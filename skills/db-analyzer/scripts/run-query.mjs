#!/usr/bin/env node
// 数据库只读查询与结构分析 —— 按环境配置连接 mysql/postgres/oracle,只读查询 + 结构探查。
// DDL/DML 写能力不存在,任何输入都会先过 lib/safety-gate.mjs 的门禁。
//
//   node run-query.mjs --list-envs                                  列已配置连接
//   node run-query.mjs --env <env> --introspect schemas             列库/schema
//   node run-query.mjs --env <env> --introspect tables [--schema x] 列表
//   node run-query.mjs --env <env> --introspect columns --table x   列字段
//   node run-query.mjs --env <env> --introspect ddl --table x       看建表语句(只读)
//   node run-query.mjs --env <env> --sql "SELECT ..."                执行只读查询
//   node run-query.mjs --env <env> --file query.sql                  同上,SQL 较长时用文件
//   --help 看全部选项。环境配置读 config/environments.yaml(见 environments.example.yaml)。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateReadOnlySql } from "../lib/safety-gate.mjs";
import * as mysqlAdapter from "../lib/adapters/mysql.mjs";
import * as postgresAdapter from "../lib/adapters/postgres.mjs";
import * as oracleAdapter from "../lib/adapters/oracle.mjs";
import * as sqliteAdapter from "../lib/adapters/sqlite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(HERE, "..", "config", "environments.yaml");
const RESULT_DUMP_PATH = join(HERE, "..", "last-query-result.txt");
const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 30000;

const ADAPTERS = { mysql: mysqlAdapter, postgres: postgresAdapter, oracle: oracleAdapter, sqlite: sqliteAdapter };

function trace(msg, extra) {
  process.stderr.write(`[db-analyzer] ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// 与 landray-log 的 query-log.mjs 用的是同一套极简 YAML 解析,故意不抽公共库——
// 每个 skill 目录要能独立迁移、独立可读,不互相依赖。
function parseSimpleYaml(text) {
  const root = {};
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!/^\s/.test(line)) {
      current = {};
      root[key] = current;
    } else if (current) {
      current[key] = val;
    }
  }
  return root;
}

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`读不到环境配置:${configPath}(照 config/environments.example.yaml 建一份)`);
  }
  return parseSimpleYaml(text);
}

// 决定读哪份配置。优先级:--config 参数 > DB_ANALYZER_CONFIG 环境变量 > 脚本旁边的默认路径。
// 打包成单文件后放到任意位置时,靠 --config/环境变量指向配置,不再被锁死在 ../config/ 下。
export function resolveConfigPath(args, env = process.env) {
  if (typeof args.config === "string") return args.config;
  if (env.DB_ANALYZER_CONFIG) return env.DB_ANALYZER_CONFIG;
  return DEFAULT_CONFIG_PATH;
}

export function pickAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`不支持的 type: ${type}(支持 mysql/postgres/oracle)`);
  return adapter;
}

export function formatTable({ columns, rows }) {
  if (rows.length === 0) return `(0 行,无结果)`;
  const widths = columns.map((c, i) =>
    Math.max(String(c).length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(columns), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map((r) => line(r))].join("\n");
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// 连接/认证类失败统一包一层提示,原始错误信息保留在末尾方便进一步排查。
export function wrapConnectionError(err, envName) {
  return new Error(
    `连接失败,核对 config/environments.yaml 里 "${envName}" 的凭证/host/port(原始错误:${errorMessage(err)})`,
  );
}

// 查询阶段失败(含真正超时)统一包一层提示,告诉使用者可以调 --timeout。
export function wrapQueryError(err, timeoutMs) {
  return new Error(`查询执行失败,如果是超时可尝试调大 --timeout(当前 ${timeoutMs}ms)(原始错误:${errorMessage(err)})`);
}

// 探查阶段失败(非连接类)统一包一层提示,指向最常见的原因:名字错了或没权限。
export function wrapIntrospectError(err, envName, opts) {
  return new Error(
    `探查失败,检查 --schema/--table 是否正确、该账号是否有权限查看该库元数据` +
      `(env=${envName}${opts.schema ? `,schema=${opts.schema}` : ""}${opts.table ? `,table=${opts.table}` : ""})` +
      `(原始错误:${errorMessage(err)})`,
  );
}

function emit(text) {
  process.stdout.write(text + "\n");
  writeFileSync(RESULT_DUMP_PATH, text, "utf8");
}

// 连接生命周期(connect -> enforceReadOnly -> 业务逻辑 -> close)在 runIntrospect/runSql 里
// 完全一样,只有中间的业务逻辑和失败时怎么包错误不同,抽成一个通用的"托管连接"帮助函数。
async function withConnection(adapter, env, envName, wrapWorkError, work) {
  let conn;
  try {
    conn = await adapter.connect(env);
  } catch (err) {
    throw wrapConnectionError(err, envName);
  }
  try {
    await adapter.enforceReadOnly(conn);
    return await work(conn);
  } catch (err) {
    throw wrapWorkError(err);
  } finally {
    await adapter.close(conn);
  }
}

// 用适配器返回的 kind 显式渲染,不靠猜返回值形状(kind: "text" 直接打印原文,
// kind: "table" 走表格;0 行给出更有针对性的提示,而不是表格的 "(0 行,无结果)")。
// introspect 不在 SQL 里套 LIMIT(要能报准总数),所以在渲染层兜底:结果超过 limit 就只渲染
// 前 limit 行并报总数——防几千张表的库把全量元数据灌进 Agent 上下文(查询走 runQuery 有自己的截断,
// 这条路径原先没有)。
export function formatIntrospectResult(result, envName, opts, limit = DEFAULT_LIMIT) {
  if (result.kind === "text") return result.content;
  if (result.rows.length === 0) {
    return `(未探查到结果,检查 env/schema/table 名是否正确:${JSON.stringify({ env: envName, ...opts })})`;
  }
  const total = result.rows.length;
  if (total > limit) {
    const shown = { columns: result.columns, rows: result.rows.slice(0, limit) };
    return (
      formatTable(shown) +
      `\n\n(共 ${total} 行,只显示前 ${limit};对象太多时别整列——用带 LIKE 的 --sql 按名字过滤,` +
      `或已知表名就直接 --introspect columns/ddl --table <表>;确要更多可调大 --limit)`
    );
  }
  return formatTable(result);
}

function runListEnvs(configPath) {
  const config = loadConfig(configPath);
  const names = Object.keys(config);
  process.stdout.write(
    (names.length ? names.map((n) => `${n} (${config[n].type})`).join("\n") : "(未配置任何连接)") + "\n",
  );
}

async function runIntrospect(envName, env, args) {
  const adapter = pickAdapter(env.type);
  const kind = args.introspect;
  const opts = { schema: args.schema, table: args.table };
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  await withConnection(adapter, env, envName, (err) => wrapIntrospectError(err, envName, opts), async (conn) => {
    trace("探查结构", { kind, ...opts });
    const result = await adapter.introspect(conn, kind, opts);
    emit(formatIntrospectResult(result, envName, opts, limit));
  });
}

async function runSql(envName, env, sql, args) {
  const check = validateReadOnlySql(sql);
  if (!check.ok) {
    throw new Error(`拒绝执行:${check.reason}`);
  }
  const adapter = pickAdapter(env.type);
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  const timeoutMs = args.timeout ? Number(args.timeout) : DEFAULT_TIMEOUT_MS;
  await withConnection(adapter, env, envName, (err) => wrapQueryError(err, timeoutMs), async (conn) => {
    trace("执行只读查询", { limit, timeoutMs });
    const result = await adapter.runQuery(conn, sql, { limit, timeoutMs });
    const text = formatTable(result) + (result.truncated ? `\n\n(已截断,加更精确的 WHERE/聚合或调大 --limit)` : "");
    emit(text);
  });
}

function printUsage() {
  process.stderr.write(
    [
      "数据库只读查询与结构分析 —— 只支持只读查询,不实现也不暴露 DDL/DML 写能力。",
      "",
      "  列连接: node run-query.mjs --list-envs",
      "  探查库: node run-query.mjs --env <env> --introspect schemas",
      "  探查表: node run-query.mjs --env <env> --introspect tables [--schema x]",
      "  探查列: node run-query.mjs --env <env> --introspect columns --table x [--schema x]",
      "  看建表: node run-query.mjs --env <env> --introspect ddl --table x [--schema x]",
      "  查数据: node run-query.mjs --env <env> --sql \"SELECT ...\"",
      "         node run-query.mjs --env <env> --file query.sql",
      "",
      "选项: --limit(默认 200) --timeout(默认 30000,单位 ms) --config <配置文件路径> --help",
      "环境/认证: 默认读脚本旁 config/environments.yaml;可用 --config 或 DB_ANALYZER_CONFIG 指定别处(见 environments.example.yaml)。",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printUsage();
  const configPath = resolveConfigPath(args);
  if (args["list-envs"]) return runListEnvs(configPath);
  if (!args.env) return printUsage(), process.exit(1);

  const config = loadConfig(configPath);
  const env = config[args.env];
  if (!env) {
    throw new Error(`环境 "${args.env}" 不在 config 里。可用:${Object.keys(config).join(", ") || "(空)"}`);
  }

  if (args.introspect) return runIntrospect(args.env, env, args);

  const sql = args.sql || (args.file ? readFileSync(args.file, "utf8") : null);
  if (!sql) return printUsage(), process.exit(1);
  return runSql(args.env, env, sql, args);
}

// process.argv[1] 在 Windows 上是 D:\... 这种无前导斜杠的路径,手写拼 file:// 前缀会跟
// import.meta.url 真实产生的 file:///D:/... 少一条斜杠对不上——用 pathToFileURL 让 Node 自己处理。
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[db-analyzer] 出错:${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

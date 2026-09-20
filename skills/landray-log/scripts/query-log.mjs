#!/usr/bin/env node
// 蓝凌日志排查:按环境用管理员账号登录 -> 用 traceId/关键字查 landrayLog -> 从返回 HTML 抽出日志。
// 该页需要管理员的 X-AUTH-TOKEN 会话,普通用户开不了,故本脚本代为登录并查询。
//
//   node query-log.mjs --env <环境> --list-services                     列该环境可查的服务
//   node query-log.mjs --env <环境> --sweep --trace <traceId>           不知在哪个服务时,并发扫全部,报出命中服务
//   node query-log.mjs --env <环境> --service <服务> --trace <traceId>  查指定服务的日志(全量打屏 + 写 last-logs.log)
//   --help 看全部选项。环境配置读 config/environments.yaml(见 environments.example.yaml)。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "..", "config", "environments.yaml");
const RAW_DUMP_PATH = join(HERE, "..", "last-response.html");
const LOGS_DUMP_PATH = join(HERE, "..", "last-logs.log");
const LOG_ENDPOINT = "/data/sys-admin/sysAdminTools/landrayLog";
const DEFAULTS = { appName: "base-server", fileName: "landray.log", level: "DEBUG" };
const SWEEP_CONCURRENCY = 6; // 跨服务扫描并发上限:一次登录、复用 token 并发查,兼顾提速与不压垮服务端

// 日志先行:关键动作打到 stderr(不污染 stdout 的日志正文),密码永不落日志。
function trace(msg, extra) {
  process.stderr.write(`[landray-log] ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`);
}

// 并发限流:items 分批跑 fn,同时在飞的不超过 limit;保持结果与输入同序。
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---- 极简 YAML 读取:仅支持本配置的两层「env: \n  key: value」结构,不引第三方依赖 ----
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
      root[key] = current; // 顶层环境名,其下挂属性
    } else if (current) {
      current[key] = val;
    }
  }
  return root;
}

function loadConfig() {
  let text;
  try {
    text = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(`读不到环境配置:${CONFIG_PATH}(照 config/environments.example.yaml 建一份)`);
  }
  return parseSimpleYaml(text);
}

// ---- 参数解析:--key value / --flag ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true; // 布尔 flag
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// ---- 登录:POST 账号密码 -> 取 X-AUTH-TOKEN(优先响应头 x-auth-token,其次 Set-Cookie,再次响应体 JSON) ----
// 登录端点/字段名可在环境配置覆盖(loginPath / usernameField / passwordField),默认走蓝凌 MK 表单登录。
async function login(env) {
  const loginPath = env.loginPath || "/data/sys-auth/login";
  const url = env.baseUrl.replace(/\/$/, "") + loginPath;
  const form = new URLSearchParams();
  form.set(env.usernameField || "j_username", env.username);
  // j_password 是服务端公钥 RSA 加密后的密文(登录页 JS 前端加密)。这里回放抓包拿到的密文即可:
  // 只要该环境公钥与密码没变,同一段密文一直能登录,省去自己取公钥 + 实现 RSA。
  form.set(env.passwordField || "j_password", env.encryptedPassword || "");
  trace("登录", { url, username: env.username });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json, text/plain, */*" },
    body: form.toString(),
    redirect: "manual",
  });
  const token = await tokenFromResponse(res);
  if (!token) {
    throw new Error(
      `自动登录未取到 x-auth-token(HTTP ${res.status})。核对 loginPath / encryptedPassword,或在 config 填 token 兜底。`,
    );
  }
  trace("登录成功,已取到 token");
  return token;
}

async function tokenFromResponse(res) {
  const headerToken = res.headers.get("x-auth-token");
  if (headerToken) return headerToken;
  const setCookie = res.headers.get("set-cookie") || "";
  const cookieMatch = /X-AUTH-TOKEN=([^;,\s]+)/i.exec(setCookie);
  if (cookieMatch) return cookieMatch[1];
  try {
    const body = await res.clone().json();
    const cand = body?.data?.token || body?.token || body?.["x-auth-token"] || body?.data?.["x-auth-token"];
    if (typeof cand === "string" && cand) return cand;
  } catch {
    /* 非 JSON 响应,忽略 */
  }
  return null;
}

async function resolveToken(env) {
  // 首选自动登录(每次拿新鲜 token,不过期);仅当没配 encryptedPassword 时退回预填 token(会过期)。
  if (env.encryptedPassword) return login(env);
  if (env.token) {
    trace("该环境未配 encryptedPassword,使用预填 token 兜底(会过期)");
    return env.token;
  }
  throw new Error("该环境既无 encryptedPassword 也无 token:抓一次登录请求,把 j_password 密文填进 config。");
}

// ---- 查询:POST landrayLog,带 token cookie + 搜索表单(字段对齐真实请求) ----
async function queryLog(env, token, params) {
  const url = env.baseUrl.replace(/\/$/, "") + LOG_ENDPOINT;
  const form = new URLSearchParams({
    method: "search",
    appName: params.appName,
    fileName: params.fileName,
    breakAddr: "",
    breakPage: "",
    beginAddr: "",
    beginPage: "",
    addressList: "",
    keyword: params.keyword,
    beginTime: params.beginTime,
    endTime: params.endTime,
    path: "",
    level: params.level,
    theadTimeout: "",
  });
  trace("查询日志", { keyword: params.keyword, appName: params.appName, level: params.level });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: `X-AUTH-TOKEN=${token}; isMkLogin=true`,
      referer: url,
      origin: env.baseUrl.replace(/\/$/, ""),
    },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`查询失败 HTTP ${res.status}(认证可能失效:核对 config 的 encryptedPassword/token)`);
  }
  return res.text();
}

// ---- 从 HTML 抽日志:优先 <pre>/<textarea> 容器,否则退回去标签取正文 ----
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

function extractLogs(html) {
  const containers = [...html.matchAll(/<(pre|textarea)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => decodeEntities(stripTags(m[2])).trim())
    .filter((s) => s.length > 0);
  if (containers.length > 0) return containers.join("\n");
  // 退回:去掉 script/style,再去标签取正文文本
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  return decodeEntities(stripTags(text))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeLoginPage(text) {
  return /(请登录|登录密码|用户名.*密码|login-form|j_username)/i.test(text);
}

// 从日志页 HTML 的 <select name="appName"> 抽出可查服务清单(不同环境各不相同,故动态取)。
function extractServices(html) {
  const sel = /<select[^>]*name=["']?appName["']?[^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!sel) return [];
  return [...sel[1].matchAll(/<option[^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]).filter(Boolean);
}

// 列服务:登录后 GET 日志页,解析 appName 下拉。GET 拿不到就退回一次空查询(其响应也带下拉)。
async function listServices(env, token) {
  const url = env.baseUrl.replace(/\/$/, "") + LOG_ENDPOINT;
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    cookie: `X-AUTH-TOKEN=${token}; isMkLogin=true`,
  };
  trace("拉取服务清单");
  let html = await (await fetch(url, { method: "GET", headers })).text();
  let services = extractServices(html);
  if (services.length === 0) {
    html = await queryLog(env, token, { ...DEFAULTS, keyword: "", beginTime: "", endTime: "" });
    services = extractServices(html);
  }
  return services;
}

// ---- 设置包/类级别日志监控:POST landrayLog method=setLogLevel,让该 appName 下指定 path(包名或类全限定名)临时按 level 输出日志。----
// 默认日志级别通常高于 DEBUG,对应包/类的 DEBUG 语句根本不会写入日志文件,单纯按关键字/traceId 查自然查不到;
// 需先在此打开监控,并让问题重新复现产生新日志,才查得到 —— 对已发生的历史请求不生效(见 runSetLogLevel 的提示)。
async function setLogLevel(env, token, { appName, path, level, timeout }) {
  const url = env.baseUrl.replace(/\/$/, "") + LOG_ENDPOINT;
  const form = new URLSearchParams({
    method: "setLogLevel",
    appName,
    breakAddr: "",
    breakPage: "",
    beginAddr: "",
    beginPage: "",
    addressList: "",
    keyword: "",
    beginTime: "",
    endTime: "",
    path,
    level,
    theadTimeout: timeout || "",
  });
  trace("设置包/类日志级别", { appName, path, level, timeout: timeout || "(服务端默认)" });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: `X-AUTH-TOKEN=${token}; isMkLogin=true`,
      referer: url,
      origin: env.baseUrl.replace(/\/$/, ""),
    },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`设置日志级别失败 HTTP ${res.status}(认证可能失效:核对 config 的 encryptedPassword/token)`);
  }
  return res.text();
}

// 列出 config/environments.yaml 里已配置的环境名——不登录、不发请求,纯读本地配置。
// 用于回答「支持哪些环境」:环境清单因人而异(各自配好自己有权限的),不能硬编码在 SKILL.md 里,只能现读。
function runListEnvs() {
  const config = loadConfig();
  const envs = Object.keys(config);
  process.stdout.write(
    (envs.length ? envs.join("\n") : "(config/environments.yaml 未配置任何环境,照 environments.example.yaml 建一份)") +
      "\n",
  );
}

// ---- 五种模式 ----

async function runListServices(env) {
  const token = await resolveToken(env);
  const services = await listServices(env, token);
  process.stdout.write((services.length ? services.join("\n") : "(未解析到服务清单,--raw 看原始页)") + "\n");
}

// 跨服务扫描:一次登录、并发查全部服务,报出命中的服务与行数(按命中降序)。
async function runSweep(env, keyword, filters) {
  const token = await resolveToken(env);
  const services = await listServices(env, token);
  trace("跨服务扫描", { services: services.length, keyword, concurrency: SWEEP_CONCURRENCY });
  const results = await mapLimit(services, SWEEP_CONCURRENCY, async (svc) => {
    try {
      const html = await queryLog(env, token, { appName: svc, ...filters, keyword, beginTime: "", endTime: "" });
      const count = extractLogs(html)
        .split("\n")
        .filter((l) => l.includes(keyword)).length;
      trace(`扫 ${svc}`, { 命中: count });
      return { svc, count };
    } catch (e) {
      trace(`扫 ${svc} 失败`, { err: e instanceof Error ? e.message : String(e) });
      return { svc, count: 0 };
    }
  });
  const hits = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const summary = hits.length
    ? "命中服务(按命中行数;再用 --service 细查):\n" + hits.map((h) => `  ${h.svc}  (${h.count} 行)`).join("\n")
    : `未在任何服务命中「${keyword}」(可能日志已滚动出窗口/traceId 过旧,或调 --level / 时间范围)`;
  process.stdout.write(summary + "\n");
}

// 查指定服务:全量日志打屏 + 写文件(默认 last-logs.log,--out 改路径)。
async function runQuery(env, args) {
  const keyword = args.trace || args.keyword;
  if (!keyword) return printUsage(), process.exit(1);
  const service =
    (typeof args.service === "string" && args.service) ||
    (typeof args.app === "string" && args.app) ||
    DEFAULTS.appName;
  const params = {
    appName: service,
    fileName: typeof args.file === "string" ? args.file : DEFAULTS.fileName,
    level: typeof args.level === "string" ? args.level : DEFAULTS.level,
    keyword,
    beginTime: typeof args.begin === "string" ? args.begin : "",
    endTime: typeof args.end === "string" ? args.end : "",
  };
  const token = await resolveToken(env);
  const html = await queryLog(env, token, params);
  if (args.raw) {
    writeFileSync(RAW_DUMP_PATH, html, "utf8");
    trace("原始 HTML 已落盘", { path: RAW_DUMP_PATH });
  }
  const logs = extractLogs(html);
  if (looksLikeLoginPage(logs)) {
    trace("返回内容疑似登录页 —— 认证可能失效,核对 config 的 encryptedPassword/token。");
  }
  const outPath = typeof args.out === "string" ? args.out : LOGS_DUMP_PATH;
  writeFileSync(outPath, logs, "utf8");
  trace("全量日志已写入文件", { path: outPath, 行数: logs.split("\n").length });
  process.stdout.write(logs + "\n");
}

// 开包/类级别 DEBUG 监控:需 --service + --path(包名或类全限定名),可选 --level(默认 DEBUG)、--timeout。
async function runSetLogLevel(env, args) {
  const service =
    (typeof args.service === "string" && args.service) || (typeof args.app === "string" && args.app);
  const path = typeof args.path === "string" && args.path;
  if (!service || !path) {
    process.stderr.write("[landray-log] --set-log-level 需要 --service <appName> 和 --path <包名或类全限定名>\n");
    return printUsage(), process.exit(1);
  }
  const level = typeof args.level === "string" ? args.level : DEFAULTS.level;
  const timeout = typeof args.timeout === "string" ? args.timeout : "";
  const token = await resolveToken(env);
  const html = await setLogLevel(env, token, { appName: service, path, level, timeout });
  const result = extractLogs(html);
  if (looksLikeLoginPage(result)) {
    trace("返回内容疑似登录页 —— 认证可能失效,核对 config 的 encryptedPassword/token。");
  }
  trace("已下发监控设置,只对之后新产生的日志生效 —— 让问题重新复现,再用 --sweep 或指定服务查询", {
    appName: service,
    path,
    level,
  });
  process.stdout.write((result || "(无返回正文,以 HTTP 状态为准,请求已下发)") + "\n");
}

function printUsage() {
  process.stderr.write(
    [
      "蓝凌日志排查 —— 按 traceId/关键字查某环境某服务的服务端日志(代管理员登录)。",
      "",
      "  列环境: node query-log.mjs --list-envs                              列 config 里已配置的环境(不登录)",
      "  列服务: node query-log.mjs --env <环境> --list-services",
      "  定位:   node query-log.mjs --env <环境> --sweep --trace <traceId>   # 不知在哪个服务,并发扫全部",
      "  查日志: node query-log.mjs --env <环境> --service <服务> --trace <traceId>",
      "  开监控: node query-log.mjs --env <环境> --service <服务> --set-log-level --path <包名或类全限定名> [--level DEBUG]",
      "          查不到时常见原因:该包/类默认日志级别高于 DEBUG,没写入日志文件;开监控只对之后新产生的日志生效,",
      "          需让问题重新复现再查。示例 path: com.landray.ai.lanbots.chat(对应服务 ai-lanbots-server)。",
      "",
      "选项: --keyword(同 --trace)  --file(默认 landray.log)  --level(默认 DEBUG)  --begin/--end 时间范围",
      "      --out <文件>(全量另存,默认 last-logs.log)  --raw(存原始 HTML)  --timeout(仅 --set-log-level,对应服务端 theadTimeout)  --help",
      "环境/认证: config/environments.yaml(见 environments.example.yaml)。",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printUsage();
  if (args["list-envs"]) return runListEnvs();
  if (!args.env) return printUsage(), process.exit(1);
  const config = loadConfig();
  const env = config[args.env];
  if (!env) {
    throw new Error(`环境 "${args.env}" 不在 config 里。可用:${Object.keys(config).join(", ") || "(空)"}`);
  }
  const filters = {
    fileName: typeof args.file === "string" ? args.file : DEFAULTS.fileName,
    level: typeof args.level === "string" ? args.level : DEFAULTS.level,
  };

  if (args["list-services"]) return runListServices(env);
  if (args["set-log-level"]) return runSetLogLevel(env, args);
  if (args.sweep) {
    const keyword = args.trace || args.keyword;
    if (!keyword) return printUsage(), process.exit(1);
    return runSweep(env, keyword, filters);
  }
  return runQuery(env, args);
}

main().catch((err) => {
  process.stderr.write(`[landray-log] 出错:${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

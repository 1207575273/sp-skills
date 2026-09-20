# db-analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `skills/db-analyzer`,一个支持 MySQL/PostgreSQL/Oracle 的只读查询与结构分析 skill,按环境配置连接,DDL/DML 写能力完全不实现、不暴露。

**Architecture:** 统一 CLI 入口(`scripts/run-query.mjs`)按 env 的 `type` 分发到对应方言适配器(`lib/adapters/{mysql,postgres,oracle}.mjs`);所有适配器共享同一个数据库无关的只读语句门禁(`lib/safety-gate.mjs`);每次查询独立开连接并立即下发引擎级只读事务指令,不做连接池。SQL 构造(要发给数据库的语句文本)与 SQL 执行(实际网络 I/O)在每个适配器内部拆成纯函数和薄封装两部分,纯函数部分做单元测试,I/O 部分留到最后一个任务做真实数据库的人工验证。

**Tech Stack:** Node.js(`.mjs` ESM,与 `landray-log` 保持一致的文件后缀风格)、`mysql2`、`pg`、`oracledb`(Thin 模式)、Vitest(单测,项目 CLAUDE.md 规定的 JS/TS 测试框架)。

## Global Constraints

- Node.js >= 18(与 landray-log 一致)。
- 任何路径、任何隐藏 flag 都不得实现或暴露 DDL/INSERT/UPDATE/DELETE 等写能力——不是靠文档提示,是代码里压根不存在这个入口。
- Oracle 必须用 Thin 模式:代码中禁止调用 `oracledb.initOracleClient()`(调用它会切到需要本地 Instant Client 的 Thick 模式)。
- 每次查询独立开连接,不做连接池;每次连接后必须先下发引擎级只读事务指令,再执行用户查询。
- 配置到具体库级别(`type` + host/port/database 或 serviceName + user/password),不做"服务器级连接 + 候选库列表"。
- `config/environments.yaml` 真实凭证不入库;`.gitignore` 写完必须用 `git check-ignore -v config/environments.yaml` 实际验证生效(不是写了就假设生效——landray-log 上出过这个事故)。
- 默认行数上限 200(`--limit` 可调),默认查询超时 30000ms(`--timeout` 可调)。
- 所有面向用户的文本(SKILL.md、README、CLI 输出、错误信息)用中文,不用 emoji 或装饰符号,状态用 `[INFO]/[FAIL]` 这类文字前缀(与 landray-log 一致)。
- 不引入 ORM/查询构建器;不做分页游标,只做 limit + 截断提示。

---

## 文件结构总览

```
skills/db-analyzer/
├── SKILL.md
├── README.md
├── .gitignore
├── package.json
├── config/
│   └── environments.example.yaml
├── lib/
│   ├── safety-gate.mjs
│   ├── safety-gate.test.mjs
│   ├── adapters/
│   │   ├── mysql.mjs
│   │   ├── mysql.test.mjs
│   │   ├── postgres.mjs
│   │   ├── postgres.test.mjs
│   │   ├── oracle.mjs
│   │   └── oracle.test.mjs
└── scripts/
    ├── run-query.mjs
    └── run-query.test.mjs
```

---

### Task 1: 项目脚手架与配置模型

**Files:**
- Create: `skills/db-analyzer/package.json`
- Create: `skills/db-analyzer/.gitignore`
- Create: `skills/db-analyzer/config/environments.example.yaml`
- Create: `skills/db-analyzer/README.md`(占位,Task 7 补全正文)

**Interfaces:**
- Produces: `package.json` 声明的依赖(`mysql2`/`pg`/`oracledb`/`vitest`)供后续所有任务使用;`config/environments.example.yaml` 的字段形状供 Task 6 的配置加载器和 Task 7 的文档引用。

- [ ] **Step 1: 创建目录骨架**

```bash
mkdir -p "D:\A_landray_ws\landary_work_e\skills\db-analyzer\config"
mkdir -p "D:\A_landray_ws\landary_work_e\skills\db-analyzer\lib\adapters"
mkdir -p "D:\A_landray_ws\landary_work_e\skills\db-analyzer\scripts"
```

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "db-analyzer",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "mysql2": "^3.11.0",
    "pg": "^8.13.0",
    "oracledb": "^6.6.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: 安装依赖**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npm install
```

Expected: 生成 `package-lock.json` 和 `node_modules/`,无报错退出。

- [ ] **Step 4: 写 `.gitignore`**

```
config/environments.yaml
node_modules/
last-query-result.txt
```

- [ ] **Step 5: 验证 `.gitignore` 真的生效(不是假设,是实测)**

```bash
cd "D:\A_landray_ws\landary_work_e" && touch skills/db-analyzer/config/environments.yaml
git check-ignore -v skills/db-analyzer/config/environments.yaml
```

Expected: 输出一行形如 `skills/db-analyzer/.gitignore:1:config/environments.yaml	skills/db-analyzer/config/environments.yaml`,确认该规则命中。如果没有输出(说明没生效),必须先修好 `.gitignore` 再继续——这一步不能跳过,landray-log 就是在这一步偷懒过一次导致凭证进了 git 历史。

```bash
git check-ignore -v skills/db-analyzer/node_modules/mysql2/package.json
```

Expected: 同样有输出,确认 `node_modules/` 规则也生效。验证完删掉刚才 touch 的空文件:

```bash
rm skills/db-analyzer/config/environments.yaml
```

- [ ] **Step 6: 写 `config/environments.example.yaml`**

```yaml
# 数据库分析 skill - 环境配置模板(每个连接一段,新增连接照抄一段改值即可)。
# 复制成同目录 environments.yaml,填自己有权限的库。真实配置不入库(见 .gitignore)。
#
# type 支持: mysql / postgres / oracle
# 每个条目直接对应一个具体的库/服务,不是"服务器级连接 + 候选库列表"。

mkdev01-mysql:
  type: mysql
  host: <主机名或IP>
  port: 3306
  database: <库名>
  user: <账号>
  password: <密码>

mkdev01-pg:
  type: postgres
  host: <主机名或IP>
  port: 5432
  database: <库名>
  user: <账号>
  password: <密码>

mkdev01-oracle:
  type: oracle
  host: <主机名或IP>
  port: 1521
  serviceName: <service name,不是 SID>
  user: <账号>
  password: <密码>
```

- [ ] **Step 7: 写 README.md 占位**

```markdown
# db-analyzer —— 数据库只读查询与结构分析

详见 SKILL.md。本文件在 Task 7 补全使用说明。
```

- [ ] **Step 8: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/package.json skills/db-analyzer/package-lock.json skills/db-analyzer/.gitignore skills/db-analyzer/config/environments.example.yaml skills/db-analyzer/README.md
git status
```

Expected: 确认 `git status` 里**没有** `skills/db-analyzer/config/environments.yaml` 或任何 `node_modules/` 路径出现在待提交列表——如果出现了,说明 Step 5 的验证有问题,回去重查。确认无误后提交:

```bash
git commit -m "chore: db-analyzer 项目脚手架"
```

---

### Task 2: 只读语句门禁(safety-gate)

**Files:**
- Create: `skills/db-analyzer/lib/safety-gate.mjs`
- Test: `skills/db-analyzer/lib/safety-gate.test.mjs`

**Interfaces:**
- Produces:
  - `validateReadOnlySql(rawSql: string) -> { ok: boolean, reason?: string }`
  - `isRowsetStatement(rawSql: string) -> boolean`(true 表示 SELECT/WITH 这类可以用子查询包 LIMIT 的语句,false 表示 EXPLAIN/SHOW/DESCRIBE 这类不能包的)
- 供 Task 3/4/5 的适配器和 Task 6 的 CLI 使用。

- [ ] **Step 1: 写失败测试**

`skills/db-analyzer/lib/safety-gate.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { validateReadOnlySql, isRowsetStatement } from "./safety-gate.mjs";

describe("validateReadOnlySql", () => {
  it("放行普通 SELECT", () => {
    expect(validateReadOnlySql("SELECT * FROM t WHERE id = 1")).toEqual({ ok: true });
  });

  it("放行 WITH(CTE)只读查询", () => {
    expect(
      validateReadOnlySql("WITH a AS (SELECT id FROM t) SELECT * FROM a"),
    ).toEqual({ ok: true });
  });

  it("放行 EXPLAIN/SHOW/DESCRIBE", () => {
    expect(validateReadOnlySql("EXPLAIN SELECT * FROM t")).toEqual({ ok: true });
    expect(validateReadOnlySql("SHOW CREATE TABLE t")).toEqual({ ok: true });
    expect(validateReadOnlySql("DESCRIBE t")).toEqual({ ok: true });
    expect(validateReadOnlySql("DESC t")).toEqual({ ok: true });
  });

  it("不区分大小写、允许前导空白", () => {
    expect(validateReadOnlySql("  select 1")).toEqual({ ok: true });
  });

  it("允许一个可选的结尾分号", () => {
    expect(validateReadOnlySql("SELECT 1;")).toEqual({ ok: true });
  });

  it("拒绝空 SQL", () => {
    expect(validateReadOnlySql("").ok).toBe(false);
    expect(validateReadOnlySql("   ").ok).toBe(false);
  });

  it("拒绝分号分隔的多条语句", () => {
    const r = validateReadOnlySql("SELECT 1; DROP TABLE t;");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/多条语句/);
  });

  it("不把注释里的分号误判成多语句(注释本身对数据库也是惰性的)", () => {
    expect(validateReadOnlySql("SELECT 1; -- DROP TABLE x").ok).toBe(true);
    expect(validateReadOnlySql("SELECT 1 /* ; DROP TABLE x */").ok).toBe(true);
  });

  it("拒绝非只读开头的语句", () => {
    expect(validateReadOnlySql("INSERT INTO t VALUES (1)").ok).toBe(false);
    expect(validateReadOnlySql("UPDATE t SET x = 1").ok).toBe(false);
    expect(validateReadOnlySql("DELETE FROM t").ok).toBe(false);
    expect(validateReadOnlySql("DROP TABLE t").ok).toBe(false);
    expect(validateReadOnlySql("CREATE TABLE t (id INT)").ok).toBe(false);
    expect(validateReadOnlySql("ALTER TABLE t ADD COLUMN x INT").ok).toBe(false);
    expect(validateReadOnlySql("TRUNCATE TABLE t").ok).toBe(false);
    expect(validateReadOnlySql("GRANT SELECT ON t TO u").ok).toBe(false);
  });

  it("拒绝把写操作藏进 CTE 里(WITH 开头但内部有 DELETE)", () => {
    const r = validateReadOnlySql(
      "WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t",
    );
    expect(r.ok).toBe(false);
  });

  it("拒绝用户 SQL 里出现 SET/COMMIT/ROLLBACK 等会话与事务控制语句", () => {
    expect(validateReadOnlySql("SET SESSION TRANSACTION READ ONLY").ok).toBe(false);
    expect(validateReadOnlySql("COMMIT").ok).toBe(false);
  });

  it("不误伤名字里带 update/create 等词的普通列(单词边界判断)", () => {
    expect(
      validateReadOnlySql("SELECT update_time, create_by FROM t").ok,
    ).toBe(true);
  });

  it("拒绝字符串里包含分号但结构上仍是单语句的情况要放行(不误伤)", () => {
    expect(validateReadOnlySql("SELECT * FROM t WHERE name = 'a;b'").ok).toBe(true);
  });
});

describe("isRowsetStatement", () => {
  it("SELECT/WITH 是可包 LIMIT 的行集语句", () => {
    expect(isRowsetStatement("SELECT * FROM t")).toBe(true);
    expect(isRowsetStatement("WITH a AS (SELECT 1) SELECT * FROM a")).toBe(true);
  });

  it("EXPLAIN/SHOW/DESCRIBE 不是", () => {
    expect(isRowsetStatement("EXPLAIN SELECT * FROM t")).toBe(false);
    expect(isRowsetStatement("SHOW CREATE TABLE t")).toBe(false);
    expect(isRowsetStatement("DESCRIBE t")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败(文件还不存在)**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/safety-gate.test.mjs
```

Expected: FAIL,报 `Cannot find module './safety-gate.mjs'` 或等价的找不到模块错误。

- [ ] **Step 3: 实现 `lib/safety-gate.mjs`**

```js
// 只读语句门禁:数据库无关的第一道防线,执行前拦截。
// 注意这不是完整的 SQL 解析器,是尽力而为的结构性检查——真正兜底的是每个适配器
// 连接后下发的引擎级只读事务指令(见 adapters/*.mjs 的 enforceReadOnly),
// 这里的作用是"绝大多数误用/明显违规在发出网络请求前就被挡掉,报错也更好懂"。

const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g;
const LINE_COMMENT = /--[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

function stripNoise(sql) {
  return sql.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ").replace(STRING_LITERAL, "''");
}

const LEADING_ALLOWED = /^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC)\b/i;
const LEADING_ROWSET = /^\s*(SELECT|WITH)\b/i;
// "SHOW CREATE TABLE/VIEW ..." 是合法只读内省语句(查看建表语句用),
// 但它字面包含 CREATE 一词,会被下面的 FORBIDDEN 扫描误伤,查 FORBIDDEN 前先把这个固定搭配挖掉。
const SHOW_CREATE_IDIOM = /\bSHOW\s+CREATE\b/gi;
const FORBIDDEN = new RegExp(
  "\\b(" +
    [
      "INSERT",
      "UPDATE",
      "DELETE",
      "DROP",
      "ALTER",
      "TRUNCATE",
      "CREATE",
      "GRANT",
      "REVOKE",
      "MERGE",
      "CALL",
      "EXEC",
      "EXECUTE",
      "REPLACE",
      "SET",
      "LOCK",
      "UNLOCK",
      "COMMIT",
      "ROLLBACK",
      "SAVEPOINT",
      "BEGIN",
      "VACUUM",
      "COPY",
      "DO",
    ].join("|") +
    ")\\b",
  "i",
);

export function validateReadOnlySql(rawSql) {
  const sql = typeof rawSql === "string" ? rawSql.trim() : "";
  if (!sql) return { ok: false, reason: "SQL 为空" };

  const clean = stripNoise(sql).trim();
  const withoutTrailingSemicolon = clean.replace(/;\s*$/, "");

  if (withoutTrailingSemicolon.includes(";")) {
    return { ok: false, reason: "仅支持单条只读语句,检测到多条语句(分号分隔)" };
  }
  if (!LEADING_ALLOWED.test(withoutTrailingSemicolon)) {
    return { ok: false, reason: "仅支持只读查询(SELECT/WITH/EXPLAIN/SHOW/DESCRIBE 开头)" };
  }
  const forbiddenCheckText = withoutTrailingSemicolon.replace(SHOW_CREATE_IDIOM, "SHOW_CREATE_IDIOM_OK");
  if (FORBIDDEN.test(forbiddenCheckText)) {
    return { ok: false, reason: "仅支持只读查询,检测到写操作或事务/会话控制关键字" };
  }
  return { ok: true };
}

export function isRowsetStatement(rawSql) {
  const sql = typeof rawSql === "string" ? rawSql.trim() : "";
  const clean = stripNoise(sql).trim();
  return LEADING_ROWSET.test(clean);
}
```

- [ ] **Step 4: 跑测试确认全部通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/safety-gate.test.mjs
```

Expected: PASS,所有 use case 通过。如果"不误伤 update_time/create_by"这条失败,检查 `FORBIDDEN` 是不是用了 `\b`(单词边界)而不是裸字符串匹配。

- [ ] **Step 5: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/lib/safety-gate.mjs skills/db-analyzer/lib/safety-gate.test.mjs
git commit -m "feat: db-analyzer 只读语句门禁"
```

---

### Task 3: MySQL 适配器

**Files:**
- Create: `skills/db-analyzer/lib/adapters/mysql.mjs`
- Test: `skills/db-analyzer/lib/adapters/mysql.test.mjs`

**Interfaces:**
- Consumes: `isRowsetStatement` from `../safety-gate.mjs`。
- Produces(供 Task 6 CLI 使用,三个适配器保持相同签名):
  - `wrapForLimit(sql: string, limit: number) -> string`(纯函数,可单测)
  - `buildIntrospectQuery(kind: 'schemas'|'tables'|'columns'|'ddl', opts: { schema?: string, table?: string }) -> { sql: string, params: any[] }`(纯函数,可单测)
  - `async connect(envConfig) -> conn`
  - `async enforceReadOnly(conn) -> void`
  - `async runQuery(conn, sql, { limit, timeoutMs }) -> { columns: string[], rows: any[][], truncated: boolean }`
  - `async introspect(conn, kind, opts) -> { columns: string[], rows: any[][] } | { ddl: string }`
  - `async close(conn) -> void`

- [ ] **Step 1: 写纯函数的失败测试**

`skills/db-analyzer/lib/adapters/mysql.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery } from "./mysql.mjs";

describe("mysql wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT,用于判断是否截断", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("mysql buildIntrospectQuery", () => {
  it("schemas: 查 information_schema.SCHEMATA", () => {
    const { sql, params } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/information_schema\.SCHEMATA/i);
    expect(params).toEqual([]);
  });

  it("tables: 按 schema 过滤", () => {
    const { sql, params } = buildIntrospectQuery("tables", { schema: "biz" });
    expect(sql).toMatch(/information_schema\.TABLES/i);
    expect(params).toEqual(["biz"]);
  });

  it("columns: 按 schema + table 过滤", () => {
    const { sql, params } = buildIntrospectQuery("columns", { schema: "biz", table: "orders" });
    expect(sql).toMatch(/information_schema\.COLUMNS/i);
    expect(params).toEqual(["biz", "orders"]);
  });

  it("ddl: 用 SHOW CREATE TABLE,反引号转义表名里的反引号", () => {
    const { sql, params } = buildIntrospectQuery("ddl", { table: "weird`name" });
    expect(sql).toBe("SHOW CREATE TABLE `weird``name`");
    expect(params).toEqual([]);
  });

  it("缺必填参数时抛错而不是拼出坏 SQL", () => {
    expect(() => buildIntrospectQuery("tables", {})).toThrow();
    expect(() => buildIntrospectQuery("columns", { schema: "biz" })).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/mysql.test.mjs
```

Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 `lib/adapters/mysql.mjs`**

```js
import mysql from "mysql2/promise";
import { isRowsetStatement } from "../safety-gate.mjs";

// 把用户查询包一层子查询加 LIMIT(limit+1,用于判断是否被截断)。
// 只对 SELECT/WITH 这类行集语句调用,EXPLAIN/SHOW/DESCRIBE 不走这条路径。
export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) AS db_analyzer_sub LIMIT ${limit + 1}`;
}

function escapeIdent(name) {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      return {
        sql: "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        params: [],
      };
    case "tables":
      if (!opts.schema) throw new Error("tables 需要 schema");
      return {
        sql:
          "SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type FROM information_schema.TABLES " +
          "WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
        params: [opts.schema],
      };
    case "columns":
      if (!opts.schema || !opts.table) throw new Error("columns 需要 schema 和 table");
      return {
        sql:
          "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable, " +
          "COLUMN_DEFAULT AS column_default FROM information_schema.COLUMNS " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        params: [opts.schema, opts.table],
      };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return { sql: `SHOW CREATE TABLE ${escapeIdent(opts.table)}`, params: [] };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  return mysql.createConnection({
    host: envConfig.host,
    port: Number(envConfig.port), // config 是从 yaml 读出来的字符串,驱动要数字
    database: envConfig.database,
    user: envConfig.user,
    password: envConfig.password,
  });
}

export async function enforceReadOnly(conn) {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const wrapped = isRowsetStatement(sql) ? wrapForLimit(sql, limit) : sql;
  const [rows, fields] = await conn.query({ sql: wrapped, timeout: timeoutMs });
  const columns = fields ? fields.map((f) => f.name) : [];
  const truncated = isRowsetStatement(sql) && rows.length > limit;
  const finalRows = truncated ? rows.slice(0, limit) : rows;
  return { columns, rows: finalRows.map((r) => columns.map((c) => r[c])), truncated };
}

export async function introspect(conn, kind, opts) {
  const { sql, params } = buildIntrospectQuery(kind, opts);
  const [rows, fields] = await conn.query(sql, params);
  if (kind === "ddl") {
    const row = rows[0] || {};
    return { ddl: row["Create Table"] ?? row["create table"] ?? "" };
  }
  const columns = fields.map((f) => f.name);
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.end();
}
```

- [ ] **Step 4: 跑测试确认纯函数部分通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/mysql.test.mjs
```

Expected: PASS。`connect`/`enforceReadOnly`/`runQuery`/`introspect`/`close` 这几个依赖真实网络连接的函数不在这一步单测覆盖,留到 Task 8 用真实 MySQL 实例人工验证。

- [ ] **Step 5: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/lib/adapters/mysql.mjs skills/db-analyzer/lib/adapters/mysql.test.mjs
git commit -m "feat: db-analyzer MySQL 适配器"
```

---

### Task 4: PostgreSQL 适配器

**Files:**
- Create: `skills/db-analyzer/lib/adapters/postgres.mjs`
- Test: `skills/db-analyzer/lib/adapters/postgres.test.mjs`

**Interfaces:**
- Consumes: `isRowsetStatement` from `../safety-gate.mjs`。
- Produces: 与 Task 3 相同的六个导出,另加 `formatDdlFromRows({ table, columns, indexes, constraints }) -> string`(纯函数,PG 没有内置单命令导出 DDL,这里手工拼一份够用于阅读理解的还原文本,不保证与 `pg_dump` 逐字节一致)。

- [ ] **Step 1: 写纯函数的失败测试**

`skills/db-analyzer/lib/adapters/postgres.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery, formatDdlFromRows } from "./postgres.mjs";

describe("postgres wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("postgres buildIntrospectQuery", () => {
  it("schemas: 查 information_schema.schemata", () => {
    const { sql, params } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/information_schema\.schemata/i);
    expect(params).toEqual([]);
  });

  it("tables: schema 缺省为 public", () => {
    const { sql, params } = buildIntrospectQuery("tables", {});
    expect(sql).toMatch(/information_schema\.tables/i);
    expect(params).toEqual(["public"]);
  });

  it("tables: 显式传 schema 时用传入值", () => {
    const { params } = buildIntrospectQuery("tables", { schema: "biz" });
    expect(params).toEqual(["biz"]);
  });

  it("columns: 需要 table,schema 缺省 public", () => {
    const { sql, params } = buildIntrospectQuery("columns", { table: "orders" });
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(params).toEqual(["public", "orders"]);
  });

  it("ddl: 返回三条独立查询(columns/indexes/constraints)供拼装", () => {
    const q = buildIntrospectQuery("ddl", { table: "orders" });
    expect(q.columnsQuery.params).toEqual(["public", "orders"]);
    expect(q.indexesQuery.params).toEqual(["public", "orders"]);
    expect(q.constraintsQuery.params).toEqual(["public", "orders"]);
  });

  it("缺必填参数时抛错", () => {
    expect(() => buildIntrospectQuery("columns", {})).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});

describe("postgres formatDdlFromRows", () => {
  it("拼出可读的建表还原文本,包含列/索引/约束", () => {
    const text = formatDdlFromRows({
      schema: "public",
      table: "orders",
      columns: [
        { column_name: "id", data_type: "integer", is_nullable: "NO", column_default: null },
        { column_name: "name", data_type: "character varying", is_nullable: "YES", column_default: null },
      ],
      indexes: [{ indexdef: "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)" }],
      constraints: [{ conname: "orders_pkey", definition: "PRIMARY KEY (id)" }],
    });
    expect(text).toContain("public.orders");
    expect(text).toContain("id integer NOT NULL");
    expect(text).toContain("name character varying");
    expect(text).toContain("orders_pkey");
    expect(text).toContain("PRIMARY KEY (id)");
    expect(text).toContain("尽力还原");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/postgres.test.mjs
```

Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 `lib/adapters/postgres.mjs`**

```js
import pg from "pg";
import { isRowsetStatement } from "../safety-gate.mjs";

const { Client } = pg;

export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) AS db_analyzer_sub LIMIT ${limit + 1}`;
}

export function buildIntrospectQuery(kind, opts) {
  const schema = opts.schema || "public";
  switch (kind) {
    case "schemas":
      return { sql: "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name", params: [] };
    case "tables":
      return {
        sql:
          "SELECT table_name, table_type FROM information_schema.tables " +
          "WHERE table_schema = $1 ORDER BY table_name",
        params: [schema],
      };
    case "columns":
      if (!opts.table) throw new Error("columns 需要 table");
      return {
        sql:
          "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
          "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        params: [schema, opts.table],
      };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return {
        columnsQuery: {
          sql:
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
            "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
          params: [schema, opts.table],
        },
        indexesQuery: {
          sql: "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2",
          params: [schema, opts.table],
        },
        constraintsQuery: {
          sql:
            "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint " +
            "WHERE conrelid = ($1 || '.' || $2)::regclass",
          params: [schema, opts.table],
        },
      };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export function formatDdlFromRows({ schema, table, columns, indexes, constraints }) {
  const columnLines = columns.map((c) => {
    const notNull = c.is_nullable === "NO" ? " NOT NULL" : "";
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
    return `  ${c.column_name} ${c.data_type}${notNull}${def}`;
  });
  const lines = [
    `-- 尽力还原,不保证与 pg_dump 逐字节一致,足够用于理解结构`,
    `CREATE TABLE ${schema}.${table} (`,
    columnLines.join(",\n"),
    ");",
    "",
    "-- 索引",
    ...indexes.map((i) => i.indexdef + ";"),
    "",
    "-- 约束",
    ...constraints.map((c) => `-- ${c.conname}: ${c.definition}`),
  ];
  return lines.join("\n");
}

export async function connect(envConfig) {
  const client = new Client({
    host: envConfig.host,
    port: Number(envConfig.port), // config 是从 yaml 读出来的字符串,驱动要数字
    database: envConfig.database,
    user: envConfig.user,
    password: envConfig.password,
  });
  await client.connect();
  return client;
}

export async function enforceReadOnly(conn) {
  await conn.query("SET default_transaction_read_only = on");
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const wrapped = isRowsetStatement(sql) ? wrapForLimit(sql, limit) : sql;
  await conn.query(`SET statement_timeout = ${timeoutMs}`);
  const result = await conn.query(wrapped);
  const columns = result.fields.map((f) => f.name);
  const truncated = isRowsetStatement(sql) && result.rows.length > limit;
  const finalRows = truncated ? result.rows.slice(0, limit) : result.rows;
  return { columns, rows: finalRows.map((r) => columns.map((c) => r[c])), truncated };
}

export async function introspect(conn, kind, opts) {
  if (kind === "ddl") {
    const q = buildIntrospectQuery("ddl", opts);
    // pg.Client 是单连接,不支持同一连接上并发查询(Promise.all 会触发废弃警告,
    // 未来版本直接报错),这三条查询必须顺序执行。
    const columnsRes = await conn.query(q.columnsQuery.sql, q.columnsQuery.params);
    const indexesRes = await conn.query(q.indexesQuery.sql, q.indexesQuery.params);
    const constraintsRes = await conn.query(q.constraintsQuery.sql, q.constraintsQuery.params);
    const ddl = formatDdlFromRows({
      schema: opts.schema || "public",
      table: opts.table,
      columns: columnsRes.rows,
      indexes: indexesRes.rows,
      constraints: constraintsRes.rows,
    });
    return { ddl };
  }
  const { sql, params } = buildIntrospectQuery(kind, opts);
  const result = await conn.query(sql, params);
  const columns = result.fields.map((f) => f.name);
  return { columns, rows: result.rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.end();
}
```

- [ ] **Step 4: 跑测试确认纯函数部分通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/postgres.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/lib/adapters/postgres.mjs skills/db-analyzer/lib/adapters/postgres.test.mjs
git commit -m "feat: db-analyzer PostgreSQL 适配器"
```

---

### Task 5: Oracle 适配器(Thin 模式)

**Files:**
- Create: `skills/db-analyzer/lib/adapters/oracle.mjs`
- Test: `skills/db-analyzer/lib/adapters/oracle.test.mjs`

**Interfaces:**
- Consumes: `isRowsetStatement` from `../safety-gate.mjs`。
- Produces: 与 Task 3 相同的六个导出。**必须确认全文件不出现 `initOracleClient` 调用**(否则会切到需要本地 Instant Client 的 Thick 模式,违反 Global Constraints)。

- [ ] **Step 1: 写纯函数的失败测试**

`skills/db-analyzer/lib/adapters/oracle.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery } from "./oracle.mjs";

describe("oracle wrapForLimit", () => {
  it("用子查询包一层并用 FETCH FIRST N ROWS ONLY(limit+1)", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) db_analyzer_sub FETCH FIRST 201 ROWS ONLY",
    );
  });
});

describe("oracle buildIntrospectQuery", () => {
  it("schemas: 查 ALL_TABLES 里的 DISTINCT OWNER", () => {
    const { sql, binds } = buildIntrospectQuery("schemas", {});
    expect(sql).toMatch(/ALL_TABLES/);
    expect(binds).toEqual({});
  });

  it("tables: 按 schema(OWNER)过滤,用命名绑定变量", () => {
    const { sql, binds } = buildIntrospectQuery("tables", { schema: "BIZ" });
    expect(sql).toMatch(/ALL_TABLES/);
    expect(sql).toMatch(/:schema/);
    expect(binds).toEqual({ schema: "BIZ" });
  });

  it("columns: 按 schema + table 过滤,绑定变量名不用 :table(TABLE 是 Oracle 保留字,会报 ORA-01745)", () => {
    const { sql, binds } = buildIntrospectQuery("columns", { schema: "BIZ", table: "ORDERS" });
    expect(sql).toMatch(/ALL_TAB_COLUMNS/);
    expect(sql).not.toMatch(/:table\b/i);
    expect(binds).toEqual({ schema: "BIZ", tname: "ORDERS" });
  });

  it("ddl: 用 DBMS_METADATA.GET_DDL,同样不用 :table 这个绑定变量名", () => {
    const { sql, binds } = buildIntrospectQuery("ddl", { schema: "BIZ", table: "ORDERS" });
    expect(sql).toMatch(/DBMS_METADATA\.GET_DDL/);
    expect(sql).not.toMatch(/:table\b/i);
    expect(binds).toEqual({ objectType: "TABLE", tname: "ORDERS", schema: "BIZ" });
  });

  it("缺必填参数时抛错", () => {
    expect(() => buildIntrospectQuery("tables", {})).toThrow();
    expect(() => buildIntrospectQuery("columns", { schema: "BIZ" })).toThrow();
    expect(() => buildIntrospectQuery("ddl", { schema: "BIZ" })).toThrow();
  });
});

describe("Thin 模式约束", () => {
  it("adapter 源文件的实际代码里不出现 initOracleClient 调用(否则会切到需要本地 Instant Client 的 Thick 模式)", () => {
    const src = readFileSync(fileURLToPath(new URL("./oracle.mjs", import.meta.url)), "utf8");
    // 去掉行注释再查——允许注释里提醒"不要调这个函数",但代码本身绝对不能调用它。
    const withoutLineComments = src.replace(/\/\/[^\n]*/g, "");
    expect(withoutLineComments).not.toMatch(/initOracleClient/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/oracle.test.mjs
```

Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 `lib/adapters/oracle.mjs`**

```js
import oracledb from "oracledb";
import { isRowsetStatement } from "../safety-gate.mjs";

// 全局只设一次:DBMS_METADATA.GET_DDL 返回 CLOB,不设这个会拿到 Lob 流对象而不是字符串。
// 不调用 oracledb.initOracleClient() —— 一旦调用会切到需要本地装 Oracle Instant Client 的
// Thick 模式,违反本 skill"免装数据库客户端"的前提,任何改动这个文件的人都不要加这行。
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// 别名不能以下划线开头 —— Oracle 裸标识符必须以字母开头,"_xxx" 会报 ORA-00911: invalid character
// (MySQL/PostgreSQL 不管这个,三个方言统一不用下划线开头是为了避免以后又踩一次)。
export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) db_analyzer_sub FETCH FIRST ${limit + 1} ROWS ONLY`;
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      return { sql: "SELECT DISTINCT OWNER AS schema_name FROM ALL_TABLES ORDER BY OWNER", binds: {} };
    case "tables":
      if (!opts.schema) throw new Error("tables 需要 schema");
      return {
        sql: "SELECT TABLE_NAME AS table_name FROM ALL_TABLES WHERE OWNER = :schema ORDER BY TABLE_NAME",
        binds: { schema: opts.schema },
      };
    case "columns":
      // 绑定变量名不能叫 :table —— TABLE 是 Oracle 保留字,即使带冒号前缀也会报
      // ORA-01745: invalid host/bind variable name,改叫 :tname。
      if (!opts.schema || !opts.table) throw new Error("columns 需要 schema 和 table");
      return {
        sql:
          "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, NULLABLE AS nullable, " +
          "DATA_DEFAULT AS data_default FROM ALL_TAB_COLUMNS " +
          "WHERE OWNER = :schema AND TABLE_NAME = :tname ORDER BY COLUMN_ID",
        binds: { schema: opts.schema, tname: opts.table },
      };
    case "ddl":
      if (!opts.schema || !opts.table) throw new Error("ddl 需要 schema 和 table");
      return {
        sql: "SELECT DBMS_METADATA.GET_DDL(:objectType, :tname, :schema) AS ddl FROM DUAL",
        binds: { objectType: "TABLE", tname: opts.table, schema: opts.schema },
      };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  return oracledb.getConnection({
    connectString: `${envConfig.host}:${envConfig.port}/${envConfig.serviceName}`,
    user: envConfig.user,
    password: envConfig.password,
  });
}

export async function enforceReadOnly(conn) {
  await conn.execute("SET TRANSACTION READ ONLY");
  // 已实测:Oracle 的只读事务只挡 DML(INSERT/UPDATE/DELETE,ORA-01456),挡不住 DDL——
  // DDL 语句会隐式提交当前事务、另起一个默认可写的新事务,SET TRANSACTION READ ONLY 管不到它。
  // 这意味着对 Oracle 来说,应用层语句门禁(safety-gate.mjs)是防 DDL 的唯一真实防线,
  // 账号本身有没有 DDL 权限就变得至关重要——这里主动查一下当前账号有没有明显的 DDL 权限并提醒使用者。
  const ddlPrivs = await conn.execute(
    "SELECT PRIVILEGE FROM SESSION_PRIVS WHERE PRIVILEGE IN ('CREATE TABLE','CREATE ANY TABLE','DROP ANY TABLE','ALTER ANY TABLE')",
  );
  if ((ddlPrivs.rows || []).length > 0) {
    const privs = ddlPrivs.rows.map((r) => r.PRIVILEGE ?? r.privilege).join(", ");
    process.stderr.write(
      `[db-analyzer] 警告:当前 Oracle 账号拥有 DDL 权限(${privs})。Oracle 的只读事务不拦截 DDL,` +
        `本工具的应用层语句门禁是防 DDL 的唯一防线——建议改用无 DDL 权限的账号以获得真正的纵深防御。\n`,
    );
  }
}

export async function runQuery(conn, sql, { limit, timeoutMs }) {
  const wrapped = isRowsetStatement(sql) ? wrapForLimit(sql, limit) : sql;
  const result = await conn.execute(wrapped, [], { callTimeout: timeoutMs });
  const columns = (result.metaData || []).map((f) => f.name);
  const rowsAsArrays = (result.rows || []).map((r) => columns.map((c) => r[c]));
  const truncated = isRowsetStatement(sql) && rowsAsArrays.length > limit;
  const finalRows = truncated ? rowsAsArrays.slice(0, limit) : rowsAsArrays;
  return { columns, rows: finalRows, truncated };
}

export async function introspect(conn, kind, opts) {
  const { sql, binds } = buildIntrospectQuery(kind, opts);
  const result = await conn.execute(sql, binds);
  if (kind === "ddl") {
    const row = result.rows[0] || {};
    return { ddl: row.DDL ?? row.ddl ?? "" };
  }
  const columns = (result.metaData || []).map((f) => f.name);
  return { columns, rows: result.rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  await conn.close();
}
```

- [ ] **Step 4: 跑测试确认纯函数部分通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/oracle.test.mjs
```

Expected: PASS,包括"不出现 initOracleClient"这条源码扫描测试。

- [ ] **Step 5: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/lib/adapters/oracle.mjs skills/db-analyzer/lib/adapters/oracle.test.mjs
git commit -m "feat: db-analyzer Oracle 适配器(Thin 模式)"
```

---

### Task 6: CLI 入口(run-query.mjs)

**Files:**
- Create: `skills/db-analyzer/scripts/run-query.mjs`
- Test: `skills/db-analyzer/scripts/run-query.test.mjs`

**Interfaces:**
- Consumes:
  - `validateReadOnlySql` from `../lib/safety-gate.mjs`
  - 三个适配器模块(`../lib/adapters/{mysql,postgres,oracle}.mjs`),各自的 `connect/enforceReadOnly/runQuery/introspect/close`
- Produces: 可执行 CLI,行为见下方 Step 3 的完整实现;导出 `parseArgs`/`loadConfig`/`pickAdapter`/`formatTable` 供本任务的单测导入(模块顶层**不得**在 import 时就跑 `main()`,必须用 `import.meta.url` 判断是否作为入口直接执行,否则测试文件 import 它时会真的尝试连接数据库)。

- [ ] **Step 1: 写纯逻辑部分的失败测试**

`skills/db-analyzer/scripts/run-query.test.mjs`:

```js
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  parseArgs,
  loadConfig,
  pickAdapter,
  formatTable,
  wrapConnectionError,
  wrapQueryError,
  wrapIntrospectError,
} from "./run-query.mjs";
import * as mysqlAdapter from "../lib/adapters/mysql.mjs";
import * as postgresAdapter from "../lib/adapters/postgres.mjs";
import * as oracleAdapter from "../lib/adapters/oracle.mjs";

describe("parseArgs", () => {
  it("解析 --key value 和布尔 flag", () => {
    const args = parseArgs(["--env", "mkdev01-mysql", "--sql", "SELECT 1", "--list-envs"]);
    expect(args.env).toBe("mkdev01-mysql");
    expect(args.sql).toBe("SELECT 1");
    expect(args["list-envs"]).toBe(true);
  });
});

describe("loadConfig", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("读 yaml 拿到各 env 的字段(含 type)", () => {
    dir = mkdtempSync(join(tmpdir(), "db-analyzer-test-"));
    const configPath = join(dir, "environments.yaml");
    writeFileSync(
      configPath,
      [
        "mkdev01-mysql:",
        "  type: mysql",
        "  host: 127.0.0.1",
        "  port: 3306",
        "  database: biz",
        "  user: reader",
        "  password: secret",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = loadConfig(configPath);
    expect(config["mkdev01-mysql"]).toEqual({
      type: "mysql",
      host: "127.0.0.1",
      port: "3306",
      database: "biz",
      user: "reader",
      password: "secret",
    });
  });
});

describe("pickAdapter", () => {
  it("按 type 分发到对应适配器模块", () => {
    expect(pickAdapter("mysql")).toBe(mysqlAdapter);
    expect(pickAdapter("postgres")).toBe(postgresAdapter);
    expect(pickAdapter("oracle")).toBe(oracleAdapter);
  });

  it("未知 type 抛错", () => {
    expect(() => pickAdapter("mssql")).toThrow();
  });
});

describe("formatTable", () => {
  it("把 columns/rows 渲染成对齐的文本表格", () => {
    const text = formatTable({ columns: ["id", "name"], rows: [[1, "a"], [2, "bb"]] });
    expect(text).toContain("id");
    expect(text).toContain("name");
    expect(text).toContain("1");
    expect(text).toContain("bb");
  });

  it("空结果给出明确提示而不是空字符串", () => {
    const text = formatTable({ columns: ["id"], rows: [] });
    expect(text).toMatch(/0 行|无结果/);
  });
});

describe("wrapConnectionError", () => {
  it("包一层提示核对 config 凭证,同时保留原始错误信息", () => {
    const wrapped = wrapConnectionError(new Error("ECONNREFUSED"), "mkdev01-mysql");
    expect(wrapped.message).toMatch(/连接失败/);
    expect(wrapped.message).toMatch(/mkdev01-mysql/);
    expect(wrapped.message).toMatch(/ECONNREFUSED/);
  });
});

describe("wrapQueryError", () => {
  it("包一层提示可调 --timeout,同时保留原始错误信息", () => {
    const wrapped = wrapQueryError(new Error("Query read timeout"), 30000);
    expect(wrapped.message).toMatch(/--timeout/);
    expect(wrapped.message).toMatch(/30000/);
    expect(wrapped.message).toMatch(/Query read timeout/);
  });
});

describe("wrapIntrospectError", () => {
  it("包一层提示检查 schema/table 名或权限,同时保留原始错误信息", () => {
    const wrapped = wrapIntrospectError(new Error("ORA-00942: table or view does not exist"), "mkdev01-oracle", {
      schema: "BIZ",
      table: "ORDERS",
    });
    expect(wrapped.message).toMatch(/schema.*table/);
    expect(wrapped.message).toMatch(/BIZ/);
    expect(wrapped.message).toMatch(/ORDERS/);
    expect(wrapped.message).toMatch(/ORA-00942/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run scripts/run-query.test.mjs
```

Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 `scripts/run-query.mjs`**

```js
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

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(HERE, "..", "config", "environments.yaml");
const RESULT_DUMP_PATH = join(HERE, "..", "last-query-result.txt");
const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 30000;

const ADAPTERS = { mysql: mysqlAdapter, postgres: postgresAdapter, oracle: oracleAdapter };

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

// 连接/认证类失败统一包一层提示,原始错误信息保留在末尾方便进一步排查。
export function wrapConnectionError(err, envName) {
  const raw = err instanceof Error ? err.message : String(err);
  return new Error(`连接失败,核对 config/environments.yaml 里 "${envName}" 的凭证/host/port(原始错误:${raw})`);
}

// 查询阶段失败(含真正超时)统一包一层提示,告诉使用者可以调 --timeout。
export function wrapQueryError(err, timeoutMs) {
  const raw = err instanceof Error ? err.message : String(err);
  return new Error(`查询执行失败,如果是超时可尝试调大 --timeout(当前 ${timeoutMs}ms)(原始错误:${raw})`);
}

// 探查阶段失败(非连接类)统一包一层提示,指向最常见的原因:名字错了或没权限。
export function wrapIntrospectError(err, envName, opts) {
  const raw = err instanceof Error ? err.message : String(err);
  return new Error(
    `探查失败,检查 --schema/--table 是否正确、该账号是否有权限查看该库元数据` +
      `(env=${envName}${opts.schema ? `,schema=${opts.schema}` : ""}${opts.table ? `,table=${opts.table}` : ""})` +
      `(原始错误:${raw})`,
  );
}

function runListEnvs() {
  const config = loadConfig();
  const names = Object.keys(config);
  process.stdout.write(
    (names.length ? names.map((n) => `${n} (${config[n].type})`).join("\n") : "(未配置任何连接)") + "\n",
  );
}

async function runIntrospect(envName, env, args) {
  const adapter = pickAdapter(env.type);
  let conn;
  try {
    conn = await adapter.connect(env);
  } catch (err) {
    throw wrapConnectionError(err, envName);
  }
  try {
    await adapter.enforceReadOnly(conn);
    const kind = args.introspect;
    const opts = { schema: args.schema, table: args.table };
    trace("探查结构", { kind, ...opts });
    const result = await adapter.introspect(conn, kind, opts);
    if ("ddl" in result) {
      process.stdout.write(result.ddl + "\n");
      writeFileSync(RESULT_DUMP_PATH, result.ddl, "utf8");
    } else if (result.rows.length === 0) {
      const text = `(未探查到结果,检查 env/schema/table 名是否正确:${JSON.stringify({ env: envName, ...opts })})`;
      process.stdout.write(text + "\n");
      writeFileSync(RESULT_DUMP_PATH, text, "utf8");
    } else {
      const text = formatTable(result);
      process.stdout.write(text + "\n");
      writeFileSync(RESULT_DUMP_PATH, text, "utf8");
    }
  } catch (err) {
    throw wrapIntrospectError(err, envName, { schema: args.schema, table: args.table });
  } finally {
    await adapter.close(conn);
  }
}

async function runSql(envName, env, sql, args) {
  const check = validateReadOnlySql(sql);
  if (!check.ok) {
    throw new Error(`拒绝执行:${check.reason}`);
  }
  const adapter = pickAdapter(env.type);
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  const timeoutMs = args.timeout ? Number(args.timeout) : DEFAULT_TIMEOUT_MS;
  let conn;
  try {
    conn = await adapter.connect(env);
  } catch (err) {
    throw wrapConnectionError(err, envName);
  }
  try {
    await adapter.enforceReadOnly(conn);
    trace("执行只读查询", { limit, timeoutMs });
    const result = await adapter.runQuery(conn, sql, { limit, timeoutMs });
    const text = formatTable(result) + (result.truncated ? `\n\n(已截断,加更精确的 WHERE/聚合或调大 --limit)` : "");
    process.stdout.write(text + "\n");
    writeFileSync(RESULT_DUMP_PATH, text, "utf8");
  } catch (err) {
    throw wrapQueryError(err, timeoutMs);
  } finally {
    await adapter.close(conn);
  }
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
      "选项: --limit(默认 200) --timeout(默认 30000,单位 ms) --help",
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
```

- [ ] **Step 4: 跑测试确认纯逻辑部分通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run scripts/run-query.test.mjs
```

Expected: PASS。确认 import 这个文件时**没有**真的尝试连接数据库或报网络错误——如果测试卡住/报连接错误,检查 `isMain` 判断逻辑是不是漏了,导致 `main()` 在 import 时就被调用。

- [ ] **Step 5: 跑全部单测确认没有相互影响**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npm test
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/scripts/run-query.mjs skills/db-analyzer/scripts/run-query.test.mjs
git commit -m "feat: db-analyzer CLI 入口"
```

---

### Task 7: SKILL.md 与 README.md

**Files:**
- Create: `skills/db-analyzer/SKILL.md`
- Modify: `skills/db-analyzer/README.md`(替换 Task 1 的占位内容)
- Modify: `README.md`(仓库根目录,补一节 db-analyzer)

**Interfaces:**
- 无代码接口,纯文档;内容必须与 Task 6 实际实现的 CLI 参数、Task 1 的配置字段完全对得上,不能凭印象写。

- [ ] **Step 1: 写 `skills/db-analyzer/SKILL.md`**

```markdown
---
name: "db-analyzer"
description: "需要只读查询或分析 MySQL/PostgreSQL/Oracle 数据库时用我:探查库表结构、看建表语句、执行只读 SQL 做数据分析。不提供任何写能力,不能用于建表/改表/增删改数据。关键词:数据库、查询、SQL、建表语句、DDL、表结构、MySQL、Oracle、PostgreSQL、Postgres。"
---

# 数据库只读查询与分析

按环境配置连接(见 `config/environments.yaml`),支持 MySQL/PostgreSQL/Oracle 三种数据库,只做查询和只读分析。DDL/INSERT/UPDATE/DELETE 等写操作**没有实现**,不是靠约定不去用——任何这类语句在发出网络请求前就会被拒绝,数据库连接本身也强制只读事务。

## 流程

1. **确认连接**:先 `node scripts/run-query.mjs --list-envs` 现读 `config/environments.yaml`,拿到当前真实配置了哪些连接(每人配置不同,不要凭记忆猜)。用户没说连哪个就把清单报给用户。
2. **不确定表结构就先探查,别瞎猜字段名**:
   ```
   node scripts/run-query.mjs --env mkdev01-mysql --introspect tables
   node scripts/run-query.mjs --env mkdev01-mysql --introspect columns --table orders
   node scripts/run-query.mjs --env mkdev01-mysql --introspect ddl --table orders
   ```
   `ddl` 能看到完整建表语句(类型、约束、索引都在一起),比单看 columns 列表更适合先摸清楚结构。PostgreSQL 的 ddl 是从系统表拼装的**尽力还原**文本,不保证跟 `pg_dump` 逐字节一致,但看结构够用。
3. **执行只读查询**:
   ```
   node scripts/run-query.mjs --env mkdev01-mysql --sql "SELECT COUNT(*) FROM orders WHERE status = 'PAID'"
   ```
   SQL 由我根据需求现写。默认最多返回 200 行,超出会提示已截断;查询超时默认 30 秒,可用 `--limit`/`--timeout` 调。

`--help` 看全部选项。

## 安全边界(不是约定,是代码强制)

- 只放行单条 `SELECT`/`WITH`/`EXPLAIN`/`SHOW`/`DESCRIBE` 语句,拒绝分号分隔的多语句,拒绝把写操作藏进 CTE 里。
- 每次连接后立即下发引擎级只读事务指令(MySQL `SET SESSION TRANSACTION READ ONLY`、PostgreSQL `SET default_transaction_read_only = on`、Oracle `SET TRANSACTION READ ONLY`)——即便应用层判断有遗漏,数据库引擎本身也会拒绝写操作。
- 这两层是配置账号本身可能是能读写账号的前提下设计的,不依赖"账号本来就是只读"这个假设。

## 环境不在清单里怎么办

和 landray-log 一致:照 `config/environments.example.yaml` 模板在 `config/environments.yaml` 里新增一段,改完立即生效(脚本每次运行都重新读文件,不需要 reload skill)。如果这个 skill 是从源仓库(`landary_work_e/skills/db-analyzer`)迁移到当前工程 `.claude/skills/db-analyzer` 来的,要确认改的是当前工程正在生效的那份配置;改源仓库那份需要用源仓库的 `scripts/migrate-skills-to-project.mjs --yes --force` 重新迁移同步。

## 使用前提

1. `npm install`(装 `mysql2`/`pg`/`oracledb`,一次性,迁移到新工程后要重新装一遍)。
2. 复制 `config/environments.example.yaml` 为 `config/environments.yaml`,按 `type: mysql|postgres|oracle` 填对应连接信息。真实配置不入库。
```

- [ ] **Step 2: 写 `skills/db-analyzer/README.md`**

```markdown
# db-analyzer —— 数据库只读查询与结构分析

给同事用的数据库只读分析工具,支持 MySQL/PostgreSQL/Oracle。详见 `SKILL.md`。

```
# 列已配置的连接
node scripts/run-query.mjs --list-envs

# 探查结构
node scripts/run-query.mjs --env mkdev01-mysql --introspect tables
node scripts/run-query.mjs --env mkdev01-mysql --introspect columns --table orders
node scripts/run-query.mjs --env mkdev01-mysql --introspect ddl --table orders

# 执行只读查询(默认最多 200 行,超时 30s)
node scripts/run-query.mjs --env mkdev01-mysql --sql "SELECT COUNT(*) FROM orders"

# 看全部选项
node scripts/run-query.mjs --help
```

### 使用前提

1. `npm install`。
2. 复制 `config/environments.example.yaml` 为 `config/environments.yaml`,填自己有权限的连接。真实配置不入库(见 `.gitignore`)。

### 只读边界

不提供任何 DDL/DML 写能力——应用层语句门禁 + 数据库引擎强制只读事务两层拦截,详见 SKILL.md。
```

- [ ] **Step 3: 补充仓库根目录 README.md**

在现有 `## Skills 一览` 小节的 `landray-log` 条目后面追加一段(参照 `landray-log` 那段的格式,写法一致):

```markdown
### db-analyzer —— 数据库只读查询与分析

按环境配置连接 MySQL/PostgreSQL/Oracle,只做只读查询与结构分析,不提供任何 DDL/DML 写能力(应用层语句门禁 + 数据库引擎强制只读事务两层拦截)。

用途:统一入口按环境 `type` 分发到对应方言,自动处理三种数据库探查表结构、看建表语句的方言差异,不用记三套系统表名。

使用前提:`skills/db-analyzer` 下先 `npm install`,再复制 `config/environments.example.yaml` 为同目录下的 `environments.yaml`,填入自己有权限的连接信息。真实配置不入库。

常用命令:

```bash
# 列已配置的连接
node scripts/run-query.mjs --list-envs

# 探查结构(表/列/建表语句)
node scripts/run-query.mjs --env mkdev01-mysql --introspect tables
node scripts/run-query.mjs --env mkdev01-mysql --introspect ddl --table orders

# 执行只读查询
node scripts/run-query.mjs --env mkdev01-mysql --sql "SELECT COUNT(*) FROM orders"
```

依赖:Node.js >= 18,`mysql2`/`pg`/`oracledb`(Oracle 走 Thin 模式,免装本地客户端)。

详见 `skills/db-analyzer/SKILL.md`。
```

- [ ] **Step 4: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/SKILL.md skills/db-analyzer/README.md README.md
git commit -m "docs: db-analyzer 使用说明"
```

---

### Task 8: 真实数据库端到端人工验证

这一步不是自动化测试——需要真实可连接的 MySQL/PostgreSQL/Oracle 实例(哪怕是本机临时装的开发库)。**没有真实数据库之前,这个 skill 不能视为完成**:Task 2-6 的单测只验证了纯逻辑(SQL 文本怎么拼、参数怎么解析),从没验证过"引擎真的会拒绝写操作"这个最核心的安全假设。

**Files:** 无新增文件(过程中可能创建临时验证脚本,验证完必须删除,不提交)。

- [ ] **Step 1: 准备至少一个真实库的连接信息**,填进 `skills/db-analyzer/config/environments.yaml`(参照 `environments.example.yaml`)。如果三种数据库都能拿到测试实例,三种都验一遍;至少要验一种。

- [ ] **Step 2: 验证 `--list-envs` 和 `--introspect`**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer"
node scripts/run-query.mjs --list-envs
node scripts/run-query.mjs --env <env> --introspect schemas
node scripts/run-query.mjs --env <env> --introspect tables --schema <schema>
node scripts/run-query.mjs --env <env> --introspect columns --table <table>
node scripts/run-query.mjs --env <env> --introspect ddl --table <table>
```

Expected: 各命令都能返回真实结构信息,不报错。`ddl` 输出能看出是完整建表语句(不是只有列名)。

- [ ] **Step 3: 验证只读查询与 limit/截断提示**

```bash
node scripts/run-query.mjs --env <env> --sql "SELECT * FROM <table>" --limit 5
```

Expected: 最多返回 5 行,如果该表实际行数 > 5,输出末尾有"已截断"提示。

- [ ] **Step 4: 验证应用层门禁真的拒绝写操作**

```bash
node scripts/run-query.mjs --env <env> --sql "DELETE FROM <table> WHERE 1=0"
```

Expected: 报错 `拒绝执行:...`,**不会**真的连接数据库执行(观察 stderr 里没有"执行只读查询"这行 trace 日志,说明在校验阶段就被挡住了)。

- [ ] **Step 5: 验证引擎级只读事务是真的在生效,不是纯装饰**

这一步刻意绕开应用层门禁,直接验证数据库引擎本身会不会拒绝写操作——因为 Step 4 全程走的是会被门禁挡住的路径,从没真正测过 `enforceReadOnly` 这句话本身有没有起作用。写一个**临时**验证脚本(不提交,验证完删除):

```js
// tmp-verify-readonly.mjs —— 临时脚本,验证完立刻删除,不要提交
import * as mysqlAdapter from "./skills/db-analyzer/lib/adapters/mysql.mjs"; // 按实际连的库换成对应 adapter

const env = { host: "...", port: 3306, database: "...", user: "...", password: "..." }; // 填真实连接信息,不要提交这个值
const conn = await mysqlAdapter.connect(env);
await mysqlAdapter.enforceReadOnly(conn);
try {
  await conn.query("INSERT INTO <随便一张测试表,不要用生产表> (id) VALUES (999999)");
  console.log("[FAIL] 只读事务没有拦住写操作,这是严重问题,不能上线");
} catch (e) {
  console.log("[PASS] 数据库引擎拒绝了写操作:", e.message);
} finally {
  await mysqlAdapter.close(conn);
}
```

```bash
cd "D:\A_landray_ws\landary_work_e" && node tmp-verify-readonly.mjs
rm tmp-verify-readonly.mjs
```

Expected: 打印 `[PASS] 数据库引擎拒绝了写操作`。如果打印的是 `[FAIL]`,说明 `enforceReadOnly` 里那句只读事务指令没有真正生效(比如连接库版本不支持、语法不对、或者在错误的时机执行),**必须回去修好 adapter 里的 `enforceReadOnly` 实现,重新走一遍这一步,不能带着这个问题结束这个任务**。PostgreSQL/Oracle 如果也有测试库,同样方式各验一遍,换成对应 adapter 模块和各自的只读语句(已在 Task 4/5 的 `enforceReadOnly` 实现里)。

**Oracle 额外要注意(已实测踩过)**:上面用 `INSERT`/`UPDATE`/`DELETE` 这类 DML 测,Oracle 会正常拒绝(`ORA-01456`)。但**必须再单独用 `CREATE TABLE`(DDL)测一遍**——Oracle 的 `SET TRANSACTION READ ONLY` 不拦 DDL,DDL 会隐式提交只读事务、另起一个可写事务直接执行成功。只测 DML 会得出"Oracle 也安全"的错误结论。DDL 探测语句用 `CREATE TABLE IF NOT EXISTS db_analyzer_readonly_probe (id NUMBER)` 这种明显是探测用的表名,如果确认没被拦住(大概率会发生,因为大多数正常业务账号本身在自己 schema 下就有建表权限),**必须立刻手工 `DROP TABLE db_analyzer_readonly_probe PURGE` 清理掉**,并确认这就是当前 Oracle 版本/账号权限下的正常行为(不是我们代码的 bug)——`lib/adapters/oracle.mjs` 的 `enforceReadOnly` 已经加了主动检测账号 DDL 权限并打印警告的逻辑,这里验证的就是这个警告在有 DDL 权限的账号下会不会正确触发。

- [ ] **Step 6: 验证迁移流程**

```bash
cd "D:\A_landray_ws\landary_work_e" && node scripts/migrate-skills-to-project.mjs --yes
```

Expected: `db-analyzer` 被复制到 `.claude/skills/db-analyzer`,`node_modules/` 和 `config/environments.yaml` 都没有被复制过去(前者体积大不该复制,后者是本地真实凭证)。到迁移后的目录下 `npm install` 能正常装上,`--list-envs` 能正常读到(空)配置提示或报"未配置任何连接"。

```bash
cd "D:\A_landray_ws\landary_work_e\.claude\skills\db-analyzer" && npm install && node scripts/run-query.mjs --list-envs
```

- [ ] **Step 7: 全部验证通过后,确认没有遗留临时文件/凭证被误提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git status
```

Expected: 没有 `tmp-verify-readonly.mjs`,没有任何 `environments.yaml`,没有 `node_modules/` 路径出现在待提交列表里。都确认干净后,这个任务才算完成(不需要额外 commit,前面的验证不产生需要提交的文件变更)。

---

## 追加任务(2026-07-18):支持第四种数据库 SQLite

Task 1-8 完成并通过真实数据库验证后追加。架构/安全模型/CLI 模式复用已有设计,决策依据见设计文档「追加:第四种数据库 SQLite」一节——用 Node 内置 `node:sqlite`(`DatabaseSync`),`engines.node` 从 `>=18` 提到 `>=22.5`;只读强制用构造时的 `{ readOnly: true }`(文件句柄级别,DML/DDL 都挡,比 Oracle 那套更彻底);已实测确认 `readOnly: true` 真的同时拦 DML 和 DDL,`sqlite_schema`/`PRAGMA table_info` 也已实测可用。

### Task 9: SQLite 适配器

**Files:**
- Modify: `skills/db-analyzer/package.json`(`engines.node` 改成 `>=22.5`)
- Create: `skills/db-analyzer/lib/adapters/sqlite.mjs`
- Test: `skills/db-analyzer/lib/adapters/sqlite.test.mjs`

**Interfaces:**
- Consumes: `isRowsetStatement` from `../safety-gate.mjs`。
- Produces:与 Task 3/4/5 相同的六个导出。`connect(envConfig)` 直接以 `{ readOnly: true }` 打开,只读性从连接那一刻就成立;`enforceReadOnly(conn)` 是文档化的空操作(为了六个适配器调用签名保持一致,CLI 层不用为 SQLite 特判),函数体里用注释写清楚为什么是空的——不是漏写。

- [ ] **Step 1: 先改 `engines`**

`skills/db-analyzer/package.json` 的 `engines` 字段:

```json
  "engines": {
    "node": ">=22.5"
  },
```

- [ ] **Step 2: 写纯函数的失败测试**

`skills/db-analyzer/lib/adapters/sqlite.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { wrapForLimit, buildIntrospectQuery, escapeIdent } from "./sqlite.mjs";

describe("sqlite wrapForLimit", () => {
  it("用子查询包一层并把 limit+1 作为 LIMIT", () => {
    expect(wrapForLimit("SELECT * FROM t", 200)).toBe(
      "SELECT * FROM (SELECT * FROM t) AS db_analyzer_sub LIMIT 201",
    );
  });
});

describe("sqlite escapeIdent", () => {
  it("双引号转义标识符,内部双引号双写", () => {
    expect(escapeIdent('weird"name')).toBe('"weird""name"');
  });
});

describe("sqlite buildIntrospectQuery", () => {
  it("schemas: SQLite 没有 schema 概念,返回固定提示而不是报错", () => {
    const { sql, params, note } = buildIntrospectQuery("schemas", {});
    expect(sql).toBeNull();
    expect(params).toEqual([]);
    expect(note).toMatch(/没有.*schema|不区分/);
  });

  it("tables: 查 sqlite_schema", () => {
    const { sql, params } = buildIntrospectQuery("tables", {});
    expect(sql).toMatch(/sqlite_schema/);
    expect(sql).toMatch(/type\s*=\s*'table'/i);
    expect(params).toEqual([]);
  });

  it("columns: 用 PRAGMA table_info,表名内联转义(PRAGMA 不支持参数化表名)", () => {
    const { sql, params } = buildIntrospectQuery("columns", { table: "orders" });
    expect(sql).toBe('PRAGMA table_info("orders")');
    expect(params).toEqual([]);
  });

  it("ddl: 查 sqlite_schema.sql,用绑定参数(这里是值不是标识符,可以参数化)", () => {
    const { sql, params } = buildIntrospectQuery("ddl", { table: "orders" });
    expect(sql).toMatch(/sqlite_schema/);
    expect(params).toEqual(["table", "orders"]);
  });

  it("columns/ddl 缺 table 时抛错", () => {
    expect(() => buildIntrospectQuery("columns", {})).toThrow();
    expect(() => buildIntrospectQuery("ddl", {})).toThrow();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/sqlite.test.mjs
```

Expected: FAIL,模块不存在。

- [ ] **Step 4: 实现 `lib/adapters/sqlite.mjs`**

```js
import { DatabaseSync } from "node:sqlite";
import { isRowsetStatement } from "../safety-gate.mjs";

export function wrapForLimit(sql, limit) {
  return `SELECT * FROM (${sql}) AS db_analyzer_sub LIMIT ${limit + 1}`;
}

// PRAGMA table_info(<表名>) 不支持把表名当参数绑定,只能内联进 SQL 文本,
// 所以表名必须在这里做标识符转义(双引号包起来,内部双引号双写),不能走 buildIntrospectQuery 的 params。
export function escapeIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

export function buildIntrospectQuery(kind, opts) {
  switch (kind) {
    case "schemas":
      // SQLite 是单文件,没有 MySQL/PostgreSQL/Oracle 那种 schema/database 概念,
      // 这里不报错,返回一个空查询 + 说明文字,CLI 层直接把 note 当结果打印。
      return { sql: null, params: [], note: "SQLite 是单文件数据库,没有 schema/database 概念,不需要这一步。" };
    case "tables":
      return { sql: "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name", params: [] };
    case "columns":
      if (!opts.table) throw new Error("columns 需要 table");
      return { sql: `PRAGMA table_info(${escapeIdent(opts.table)})`, params: [] };
    case "ddl":
      if (!opts.table) throw new Error("ddl 需要 table");
      return { sql: "SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?", params: ["table", opts.table] };
    default:
      throw new Error(`未知的 introspect kind: ${kind}`);
  }
}

export async function connect(envConfig) {
  // 只读性从打开文件这一刻就成立(SQLITE_OPEN_READONLY),不是"打开后再申请只读"——
  // 已实测确认这个模式下 DML 和 DDL 都会被拒绝,比其它三个方言的"连接后发只读事务指令"更彻底。
  return new DatabaseSync(envConfig.path, { readOnly: true });
}

// SQLite 的只读性在 connect() 时通过 { readOnly: true } 已经生效,这里没有额外动作可做——
// 保留这个函数只是为了和其它三个适配器的调用签名保持一致,CLI 层不用为 SQLite 特判。
export async function enforceReadOnly(conn) {
  void conn;
}

export async function runQuery(conn, sql, { limit }) {
  // node:sqlite 是同步本地文件访问,没有网络往返,不存在真正意义上的"查询超时"这个概念,
  // timeoutMs 这里不使用(和其它三个方言的签名保持一致,但故意不解构它,避免误导以为生效了)。
  const wrapped = isRowsetStatement(sql) ? wrapForLimit(sql, limit) : sql;
  const rows = conn.prepare(wrapped).all();
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const truncated = isRowsetStatement(sql) && rows.length > limit;
  const finalRows = truncated ? rows.slice(0, limit) : rows;
  return { columns, rows: finalRows.map((r) => columns.map((c) => r[c])), truncated };
}

export async function introspect(conn, kind, opts) {
  const { sql, params, note } = buildIntrospectQuery(kind, opts);
  if (!sql) return { ddl: note };
  if (kind === "ddl") {
    const rows = conn.prepare(sql).all(...params);
    return { ddl: rows[0]?.sql ?? "(未找到该表,检查表名是否正确)" };
  }
  const rows = conn.prepare(sql).all(...params);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
}

export async function close(conn) {
  conn.close();
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run lib/adapters/sqlite.test.mjs
```

Expected: PASS。

- [ ] **Step 6: `npm install` 后跑全量单测,确认新增的 `node:sqlite` 用法在其它测试文件里不冲突**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npm test
```

Expected: 全部 PASS。**已实测踩过一个坑**:`vitest@2.1.x`(连带的 `vite@5.x`)不认识 `node:sqlite`——Node 自己的 `module.builtinModules` 列表里也还没收录这个实验性模块,Vite 判断"是不是 Node 内置模块"依赖这份列表,认不出就当成普通包名去 `node_modules` 里找,报 `Cannot find package 'sqlite'`。用 `test.server.deps.external` 配置挖坑打补丁没能完全解决(会把 `node:` 前缀也剥掉)。真正的修法是直接把 `vitest` 升到 `^4.1.0`(连带升级的 `vite` 版本原生认识 `node:sqlite`),不需要额外配置文件:

```bash
npm install -D vitest@^4.1.0
```

升级后重新跑 `npm test` 确认全部 PASS(包括之前 Task 2-6 的测试,升级只影响 devDependency,不影响生产代码路径)。

- [ ] **Step 7: 提交**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/package.json skills/db-analyzer/lib/adapters/sqlite.mjs skills/db-analyzer/lib/adapters/sqlite.test.mjs
git commit -m "feat: db-analyzer SQLite 适配器"
```

### Task 10: 接入 CLI + 文档更新

**Files:**
- Modify: `skills/db-analyzer/scripts/run-query.mjs`(`ADAPTERS` 加 `sqlite`)
- Modify: `skills/db-analyzer/config/environments.example.yaml`(加一段 SQLite 示例)
- Modify: `skills/db-analyzer/SKILL.md` / `skills/db-analyzer/README.md`
- Modify: 仓库根目录 `README.md`

**Interfaces:**
- Consumes: Task 9 的 `sqlite.mjs` 六个导出。
- 无新增导出,纯接线 + 文档。

- [ ] **Step 1: `run-query.mjs` 接入 sqlite 适配器**

```js
import * as sqliteAdapter from "../lib/adapters/sqlite.mjs";
```

加到 `import * as oracleAdapter from "../lib/adapters/oracle.mjs";` 那一行后面,`ADAPTERS` 常量改成:

```js
const ADAPTERS = { mysql: mysqlAdapter, postgres: postgresAdapter, oracle: oracleAdapter, sqlite: sqliteAdapter };
```

- [ ] **Step 2: 跑测试确认没破坏 CLI 层**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer" && npx vitest run scripts/run-query.test.mjs
```

Expected: PASS(`pickAdapter("mysql"/"postgres"/"oracle")` 几个既有断言不受影响;不用额外为 `sqlite` 加断言,和 Task 6 里其它三个走的是同一段 `pickAdapter` 逻辑,已经被通用测试覆盖)。

- [ ] **Step 3: `config/environments.example.yaml` 加 SQLite 示例段**

在文件末尾追加:

```yaml

local-sqlite:
  type: sqlite
  path: <SQLite 文件的绝对路径,如 /path/to/app.db>
```

- [ ] **Step 4: `SKILL.md` 补 SQLite 相关说明**

在「安全边界」一节 Oracle 那段提醒后面加一段:

```markdown
**SQLite 是文件数据库,只读性来自打开文件时的 `readOnly` 模式(文件句柄级别),已实测确认 DML 和 DDL 都会被拒绝,不存在 Oracle 那种缺口。** 配置项形状和另外三个不同:没有 host/port/账号密码,只有 `type: sqlite` + `path: <文件路径>`。`--introspect schemas` 对 SQLite 没有意义(单文件即一个命名空间),会直接给提示而不是报错。
```

流程第 2 步的示例命令加一行 SQLite 版本:

```
node scripts/run-query.mjs --env local-sqlite --introspect tables
```

「使用前提」补一条:SQLite 走 Node 内置 `node:sqlite`,需要 Node >= 22.5(其它三个库 >= 18 即可);无需 `npm install` 额外依赖。

- [ ] **Step 5: `README.md`(skill 自身 + 仓库根目录)加 SQLite 常用命令**

两处「常用命令」代码块里都加一行:

```bash
# SQLite(文件数据库,不需要 host/port/账号密码)
node scripts/run-query.mjs --env local-sqlite --introspect ddl --table orders
```

依赖说明那句改成:`Node.js >= 22.5(SQLite 走内置 node:sqlite 模块),mysql2/pg/oracledb(Oracle 走 Thin 模式,免装本地客户端)`。

- [ ] **Step 6: 提交文档改动**

```bash
cd "D:\A_landray_ws\landary_work_e" && git add skills/db-analyzer/scripts/run-query.mjs skills/db-analyzer/config/environments.example.yaml skills/db-analyzer/SKILL.md skills/db-analyzer/README.md README.md
git commit -m "feat: db-analyzer 接入 SQLite + 文档更新"
```

- [ ] **Step 7: 真实 SQLite 文件端到端验证(比另外三个库省事——不需要账号/网络,本地建一个文件就能测)**

```bash
cd "D:\A_landray_ws\landary_work_e\skills\db-analyzer"
node -e "
import('node:sqlite').then(({DatabaseSync}) => {
  const db = new DatabaseSync('/tmp/db-analyzer-smoke-test.sqlite');
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL)');
  db.exec(\"INSERT INTO orders (status) VALUES ('PAID'), ('PENDING'), ('PAID')\");
  db.close();
});
"
```

把这个文件路径填进 `config/environments.yaml`(真实配置,不入库)当 `local-sqlite` 的 `path`,然后跑:

```bash
node scripts/run-query.mjs --list-envs
node scripts/run-query.mjs --env local-sqlite --introspect schemas
node scripts/run-query.mjs --env local-sqlite --introspect tables
node scripts/run-query.mjs --env local-sqlite --introspect columns --table orders
node scripts/run-query.mjs --env local-sqlite --introspect ddl --table orders
node scripts/run-query.mjs --env local-sqlite --sql "SELECT status, COUNT(*) FROM orders GROUP BY status"
node scripts/run-query.mjs --env local-sqlite --sql "DELETE FROM orders WHERE 1=0"
```

Expected:`--list-envs` 列出 `local-sqlite`;`schemas` 给出"没有 schema 概念"的提示而不是报错;`tables`/`columns`/`ddl` 都能正确返回;`SELECT ... GROUP BY` 查询给出 `PAID: 2, PENDING: 1`;`DELETE` 被应用层门禁直接拒绝(不进 `runQuery`)。都过了之后删掉这个临时 sqlite 文件:

```bash
rm /tmp/db-analyzer-smoke-test.sqlite
```

---

## 完成标准

- [ ] Task 1-10 全部提交。
- [ ] `npm test` 在 `skills/db-analyzer` 下全绿。
- [ ] Task 8 的人工验证全部通过,尤其是 Step 5(引擎级只读强制是真的在生效,不是没测过的假设);Oracle 那部分还额外确认了 DDL 缺口和账号权限告警。
- [ ] Task 10 Step 7 的 SQLite 端到端验证通过,包括确认 `readOnly` 模式真的同时拦住了 DML 和 DDL。
- [ ] `git status` 干净,没有真实凭证或临时验证脚本残留在待提交区。

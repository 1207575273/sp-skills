# db-analyzer 设计文档

日期:2026-07-17
状态:已批准设计,待写实现计划

## 背景与目标

在 `skills/landray-log` 之后开发第二个通用 skill:数据库分析工具。同时支持 MySQL、Oracle、PostgreSQL 三种数据库,按环境 + 账号密钥配置连接,只提供查询与只读分析能力,DDL/DELETE/UPDATE 等写操作能力**不实现、不暴露**——不是靠文档告知使用者"别这么用",而是从命令、代码路径上就不存在这个入口。

整体设计思路和 `landray-log` 一致:一个瘦的执行层负责安全地拿到原始数据,"分析"发生在使用者(我)这一层对返回结果的解读,而不是让工具本身长出复杂的分析逻辑。

## 交互方式

用户主要用自然语言描述分析需求,由我据此选择:

- 需要探查库表结构时,走 `--introspect` 系列只读元数据命令;
- 需要看实际数据 / 做统计分析时,走 `--sql`/`--file` 执行一条只读 SQL(SQL 由我编写)。

两条路径共用同一套安全校验,不存在"自然语言直接免检查落地"的旁路。

## 驱动可行性结论

三种数据库都能用纯 JS 驱动,不需要在目标机器上安装任何数据库客户端:

| DB | 驱动 | 说明 |
|---|---|---|
| MySQL | `mysql2` | 纯 JS 实现协议,`npm install` 即用 |
| PostgreSQL | `pg` | 同上 |
| Oracle | `oracledb`(node-oracledb) | 必须使用 **Thin 模式**(v6 起默认模式),不启用 Thick 模式,避免依赖 Oracle Instant Client |

因为需要真实的协议驱动,这个 skill 不能像 `landray-log` 一样零依赖单文件,而是一个带 `package.json` 的小型 Node 项目。

## 架构:统一入口 + 按方言适配器

参照 `query-log.mjs` 的"单脚本、多模式分发"模式:

```
skills/db-analyzer/
├── SKILL.md
├── README.md
├── .gitignore
├── package.json
├── package-lock.json
├── config/
│   ├── environments.example.yaml
│   └── environments.yaml          # 真实凭证,gitignore 排除
├── lib/
│   ├── safety-gate.mjs            # 数据库无关的只读语句校验
│   └── adapters/
│       ├── mysql.mjs
│       ├── postgres.mjs
│       └── oracle.mjs
└── scripts/
    └── run-query.mjs              # CLI 入口,按 env 的 type 分发到对应 adapter
```

每个 adapter 暴露统一接口:`connect(env)` / `enforceReadOnly(conn)` / `query(conn, sql, {limit, timeout})` / `introspect(conn, kind, opts)` / `close(conn)`,`run-query.mjs` 本身不关心方言细节。

选择这个方案而不是"三个库各写一份独立脚本"或"引入 Knex 等查询构建器统一方言",原因:前者容易在安全校验等公共逻辑上出现三份实现漂移;后者的抽象价值(程序化拼查询条件)在这里用不上,SQL 文本本身是我直接手写的裸文本,徒增依赖和复杂度。

## 安全模型:两层真实防线

已确认连接数据库的账号**不能保证是只读权限**,设计必须按最坏情况(账号能读写)假设,因此不能只依赖账号权限,需要两层都是"真的会拒绝"的技术手段:

1. **应用层语句门禁**(执行前拦截):解析 SQL 全文(不只看首个关键字,防止把写操作藏进 CTE,如 `WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t`),只放行单条 `SELECT`/只读 `WITH`/`EXPLAIN`/`SHOW`/`DESCRIBE`/Oracle 的 `DBMS_METADATA.GET_DDL` 只读函数调用;拒绝分号分隔的多语句;命中 `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`REVOKE`/`MERGE`/`CALL`/`EXEC` 等关键字一律拒绝,报错信息只说明"仅支持只读查询",不给出绕过建议。
2. **连接层引擎强制只读**(即便①被绕过,数据库自己也会拒绝写):每次建立连接后立即下发只读事务指令——MySQL `SET SESSION TRANSACTION READ ONLY`;PostgreSQL `SET default_transaction_read_only = on`;Oracle 在每次查询对应的事务开始时执行 `SET TRANSACTION READ ONLY`(Oracle 的只读事务只对当次事务生效,需要每次查询前重新下发,当前设计为每次查询使用独立连接,不做连接池,避免只读事务生命周期管理的复杂度)。

DDL/DELETE/UPDATE 能力不会出现在 `--help`、`SKILL.md`、任何示例命令里。

**实现阶段人工验证时发现的重要修正(Oracle)**:直接拿真实 Oracle 实例测过——`SET TRANSACTION READ ONLY` 只拦 DML(INSERT/UPDATE/DELETE,报 ORA-01456),**不拦 DDL**(CREATE/ALTER/DROP 直接执行成功),因为 Oracle 的 DDL 语句会隐式提交当前事务、另起一个默认可写的新事务,只读事务标志根本管不到它。这意味着上面写的"两层都是真的会拒绝"这个假设,对 Oracle 的 DDL 场景不成立——**对 Oracle 来说,第②层防不住 DDL,第①层(应用层语句门禁)是防 DDL 的唯一真实防线**。已加一个补偿措施:每次连接 Oracle 后主动查 `SESSION_PRIVS` 检查账号是否有 `CREATE TABLE`/`CREATE ANY TABLE`/`DROP ANY TABLE`/`ALTER ANY TABLE` 等权限,有就打印警告,提示换成真正无 DDL 权限的账号——但这只是提醒,不是拦截,真正补齐这个缺口需要从数据库授权侧下手(给 Oracle 连接账号收回 DDL 权限),工具代码层面做不到。MySQL/PostgreSQL 没有这个问题,只读事务同时挡 DML 和 DDL。

## 配置模型:直接到具体库,不做"服务器级连接 + 候选库列表"

每个 env 条目完全限定到一个具体的库/服务,而不是"连上服务器后再从候选库列表里选":

```yaml
mkdev01-mysql:
  type: mysql
  host: xxx.internal
  port: 3306
  database: xxx
  user: xxx
  password: xxx

mkdev01-oracle:
  type: oracle
  host: xxx.internal
  port: 1521
  serviceName: xxx
  user: xxx
  password: xxx

mkdev01-pg:
  type: postgres
  host: xxx.internal
  port: 5432
  database: xxx
  user: xxx
  password: xxx
```

选择这个而不是"服务器级配置 + 候选库列表"的关键原因:PostgreSQL 一个连接内无法跨库查询,换库本质要开新连接,"候选库列表"对 PG 来说是假的轻量;为了 MySQL 能做到的轻量切库单独开例外会破坏三种方言体验一致的目标。配置重复几行 YAML 的成本很低,且更明确、更贴合"账号可能能写、必须保守"这一安全前提下的最小可见范围原则。

**教训前置**:`landray-log` 曾因 `.gitignore` 里 `config/environments.yaml` 那一行被注释掉,导致真实管理员凭证进了 git 历史并推到了远端。这个新 skill 的 `.gitignore` 写完后必须用 `git check-ignore -v config/environments.yaml` 实际验证生效,再进入任何 `git add` 步骤,不能假设写了就等于生效。

## 依赖打包

`package.json` 声明 `mysql2`、`pg`、`oracledb` 三个依赖并提交 `package.json`/`package-lock.json`;`node_modules/` 进 `.gitignore`(`migrate-skills-to-project.mjs` 已经默认排除 `node_modules`,复制逻辑不用改)。`SKILL.md`「使用前提」新增一步:迁移到目标工程后先 `npm install`。

## CLI 全貌

```
node run-query.mjs --list-envs                                    列已配置的连接(不连接,纯读 config)
node run-query.mjs --env <env> --introspect schemas               列库/schema
node run-query.mjs --env <env> --introspect tables [--schema x]   列表
node run-query.mjs --env <env> --introspect columns --table x     列字段及类型
node run-query.mjs --env <env> --introspect ddl --table x         看该表完整建表语句(只读)
node run-query.mjs --env <env> --sql "SELECT ..."                 执行只读查询
node run-query.mjs --env <env> --file query.sql                   同上,SQL 较长时用文件
  可选: --limit(默认 200) --timeout(默认 30000ms)
```

`--introspect ddl` 三种方言实现方式不同:MySQL 用 `SHOW CREATE TABLE` 原生一条拿到;Oracle 用 `SELECT DBMS_METADATA.GET_DDL('TABLE','X','SCHEMA') FROM DUAL`,同样原生一条拿到;PostgreSQL 没有内置的单命令 DDL 导出,为避免依赖外部 `pg_dump` 客户端,改为拼接 `information_schema.columns` + `pg_indexes`(自带索引 DDL 文本)+ `table_constraints` 得到一份**尽力还原**的建表语句,明确告知使用者这不保证与 `pg_dump` 逐字节一致,但足够用于理解表结构。

## 输出与安全默认值

结果默认落 `last-query-result.txt`(表格形式)并同时打屏;超过 `--limit`(默认 200 行)时截断,并提示"已截断,加更精确的 WHERE/聚合或调大 --limit"。查询超时默认 30000ms,超时报错提示如何调 `--timeout`。这两个默认值都是"分析用途"下的保护性设置,不是无脑限制。

## 错误处理

- 认证失败:提示核对 `config/environments.yaml` 里对应连接的凭证。
- 语句门禁拒绝:明确说明"仅支持只读查询",不给绕过建议。
- `--introspect` 无结果:提示检查 env/schema/table 名是否正确。
- 查询超时:报错并提示 `--timeout` 用法。

## SKILL.md 流程(与 landray-log 保持一致的骨架)

1. 先 `--list-envs` 确认当前配置支持哪些连接,不凭记忆假设。
2. 不确定库表结构时先 `--introspect`(schemas/tables/columns/ddl)摸清楚再写查询。
3. 执行具体 `--sql`/`--file`,读结果做分析。
4. 用户提到的连接不在清单里时的引导逻辑与 `landray-log` 完全一致:改 `config/environments.yaml`(照 `environments.example.yaml` 模板)立即生效;如果这个 skill 是从源仓库迁移到目标工程的,要确认改的是当前生效那份配置,改源仓库那份则需要 `migrate-skills-to-project.mjs --yes --force` 重新同步。

## 非目标(明确不做)

- 不提供任何 DDL/DML 写能力,包括不做"高权限模式"开关。
- 不做跨库(PostgreSQL 语境下)查询能力。
- 不做分页游标,只做简单的 limit + 截断提示。
- 不引入 ORM/查询构建器。
- 不做连接池(每次查询独立连接,配合每次下发只读事务)。

## 追加:第四种数据库 SQLite(2026-07-18 补充)

MySQL/PostgreSQL/Oracle 三个方言实现完并做完真实数据库验证后,追加支持 SQLite。SQLite 和前三个方言有本质差异,不是简单再抄一份适配器:

**连接模型不同**:SQLite 没有 host/port/账号密码,是本地一个文件。`config/environments.yaml` 里 SQLite 条目形状是 `type: sqlite` + `path: <文件路径>`,没有 user/password 字段。

**驱动选型**:用 Node 官方内置的 `node:sqlite`(`DatabaseSync`),不用 `better-sqlite3` 之类的第三方原生 addon——保持和 Oracle Thin 模式一致的"免装本地组件、零第三方原生依赖"原则。代价是 `node:sqlite` 要求 Node >= 22.5,所以 `skills/db-analyzer/package.json` 的 `engines.node` 从 `>=18` 提到 `>=22.5`(只影响这一个 skill,不影响 `landray-log` 或迁移脚本)。`node:sqlite` 的 `DatabaseSync` API 是同步的,适配器里仍然对外暴露 `async function`(内部同步执行、包一层 Promise),保持和其它三个方言完全一致的调用签名,CLI 层不需要区分方言是同步还是异步驱动。

**只读强制机制不同,而且比 Oracle 更彻底**:MySQL/PostgreSQL/Oracle 用的是"连接后发一条只读事务指令",Oracle 那边已经实测确认这套机制挡不住 DDL。SQLite 没有会话/事务级别的只读开关,但有更硬的手段——**用只读模式打开数据库文件本身**(`new DatabaseSync(path, { readOnly: true })`,底层是 `SQLITE_OPEN_READONLY`),这是文件句柄级别的限制,不区分 DML 还是 DDL,任何写操作(包括 CREATE/ALTER/DROP)在文件句柄层面就会被拒绝,不存在 Oracle 那种"DDL 隐式开新事务绕过只读标志"的缺口。对 SQLite 来说,应用层语句门禁(第①层)+ 只读文件句柄(第②层)两层都是真正硬性的,不需要再加 Oracle 那样的权限检测告警。

**introspect 的实现**:SQLite 自带 `sqlite_master`(或新版本的 `sqlite_schema`)系统表记录所有对象的建表 DDL 原文,`SELECT sql FROM sqlite_schema WHERE type='table' AND name=?` 直接就能拿到完整建表语句,不需要像 PostgreSQL 那样从多个系统表拼装,也不需要像 MySQL/Oracle 那样调用专门的内置函数/命令——三个方言里最省事的一个。列信息用 `PRAGMA table_info(<table>)`(表名需要做标识符转义,不能走 `?` 绑定参数,因为 PRAGMA 语法不支持参数化表名,需要在应用层做好转义)。SQLite 没有 schema 的概念(单文件即一个命名空间),`--introspect schemas` 对 SQLite 语义上没有意义,返回固定的一条提示而不是报错。

**limit 包装方式**:和 MySQL/PostgreSQL 一样用 `LIMIT`(SQLite 语法与 MySQL/PostgreSQL 一致),子查询别名沿用已经踩过坑的 `db_analyzer_sub`(不以下划线开头,虽然 SQLite 本身对下划线开头的标识符没有 Oracle 那种限制,但统一起来避免以后又要分别记哪个方言有这个限制)。

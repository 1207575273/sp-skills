---
name: "db-analyzer"
description: "需要只读查询或分析 MySQL/PostgreSQL/Oracle/SQLite 数据库时用我:探查库表结构、看建表语句、执行只读 SQL 做数据分析。不提供任何写能力,不能用于建表/改表/增删改数据。关键词:数据库、查询、SQL、建表语句、DDL、表结构、MySQL、Oracle、PostgreSQL、Postgres、SQLite。"
---

# 数据库只读查询与分析

只读查 MySQL / PostgreSQL / Oracle / SQLite:探查库表结构、看建表语句、跑 SELECT 做分析。**只读,绝不写库**——DDL/INSERT/UPDATE/DELETE 在代码层直接拒,不靠自觉。

命令统一是 `node scripts/run-query.mjs <参数>`,在本 skill 目录下执行。

## SOP(按顺序走,不要跳步)

### 步骤 1 - 确认连哪个库

```
node scripts/run-query.mjs --list-envs
```

- 现读配置列出可用连接,不要凭记忆假设有哪些环境。
- 用户没指定连接 -> 把清单报给用户挑一个。
- 用户说的连接不在清单里 -> 见文末「环境没配」,别直接报错了事。

### 步骤 2 - 不确定表结构,先探查(别猜字段名)

```
node scripts/run-query.mjs --env <env> --introspect tables                 列出表(默认最多 200)
node scripts/run-query.mjs --env <env> --introspect columns --table <表>   列字段 + 类型
node scripts/run-query.mjs --env <env> --introspect ddl --table <表>       看完整建表语句(首选)
```

- `ddl` 首选:类型、约束、索引都在一起,比只看 columns 更快摸清结构。
- 参数不齐时(如 Oracle/MySQL 需要 `--schema`)工具会明确报错说缺哪个,照提示补即可,不用背方言差异。
- 库表很多时(几千张):`tables` 默认只列前 200 并报总数,别指望整列看完;改用带 `LIKE` 的 `--sql` 按表名过滤,或已知表名就直接查它的 `columns`/`ddl`。

### 步骤 3 - 跑只读查询

```
node scripts/run-query.mjs --env <env> --sql "SELECT ..."
node scripts/run-query.mjs --env <env> --file query.sql        SQL 长时用文件
```

- SQL 你现写。默认最多 200 行(`--limit` 调),超时默认 30000ms(`--timeout` 调),超出会提示已截断。

`--help` 看全部选项。

## 性能 / 慢查询分析

没有专用命令,靠下面这些只读查询做(用户问"这查询为什么慢""哪些语句慢"时用):

**看某条查询为什么慢 -> EXPLAIN(四种库都支持)**

```
node scripts/run-query.mjs --env <env> --sql "EXPLAIN <原 SELECT>"
```

- 重点看有没有走索引(MySQL 里 `type=ALL` 或 `key=NULL` 就是全表扫)、预估扫描行数。
- 要真实耗时用 `EXPLAIN ANALYZE <SELECT>`:它会**真执行**这条 SELECT(只对 SELECT 有效,套在写语句上会被门禁拒),慢查询会真占那么久、可能撞 `--timeout`。

**找出整库哪些语句慢(MySQL,慢日志关着也能用)**

```
node scripts/run-query.mjs --env <env> --sql "SHOW VARIABLES LIKE 'slow_query%'"
node scripts/run-query.mjs --env <env> --sql "SELECT query, exec_count, avg_latency, rows_examined_avg FROM sys.statement_analysis ORDER BY avg_latency DESC LIMIT 20"
```

- `sys.statement_analysis` 底层是 performance_schema,不依赖慢日志开关。其它方言按同样思路查各自的语句统计视图(如 PostgreSQL 的 `pg_stat_statements`、Oracle 的 `v$sql`),视图不存在工具会明确报错。

**够不着的**:读不了服务器上的慢查询日志**文件**(工具只走 SQL 连接);除非 MySQL 配了 `log_output=TABLE`、日志进了 `mysql.slow_log` 表,才能用 SQL 查。

## 红线与必须转达的坑

- **只读不可绕过**:只放行单条 `SELECT`/`WITH`/`EXPLAIN`/`SHOW`/`DESCRIBE`,拒绝多语句、拒绝 CTE 里藏写操作,连接本身也是引擎级只读。用户要写库 -> 直接说此工具做不到,不要尝试绕。
- **Oracle 特例(重要)**:Oracle 只读事务挡得住增删改,**挡不住建表/改表/删表(DDL)**,这是 Oracle 本身机制,其它三个库都没这问题。所以 Oracle 上门禁是防 DDL 的唯一防线。连 Oracle 时若账号有 DDL 权限,工具会打印告警 -> **看到就照实转达用户**,建议换无 DDL 权限的账号。
- **SQLite 特点**:配置只有 `type` + `path`(无 host/账号密码);`--introspect schemas` 对它无意义,会返回一句提示而非报错。
- **PostgreSQL 的 ddl** 是从系统表拼的「尽力还原」文本,看结构够用,不保证跟 `pg_dump` 逐字一致。

## 首次使用 / 迁移到新工程后

1. 本 skill 目录下 `npm install`(装 `mysql2`/`pg`/`oracledb`;SQLite 用 Node 内置模块无需装)。SQLite 要求 Node >= 22.5,其它库 >= 18。
2. 复制 `config/environments.example.yaml` 为 `config/environments.yaml`,按 `type: mysql|postgres|oracle|sqlite` 填连接信息。真实配置不入库。

## 环境没配 / 用户要的连接不在清单

照 `config/environments.example.yaml` 在 `config/environments.yaml` 加一段即可,改完立即生效(脚本每次运行都重读,无需 reload skill)。注意:本 skill 若是从源仓库(`landary_work_e/skills/db-analyzer`)迁到当前工程(`.claude/skills/db-analyzer`)的,改的必须是当前工程这份;若改了源仓库那份,要跑 `scripts/migrate-skills-to-project.mjs --yes --force` 重新同步。

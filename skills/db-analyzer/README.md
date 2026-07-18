# db-analyzer —— 数据库只读查询与结构分析

给同事用的数据库只读分析工具,支持 MySQL/PostgreSQL/Oracle/SQLite。详见 `SKILL.md`。

```
# 列已配置的连接
node scripts/run-query.mjs --list-envs

# 探查结构
node scripts/run-query.mjs --env mkdev01-mysql --introspect tables
node scripts/run-query.mjs --env mkdev01-mysql --introspect columns --table orders
node scripts/run-query.mjs --env mkdev01-mysql --introspect ddl --table orders

# 执行只读查询(默认最多 200 行,超时 30s)
node scripts/run-query.mjs --env mkdev01-mysql --sql "SELECT COUNT(*) FROM orders"

# SQLite(文件数据库,不需要 host/port/账号密码)
node scripts/run-query.mjs --env local-sqlite --introspect ddl --table orders

# 看全部选项
node scripts/run-query.mjs --help
```

### 使用前提

1. `npm install`(SQLite 走 Node 内置 `node:sqlite`,不需要额外装)。
2. 复制 `config/environments.example.yaml` 为 `config/environments.yaml`,填自己有权限的连接。真实配置不入库(见 `.gitignore`)。
3. SQLite 需要 Node >= 22.5,其它三种库 >= 18 即可。

### 只读边界

不提供任何 DDL/DML 写能力——应用层语句门禁 + 数据库引擎强制只读两层拦截,详见 SKILL.md。**Oracle 有例外**:它的只读事务挡不住 DDL,应用层门禁是唯一防线,建议配无 DDL 权限的账号。SQLite 用只读文件句柄,DML/DDL 都挡得住。

### 打包成生产版 skill / 部署

上面是开发用法(跑源码 + `npm install`)。生产端要"拿了就能用",用打包命令产出一个**自闭环的生产 skill**:

```
npm run build
```

它在 `dist/` 生成一个完整、自包含的生产版 skill(已随仓库提交):

```
dist/
  SKILL.md                      给 Agent 的操作说明(命令走单文件,无 npm install 步骤,由源码 SKILL.md 自动生成)
  scripts/run-query.bundle.mjs  单文件,已内置 mysql2/pg/oracledb 驱动(约 2.5MB;Oracle 走 Thin 模式纯 JS,不含平台二进制)
  config/environments.example.yaml  配置模板
  README.md                     部署说明
```

生产端**无需 node_modules、无需 npm install**,把整个 `dist/` 复制过去(可直接当目标工程的 `.claude/skills/db-analyzer`),只要:

- Node >= 22.5(为了内置 `node:sqlite`;不查 SQLite 的话 >= 18 也行);
- 复制 `config/environments.example.yaml` 为 `config/environments.yaml` 填连接(或用 `--config` / 环境变量 `DB_ANALYZER_CONFIG` 指向别处)。

改了源码后重跑 `npm run build` 重新生成。只读门禁、四种数据库支持在生产版里和源码完全一致——已用「挪走 node_modules、只留 dist/」的方式实测四库全通、门禁完整。

> 生产版 SKILL.md 与源码版**理应不同**:源码版讲"跑 scripts/、先 npm install",生产版讲"跑打包单文件、免安装"。生产版由 build 从源码 SKILL.md 自动转换生成,不用手维护两份。

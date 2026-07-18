# db-analyzer(生产打包版)

这是 `npm run build` 从源码 `skills/db-analyzer` 生成的自闭环生产 skill,请勿手改(改源码后重跑 build)。

内容:
- `SKILL.md` —— 给 Agent 的操作说明,命令走打包后的单文件
- `scripts/run-query.bundle.mjs` —— 单文件,已内置 mysql2/pg/oracledb 驱动(约 2.5MB,Oracle 走 Thin 模式纯 JS、无平台二进制)
- `config/environments.example.yaml` —— 配置模板

部署:
1. 把整个本目录复制到目标工程的 `.claude/skills/db-analyzer`(或任意位置作独立工具)。
2. 复制 `config/environments.example.yaml` 为 `config/environments.yaml`,填自己有权限的连接。
3. Node >= 22.5,**无需 npm install / node_modules**。

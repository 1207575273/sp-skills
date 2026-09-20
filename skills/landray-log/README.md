# 蓝凌便利分析 / 排查 skills

给同事用的蓝凌运维小工具集合(逐步迭代)。当前包含:

## landray-log —— 蓝凌日志排查

按 traceId / 关键字查蓝凌各环境(mkdev01、mksmoke 等)的服务端日志:代管理员登录 -> 定位服务 -> 拉全量日志。详见 `SKILL.md`。

```
# 支持哪些环境:现读 config/environments.yaml,不登录不发请求
node scripts/query-log.mjs --list-envs

# 不知在哪个服务:并发扫全部,报出命中服务
node scripts/query-log.mjs --env mkdev01 --sweep --trace <traceId>

# 查指定服务(全量日志打屏 + 写 last-logs.log)
node scripts/query-log.mjs --env mkdev01 --service ai-lanbots-server --trace <traceId>

# 列该环境可查的服务 / 看全部选项
node scripts/query-log.mjs --env mkdev01 --list-services
node scripts/query-log.mjs --help

# 查不到日志时:该包/类默认日志级别可能高于 DEBUG,先开监控(只对之后新产生的日志生效,需重新复现问题)
node scripts/query-log.mjs --env mkdev01 --service ai-lanbots-server --set-log-level --path com.landray.ai.lanbots.chat --level DEBUG
```

### 使用前

复制 `config/environments.example.yaml` 为 `config/environments.yaml`,填自己有权限的环境(抓包的 `j_password` 密文自动登录,或直接填 `token`)。真实配置不入库(见 `.gitignore`)。

零第三方依赖(Node 内置 fetch,Node >= 18)。

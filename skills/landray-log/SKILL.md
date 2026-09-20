---
name: "landray-log"
description: "当需要排查蓝凌某环境(mkdev01、mksmoke 等)的服务端问题时用我:按 traceId 追踪一次请求、定位报错/超时、或查看某个服务的日志。关键词:traceId、日志、排查、报错、超时、蓝凌、landray。"
---

# 蓝凌日志排查

蓝凌日志页需要管理员会话,普通账号打不开;我用配置好的管理员身份代为登录,按 traceId/关键字查出服务端日志。蓝凌是多服务的(base-server、ai-lanbots-server、gateway-server…),各服务各有各的日志。

## 流程

1. **确认环境**:先 `node scripts/query-log.mjs --list-envs` 现读 `config/environments.yaml`,拿到**当前真实支持的环境清单**(不登录、不发请求;每人配置不同,不要凭记忆或猜测,如 mkdev01 只是示例不代表所有人都配了它)。
   - 用户说的环境在清单里 → 直接用。
   - 用户没说环境 → 把清单报给用户,问要查哪个。
   - 用户说的环境不在清单里 → 不要直接报错了事,提示用户:该环境还没配置,需要照 `config/environments.example.yaml` 的模板在 `config/environments.yaml` 里新增一段(baseUrl/username/loginPath + encryptedPassword 或 token)。配置改完**立即生效**,脚本每次运行都会重新读文件,不需要 reload skill。
     - 但如果这个 skill 是从源仓库(`landary_work_e/skills/landray-log`)迁移到当前工程 `.claude/skills/landray-log` 来的,要确认改的是**当前工程正在生效的这一份**配置;如果改的是源仓库那份,需要用源仓库的 `scripts/migrate-skills-to-project.mjs --yes --force` 重新迁移覆盖,当前工程这份才会同步到最新(这一步才需要动作,不是字面意义的"reload skill")。
2. **定位服务**:
   - 用户已指明服务 → 直接查那个。
   - 用户不知道在哪个服务(常见)→ **先 sweep 并发扫全部服务**,报出命中的服务;不要替他默认 base-server、也不用逼他盲选:
     ```
     node scripts/query-log.mjs --env mkdev01 --sweep --trace <traceId>
     ```
   - 想让用户从清单里挑 → `--list-services` 列出该环境的服务交给用户选。
3. **查日志**(拿到服务后):
   ```
   node scripts/query-log.mjs --env mkdev01 --service ai-lanbots-server --trace <traceId>
   ```
   全量日志打屏,同时写入 `last-logs.log`。排查报错可加 `--level ERROR`;缩时段用 `--begin/--end`。

`--help` 看全部选项。

## 读结果 / 排查提示

- 结果全量落在 `last-logs.log`(可直接打开 / grep)。
- **查不到,原因一:日志窗口**:多半是该 traceId 已滚出「当前日志窗口」(工具默认只扫日志末尾一段)。换更近的 traceId,或用 `--begin/--end` 缩到发生时段;`--sweep` 也能确认它到底在不在任何服务。
- **查不到,原因二:该包/类默认日志级别高于 DEBUG**:蓝凌各服务默认不是所有包都输出 DEBUG,对应代码里的 DEBUG 语句根本没写进日志文件,再怎么查关键字/traceId 都查不到。这种情况下**主动向用户确认**是否要打开该服务下某个包/类的 DEBUG 监控,需要 `appName`(服务) + 包名或类全限定名(如 `com.landray.ai.lanbots.chat` 对应服务 `ai-lanbots-server`),不确定具体路径就问用户或让用户提供:
  ```
  node scripts/query-log.mjs --env mkdev01 --service ai-lanbots-server --set-log-level --path com.landray.ai.lanbots.chat --level DEBUG
  ```
  **关键提醒**:该设置只对**之后新产生**的日志生效,不能让已经发生过的历史请求"补出"DEBUG 日志 —— 下完监控后要让用户**重新触发一次问题场景**,再用 `--sweep` 或指定服务查询。可选 `--timeout <秒>` 对应服务端 `theadTimeout` 字段(监控存活时长),不确定就留空用服务端默认。
- **定位报错**:在结果里找 `ERROR` / `WARN` / `Exception` / `FAILED` / `超时`;蓝凌把 traceId 记在日志行的 `[...traceId...]` 上下文里,尾段还带来源服务(如 `:1:gateway-server:0`)可还原调用链。

## 使用前提

使用者先在 `config/environments.yaml` 配好自己有权限的环境(见 `environments.example.yaml` 两种认证:抓包的 `j_password` 密文自动登录,或直接填 `token`)。认证失效会提示,按 config 注释更新。

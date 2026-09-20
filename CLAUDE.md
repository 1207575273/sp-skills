# CLAUDE.md — sp-skills

sp-skills 是一个 Claude Code skill 集(sp = superpower 的精简,代表个人与团队沉淀、提炼出来的可复用 skill)。定位:公开、可分享、可被任意工程用 `npx skills add` 装用。

可与全局 `~/.claude/CLAUDE.md`、各 skill 自身的 SKILL.md 叠加,本文件优先级低于用户显式指令。

---

## 目录约定

- 每个 skill 一个目录:`skills/<skill-name>/`,目录名即 skill 名(小写连字符)。
- 每个 skill 至少含 `SKILL.md`,其 YAML frontmatter 必须有 `name`(小写连字符)与 `description` 两个字段,平台靠这两个字段识别。
- 可携带资产(SKILL.md、脚本、模板)只自然描述意图,不出现平台内部机制(工具名等),保证在任何规范宿主可移植。

## 安全红线(最高优先级,永不违背)

1. 本仓库面向公开。任何真实凭证、内网域名/IP、可重放密文,一律不得进入本仓库,**包括 git 历史**。
2. 每个 skill 只带 `config/*.example.yaml` 模板(占位符);真实 `environments.yaml` / `secrets.yaml` 由各 skill 自己的 `.gitignore` 拦住,绝不入库。
3. **判定粒度是文件,不是仓库**:skill 代码本身不含秘密(连接信息、账号、密钥全从配置读),所以对接内网系统的 skill(如 landray-log)同样可以公开,秘密只存在于各人本地那份被忽略的配置里。别再靠"换个私有仓放"解决凭证问题 —— 那只会让 skill 源分叉。
4. 关联的私有仓库 landray_work_e 的 git 历史里有真实内网凭证(2026-09-20 已从索引移除,历史仍在),**永不可设为公开**;那份管理员密文应尽快轮换。
5. 提交前必过凭证自检 `node scripts/audit-secrets.mjs`,已挂进 `.githooks/pre-commit`(启用:`git config core.hooksPath .githooks`)。任一命中即停,别推。新增规则或豁免都要写明理由。

## 发布 / 安装

- skills.sh 无提交/审批流程:公开 GitHub 仓库即目录。别人用 `npx skills add <owner>/sp-skills` 装全部,或 `npx skills add <owner>/sp-skills --skill <name>` 装单个;安装量经匿名遥测自动上榜,无需登记。
- 底层工具:github.com/vercel-labs/skills。
- CLI 识别的容器目录:仓库根(若根有 SKILL.md)、`skills/`、`.claude/skills/`;本仓库用 `skills/<name>/` 布局。

## 开发约定

- skill 若已 `npm run build` 出 `dist/`(自闭环生产版:打包单文件 + 生产版 SKILL.md + 配置模板),生产端拿 `dist/` 免 `npm install` 即用;没 `dist/` 则跑源码(目标端需 `npm install`)。
- 只读/安全边界等 skill 自身约束写进各自 SKILL.md,本文件不重复。

## 仓库关系

**本仓库是 skill 的唯一源**(2026-09-20 合并完成)。所有 skill 只在这里开发、只在这里改,不存在"私有仓开发 + 拷贝副本到公开仓"那套流程 —— 那套双份维护已废弃。

- 上游:无。不再从 landray_work_e 同步。landray_work_e 保留为私有工程仓,其 `skills/` 与 `.claude/skills/` 下的旧副本已是历史遗留,不再更新,只作存档。
- 下游(分发,两条,别再加第三条):
  - 对外 —— `npx skills add <owner>/sp-skills`,GitHub 仓库即目录。
  - 对内 —— 打 zip 上传团队 skill-hub(l-skill-hup 项目),供内网同事安装。
- 本机自用:别再往 `.claude/skills/` 拷第三份。直接软链本仓 `skills/<name>` 到目标工程的 `.claude/skills/<name>`,或用 `npx skills add` 装本地路径。
- 一次性迁移脚本 `scripts/import-skills.mjs` 已完成使命,保留仅作审计追溯,不要再跑。

## 通用

- 全局 `~/.claude/CLAUDE.md` 的编码规范、踩坑点在本仓库同样生效。
- 不使用 emoji 或装饰字符;状态用 [PASS]/[FAIL]/[WARN]/[SKIP]/[INFO],箭头用 `->`。
- 与我对话一律中文。

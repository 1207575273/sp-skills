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
2. 每个 skill 只带 `config/environments.example.yaml` 模板(占位符);真实 `environments.yaml` 由各 skill 自己的 `.gitignore` 拦住,绝不入库。
3. 含真实凭证的 skill(如 landray-log)只留在私有仓库 landray_work_e,**永不迁入本仓库**。
4. 关联的私有仓库 landray_work_e 的 git 历史里有真实内网凭证,**永不可设为公开**。
5. 发布前对整个待发布目录做凭证自检(扫内网域名/IP、密文特征、误混入的 `environments.yaml`),任一命中即停,别推。

## 发布 / 安装

- skills.sh 无提交/审批流程:公开 GitHub 仓库即目录。别人用 `npx skills add <owner>/sp-skills` 装全部,或 `npx skills add <owner>/sp-skills --skill <name>` 装单个;安装量经匿名遥测自动上榜,无需登记。
- 底层工具:github.com/vercel-labs/skills。
- CLI 识别的容器目录:仓库根(若根有 SKILL.md)、`skills/`、`.claude/skills/`;本仓库用 `skills/<name>/` 布局。

## 开发约定

- skill 若已 `npm run build` 出 `dist/`(自闭环生产版:打包单文件 + 生产版 SKILL.md + 配置模板),生产端拿 `dist/` 免 `npm install` 即用;没 `dist/` 则跑源码(目标端需 `npm install`)。
- 只读/安全边界等 skill 自身约束写进各自 SKILL.md,本文件不重复。

## 仓库关系

- db-analyzer 的源码在 landray_work_e 里开发,选择性拷干净副本(排除真实配置 / node_modules / 运行产物)同步到本仓库。
- 仓库拆分与 submodule 拓扑待定,确定后补写此节。

## 通用

- 全局 `~/.claude/CLAUDE.md` 的编码规范、踩坑点在本仓库同样生效。
- 不使用 emoji 或装饰字符;状态用 [PASS]/[FAIL]/[WARN]/[SKIP]/[INFO],箭头用 `->`。
- 与我对话一律中文。

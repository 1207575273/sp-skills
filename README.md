# sp-skills

个人与团队沉淀、提炼出来的 Claude Code skill 集(sp = superpower 的精简)。每个 skill 独立可用,可被任意工程用 `npx skills add` 安装。

## 安装

装全部:

```
npx skills add 1207575273/sp-skills
```

只装某一个:

```
npx skills add 1207575273/sp-skills --skill db-analyzer
```

装完在目标工程的 `.claude/skills/<name>/` 下,按各 skill 的 `SKILL.md` 使用。

## 包含的 skills

### 数据与查询

- **db-analyzer** —— 数据库只读查询与结构分析。支持 MySQL / PostgreSQL / Oracle / SQLite;两层只读拦截(应用层语句门禁 + 数据库引擎强制只读),不提供任何 DDL/DML 写能力。带自闭环生产版(`dist/`,免 `npm install`)。需 Node >= 22.5(为内置 `node:sqlite`;不查 SQLite 时 >= 18 亦可)。
- **market-analyzer** —— 股票 / 基金 / 黄金行情只读分析。实时报价、历史 K 线、技术指标(MA/RSI/MACD/KDJ)、信号面板、上金所金价,可出自包含 HTML 走势报告。只读取数与本地分析,不含交易能力,不预测涨跌、不荐股。零依赖,需 Node >= 20。

### 信息采集

- **web-search** —— 通用网页 / 新闻搜索,可选把命中页面正文(markdown)一并带回,适合查资料与热点深挖。需自备 API key(`config/secrets.yaml`)。
- **github-trending** —— GitHub 热门开源项目采集,按近 N 天新建仓库的 star 数排序,可按语言过滤。走官方 API,无需 token。
- **cn-hotspot** —— 国内时政 / 社会热点采集,拉百度热搜实时榜单。公开接口,免 key。

### 内容生产

- **wechat-post** —— 公众号发文流水线:选题 -> 成稿 -> 配图 -> 排版 -> 存入草稿箱。每步有产物有验收,终点是草稿箱,群发永远人工。

### 研发排查

- **landray-log** —— 蓝凌(Landray)服务端日志排查。按 traceId / 关键字跨服务查日志,支持并发扫服务定位、动态调日志级别。需自备环境与管理员凭证(`config/environments.yaml`),仓库内只有占位模板。

> 需要凭证的 skill(db-analyzer、web-search、landray-log)一律只随仓库携带 `config/*.example.yaml` 模板;真实配置由各 skill 的 `.gitignore` 拦住,永不入库。

## 授权

本仓库采用 **PolyForm Small Business License 1.0.0**(见 `LICENSE`),属 source-available 双重授权:

- 个人、非商业用途 —— 免费。
- 小企业(员工 + 外包 < 100 人,**且**上一纳税年度营收 < 100 万美元)—— 免费。
- 超过上述阈值的组织 —— 本许可不授予使用权,须单独获取商业授权。

商业授权请通过本仓库 GitHub Issue 联系作者。

## 开发

各 skill 的源码与构建说明见其目录内的 `README` / `SKILL.md`。改动某 skill 后,如带 `dist/` 生产版,记得重跑该 skill 的 `npm run build` 重新生成。

### 凭证自检(本仓面向公开,必须过)

clone 后先启用提交钩子,之后每次 `git commit` 会自动扫暂存区,命中凭证特征即拦下:

```bash
git config core.hooksPath .githooks
```

也可随时手动全量扫已跟踪文件:

```bash
node scripts/audit-secrets.mjs
```

规则见 `scripts/audit-secrets.mjs`:内网 IP、内网域名、疑似真实凭证赋值、私钥块、真实配置文件被跟踪。误报时到对应规则的 `allow` 里加豁免,**并写明理由** —— 不写理由的豁免就是下一个漏洞。

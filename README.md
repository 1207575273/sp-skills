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

- **db-analyzer** —— 数据库只读查询与结构分析。支持 MySQL / PostgreSQL / Oracle / SQLite;两层只读拦截(应用层语句门禁 + 数据库引擎强制只读),不提供任何 DDL/DML 写能力。带自闭环生产版(`dist/`,免 `npm install`)。需 Node >= 22.5(为内置 `node:sqlite`;不查 SQLite 时 >= 18 亦可)。

## 授权

本仓库采用 **PolyForm Small Business License 1.0.0**(见 `LICENSE`),属 source-available 双重授权:

- 个人、非商业用途 —— 免费。
- 小企业(员工 + 外包 < 100 人,**且**上一纳税年度营收 < 100 万美元)—— 免费。
- 超过上述阈值的组织 —— 本许可不授予使用权,须单独获取商业授权。

商业授权请通过本仓库 GitHub Issue 联系作者。

## 开发

各 skill 的源码与构建说明见其目录内的 `README` / `SKILL.md`。改动某 skill 后,如带 `dist/` 生产版,记得重跑该 skill 的 `npm run build` 重新生成。

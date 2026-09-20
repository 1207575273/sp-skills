---
name: "github-trending"
description: "需要了解 GitHub 上最近热门/新兴的开源项目时用我:按近 N 天新建仓库的 star 数排序取热门榜,可按编程语言过滤。适合日报/周报里的开源热点盘点。关键词:GitHub、trending、热门项目、开源、新项目、star、涨星、技术热点、开源日报。"
---

# GitHub 热门项目采集

拉取 GitHub 最近热门的开源项目:近 N 天新建仓库按 star 数排序(对官方 trending 的稳定近似,走 api.github.com 官方接口,无需 token)。

命令统一 `node scripts/trending.mjs <参数>`,在本 skill 目录下执行。

## 用法

```
node scripts/trending.mjs                              近 7 天 top 10(默认)
node scripts/trending.mjs --days 3 --top 15            近 3 天 top 15
node scripts/trending.mjs --language python --top 10   只看 Python 项目
```

- `--days` 1-90,越小越"新锐";`--top` 1-30。
- 输出 JSON:`items` 数组,每条含 `name`(owner/repo)/`url`/`stars`/`language`/`description`。

## 口径与注意

- 榜单口径是「近 N 天**新建**且 star 最多」,天然偏向新兴项目;不是官方 trending 页(那个无公开 API)。要看老项目的动向,用更长的 `--days` 或让用户明确诉求。
- 未认证配额为搜索 10 次/分钟,单次调用足够;不要在一轮里高频反复调用。
- description 可能为空(项目没写),不代表采集失败。

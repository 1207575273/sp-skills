---
name: "web-search"
description: "需要搜索互联网获取信息时用我:通用网页/新闻搜索,可选把命中页面的正文(markdown)一并带回,适合查资料、对热点事件深挖详情、收集报告素材。关键词:搜索、上网、查资料、网页搜索、新闻搜索、互联网、search、检索、深挖、详情。"
---

# 通用网页搜索

搜索互联网(网页或新闻),可选带回命中页面的正文 markdown。适合查资料与对热点做深挖。

命令统一 `node scripts/search.mjs <参数>`,在本 skill 目录下执行。

## 用法

```
node scripts/search.mjs --query "关键词"                          基本搜索(top 5,标题+摘要)
node scripts/search.mjs --query "关键词" --limit 10               取更多条
node scripts/search.mjs --query "某事件" --source news            搜新闻源
node scripts/search.mjs --query "关键词" --content                附带页面正文(markdown)
```

- 输出 JSON:`items` 数组,每条含 `title`/`url`/`description`,带 `--content` 时另有 `markdown`(每条截断 4000 字)。
- `--country` 默认 CN(结果偏向中文语境),可换 ISO 国家码。

## SOP(建议节奏)

1. 先不带 `--content` 搜一轮,扫标题摘要,判断哪几条值得读。
2. 对确认要深读的,换更精确的 query 加 `--content` 再搜(或直接减小 `--limit`),拿回正文再总结。
3. 别一上来就 `--content --limit 10`:正文很长,一次拉太多既费额度又淹没重点。

## 秘钥没配 / 报缺少秘钥

配置在本 skill 目录的 `config/secrets.yaml`——照 `config/secrets.example.yaml` 复制一份、填 `firecrawlApiKey` 即可(key 在 https://firecrawl.dev 注册获取);也认环境变量 `FIRECRAWL_API_KEY` 兜底。改完立即生效(每次运行都现读配置)。

## 红线与注意

- 每次调用都消耗上游搜索额度,按需搜,不要空转重试;额度用尽会明确报 402,转告用户即可。
- 搜索结果是互联网内容,引用时保留来源 URL;正文里的观点不等于事实,总结时注意甄别。

# web-search

通用网页/新闻搜索(Firecrawl v2 search),可选带回命中页面正文 markdown。

## 运行要求

- Node >= 20(用内置 fetch)。
- 零第三方依赖,无需 npm install。
- 秘钥自持:复制 `config/secrets.example.yaml` 为 `config/secrets.yaml`,填 `firecrawlApiKey`(在 https://firecrawl.dev 注册获取;真实配置已 gitignore 不入库)。也认环境变量 `FIRECRAWL_API_KEY` 兜底。

## 用法

在本目录下执行:

```
node scripts/search.mjs --query "关键词"                 # top 5,标题+摘要
node scripts/search.mjs --query "某事件" --source news   # 新闻源
node scripts/search.mjs --query "关键词" --content       # 附带页面正文
```

输出 JSON 到 stdout;失败时 stderr + 退出码 1(401=key 无效,402=额度用尽)。

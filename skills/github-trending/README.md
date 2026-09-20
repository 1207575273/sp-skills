# github-trending

GitHub 热门开源项目采集(近 N 天新建仓库按 star 排序,官方 api.github.com 搜索接口,免 token)。

## 运行要求

- Node >= 20(用内置 fetch)。
- 零第三方依赖,无需 npm install。

## 用法

在本目录下执行:

```
node scripts/trending.mjs                              # 近 7 天 top 10
node scripts/trending.mjs --days 3 --top 15            # 近 3 天 top 15
node scripts/trending.mjs --language python            # 按语言过滤
```

输出 JSON 到 stdout;失败时 stderr + 退出码 1。

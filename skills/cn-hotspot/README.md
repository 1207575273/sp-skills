# cn-hotspot

国内时政/社会热点采集(百度热搜榜公开接口,免 key)。

## 运行要求

- Node >= 20(用内置 fetch)。
- 零第三方依赖,无需 npm install。

## 用法

在本目录下执行:

```
node scripts/hotspot.mjs              # 实时热搜 top 15
node scripts/hotspot.mjs --top 30     # 前 30 条
```

输出 JSON 到 stdout;失败时 stderr + 退出码 1。

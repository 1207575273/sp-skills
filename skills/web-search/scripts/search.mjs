// 通用网页搜索:Firecrawl v2 search(可选带回页面正文 markdown)。
// 零第三方依赖(Node 18+ 内置 fetch)。
// 秘钥自持:读本 skill 目录 config/secrets.yaml 的 firecrawlApiKey(照 config/secrets.example.yaml 填);
// 也认环境变量 FIRECRAWL_API_KEY 兜底(配置文件优先)。
// 用法: node scripts/search.mjs --query "关键词" [--limit 5] [--source web|news] [--country CN] [--content]
//   --content: 结果附带抓取的页面正文(markdown,每条截断到 4000 字,防输出爆炸)
// 输出: stdout 一份 JSON(items 数组:title/url/description[/markdown]),失败时 stderr + 退出码 1。

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = "https://api.firecrawl.dev/v2/search";
const MARKDOWN_LIMIT = 4000;
const SECRETS_PATH = fileURLToPath(new URL("../config/secrets.yaml", import.meta.url));

function parseArgs(argv) {
  const args = { query: "", limit: 5, source: "web", country: "CN", content: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--query" && value !== undefined) { args.query = value; i += 1; }
    else if (key === "--limit" && value !== undefined) { args.limit = Number(value); i += 1; }
    else if (key === "--source" && value !== undefined) { args.source = value; i += 1; }
    else if (key === "--country" && value !== undefined) { args.country = value; i += 1; }
    else if (key === "--content") { args.content = true; }
  }
  if (args.query.trim() === "") throw new Error("--query 必填(要搜什么)");
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
    throw new Error(`--limit 须为 1-20 的整数,收到: ${args.limit}`);
  }
  if (args.source !== "web" && args.source !== "news") {
    throw new Error(`--source 只支持 web 或 news,收到: ${args.source}`);
  }
  return args;
}

// 读 config/secrets.yaml 的 firecrawlApiKey(扁平 key: value 解析,够用且零依赖);env var 兜底。
async function loadApiKey() {
  let fileKey;
  try {
    const text = await readFile(SECRETS_PATH, "utf8");
    const match = /^firecrawlApiKey:\s*(\S+)\s*$/m.exec(text);
    fileKey = match?.[1];
  } catch {
    // 配置文件不存在,走 env 兜底
  }
  const key = fileKey ?? process.env.FIRECRAWL_API_KEY;
  if (key === undefined || key === "" || key.includes("你的密钥")) {
    throw new Error("缺少秘钥:请照 config/secrets.example.yaml 复制为 config/secrets.yaml 填 firecrawlApiKey(或设环境变量 FIRECRAWL_API_KEY)");
  }
  return key;
}

async function search({ query, limit, source, country, content }, apiKey) {
  const body = {
    query,
    limit,
    country,
    sources: [{ type: source }],
    ...(content ? { scrapeOptions: { formats: [{ type: "markdown" }] } } : {}),
  };
  const res = await fetch(API, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // 带抓取时上游要现抓页面,放宽超时。
    signal: AbortSignal.timeout(content ? 60000 : 20000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401) throw new Error(`认证失败(401):firecrawlApiKey 无效或过期。${text}`);
    if (res.status === 402) throw new Error(`额度不足(402):Firecrawl 配额用尽。${text}`);
    throw new Error(`搜索接口 ${res.status}: ${text}`);
  }
  const data = await res.json();
  const list = data?.data?.[source];
  if (!Array.isArray(list)) {
    throw new Error(`响应结构不符预期(data.${source} 缺失),原文前 200 字: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return list.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: (r.description ?? "").slice(0, 300),
    ...(typeof r.markdown === "string" && r.markdown.length > 0
      ? { markdown: r.markdown.slice(0, MARKDOWN_LIMIT) }
      : {}),
  }));
}

try {
  const apiKey = await loadApiKey();
  const args = parseArgs(process.argv.slice(2));
  const items = await search(args, apiKey);
  process.stdout.write(JSON.stringify({ query: args.query, source: args.source, count: items.length, items }, null, 1));
} catch (e) {
  process.stderr.write(`搜索失败: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

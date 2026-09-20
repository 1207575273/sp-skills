// 国内时政/社会热点采集:百度热搜榜(公开接口,免 key)。
// 零第三方依赖(Node 18+ 内置 fetch)。
// 用法: node scripts/hotspot.mjs [--top 15] [--tab realtime]
//   tab 可选: realtime(热搜,默认)/ novel / movie / teleplay / car / game
// 输出: stdout 一份 JSON(items 数组:title/url/isTop),失败时 stderr + 退出码 1。

const API = "https://top.baidu.com/api/board";

function parseArgs(argv) {
  const args = { top: 15, tab: "realtime" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--top" && value !== undefined) { args.top = Number(value); i += 1; }
    else if (key === "--tab" && value !== undefined) { args.tab = value; i += 1; }
  }
  if (!Number.isInteger(args.top) || args.top < 1 || args.top > 50) {
    throw new Error(`--top 须为 1-50 的整数,收到: ${args.top}`);
  }
  return args;
}

async function fetchHotspot({ top, tab }) {
  const url = `${API}?platform=wise&tab=${encodeURIComponent(tab)}`;
  const res = await fetch(url, {
    // 不带 UA 部分网络下会被挡,带常规浏览器 UA 最稳。
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`百度热榜接口 ${res.status}`);
  }
  const data = await res.json();
  // 实测结构(2026-07):条目在 data.cards[].content[].content[](wise 端多包一层);
  // 兼容扁平结构(块自身即条目)以防端上形状再变。
  const blocks = (data?.data?.cards ?? []).flatMap((c) => c.content ?? []);
  const items = blocks.flatMap((b) => (Array.isArray(b.content) ? b.content : [b]));
  const usable = items.filter((it) => typeof it.word === "string" && it.word.length > 0);
  if (usable.length === 0) {
    throw new Error(`响应结构不符预期(未解析出条目),原文前 200 字: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return usable.slice(0, top).map((it) => ({
    title: it.word,
    url: it.url ?? "",
    isTop: it.isTop === true,
  }));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const items = await fetchHotspot(args);
  process.stdout.write(JSON.stringify({ tab: args.tab, count: items.length, items }, null, 1));
} catch (e) {
  process.stderr.write(`采集失败: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

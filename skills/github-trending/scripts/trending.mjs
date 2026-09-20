// GitHub 热门仓库采集:基于 api.github.com 搜索(近 N 天新建仓库按 star 排序,近似 trending)。
// 零第三方依赖(Node 18+ 内置 fetch);无需 token(未认证配额:搜索 10 次/分钟,日报场景绰绰有余)。
// 用法: node scripts/trending.mjs [--days 7] [--top 10] [--language python]
// 输出: stdout 一份 JSON(items 数组:name/url/stars/language/description),失败时 stderr + 退出码 1。

const API = "https://api.github.com/search/repositories";

function parseArgs(argv) {
  const args = { days: 7, top: 10, language: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--days" && value !== undefined) { args.days = Number(value); i += 1; }
    else if (key === "--top" && value !== undefined) { args.top = Number(value); i += 1; }
    else if (key === "--language" && value !== undefined) { args.language = value; i += 1; }
  }
  if (!Number.isInteger(args.days) || args.days < 1 || args.days > 90) {
    throw new Error(`--days 须为 1-90 的整数,收到: ${args.days}`);
  }
  if (!Number.isInteger(args.top) || args.top < 1 || args.top > 30) {
    throw new Error(`--top 须为 1-30 的整数,收到: ${args.top}`);
  }
  return args;
}

async function fetchTrending({ days, top, language }) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const q = [`created:>${since}`, language ? `language:${language}` : ""].filter(Boolean).join(" ");
  const url = `${API}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${top}`;
  const res = await fetch(url, {
    headers: {
      // GitHub API 强制要求 User-Agent;Accept 按官方推荐。
      "User-Agent": "skills-library-github-trending",
      "Accept": "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return (data.items ?? []).map((r) => ({
    name: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    language: r.language ?? "",
    description: (r.description ?? "").slice(0, 200),
  }));
}

try {
  const args = parseArgs(process.argv.slice(2));
  const items = await fetchTrending(args);
  process.stdout.write(JSON.stringify({ since_days: args.days, count: items.length, items }, null, 1));
} catch (e) {
  process.stderr.write(`采集失败: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

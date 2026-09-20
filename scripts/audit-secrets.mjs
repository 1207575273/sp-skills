/**
 * 发布前凭证自检 —— CLAUDE.md 安全红线第 5 条的落地实现。
 *
 * 本仓面向公开。推送前扫描待发布内容,命中即以非零码退出,挡住这次推送。
 * 扫描范围是 git 已跟踪的文件(真正会被推上去的那些),不扫工作区里被忽略的本地配置。
 *
 * 用法:
 *   node scripts/audit-secrets.mjs            扫已跟踪文件
 *   node scripts/audit-secrets.mjs --staged   只扫暂存区(供 pre-commit 用)
 */

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 每条规则:命中即拦。
 * allow 用来放掉已知安全的同形命中(占位符、Java 包名、依赖声明里的版本号等),
 * 每条都要写清楚为什么放 —— 不写理由的豁免就是下一个漏洞。
 */
const RULES = [
  {
    id: "private-ip",
    desc: "内网 IP",
    re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
    // package-lock 的 engines 字段形如 ^10.6.0,与 10.x 私网段同形
    allow: (line) => /"(?:node|npm|engines)"|\^\d|>=\s*\d/.test(line),
  },
  {
    id: "internal-host",
    desc: "内网域名",
    re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:landray\.com\.cn|local|internal|intranet)\b/gi,
    // com.landray.* 是 Java 包名(反编译即可见),landray.log 是日志文件名,都不是地址
    allow: (line) => /com\.landray\.|landray\.log/.test(line),
  },
  {
    id: "credential-value",
    desc: "疑似真实凭证赋值",
    re: /^\s*(?:encryptedPassword|password|passwd|secret|apiKey|api_key|apiSecret|appSecret|token|accessToken)\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{12,})["']?\s*$/gim,
    // 尖括号占位符与全大写模板变量不是真凭证
    allow: (line) => /<[^>]+>|\$\{|YOUR_|xxx|REPLACE|example|占位|抓包/i.test(line),
  },
  {
    id: "private-key",
    desc: "私钥块",
    re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/g,
    allow: () => false,
  },
  {
    id: "real-config-file",
    desc: "真实配置文件被跟踪",
    // 文件名级规则,不看内容
    pathRe: /(?:^|\/)config\/(?:environments|secrets)\.yaml$/,
  },
];

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".zip", ".gz", ".pdf", ".woff", ".woff2", ".ttf",
]);

function listFiles() {
  const args = process.argv.includes("--staged")
    ? ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"]
    : ["ls-files", "-z"];
  const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

async function scanFile(relPath) {
  const hits = [];

  for (const rule of RULES) {
    if (rule.pathRe?.test(relPath)) {
      hits.push({ rule, line: 0, text: relPath });
    }
  }

  if (BINARY_EXT.has(path.extname(relPath).toLowerCase())) return hits;

  let content;
  try {
    content = await readFile(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return hits; // 暂存区里已删除的文件,跳过
  }

  const lines = content.split(/\r?\n/);
  for (const rule of RULES) {
    if (!rule.re) continue;
    lines.forEach((line, i) => {
      rule.re.lastIndex = 0;
      if (!rule.re.test(line)) return;
      if (rule.allow?.(line)) return;
      hits.push({ rule, line: i + 1, text: line.trim().slice(0, 120) });
    });
  }
  return hits;
}

async function main() {
  const files = listFiles();
  const allHits = [];

  for (const file of files) {
    allHits.push(...(await scanFile(file)).map((h) => ({ ...h, file })));
  }

  console.log(`[INFO] 凭证自检:扫描 ${files.length} 个${process.argv.includes("--staged") ? "暂存" : "已跟踪"}文件`);

  if (allHits.length === 0) {
    console.log("[PASS] 未发现凭证特征,可以推送");
    return;
  }

  console.log("");
  for (const hit of allHits) {
    console.log(`[FAIL] ${hit.rule.desc} (${hit.rule.id})`);
    console.log(`       ${hit.file}${hit.line ? `:${hit.line}` : ""}`);
    if (hit.line) console.log(`       ${hit.text}`);
  }
  console.log("");
  console.log(`[FAIL] 命中 ${allHits.length} 处,已阻止。本仓面向公开,处理干净再推。`);
  console.log("       误报的话到 scripts/audit-secrets.mjs 对应规则的 allow 里加豁免,并写明理由。");
  process.exit(1);
}

await main();

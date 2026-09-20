/**
 * 一次性迁移脚本:把私有仓 landary_work_e 的 skill 源迁进本仓 skills/。
 *
 * 安全基线:只拷贝源仓 git 已跟踪的文件 —— 凡被源仓 .gitignore 拦下的
 * (真实 environments.yaml / secrets.yaml、node_modules、运行产物) 天然进不来,
 * 不依赖本脚本再维护一份易漏的排除清单。
 *
 * 例外:wechat-post 在源仓是未跟踪目录,只能走显式排除,见 UNTRACKED_SOURCES。
 *
 * 用法: node scripts/import-skills.mjs [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_REPO = path.resolve(REPO_ROOT, "..", "landary_work_e");

/** 源仓 git 已跟踪的 skill: 源仓相对路径 -> 本仓 skills/ 下的目录名 */
const TRACKED_SOURCES = {
  "skills/cn-hotspot": "cn-hotspot",
  "skills/github-trending": "github-trending",
  "skills/landray-log": "landray-log",
  "skills/market-analyzer": "market-analyzer",
  "skills/web-search": "web-search",
};

/** 源仓未跟踪、需显式排除运行产物的 skill */
const UNTRACKED_SOURCES = {
  ".claude/skills/wechat-post": {
    target: "wechat-post",
    // .profile 是浏览器登录态,publish-logs 是发文运行日志,都不该进公开仓
    excludeDirs: new Set([".profile", "publish-logs", "node_modules"]),
    excludeFiles: new Set(["last-response.html"]),
  },
};

/** wechat-post 源仓没有 .gitignore,补一份,免得运行产物日后被误提交 */
const WECHAT_POST_GITIGNORE = `# 浏览器登录态,绝不入库
.profile/

# 发文运行日志
publish-logs/

# 依赖
node_modules/
`;

const dryRun = process.argv.includes("--dry-run");

function listTrackedFiles(relDir) {
  const out = execFileSync("git", ["ls-files", "-z", "--", relDir], {
    cwd: SOURCE_REPO,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

async function listUntrackedFiles(absDir, rule, relPrefix = "") {
  const entries = await readdir(absDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (rule.excludeDirs.has(entry.name)) continue;
      files.push(...(await listUntrackedFiles(path.join(absDir, entry.name), rule, rel)));
    } else if (entry.isFile()) {
      if (rule.excludeFiles.has(entry.name)) continue;
      files.push(rel);
    }
  }
  return files;
}

async function copyInto(targetName, pairs) {
  let bytes = 0;
  for (const { from, to } of pairs) {
    const dest = path.join(REPO_ROOT, "skills", targetName, to);
    bytes += (await stat(from)).size;
    if (dryRun) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(from, dest);
  }
  return bytes;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  console.log(`[INFO] 源仓: ${SOURCE_REPO}`);
  console.log(`[INFO] 目标: ${path.join(REPO_ROOT, "skills")}`);
  if (dryRun) console.log("[INFO] --dry-run,只统计不落盘");
  console.log("");

  for (const [relDir, targetName] of Object.entries(TRACKED_SOURCES)) {
    const tracked = listTrackedFiles(relDir);
    if (tracked.length === 0) {
      console.log(`[FAIL] ${targetName}: 源仓无已跟踪文件,检查路径 ${relDir}`);
      process.exitCode = 1;
      continue;
    }
    const pairs = tracked.map((relFile) => ({
      from: path.join(SOURCE_REPO, relFile),
      to: path.relative(relDir, relFile).split(path.sep).join("/"),
    }));
    const bytes = await copyInto(targetName, pairs);
    console.log(`[PASS] ${targetName}: ${pairs.length} 个文件, ${kb(bytes)} (git tracked)`);
  }

  for (const [relDir, rule] of Object.entries(UNTRACKED_SOURCES)) {
    const absDir = path.join(SOURCE_REPO, relDir);
    const files = await listUntrackedFiles(absDir, rule);
    const pairs = files.map((relFile) => ({
      from: path.join(absDir, relFile),
      to: relFile,
    }));
    const bytes = await copyInto(rule.target, pairs);
    if (!dryRun) {
      await writeFile(
        path.join(REPO_ROOT, "skills", rule.target, ".gitignore"),
        WECHAT_POST_GITIGNORE,
        "utf8",
      );
    }
    console.log(`[PASS] ${rule.target}: ${pairs.length} 个文件, ${kb(bytes)} (untracked, 已排除运行产物)`);
  }

  console.log("");
  console.log("[INFO] 迁移完成。提交前务必跑一次凭证自检: node scripts/audit-secrets.mjs");
}

await main();

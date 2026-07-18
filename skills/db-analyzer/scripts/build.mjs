// 把 db-analyzer 打包成一个自闭环的「生产版 skill」到 dist/,生产端拿整个 dist/ 就能用:
//   dist/
//     SKILL.md                      给 Agent 的操作说明(命令走打包后的单文件,无 npm install 步骤)
//     scripts/run-query.bundle.mjs  单文件,已内置 mysql2/pg/oracledb 驱动(Oracle Thin 纯 JS,无平台二进制)
//     config/environments.example.yaml  配置模板
//     README.md                     部署说明
//
// 单文件放在 dist/scripts/ 下(镜像源码布局),这样它默认读的 ../config 正好是 dist/config,
// SKILL.md 里的命令只需把 scripts/run-query.mjs 换成 scripts/run-query.bundle.mjs。
//
// 用 esbuild 的 JS API(而非 CLI 一行)避开 banner 引号在 Windows/bash 之间的转义坑。
import { build } from "esbuild";
import { rm, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");

// 生产版 SKILL.md 由源码 SKILL.md 文本转换而来(避免维护两份漂移),三处不同:
//   1. 命令入口 scripts/run-query.mjs -> 打包单文件 scripts/run-query.bundle.mjs;
//   2. 删掉"首次使用/迁移"整节——部署前提是给人看的、README 已有,不塞进给 Agent 的 SKILL.md;
//   3. 末节"环境没配"精简成只留 Agent 用得上的配置定位与 --config/DB_ANALYZER_CONFIG 覆盖。
// 其余 SOP/红线/性能分析原样保留。
const PROD_ENVMISSING = `## 环境没配 / 用户要的连接不在清单

配置在本 skill 目录的 \`config/environments.yaml\`——照 \`config/environments.example.yaml\` 加一段、按 \`type: mysql|postgres|oracle|sqlite\` 填即可;也可用 \`--config <路径>\` 或环境变量 \`DB_ANALYZER_CONFIG\` 指向别处。改完立即生效(每次运行都重读配置,无需 reload)。运行环境要求(Node 版本等)见 README。
`;

const DIST_README = `# db-analyzer(生产打包版)

这是 \`npm run build\` 从源码 \`skills/db-analyzer\` 生成的自闭环生产 skill,请勿手改(改源码后重跑 build)。

内容:
- \`SKILL.md\` —— 给 Agent 的操作说明,命令走打包后的单文件
- \`scripts/run-query.bundle.mjs\` —— 单文件,已内置 mysql2/pg/oracledb 驱动(约 2.5MB,Oracle 走 Thin 模式纯 JS、无平台二进制)
- \`config/environments.example.yaml\` —— 配置模板

部署:
1. 把整个本目录复制到目标工程的 \`.claude/skills/db-analyzer\`(或任意位置作独立工具)。
2. 复制 \`config/environments.example.yaml\` 为 \`config/environments.yaml\`,填自己有权限的连接。
3. Node >= 22.5,**无需 npm install / node_modules**。
`;

function toProductionSkill(source) {
  let md = source;
  // 命令入口:源码脚本 -> 打包单文件(migrate 脚本那处路径名不同,不会被误伤)。
  md = md.replaceAll("scripts/run-query.mjs", "scripts/run-query.bundle.mjs");
  // 删掉"首次使用/迁移"整节(连它前面那个空行一起删,避免留多余空行):
  // 部署前提是给人看的、README 已有,不塞进给 Agent 的 SKILL.md。
  md = md.replace(/\n## 首次使用 \/ 迁移到新工程后[\s\S]*?(?=\n## )/, "");
  // 最后一节"环境没配"(源码版讲迁移脚本)-> 生产版精简(匹配到文件末尾)。
  md = md.replace(/## 环境没配 \/ 用户要的连接不在清单[\s\S]*$/, PROD_ENVMISSING);
  return md;
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, "scripts"), { recursive: true });
  await mkdir(join(DIST, "config"), { recursive: true });

  await build({
    entryPoints: [join(ROOT, "scripts", "run-query.mjs")],
    outfile: join(DIST, "scripts", "run-query.bundle.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["node:sqlite"], // Node 内置模块,运行时由 Node 提供
    // esbuild 把 CJS 依赖打进 ESM 输出时,依赖里的动态 require(如 mysql2 -> sql-escaper 的
    // require('node:buffer'))会变成抛错的桩。注入真正的 require 让这些动态 require 能工作。
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  });

  const sourceSkill = await readFile(join(ROOT, "SKILL.md"), "utf8");
  await writeFile(join(DIST, "SKILL.md"), toProductionSkill(sourceSkill));
  await cp(join(ROOT, "config", "environments.example.yaml"), join(DIST, "config", "environments.example.yaml"));
  await writeFile(join(DIST, "README.md"), DIST_README);

  console.log("[build] 已生成自闭环生产 skill 到 dist/(SKILL.md + scripts/run-query.bundle.mjs + config 模板)");
}

main().catch((err) => {
  console.error("[build] 失败:", err.stack || err.message);
  process.exit(1);
});

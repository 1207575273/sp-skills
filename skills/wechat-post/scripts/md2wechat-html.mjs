// 将公众号 Markdown 文稿转换为微信粘贴兼容的行内样式 HTML(多风格)
// 用法: node scripts/md2wechat-html.mjs <markdown文件路径>
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`;
const SERIF = `Georgia,'Times New Roman','Songti SC','Noto Serif CJK SC',SimSun,serif`;

// 各风格的行内样式映射。伪元素装饰已按 SKILL.md 规则改写为边框/留白。
const STYLES = {
  minimal: {
    name: '极简黑白', scene: '默认款、深度文章、方法论',
    body: `max-width:740px;margin:0 auto;padding:24px 22px;background-color:#ffffff;`,
    p: `margin:12px 0;font-family:${SANS};font-size:16px;line-height:1.82;color:#2b2b2b;`,
    h2: `margin:42px 0 14px;font-family:${SANS};font-size:19px;line-height:1.45;font-weight:800;color:#111111;border-left:6px solid #111111;padding-left:10px;`,
    h3: `margin:30px 0 10px;font-family:${SANS};font-size:17px;line-height:1.5;font-weight:700;color:#222222;`,
    strong: `font-weight:800;color:#111111;`,
    hr: `border:none;border-top:1px solid #e0e0e0;margin:32px 0;`,
    img: `margin:20px 0;padding:18px 16px;border:1px dashed #bbbbbb;background-color:#fafafa;font-family:${SANS};font-size:14px;line-height:1.6;color:#888888;text-align:center;`,
  },
  medium: {
    name: 'Medium Essay', scene: '长文观点、个人文章',
    body: `max-width:680px;margin:0 auto;padding:34px 24px;background-color:#ffffff;`,
    p: `margin:15px 0;font-family:${SERIF};font-size:16px;line-height:1.92;color:#242424;`,
    h2: `margin:52px 0 18px;font-family:${SERIF};font-size:22px;line-height:1.35;font-weight:700;color:#111111;`,
    h3: `margin:34px 0 12px;font-family:${SERIF};font-size:18px;line-height:1.45;font-weight:700;color:#333333;`,
    strong: `font-weight:800;color:#111111;`,
    hr: `border:none;border-top:1px solid #d8d8d8;margin:40px auto;width:34%;`,
    img: `margin:24px 0;padding:18px 16px;border:1px dashed #c9c9c9;background-color:#fafafa;font-family:${SERIF};font-size:14px;line-height:1.6;color:#8a8a8a;text-align:center;`,
  },
  stripe: {
    name: 'Stripe Docs', scene: '教程、工具说明、产品文档',
    body: `max-width:760px;margin:0 auto;padding:24px 22px;background-color:#fbfcff;`,
    p: `margin:12px 0;font-family:${SANS};font-size:16px;line-height:1.78;color:#2a2f45;`,
    h2: `margin:42px 0 14px;font-family:${SANS};font-size:19px;line-height:1.45;font-weight:800;color:#0a2540;padding:10px 12px;background-color:#f1f5ff;border-left:4px solid #635bff;`,
    h3: `margin:30px 0 10px;font-family:${SANS};font-size:17px;line-height:1.5;font-weight:700;color:#425466;`,
    strong: `font-weight:800;color:#0a2540;`,
    hr: `border:none;border-top:1px solid #d9e2f3;margin:32px 0;`,
    img: `margin:20px 0;padding:18px 16px;border:1px dashed #b9c6e8;background-color:#ffffff;font-family:${SANS};font-size:14px;line-height:1.6;color:#8792ad;text-align:center;`,
  },
  wired: {
    name: 'WIRED Feature', scene: 'AI、科技观点、前沿趋势',
    body: `max-width:750px;margin:0 auto;padding:22px;background-color:#ffffff;`,
    p: `margin:12px 0;font-family:${SANS};font-size:16px;line-height:1.74;color:#111111;`,
    h2: `margin:44px 0 14px;font-family:${SANS};font-size:20px;line-height:1.35;font-weight:900;color:#111111;background-color:#f5ff00;padding:10px 12px;`,
    h3: `margin:32px 0 10px;font-family:${SANS};font-size:18px;line-height:1.4;font-weight:900;color:#111111;border-bottom:4px solid #00e5ff;padding-bottom:5px;`,
    strong: `font-weight:900;color:#111111;background-color:#f5ff00;`,
    hr: `border:none;border-top:5px solid #111111;margin:34px 0;`,
    img: `margin:20px 0;padding:18px 16px;border:2px solid #111111;background-color:#f2f2f2;font-family:${SANS};font-size:14px;line-height:1.6;color:#555555;text-align:center;`,
  },
  ft: {
    name: 'FT Analysis', scene: '商业分析、市场判断',
    body: `max-width:740px;margin:0 auto;padding:24px 22px;background-color:#fff1df;`,
    p: `margin:13px 0;font-family:${SERIF};font-size:16px;line-height:1.9;color:#262018;`,
    h2: `margin:46px 0 16px;font-family:${SERIF};font-size:21px;line-height:1.42;font-weight:800;color:#3b2b1d;padding-top:10px;border-top:1px solid #8a7356;`,
    h3: `margin:32px 0 10px;font-family:${SERIF};font-size:18px;line-height:1.5;font-weight:700;color:#4c3a29;`,
    strong: `font-weight:800;color:#111111;`,
    hr: `border:none;border-top:1px solid #8a7356;margin:34px 0;width:58%;`,
    img: `margin:20px 0;padding:18px 16px;border:1px dashed #b39b7c;background-color:#f9e6cf;font-family:${SERIF};font-size:14px;line-height:1.6;color:#7a6648;text-align:center;`,
  },
  course: {
    name: '课程讲义', scene: '课程、教程、学习笔记',
    body: `max-width:750px;margin:0 auto;padding:22px;background-color:#ffffff;`,
    p: `margin:12px 0;font-family:${SANS};font-size:16px;line-height:1.84;color:#272727;`,
    h2: `margin:40px 0 16px;font-family:${SANS};font-size:19px;line-height:1.45;font-weight:800;color:#111111;padding:11px 14px;background-color:#f3f3f3;`,
    h3: `margin:30px 0 10px;font-family:${SANS};font-size:17px;line-height:1.5;font-weight:800;color:#111111;border-bottom:1px dotted #aaaaaa;padding-bottom:6px;`,
    strong: `font-weight:800;color:#111111;`,
    hr: `border:none;border-top:1px solid #dddddd;margin:30px 0;`,
    img: `margin:20px 0;padding:18px 16px;border:1px dashed #bbbbbb;background-color:#f8f8f8;font-family:${SANS};font-size:14px;line-height:1.6;color:#888888;text-align:center;`,
  },
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内标记: **加粗** 与 `代码`
function inline(s, st) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong style="${st.strong}">${t}</strong>`);
  return out;
}

// 段末中文句号去掉(SKILL.md 转换细节第 5 条)
function trimPeriod(s) {
  return s.replace(/。\s*$/, '');
}

function parse(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let title = null;
  let para = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join(' ') });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^# /.test(line)) {
      flush();
      if (title === null) title = line.slice(2).trim();
      else blocks.push({ type: 'h2', text: line.slice(2).trim() });
    } else if (/^## /.test(line)) {
      flush(); blocks.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (/^### /.test(line)) {
      flush(); blocks.push({ type: 'h3', text: line.slice(4).trim() });
    } else if (/^---+$/.test(line)) {
      flush(); blocks.push({ type: 'hr' });
    } else if (/^!\[.*\]\(.*\)$/.test(line)) {
      flush();
      const m = line.match(/^!\[(.*)\]\((.*)\)$/);
      blocks.push({ type: 'img', alt: m[1], src: m[2] });
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return { title: title || '公众号文章', blocks };
}

function render(doc, st) {
  const parts = [];
  for (const b of doc.blocks) {
    if (b.type === 'p') parts.push(`<p style="${st.p}">${inline(trimPeriod(b.text), st)}</p>`);
    else if (b.type === 'h2') parts.push(`<h2 style="${st.h2}">${inline(b.text, st)}</h2>`);
    else if (b.type === 'h3') parts.push(`<h3 style="${st.h3}">${inline(b.text, st)}</h3>`);
    else if (b.type === 'hr') parts.push(`<hr style="${st.hr}">`);
    else if (b.type === 'img') parts.push(`<p style="${st.img}">[图片:${escapeHtml(b.alt)} - 粘贴后在此处插入 ${escapeHtml(path.basename(b.src))}]</p>`);
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title)}</title>
</head>
<body style="${st.body}">
${parts.join('\n')}
</body>
</html>
`;
}

function overviewPage(baseName, entries) {
  const cards = entries.map(e => `
    <a class="card" href="${encodeURI(e.file)}">
      <div class="sid">${e.id}</div>
      <div class="name">${e.name}</div>
      <div class="scene">${e.scene}</div>
    </a>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>公众号 HTML 风格总览</title>
<style>
  body { font-family: 'Microsoft YaHei', sans-serif; background: #f5f6fa; padding: 40px; color: #222; }
  h1 { font-size: 22px; margin-bottom: 6px; }
  .tip { color: #777; font-size: 14px; margin-bottom: 28px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 900px; }
  .card { display: block; background: #fff; border: 1px solid #e3e5ef; border-radius: 10px; padding: 20px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #635bff; }
  .sid { font-size: 12px; color: #635bff; font-weight: 700; letter-spacing: 1px; }
  .name { font-size: 17px; font-weight: 700; margin: 6px 0 4px; }
  .scene { font-size: 13px; color: #888; }
</style>
</head>
<body>
<h1>${baseName} - 风格总览</h1>
<div class="tip">点开风格页面后: 全选(Ctrl+A) - 复制(Ctrl+C) - 粘贴到公众号后台编辑器。图片占位处需在编辑器内手动插入对应 PNG。</div>
<div class="grid">
${cards}
</div>
</body>
</html>
`;
}

const mdPath = process.argv[2];
if (!mdPath) {
  console.error('[FAIL] 用法: node scripts/md2wechat-html.mjs <markdown文件路径>');
  process.exit(1);
}
console.log('[INFO] 读取文稿:', mdPath);
const md = await readFile(mdPath, 'utf8');
const doc = parse(md);
console.log('[INFO] 文章标题:', doc.title, '| 内容块数:', doc.blocks.length);

const srcDir = path.dirname(mdPath);
const baseName = path.basename(mdPath, path.extname(mdPath));
const outDir = path.join(srcDir, '公众号HTML输出');
await mkdir(outDir, { recursive: true });

const entries = [];
for (const [id, st] of Object.entries(STYLES)) {
  const file = `${baseName}_${id}_${st.name}_微信公众号版.html`;
  await writeFile(path.join(outDir, file), render(doc, st), 'utf8');
  entries.push({ id, name: st.name, scene: st.scene, file });
  console.log('[PASS] 生成:', file);
}
await writeFile(path.join(outDir, '00_公众号HTML风格总览.html'), overviewPage(baseName, entries), 'utf8');
await writeFile(path.join(outDir, '风格目录.md'),
  `# 风格目录\n\n${entries.map(e => `- ${e.id} (${e.name}): ${e.scene} -> ${e.file}`).join('\n')}\n`, 'utf8');
console.log('[PASS] 总览页与风格目录已生成 ->', outDir);

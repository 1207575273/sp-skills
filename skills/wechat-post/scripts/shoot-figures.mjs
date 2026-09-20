// 把目录下所有配图 HTML 模板截成同名 PNG(对 body 做元素级截图,尺寸精确)
// 用法: node shoot-figures.mjs <assets目录> [--only cover.html,fig1.html]
import { readdir } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { chromium } from 'playwright-core';

function log(level, ...args) {
  console.log(`[${level}]`, ...args);
}

const dir = process.argv[2];
if (!dir) {
  log('FAIL', '用法: node shoot-figures.mjs <assets目录> [--only a.html,b.html]');
  process.exit(1);
}
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > -1 ? new Set(process.argv[onlyIdx + 1].split(',')) : null;

const files = (await readdir(dir)).filter(f => f.endsWith('.html') && (!only || only.has(f)));
if (!files.length) {
  log('FAIL', '目录下没有待截图的 HTML:', dir);
  process.exit(1);
}
log('INFO', `待截图 ${files.length} 个模板:`, files.join(', '));

// 自有浏览器实例,file 协议不受限;优先本机 Chrome,失败退回 playwright 自带 chromium
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

let failed = 0;
for (const file of files) {
  const htmlPath = path.resolve(dir, file);
  const pngPath = htmlPath.replace(/\.html$/, '.png');
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    const body = page.locator('body');
    await body.screenshot({ path: pngPath });
    const box = await body.boundingBox();
    log('PASS', `${path.basename(pngPath)} ${Math.round(box.width)} x ${Math.round(box.height)}`);
  } catch (err) {
    failed++;
    log('FAIL', file, err.message);
  }
}
await browser.close();
log('INFO', `完成: ${files.length - failed} 成功, ${failed} 失败`);
process.exit(failed ? 1 : 0);

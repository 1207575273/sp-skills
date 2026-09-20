// 入口:把微信粘贴兼容 HTML 存入公众号草稿箱(只存草稿,不群发),配图自动上传
// 用法见 ../SKILL.md;浏览器为常驻独立 Chrome,脚本退出不关闭
import { readFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, parseArgs } from './lib/common.mjs';
import { ensureBrowser, waitLogin } from './lib/browser.mjs';
import { openEditor, dismissPopups, fillTitleAuthor, getBodyEditor, injectContent, uploadImages, cleanupEmptyPlaceholders, setCover, saveDraft } from './lib/editor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '..', '.profile');
const LOG_DIR = path.join(__dirname, '..', 'publish-logs');

const args = parseArgs(process.argv);
if (!args.html) {
  log('FAIL', '缺少 --html 参数');
  process.exit(1);
}
const loginTimeoutMs = (Number(args['login-timeout']) || 180) * 1000;
const assetsDir = args['assets-dir'] || path.join(path.dirname(args.html), '..', 'assets');

log('INFO', '读取 HTML:', args.html);
const rawHtml = await readFile(args.html, 'utf8');
const titleMatch = rawHtml.match(/<title>([\s\S]*?)<\/title>/);
const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
if (!bodyMatch) {
  log('FAIL', 'HTML 中未找到 <body>,无法提取正文');
  process.exit(1);
}
const title = (args.title || (titleMatch ? titleMatch[1].trim() : '')).slice(0, 64);
const bodyHtml = bodyMatch[1].trim();
log('INFO', '文章标题:', title, '| 正文长度:', bodyHtml.length, '| 配图目录:', assetsDir);

await mkdir(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const shot = (name) => path.join(LOG_DIR, `${stamp}_${name}.png`);

let exitCode = 0;
try {
  const browser = await ensureBrowser(PROFILE_DIR);
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP 连接上了但没有浏览器上下文');

  const token = await waitLogin(context, loginTimeoutMs);
  log('PASS', '已登录,token:', token);

  const page = await openEditor(context, token);
  await dismissPopups(page);
  await page.screenshot({ path: shot('editor-loaded') });

  await fillTitleAuthor(page, title, args.author);

  const editor = getBodyEditor(page);
  await injectContent(page, editor, bodyHtml);

  await uploadImages(page, editor, assetsDir, shot);
  await cleanupEmptyPlaceholders(page, editor);
  await page.screenshot({ path: shot('content-ready') });

  const coverPath = args.cover || path.join(assetsDir, 'cover.png');
  try {
    await setCover(page, coverPath, shot);
  } catch (err) {
    log('WARN', '封面设置失败,可在后台手动设置:', err.message);
  }

  await dismissPopups(page, 1);
  await saveDraft(page, shot);
  log('INFO', 'Chrome 窗口保留,请直接在页面上核对草稿效果');
} catch (err) {
  log('FAIL', '执行异常:', err.message);
  exitCode = 9;
}
// 只断开 CDP,不关闭浏览器
process.exit(exitCode);

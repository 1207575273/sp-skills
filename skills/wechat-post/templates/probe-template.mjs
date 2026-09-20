// 临时探测脚本骨架:连上常驻 Chrome 的页面现场做排查
// 用法: 复制到项目 scripts/tmp-probe-xxx.mjs,改探测动作,node 运行;搞定后删除
// 纪律: 只连接不关闭浏览器;每步落截图;结论固化进 skill 后补 pitfalls.md
import { chromium } from 'playwright-core';

const CDP = 'http://127.0.0.1:9223';
const SHOT_DIR = '.claude/skills/wechat-post/publish-logs';

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0];
if (!context) { console.log('[FAIL] 无浏览器上下文,常驻 Chrome 是否在跑?'); process.exit(1); }

// 按 URL 特征找到目标页面(编辑页含 appmsg_edit)
const page = context.pages().find(p => p.url().includes('appmsg_edit'));
if (!page) {
  console.log('[FAIL] 没找到目标页面,当前标签页:');
  for (const p of context.pages()) console.log('  -', p.url().slice(0, 100));
  process.exit(1);
}
console.log('[INFO] 已连上页面:', page.url().slice(0, 100));

// 第一板斧:截图看现场
await page.screenshot({ path: `${SHOT_DIR}/probe-scene.png` });
console.log('[INFO] 现场截图:', `${SHOT_DIR}/probe-scene.png`);

// 第二板斧:枚举可交互元素(按需改筛选词)
const info = await page.evaluate(() => {
  const out = { buttons: [], fileInputs: [] };
  for (const el of document.querySelectorAll('button, a, label')) {
    const r = el.getBoundingClientRect();
    const t = (el.textContent || '').trim();
    if (r.width > 0 && r.height > 0 && t && t.length <= 12) {
      out.buttons.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: t });
    }
  }
  for (const i of document.querySelectorAll('input[type=file]')) {
    out.fileInputs.push({ accept: i.accept, id: i.id, visible: !!(i.offsetWidth || i.offsetHeight) });
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));

// 第三板斧:在这里加一个最小交互动作,然后截图验证
// 例: await page.locator('button:has-text("确认")').first().click();
// await page.waitForTimeout(2000);
// await page.screenshot({ path: `${SHOT_DIR}/probe-after.png` });

process.exit(0);

// 图文编辑页操作(新版 ProseMirror 编辑器):弹窗清理、标题作者、正文注入、配图上传、存草稿
import { readFile } from 'fs/promises';
import path from 'path';
import { log } from './common.mjs';

export async function openEditor(context, token) {
  const editUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&createType=0&token=${token}&lang=zh_CN`;
  for (const p of context.pages()) {
    if (p.url().includes('appmsg_edit')) {
      await p.close().catch(() => {});
      log('INFO', '关闭上一轮遗留的编辑页标签');
    }
  }
  const page = await context.newPage();
  log('INFO', '打开图文编辑页:', editUrl);
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  return page;
}

// 弹窗可能晚于页面出现,循环清理直到连续静默;关键动作前都应再调用一次
export async function dismissPopups(page, quietRounds = 3) {
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < quietRounds; i++) {
    const dialog = page.locator('.weui-desktop-dialog__wrp').filter({ visible: true }).first();
    if (await dialog.isVisible().catch(() => false)) {
      quiet = 0;
      const btn = dialog.locator(
        'button:has-text("我知道了"), button:has-text("知道了"), button:has-text("跳过"), button:has-text("完成"), .weui-desktop-dialog__close'
      ).first();
      if (await btn.count()) {
        await btn.click().catch(() => {});
        log('INFO', '关闭弹窗');
      } else {
        await page.keyboard.press('Escape');
        log('INFO', '按 Escape 关闭弹窗');
      }
    } else {
      quiet++;
    }
    await page.waitForTimeout(800);
  }
}

export async function fillTitleAuthor(page, title, author) {
  const titleBox = page.locator('div.ProseMirror[data-placeholder*="标题"], textarea[placeholder*="标题"]')
    .filter({ visible: true }).first();
  await titleBox.waitFor({ state: 'visible', timeout: 15000 });
  await titleBox.click();
  await page.keyboard.type(title, { delay: 10 });
  log('PASS', '标题已填写');
  if (!author) return;
  const authorBox = page.locator('#author, input[placeholder*="作者"]').filter({ visible: true }).first();
  if (await authorBox.count()) {
    await authorBox.click();
    await page.keyboard.type(author, { delay: 10 });
    log('PASS', '作者已填写:', author);
  } else {
    log('WARN', '未找到作者输入框,跳过');
  }
}

// 正文编辑器 = 页面上不带"标题"占位符的那个 ProseMirror
export function getBodyEditor(page) {
  return page.locator('div.ProseMirror:not([data-placeholder*="标题"])').filter({ visible: true }).first();
}

// 通过真实粘贴事件注入 HTML,让 ProseMirror 走自己的解析管线
export async function injectContent(page, editor, bodyHtml) {
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  await editor.click();
  await editor.evaluate((el, html) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    el.dispatchEvent(evt);
  }, bodyHtml);
  await page.waitForTimeout(2000);
  const textLen = await editor.evaluate(el => (el.innerText || '').length);
  if (textLen < 100) throw new Error(`正文注入后文本过短(${textLen}),疑似失败`);
  log('PASS', '正文已注入,可见文本长度:', textLen);
}

// 配图上传:三连击选中占位段落,再派发带 File 的粘贴事件,由编辑器上传替换
export async function uploadImages(page, editor, assetsDir, shot) {
  const placeholders = await editor.evaluate((el) => {
    const list = [];
    for (const p of el.querySelectorAll('p')) {
      const m = (p.textContent || '').match(/\[图片:.*?([\w\-]+\.(?:png|jpg|jpeg))\]?/);
      if (m) list.push(m[1]);
    }
    return list;
  });
  log('INFO', '发现图片占位:', placeholders.length ? placeholders.join(', ') : '无');

  for (const fileName of placeholders) {
    const filePath = path.join(assetsDir, fileName);
    let buf;
    try {
      buf = await readFile(filePath);
    } catch {
      log('WARN', '本地找不到配图文件,跳过:', filePath);
      continue;
    }
    const before = await editor.evaluate(el => el.querySelectorAll('img').length);
    log('INFO', `上传配图 ${fileName} (${buf.length} 字节),当前正文图片数: ${before}`);

    const pLoc = editor.locator(`p:has-text("${fileName}")`).first();
    if (!(await pLoc.count())) {
      log('WARN', '正文中找不到该占位段落,跳过:', fileName);
      continue;
    }
    await pLoc.scrollIntoViewIfNeeded();
    await pLoc.click({ clickCount: 3 });
    await editor.evaluate((el, { fileName, b64 }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(evt, 'clipboardData', { value: dt });
      el.dispatchEvent(evt);
    }, { fileName, b64: buf.toString('base64') });

    let uploaded = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const now = await editor.evaluate(el => el.querySelectorAll('img').length);
      if (now > before) { uploaded = true; break; }
    }
    if (uploaded) {
      log('PASS', `配图已上传: ${fileName}`);
      await page.waitForTimeout(1000);
    } else {
      log('WARN', `30s 内未见 ${fileName} 插入正文,保留占位,请后台手动处理`);
      await page.screenshot({ path: shot(`img-fail-${fileName.replace(/\W/g, '_')}`) });
    }
  }
}

// 图片替换后可能留下空的虚线占位段落,点击空段落后退格删除
export async function cleanupEmptyPlaceholders(page, editor) {
  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const handle = await editor.evaluateHandle((el) => {
      return [...el.querySelectorAll('p')].find(p =>
        !p.querySelector('img') && (p.textContent || '').trim() === '' &&
        (p.getAttribute('style') || '').includes('border')
      ) || null;
    });
    const target = handle.asElement();
    if (!target) break;
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    removed++;
  }
  log('INFO', `空占位段落清理完成,移除 ${removed} 个`);
}

// 设置封面:封面区菜单 -> 从图片库选择 -> 向 webuploader 隐藏 input 注入文件 -> 上传完自动进裁剪 -> 确认
export async function setCover(page, coverPath, shot) {
  const area = page.locator('.select-cover__btn').first();
  await area.scrollIntoViewIfNeeded();
  await area.click();
  await page.waitForTimeout(1000);
  const fromLib = page.locator('a.js_imagedialog').filter({ visible: true }).first();
  await fromLib.waitFor({ state: 'visible', timeout: 10000 });
  await fromLib.click();
  log('INFO', '已打开图片库对话框');
  await page.waitForTimeout(2000);
  const input = page.locator('div[id^="rt_rt"] input[type="file"]').first();
  await input.waitFor({ state: 'attached', timeout: 10000 });
  await input.setInputFiles(coverPath);
  log('INFO', '封面文件已注入,等待上传');
  // 上传后两种分支:直接进裁剪层;或停在选图对话框(图已选中),需点"下一步"再进裁剪
  const jcrop = page.locator('.jcrop-holder').first();
  let inCrop = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (await jcrop.isVisible().catch(() => false)) { inCrop = true; break; }
    const nextBtn = page.locator('button.weui-desktop-btn_primary:has-text("下一步")').filter({ visible: true }).first();
    if (await nextBtn.count()) {
      const enabled = await nextBtn.evaluate(el => !el.disabled && !el.className.includes('disabled')).catch(() => false);
      if (enabled) {
        log('INFO', '停在选图对话框且图已选中,点下一步');
        await nextBtn.click();
      }
    }
  }
  if (!inCrop) {
    await page.screenshot({ path: shot('cover-no-crop') }).catch(() => {});
    throw new Error('30s 内未进入封面裁剪界面');
  }
  const confirmBtn = page.locator('button.weui-desktop-btn_primary:has-text("确认")').filter({ visible: true }).first();
  await confirmBtn.click();
  await page.waitForTimeout(2000);
  log('PASS', '封面已设置:', path.basename(coverPath));
}

export async function saveDraft(page, shot) {
  const saveBtn = page.locator('button:has-text("保存为草稿"), a:has-text("保存为草稿")').filter({ visible: true }).first();
  if (!(await saveBtn.count())) {
    await page.screenshot({ path: shot('no-save-button') });
    throw new Error('未找到保存为草稿按钮');
  }
  log('INFO', '点击保存为草稿');
  await saveBtn.click();
  await page.waitForTimeout(5000);
  // 保存成功后页面会自动重载,截图可能撞上导航,失败不影响结果
  await page.screenshot({ path: shot('after-save') }).catch(() => log('WARN', '保存后页面重载,截图跳过'));
  log('PASS', '已执行保存');
}

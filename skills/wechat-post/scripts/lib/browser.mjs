// 浏览器接入:连接常驻调试端口的独立 Chrome,连不上则拉起(脱离脚本存活,脚本退出不关浏览器)
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright-core';
import { log } from './common.mjs';

export const CDP_PORT = 9223;

// Chrome 路径:环境变量优先,其次探测常见安装位置
function findChrome() {
  const candidates = [
    process.env.WECHAT_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('未找到 Chrome,请安装 Chrome 或设置环境变量 WECHAT_CHROME_PATH 指向 chrome.exe');
}

export async function ensureBrowser(profileDir) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  try {
    const b = await chromium.connectOverCDP(endpoint);
    log('INFO', '已连接既有 Chrome:', endpoint);
    return b;
  } catch {
    log('INFO', '未发现常驻 Chrome,拉起新实例(脚本退出不会关闭它)');
    spawn(findChrome(), [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run', '--no-default-browser-check', '--start-maximized',
      'https://mp.weixin.qq.com/',
    ], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const b = await chromium.connectOverCDP(endpoint);
        log('PASS', 'Chrome 已就绪并接管连接');
        return b;
      } catch { /* 继续等 */ }
    }
    throw new Error('30 秒内未能连接到 Chrome 调试端口 ' + CDP_PORT);
  }
}

// 等待任一标签页出现公众号后台登录态,返回 token
export async function waitLogin(context, timeoutMs) {
  let homePage = context.pages().find(p => p.url().includes('mp.weixin.qq.com')) || await context.newPage();
  if (!homePage.url().includes('mp.weixin.qq.com')) {
    await homePage.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      const m = p.url().match(/mp\.weixin\.qq\.com.*[?&]token=(\d+)/);
      if (m) return m[1];
    }
    log('INFO', '未检测到登录态,请在 Chrome 窗口扫码登录');
    await homePage.waitForTimeout(5000);
  }
  throw new Error(`等待登录超时(${timeoutMs / 1000}s)`);
}

# 探测排障手册

固化脚本失效时,用临时脚本连上常驻 Chrome 排查。本手册的每个招式都在实战中验证过。

## 原则

- **现场不灭**:常驻 Chrome(CDP 9223)保留登录态和页面状态,探测脚本只 `connectOverCDP` 连接,结束 `process.exit()` 断开,永远不 `browser.close()`
- **小步循环**:截图看现场 -> 枚举候选元素 -> 一次只试一个动作 -> 再截图验证 -> 有效则固化
- **证据优先**:每步落一张截图;Playwright 的超时错误日志会直接说出"谁拦截了点击",先读日志再动手
- **接管优于重跑**:发布流程半途中断时,编辑页和已填内容都还在现场,探测脚本连上去从卡点续跑;重跑整条流程会产生重复草稿

## 探测循环的三板斧

1. **截图看现场**:`await page.screenshot({ path: '...' })`,人眼看一眼胜过十次猜
2. **枚举可交互元素**(在 evaluate 里跑,按需改筛选条件):

```js
const info = await page.evaluate(() => {
  const out = { buttons: [], inputs: [] };
  for (const el of document.querySelectorAll('button, a, label')) {
    const r = el.getBoundingClientRect();
    const t = (el.textContent || '').trim();
    if (r.width > 0 && t && t.length <= 12) {
      out.buttons.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: t });
    }
  }
  for (const i of document.querySelectorAll('input[type=file]')) {
    out.inputs.push({ accept: i.accept, id: i.id, visible: !!(i.offsetWidth || i.offsetHeight) });
  }
  return out;
});
```

3. **最小交互 + 验证**:试一个动作,等 1-3 秒,截图或查 DOM 状态确认效果

## 招式对照表(实战验证)

| 症状 | 根因 | 招式 |
| --- | --- | --- |
| 点击超时,日志说 element intercepts pointer events | 弹窗/遮罩盖着 | 读日志里拦截者的 class:引导弹窗就循环清理(按钮文本 我知道了/知道了/跳过,或 Escape),清到连续静默 |
| 目标元素 resolved to hidden | 老 DOM 残留,页面早换了新组件 | 别恋战,枚举页面上可见的同类元素(如 `div.ProseMirror`),换定位 |
| contenteditable 用 fill 无效 | fill 只对表单控件 | `click()` + `page.keyboard.type()` |
| 富文本编辑器 innerHTML 注入后状态错乱 | 框架(ProseMirror 等)有自己的文档模型 | 合成粘贴事件走它自己的解析管线:`dispatchEvent(new ClipboardEvent('paste', ...))`,dataTransfer 里放 text/html 或 File |
| 上传按钮点不动/点了没反应 | webuploader 类组件只认自己的绑定,UI 层有透明 label | 跳过 UI:找隐藏 `input[type=file]` 直接 `setInputFiles()` |
| 上传后"下一步/确认"仍禁用,疑似失败 | 上传完成后流程自动跳到了别的层(如裁剪) | 别依赖按钮态,等**结果特征元素**出现(如 `.jcrop-holder`、img 数量增加),轮询 + 超时 |
| 点击会弹系统文件对话框 | 原生 file dialog | 点击前 `page.waitForEvent('filechooser')`,拿到后 `setFiles()` |
| 合成 DragEvent 拖拽无效 | 框架不认非受信拖拽事件 | 放弃拖拽路线,换隐藏 input 或 filechooser |
| file:// 打不开(托管浏览器) | 通道禁 file 协议 | 自有 playwright 实例不受限;或起 `python -m http.server` 走 `http://127.0.0.1`(不要用 localhost,会解析到 ::1) |

## 固化纪律

探测成功不等于完事,必须走完:

1. 把验证过的选择器和交互序列写进 `scripts/lib/editor.mjs`(或对应模块),带日志打点和失败截图
2. 新坑按"现象 -> 根因 -> 处理"补进 `pitfalls.md`
3. 删除所有 `tmp-` 临时脚本
4. 用真实产物完整重跑一遍固化后的脚本,全 [PASS] 才算收口

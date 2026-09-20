# 踩坑全录

2026-08-17 首篇实战中踩过的所有坑,格式:现象 -> 根因 -> 处理。新坑继续往这里补。

## 配图与截图

1. **浏览器自动化工具打不开本地 HTML 模板**
   - 现象:navigate `file:///...` 报 "Access to file: protocol is blocked"
   - 根因:托管的浏览器自动化通道出于安全禁用 file 协议
   - 处理:本 skill 的 `shoot-figures.mjs` 用自有 playwright-core 实例,file 协议不受限,坑已架构性消除。若临时手工截图,起 `python -m http.server` 走 HTTP

2. **localhost 连接被拒但服务器明明起了**
   - 现象:`http://localhost:8931` ERR_CONNECTION_REFUSED
   - 根因:Windows 下 localhost 解析到 IPv6 `::1`,而 python http.server 绑定的是 IPv4
   - 处理:一律用 `http://127.0.0.1:<port>`

3. **fullPage 截图尺寸不对,封面比例失真**
   - 现象:1800x766 的封面截出 2000x900,视口空白被带进图
   - 根因:fullPage 以视口/文档尺寸为准,不是内容尺寸
   - 处理:一律对 `body` 做元素级截图(`locator('body').screenshot()`),body 在模板里定死宽高

## 排版与粘贴

4. **公众号发布后出现双标题**
   - 现象:正文顶部又出现一遍文章标题
   - 根因:Markdown 首个一级标题被渲染进正文,而后台标题框已有一份
   - 处理:转换脚本把首个 h1 只写入 `<title>`,不进 body(已内置)

5. **粘贴到公众号编辑器图片丢失**
   - 现象:HTML 里内嵌 base64 或本地路径图片,粘贴后图没了
   - 根因:公众号编辑器清洗粘贴内容,base64 与本地路径图片都会被剥离
   - 处理:排版 HTML 只放文字占位块 `[图片:xxx.png]`,发布环节由 wechat-publisher 走编辑器自身上传通道替换

6. **样式粘贴后丢失**
   - 现象:浏览器预览正常,贴进公众号排版垮掉
   - 根因:复制不携带 `<head><style>`,class/伪元素也会被清洗
   - 处理:所有样式逐元素展开为行内 style,禁 class/id/伪元素/外链(脚本已内置,交付前 grep 检查)

## 发布自动化(详见 wechat-publisher 的 SKILL.md,此处存档根因)

7. **老教程里的 UEditor 选择器全部失效**
   - 现象:#title 存在但 hidden,#ueditor_0 注入无效
   - 根因:新版公众号编辑器已换 ProseMirror,老 DOM 只是残留
   - 处理:标题和正文都定位 `div.ProseMirror`;内容注入用合成粘贴事件走编辑器解析管线

8. **引导弹窗拦截一切点击**
   - 现象:element intercepts pointer events,点击超时
   - 根因:新功能引导弹窗(education-dialog)出现时机晚于页面加载
   - 处理:循环清理弹窗直到连续多轮静默,关键动作前再清一次

9. **脚本退出把用户浏览器一起带走**
   - 现象:launchPersistentContext 的 Chrome 随脚本退出关闭,登录现场丢失
   - 根因:playwright 启动的浏览器是脚本子进程
   - 处理:改为 detached 拉起带调试端口的独立 Chrome,脚本用 CDP 连接,退出只断开

10. **封面上传:拖拽、点按钮全被拦**
    - 现象:合成 DragEvent 无反应;"上传文件"按钮点击被 webuploader 的 label 和图片网格拦截
    - 根因:上传组件(webuploader)只认自己的事件绑定
    - 处理:直接对 `div[id^="rt_rt"] input[type=file]` 做 setInputFiles,绕过所有 UI 层

11. **封面上传成功却被误判失败**
    - 现象:注入文件后"下一步"仍 disabled,以为没传上
    - 根因:单文件上传完成后对话框自动跳进裁剪层(jcrop),根本不走"下一步"
    - 处理:注入后等待 `.jcrop-holder` 出现,点确认即可;2.35:1 的图零裁损

11b. **封面上传后行为有两种分支**
    - 现象:同样的注入,第一次自动跳进裁剪层,第二次停在选图对话框(图已上传选中,"下一步"可用),脚本干等裁剪层超时
    - 根因:选图对话框的流转行为不唯一(疑与图库已有内容/加载时序有关)
    - 处理:注入后同时轮询两个信号——裁剪层出现直接走;"下一步"可用就点它再等裁剪层(已固化进 setCover)

11c. **保存草稿后整页截图超时**
    - 现象:保存成功但 page.screenshot 卡 30s 超时
    - 根因:保存成功后页面自动重载(URL 追加 reprint_confirm/timestamp),截图撞上导航
    - 处理:保存后的截图加 catch 容错;验证保存结果读 DOM(封面区 mmbiz CDN 背景、历史版本),不依赖截图

11d. **换排版风格后空占位清理失效**
    - 现象:medium(虚线占位)清理正常,换 wired(实线占位)后"移除 0 个",正文残留空黑框
    - 根因:清理函数按 style 含 "dashed" 匹配,不同风格的占位边框样式不同
    - 处理:匹配条件放宽为"空文本 + 无 img + style 含 border"(已固化);新增风格时留意占位样式特征

12. **登录态几天就过期**
    - 现象:隔几天跑脚本又要扫码
    - 根因:公众号后台 cookie 有效期短,平台如此
    - 处理:接受现实,脚本检测不到登录态时提示扫码等待,不要试图绕过

## 工程杂项

13. **npm 装到了错误目录**
    - 现象:node_modules 出现在子目录
    - 根因:shell 会话 cwd 被之前的 cd 漂移
    - 处理:npm/node 命令前显式 `cd` 回项目根,或用绝对路径

14. **IDE/LSP 报"未使用的导入"等误报**
    - 现象:刚加的导入被标记 never read
    - 根因:LSP 索引滞后(本项目反复实证)
    - 处理:以 `node --check` / 实跑退出码为准,无视 IDE 红线

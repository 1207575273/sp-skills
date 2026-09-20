---
name: wechat-post
description: 公众号文章一条龙流水线:选题 -> 成稿 -> 配图 -> 排版 -> 存入草稿箱。当用户给出选题要写公众号文章、要发公众号、要把现成 HTML 存草稿、或走任意一段发文流程时使用。终点是草稿箱,群发永远人工。
---

# wechat-post:公众号发文流水线

从一个选题走到公众号草稿箱的完整流程。每步有产物、有验收,整条链已实战跑通(2026-08-17 首篇上线)。

用户只要走某一段也支持:只写稿走第 1 步,只排版走第 3 步,已有排版 HTML 只想存草稿直接走第 5 步。

动手前先读 `references/pitfalls.md`,里面是实战踩过的所有坑,能省掉一半弯路。

## 流水线总览

```
选题
 -> 1 写稿      articles/YYYYMMDD_题目_公众号文章.md
 -> 2 配图      articles/assets/<YYYYMMDD-slug>/ 按篇建子目录:*.html 模板 + *.png 产物
 -> 3 排版      articles/公众号HTML输出/*_微信公众号版.html(多风格)
 -> 4 人工确认   用户挑风格、审内容
 -> 5 存草稿    scripts/publish-draft.mjs 一条命令入草稿箱
 -> 6 发表      永远人工,后台点"发表"
```

配图必须按篇建子目录(第二篇实战教训:共用 assets/ 会互相覆盖),文稿里引用 `assets/<YYYYMMDD-slug>/figN-xxx.png`,发布时显式传 `--assets-dir`。

## 第 1 步:写稿

按 `references/writing-guide.md` 的规范撰写。要点:

- 先联网核实近期事实,单一来源的夸张传闻不采用
- 1000-1500 字,故事化开头,一条叙事主线贯穿
- 金句加粗单独成段;结尾引导关注 + 下篇预告
- 文件开头一级标题即文章标题(排版时自动只进 title 不进正文)
- 图片位置写占位引用:`![描述](assets/figN-xxx.png)`,文件名必须与第 2 步产物一致
- 产出 5 个备选标题供用户挑

验收:文章落盘,用户对文风和标题点头。

## 第 2 步:配图

按 `references/illustration-guide.md` 生成。要点:

- 封面 `cover.png` 固定 1800x766(2.35:1 的 2 倍,公众号封面零裁损)
- 正文插图 1200 宽,数量 2-4 张;色系跨篇沿用账号统一的一套(历史篇目模板就是现成参照)
- 每张图一个 HTML 模板(参考 `templates/` 下两个实战模板改),放本篇子目录 `articles/assets/<YYYYMMDD-slug>/`
- 截图用本 skill 脚本,对 body 做元素级截图,尺寸精确:

```bash
node .claude/skills/wechat-post/scripts/shoot-figures.mjs "articles/assets/<YYYYMMDD-slug>"
```

验收:PNG 尺寸正确(脚本会打印),逐张目检文字无溢出、无错字。

## 第 3 步:排版

```bash
node .claude/skills/wechat-post/scripts/md2wechat-html.mjs "articles/YYYYMMDD_题目_公众号文章.md"
```

生成 6 种风格的微信粘贴兼容 HTML + 总览页。规则细节(双标题消除、行内样式展开、图片占位块)已内置在脚本里。科技观点文优先推 minimal / wired,长文随笔推 medium。

验收:脚本输出全 [PASS],总览页可浏览。

## 第 4 步:人工确认

把总览页给用户挑风格,确认后进入发布。不要替用户选。

## 第 5 步:存草稿

```bash
node .claude/skills/wechat-post/scripts/publish-draft.mjs \
  --html "articles/公众号HTML输出/<选定风格>.html" --author "作者名" \
  --assets-dir "articles/assets/<YYYYMMDD-slug>"
```

自动完成:登录(首次扫码)、标题作者、正文注入、配图上传到公众号 CDN、封面设置、保存草稿。

可选参数:`--title`(默认取 HTML 的 title)、`--assets-dir`(默认 HTML 上级的 assets/)、`--cover`(默认 assets/cover.png,建议 2.35:1)、`--login-timeout`(默认 180 秒)。

工作机制(改版排障时需要理解):

- 浏览器:连接调试端口 9223 的常驻独立 Chrome(档案 `.profile/`,与日常 Chrome 互不影响),连不上就拉起;**脚本退出只断开,不关浏览器**。每次运行先关闭上一轮遗留的编辑页标签
- 登录:已有登录态直进;否则停在二维码页等人扫码。登录态几天过期属正常,重扫即可
- 编辑器:新版 ProseMirror。正文 HTML 与配图都走合成粘贴事件(编辑器自身解析/上传管线);配图按 `[图片:xxx.png]` 占位段落原地替换,残留空占位自动清理
- 封面:图片库对话框 -> webuploader 隐藏 file input 注入 -> 自动进裁剪 -> 确认
- 模块:`scripts/publish-draft.mjs` 编排,`scripts/lib/{common,browser,editor}.mjs` 分职责;全程 [INFO]/[PASS]/[FAIL] 打点,失败截图在 `publish-logs/`

验收:脚本全 [PASS],后台草稿箱可见完整图文(含封面)。

安全:`.profile/`(登录凭证)与 `publish-logs/`(含账号截图)已入 .gitignore,严禁提交。

## 第 6 步:发表

**永远人工。** 用户在后台预览、点"发表"。这是刻意保留的风控闸门,不做自动群发,不要提议自动化这一步。

## 排障:与 Playwright 配合,搞不定就临时造脚本

本 skill 的浏览器自动化基于 playwright-core + 常驻调试 Chrome(CDP 端口 9223)。公众号后台会改版,固化脚本某天失效是预期内的事,标准处置流程:

1. **不要盲改参数重跑。** 先看失败日志和 `publish-logs/` 截图,定位卡在哪一步
2. **写临时探测脚本连上现场排查。** 骨架抄 `templates/probe-template.mjs`(连接 CDP -> 找到页面 -> 截图 -> 枚举元素),放 `scripts/` 下用 `tmp-` 前缀命名。常驻 Chrome 保留着登录态和页面现场,探测脚本只连接不关闭,可以反复小步试
3. **按 `references/probe-playbook.md` 的套路试交互。** 里面是实战验证过的招式对照表(点击被拦、上传组件、富文本注入等)
4. **搞定后三件事:** 结论固化进 `scripts/lib/`;新坑按"现象->根因->处理"补进 `references/pitfalls.md`;删掉 tmp- 临时脚本

**发布脚本半途中断(人为打断、超时)时,优先接管现场续跑,不要重跑整条流程**:常驻 Chrome 里编辑页还在,已填的标题/正文/图都在,写探测脚本连上去从卡住的那步继续即可;重跑会在草稿箱产生重复草稿(若已产生,发表前提醒用户删旧稿)。

整条链首次跑通时,封面上传就是这样用 8 个临时探测脚本逐步攻克的;第二篇的封面分支卡点也是探测接管 3 步解决的。方法论可靠。

## 分发与交接须知

把本 skill 给他人/别的机器使用时:

- **只分发资产**:SKILL.md、references/、templates/、scripts/。`.profile/`(登录态,等同账号凭证)和 `publish-logs/`(含账号截图)**绝不能带走**;git 分发天然不带(在 .gitignore),手工拷贝需自行删除
- **对方零配置接入登录**:首次运行 publish-draft.mjs 会自动拉起 Chrome 停在二维码页,对方用自己的公众号扫码,登录态落在对方机器自己的 `.profile/`,与原机器无关
- **环境依赖**:Node 18+;项目根 `npm i playwright-core`;本机装有 Chrome(脚本自动探测常见路径,装在非常规位置时设环境变量 `WECHAT_CHROME_PATH` 指向 chrome.exe)
- 排版/截图脚本(md2wechat-html.mjs、shoot-figures.mjs)无登录态依赖,拿来即用

## 硬性约束

- 不用 emoji 和装饰符号,状态用 [PASS]/[FAIL]/[WARN]
- 事实必须核实;涉及具体人物、公司、时间线的表述以多来源交叉为准
- 所有中间产物按上面的目录约定落盘,不要散放

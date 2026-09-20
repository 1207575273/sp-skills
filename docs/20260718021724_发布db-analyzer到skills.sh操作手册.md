> **本文记录的是 2026-07 的决策:另开干净仓只放 db-analyzer。该决策已于 2026-09-20 被取代** —— 判定粒度从仓库降到文件后,7 个 skill 全部合入 sp-skills,不再有"干净仓/私有仓"之分。本文保留作决策沿革,安全红线部分仍然成立。

# 发布 db-analyzer 到 skills.sh 操作手册

面向你自己操作。命令按 Windows Git Bash 写(你的主环境)。

---

## 0. 原理(一句话)

skills.sh **没有提交/审批流程**:技能就放在一个**公开 GitHub 仓库**里,别人用 `npx skills add <owner>/<repo>` 安装;装的人一多,靠匿名遥测自动上榜(按安装量排名),不需要你去哪里登记。

SKILL.md 只要有合法 frontmatter(`name` 小写连字符 + `description`)就会被识别——db-analyzer 已合规。

---

## 1. 安全红线(必读,别跳)

**绝对不能直接把 `landray_work_e` 设成公开仓库。** 原因:git 历史里有真实内网管理员凭证——

- `skills/landray-log/config/environments.yaml`(以及 `.claude/` 那份)是**被 git 跟踪的**,含 mkdev01 / mksmoke / sp4smoke 的真实 `encryptedPassword`(你的工具本身证明了这些密文能重放登录 = 等于活凭证);
- 内网域名(各环境真实域名,此处不复述);
- 这些在提交 `e9259a5` / `aeead91` / `8b7fa62` 的历史里,**删文件也没用,历史仍在**。

所以正确做法:**另开一个只含 db-analyzer 的干净仓库**。好消息:db-analyzer 本身干净——它的真实配置一直被 gitignore,只有 `environments.example.yaml` 模板入库,无任何凭证。

---

## 2. 准备干净的发布目录

在 `landray_work_e` 同级建一个新目录,**选择性拷贝**(真实配置 / node_modules / 运行产物一律不带)。

```bash
cd /d/A_landray_ws/landray_work_e
DEST=/d/A_landray_ws/db-analyzer          # 目标目录,名字随你

rm -rf "$DEST" && mkdir -p "$DEST/config"

# 只拷该拿的:源码 + 打包产物 + 模板 + 元数据
cp skills/db-analyzer/SKILL.md skills/db-analyzer/package.json skills/db-analyzer/package-lock.json skills/db-analyzer/.gitignore "$DEST/"
cp -r skills/db-analyzer/lib skills/db-analyzer/scripts skills/db-analyzer/dist "$DEST/"
cp skills/db-analyzer/config/environments.example.yaml "$DEST/config/"
```

> 关键:**不要** `cp -r skills/db-analyzer` 整个拷——那会把 `config/environments.yaml`(真实库连接)、`node_modules`(48M)、`last-query-result.txt` 一起带过去。上面是逐项挑,天然排除这些。

拷完看一眼结构(应无 environments.yaml、无 node_modules):

```bash
find "$DEST" -type f -not -path "*/node_modules/*" | sed "s#$DEST/##" | sort
```

---

## 3. 发布前凭证自检(最重要的一步,务必做)

推之前,把整个目录扫一遍,确认零真实凭证、零内网信息。**任何一条命中真实值就停下来处理,别推。**

```bash
cd "$DEST"

echo "--- 内网域名(应为空或只在注释/示例里) ---"
grep -rniE "ywork\.me|landray\.com\.cn" . || echo "[OK] 无内网域名"

echo "--- 内网 IP(应为空) ---"
grep -rniE "192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+" . || echo "[OK] 无内网 IP"

echo "--- 真实密文/密码(应为空;example 里是占位符不算) ---"
grep -rniE "encryptedPassword|OQjaXUV|utHQ" . || echo "[OK] 无真实凭证"

echo "--- 是否混入真实配置文件(应只有 environments.example.yaml) ---"
find . -name "environments.yaml"
echo "(上面若有输出就是危险:立即删掉那个文件)"
```

期望:前三条全 `[OK]`,第四条无输出。`environments.example.yaml` 里是 `<主机名或IP>` 之类的占位符,不是真值,正常。

打包的单文件 `dist/scripts/run-query.bundle.mjs` 里是 mysql2/pg/oracledb 的驱动代码,不含任何连接信息(配置是运行时读的),扫描已覆盖到它。

---

## 4. 精简两处"内部仓库"痕迹(可选,但公开更专业)

有两处提到了内部仓库/迁移脚本,对公开用户没意义,建议改掉:

**4.1 `$DEST/SKILL.md`** —— 最后一节「环境没配」把这句删了:

> 注意:本 skill 若是从源仓库(`landary_work_e/skills/db-analyzer`)迁到当前工程...要跑 `scripts/migrate-skills-to-project.mjs --yes --force` 重新同步。

改成只留:

> 照 `config/environments.example.yaml` 在 `config/environments.yaml` 加一段即可,改完立即生效(每次运行都重读配置,无需 reload skill)。

(`dist/SKILL.md` 是打包时自动生成的生产版,这句已经是干净的,不用改。)

**4.2 `$DEST/README.md`** —— 现在开头是「给同事用的…」,面向公开用户重写一版:说清楚它是什么(只读查 MySQL/PostgreSQL/Oracle/SQLite 的 Claude skill)、只读安全边界、两种用法(`npm install` 跑源码 / 直接用 `dist/scripts/run-query.bundle.mjs` 免安装)、Node >= 22.5。可参考 `dist/README.md` 的措辞。

---

## 5. 建 git 仓库并推到 GitHub

```bash
cd "$DEST"
git init -b main
git add -A

# 推前最后确认:暂存区里没有真实配置
git status
git diff --cached --name-only | grep -E "environments\.yaml$" && echo "危险!有真实配置,别提交" || echo "[OK] 干净"

git commit -m "feat: db-analyzer —— 只读查询/分析 MySQL/PostgreSQL/Oracle/SQLite 的 Claude skill"
```

在 GitHub 建一个**公开**空仓库(网页建,或用 gh CLI):

```bash
# 若装了 gh CLI 且已登录:
gh repo create db-analyzer --public --source=. --remote=origin --push

# 或网页建好空仓库后手动关联:
# git remote add origin git@github.com:<你的用户名>/db-analyzer.git
# git push -u origin main
```

> 你的 GitHub 用户名是 `1207575273`(从 landray_work_e 的 remote 看到的),仓库名 `db-analyzer` 随你改。

---

## 6. 验证 + 怎么上榜

推完后,别人(和你)就能这样装:

```bash
npx skills add 1207575273/db-analyzer
```

装完在目标工程的 `.claude/skills/db-analyzer/` 下,按 SKILL.md 用。**上榜是自动的**:有人跑 `npx skills add` 装它,遥测就会统计,安装量攒起来自动进 skills.sh 榜单,你不用做别的。

自己先装一次验证跑得通(先在某个测试工程里 `npx skills add ...`,填个 SQLite 的 `config/environments.yaml` 试 `--list-envs` 和一条查询)。

---

## 7. 后续更新怎么办

db-analyzer 的源码仍在 `landray_work_e` 里开发。改了之后要同步到公开仓库:

1. 在 `landray_work_e` 里改源码 + `cd skills/db-analyzer && npm run build` 重新打包 `dist/`;
2. 重跑本手册第 2 步的选择性拷贝,覆盖 `$DEST`;
3. 重跑第 3 步凭证自检;
4. `cd "$DEST" && git add -A && git commit -m "..." && git push`。

(值得的话,以后可以写个小脚本把「拷贝 + 自检 + 推送」串起来,但先手动跑通几次。)

---

## 附:一句话检查清单(推之前对一遍)

- [ ] 目标目录是**新建的干净目录**,不是 landray_work_e 本身
- [ ] 没有 `environments.yaml`(真实配置),只有 `environments.example.yaml`
- [ ] 没有 `node_modules`
- [ ] 第 3 步四条凭证自检全过
- [ ] GitHub 仓库设为 **public**,且里面**没有 landray-log**
- [ ] `git status` / `git diff --cached` 最后再扫一眼没有真实配置

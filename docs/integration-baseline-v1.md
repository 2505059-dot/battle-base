# UI / 能力基础 / 扩队准备包集成基线 v1

## 基线与来源

集成工作树从 fetch 时最新的 `origin/main` 创建，基线 SHA 为 `89df44ce08a863a7f2351ea98c9eb193e1b8efe0`。本分支依次使用非 squash 的 `--no-ff` merge 保留原提交历史：

1. `origin/feature/draft-workbench-v1`：验收提交 `80170d83261a4849847fec92f799fbc608191fa3`。Tailwind 基础提交 `9b55623a836d1d34558e2905cc75dee261b67feb` 已是该提交祖先，没有重复导入。
2. `origin/feature/player-ability-data-foundation-v2`：验收修复提交 `c0e513cba9c39feb20b929086d37b6777d2e821e`。基础提交 `e020753e9296ee1fd0ce42fe96812f9707af937e` 已是该提交祖先。
3. `origin/feature/team-expansion-wave1-prep`：验收准备包提交 `d84aa0a12327baf3050bcfce418cbe6a59ff35d4`。

合并前 fetch 后记录的 `origin/main` 与三个来源分支分别为以上 SHA；没有发现这些分支在验收提交之后的后续提交。合并顺序如上，各次 merge 均无冲突。集成合并提交依次为 Draft `1b09427`、能力 `30d1fee`、扩队 `378db01`。三个来源提交均为集成历史中的祖先。

## 集成小修

- Draft 说明及日/英/简中提示改为“当前总评 / current overall / 現在の総合評価”，并继续明确没有独立位置评分；评分数值和位置资格逻辑未变。旧的“官方总评 / official OVR”只留在原有历史截图指标中，该历史文件未修改。
- 增加 `npm run build`，映射到既有 `build:css` 入口。合并时发现原 `package.json` 没有用户要求运行的 `build` script；未改依赖或 lockfile。重新运行 `npm run build` 成功。生成的 CSS 与提交版除 Windows 行尾外无内容差异，因此没有把行尾改写纳入提交。
- 增加精确 `.gitignore` 规则 `data/raw/fifa/expansion-wave1/`，避免忽略缓存被提交。扩队缓存与能力来源缓存均留在集成工作树的忽略目录中。

## 检查结果

先对 20 个相关 JavaScript 脚本做 `node --check`，全部通过。`npm ci` 成功（34 个包）；npm 输出提示依赖中有 4 项 high severity audit advisories，本次没有升级依赖或 lockfile。

| 检查 | 结果 | 观察 |
| --- | --- | --- |
| `npm run build` | PASS | Tailwind CSS 构建成功；规范化后没有 CSS 内容 diff。 |
| `node scripts/check-i18n.mjs` | PASS | ja/en/zh-CN 共 201 个 key 与占位符。 |
| `node scripts/check-entity-localization-leaks.mjs` | PASS | 零泄漏。 |
| `node scripts/smoke-draft-workbench.mjs` | PASS | 候选和位置预览不发 PICK；mock sender 验证最终确认只发一次；盲选边界、预览清理、锁定与键盘焦点检查通过。 |
| `node scripts/smoke-player-media-ui.mjs` | PASS | 媒体 UI smoke 通过。 |
| `node scripts/smoke-11v11.mjs` | PASS | 1,000 场模拟通过。 |
| `node scripts/smoke-concurrent-draft.mjs` | PASS | 并发选秀 smoke 通过。 |
| `node scripts/smoke-draft-deadlock.mjs` | PASS | 死锁 smoke 通过。 |
| `node scripts/smoke-draft-roll-policy-v2.mjs` | PASS | 1,000,000 次策略模拟通过。 |
| `node scripts/smoke-unique-player-lock.mjs` | PASS | 554/554 PlayerSeasons、418 canonical entities 的唯一球员锁通过。 |
| `node scripts/validate-data.mjs` | PASS | 7 leagues / 28 clubs / 62 TeamSeasons / 554 PlayerSeasons，0 errors。 |
| `node scripts/validate-entities.mjs` | PASS | 418 entities 与 554 个一对一映射。 |
| `node scripts/validate-football-localization.mjs` | PASS | 418 players / 28 clubs / 7 leagues。 |
| `node scripts/validate-player-identity-index.mjs` | FAIL（Windows 行尾问题） | 结构与映射断言先通过；脚本随后把 `public/data/player-identities.js` 重建两次，并以原始字节 SHA 做比较。集成 checkout 在 `core.autocrlf=true` 下为 559 行 CRLF，运行前 SHA-256 `0a8775e95929e263144643236b5854c96ae90fc1ba258ffdc2b99f0931462130`；生成器写出同内容 559 行 LF，SHA-256 `f1abee47dcc5a1229c533597df314dbcfc64b7f39fee9a100449544331d380d6`，于是触发 `Runtime index on disk must match fresh build output`。仅恢复该脚本改写的文件到集成 HEAD；恢复后的 Git blob 与原内容相同。没有改验证器、索引或全项目行尾。 |
| `node scripts/ability-v2/acquire-sources.mjs --verify-only` | PASS | 22 个原始来源文件及 2 个 ZIP 解包成员的字节数和 hash 匹配固定 manifest；未下载或修改 manifest/hash。 |
| `node scripts/ability-v2/build.mjs` | PASS | 5,164 observations、554 records、462 selected、92 unavailable、1,806 conflicts、9 PSV。 |
| `node scripts/ability-v2/validate.mjs` | PASS | 22 个物理 CSV / 663,370 行；23 sources、5,164 observations、554 records、462 selected、92 unavailable、20 rejection cases、9 PSV；Farfán 48/69/73。 |
| `node --test scripts/ability-v2/source-verification.test.mjs` | PASS | 14/14；覆盖原始字段与 canonical 值同时发生 70→99 篡改时拒绝，以及原始 CSV 行核对在正式 validate 入口执行。 |
| `node scripts/expansion/build-wave1-package.mjs --check` | PASS | 29 个候选的 checksum、来源与 exact-id 匹配通过。 |
| `node scripts/expansion/build-national-attribute-candidates.mjs --check` | PASS | 只读检查通过。两个 `--check` 均未改包内容，覆盖率仍为 0/29。 |

能力数据及六份报告的七个 hash 已在 build 后逐文件对比：build 输出（LF）与原能力工作树（LF）磁盘 SHA-256 完全一致，源分支和集成 HEAD Git blob 也一致。脚本生成的 LF 输出使 Git 显示了行尾改动；确认 `git diff --ignore-space-at-eol` 无内容差异后，恢复七文件到集成 HEAD。当前集成 checkout 为 CRLF，所以恢复后的原始磁盘 SHA-256 与原能力工作树 LF 原始 SHA 不同，但七个 Git blob 均仍与原分支相同，逻辑数据无漂移。

| 文件 | 原能力工作树 / build 后 LF SHA-256 | 恢复后集成 CRLF 磁盘 SHA-256 | 源 / 集成一致 Git blob（SHA-1） |
| --- | --- | --- | --- |
| `data/abilities/player-season-abilities-v2.json` | `82bf1974977f3745d0d652bbf438248e914201959f1c62e6e7938fb82fb7e26b` | `7c4f06655e7a07161dc0c38a0ca8f2dae70c13499e12d14648f1977141969664` | `1e8f086f01daebc5eeb470a8015ceef9a904e13b` |
| `data/reports/ability-v2/coverage.json` | `1a4caf10edf106a48801828bef975824b10c3594111a6f9a9e22b260bac51124` | `ece363ceef7739bc6a9d8f40b7538dc844f9368689f1a97aa4a5bbf3a6ecf38c` | `46e8b70d00091c71ea60cf6a49c706d7d74eadf3` |
| `data/reports/ability-v2/legacy-migration.json` | `1841547f3bd8f7bfa89a9dc9f286cd147b166b8ca08ad00fef8f123e35dfdc0e` | `eee0a277ec01930a9421fd2176657ebe05759a06f762946c10b32ebcd6d66c34` | `0221efe1abd0d181e33795e20c9231cd82de4701` |
| `data/reports/ability-v2/psv-2005-case.json` | `01f47352345af457186674c3b8f2fd395b0c6ea5e52ed2d8abe8a12abd90382d` | `edb91ea9c2a9bb32dfc863f697fe4704d2ef5818ada19c14992881756ec84e59` | `03ac57c5b0dbe1b0ef247471b7eb27e84b47b60b` |
| `data/reports/ability-v2/source-conflicts.json` | `956a43b5f6129cc021031167005a365de164ee29cea2c31aa26daaf286fd7cc6` | `144a12d0a86761e7bdccd64b763d4a9b77c4731e7722e9e3834d4010b7dd19c0` | `0ce762ab7da18b68a4dee29d3723263a8f811ef7` |
| `data/reports/ability-v2/source-lineage.json` | `7bf4d1de44279c8bf9b87c41476c7c1173423dbfc99fe6278cff529997079702` | `acfd25bf5f879e23b58db4dc2a4c25cde6ab2b17cd9b2639f285bae5b08c808c` | `95804dc738ed940220512fda9e8309c824b5d20f` |
| `data/reports/ability-v2/unresolved.json` | `80b63e2029a10da96c4a35f82ba1992b8e04754cb7cb30078fc40072bcc508fd` | `468a9fd75c86552a691c0acf3036bcb89eb05d4894dc386336bb08602faa4784` | `ea39545f9e21b5438a1504d458aa2967c30dc2ae` |

## 真实浏览器回归

应用在集成工作树以 `http://127.0.0.1:18000/` 运行。真实两玩家流程 `大厅 → 房间 → Draft → 揭晓 → 比赛 → 结果 → 返回大厅` 在默认 1280×720 浏览器页签完成：两边各 11/11 并锁定，比赛到 90′、结果 3–0、28 条比赛报告；返回大厅成功。揭晓、比赛、结果继续使用现有布局。

1366×768 桌面 Draft 截图确认三栏工作台同屏呈现。390×844 移动端实测页签 `候选池 / 阵容 / 详情` 与完整选人交互：在候选池选球员、切至阵容预览合法槽位、回到候选池最终确认；确认前计数保持不变，确认后增加 1。继续完成 11 人并 LOCK IN；移动端截图中对手状态为 `HIDDEN`。同一移动页签完成日语、英语、简体中文切换，页面文案随语言变化。详见 [screenshots/integration-baseline-v1](screenshots/integration-baseline-v1/)，指标见该目录 `metrics.json`。

现场页面未使用浏览器网络面板或 WebSocket 诊断接口，因此不能独立声称抓到了每个 live `PICK` frame 的精确次数。候选/槽位预览未改变界面人数、最终确认让人数增加一的 live UI 行为已实测；精确“一次”由 `smoke-draft-workbench.mjs` 中的 mock sender 断言验证。控制台检查覆盖两轮任务新建的 Chrome 与 IAB 页签，未采集到 warn 或 error。另在真实 Chrome 双页签 TSFR 房间采样 Draft 与离开房间回大厅后的 DOM：Draft 时两页 `body.className` 均为 `in-room in-game in-draft`，`#lobby` 隐藏，`#room` 与 `#game-area` 显示；body scrollWidth/clientWidth 均为 1920，main 为 1680×945（Host）与 1680×889（Guest）。离开 Draft 后两页 `body.className` 与 `documentElement.className` 均为空，`#lobby` 显示、`#room` 与 `#game-area` 隐藏，main 回到 1240×516，body scrollWidth/clientWidth 为 1920、无横向溢出。截图见 `lobby-after-draft-cleanup-1920x945.jpg`，详细数值见 metrics.json；`smoke-draft-workbench.mjs` 也独立断言 `stop()` 会移除 `body.in-draft`。

刷新行为实测：活动比赛中刷新后页面回到大厅，再加入同一已开始房间会收到“该房间游戏已经开始”。只读对比 `origin/feature/draft-workbench-v1` 与集成分支的 `public/main.js`、`public/net.js`、`server.js` 无差异：Draft 启动时仅从 query 恢复房间，close handler 回大厅且无重连；服务端拒绝加入已开始房间。这是验收来源已有行为，不由本次集成引入，也未扩大为重连架构修复。功能回归里其余流程通过。

## 三层数据现状与边界

1. **正式运行时**：仍为 62 TeamSeasons、554 PlayerSeasons、418 canonical entities；Draft 三栏与球员预览不接入独立位置评分。未补齐 8/9 人名单、未增加球队、未训练评分模型。
2. **能力 v2**：独立数据基础，5,164 observations、462 selected、92 unavailable；完整来源核验和七个构建产物的 hash 已验证。没有接入游戏评分或比赛引擎。
3. **扩队 wave1 准备包**：29 个候选，检查状态仍为 0/29 集成就绪；未进入正式 TeamSeason 池、身份索引或抽取配置，没有正式扩队。

## 后续工作

- 完成已有 62 支球队的球员名单。
- 为 PlayerSeason 建立稳定 ID。
- 对扩队包版本与正式集成做核验。
- 后续单独设计能力模型接入，不把独立能力 v2 数据直接当作游戏评分。

名单补全是本基线之后的独立任务。
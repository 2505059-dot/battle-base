# Draft Workbench v1 (`feature/draft-workbench-v1`)

## 1. 基线与边界

- **分支与工作树**：`feature/draft-workbench-v1`（独立工作树 `../battle-base-draft-workbench-v1`）
- **基线提交**：`9b55623a836d1d34558e2905cc75dee261b67feb`（`feature/tailwind-ui-foundation-v1`；当前 `origin/main` 位于 `89df44ce08a863a7f2351ea98c9eb193e1b8efe0`）
- **并行边界**：
  - 未修改 `data/`、`research/`、评分模型、比赛引擎、Draft 规则或 `server.js` 网络协议。
  - 未引入 React、Vue、Vite 或大型组件库，继续采用原生 JavaScript ES Modules + Tailwind CLI (`@tailwindcss/cli` v4.3.3) + 自有组件。

---

## 2. 一屏三栏工作台布局结构

### 2.1 作用域隔离 (`body.in-draft`)
- 在正式选秀阶段（`state.phase === 'DRAFT'`），控制器通过 `syncDraftBodyScope(true)` 为 `<body>` 添加 `in-draft` 类，并为根节点添加 `.dw-root.ui-scope`。
- 大厅（`#lobby`）、玩法说明（`#about`）、阵容揭晓（`REVEAL`）、比赛中心（`MATCH`）与赛果（`RESULT`）均不带 `body.in-draft`，保持原有页面滚动与三栏比赛布局不变。
- 桌面端（`>= 1024px`）不使用全局 `overflow: hidden` 掩盖溢出，而是通过 `body.in-draft main` 的 `height: 100dvh; max-height: 100dvh` 网格布局与子容器 `min-height: 0; flex: 1; overflow-y: auto` 内部滚动，确保在 `1920×1080`、`1366×768`、`1280×720` 下页面 `scrollHeight <= innerHeight` 且 `scrollWidth <= innerWidth`。

### 2.2 自适应宽屏容器与紧凑顶部工具栏
- 游戏阶段容器宽度自适应拓宽为 `max-width: min(1680px, calc(100vw - 24px))`（在 `1920px` 宽屏下内容区宽度为 `1680px`，两侧保留适度呼吸空间）。
- 桌面端将 `.topbar`（标题、说明切换、语言切换）与 `#room.room--in-game`（房间号、复制邀请、返回大厅/离开房间）合并至 `main` 第一行的 `34px` 紧凑工具栏中；玩法说明 `#about` 在展开时以浮动面板呈现，不挤压主工作台高度。

### 2.3 三栏主体 (`Left / Center / Right`) 与对手进度小浮层
- **顶栏状态条 (`.dw-header--draft`)**：
  - 左侧：己方身份、已选人数（如 `0 / 11`）与阶段徽章（`ROLL` / `PICK` / `READY` / `LOCKED ✓`）。
  - 中部：当前回合操作提示条（`.fd-turn-bar`）。
  - 右侧小浮层（`renderBlindOpponentPanel` / `.dw-opponent-float`）：仅显示对手昵称、已选人数（如 `7 / 11`）、等待/锁定状态与 `HIDDEN` 徽章；**不显示**任何对手球员、位置分布（已移除原 `GK/DF/MF/FW` 进度条）、评分或头像。
- **左栏：己方阵容与位置选择 (`.dw-col-squad` / `renderTeamPanel`)**：
  - 始终展示当前玩家自己的 4-3-3 阵容面板（支持阵型视图 Pitch / 列表视图 List 切换），并在选人时直接承担合法位置高亮与临时放置预览。
- **中栏：候选池、重抽控制与底部固定确认栏 (`.dw-col-center` / `renderDraftZone`)**：
  - 顶部固定：已选计数、当前抽取的联赛/俱乐部/赛季横幅、三项重抽按钮（联赛/俱乐部/赛季）及死局免费重抽提示（`FREE REDRAW`）。
  - 中部独立滚动区（`.dw-candidates-scroll`）：紧凑候选球员卡片网格（展示位置、总评、头像、俱乐部徽章、本地化主/副名称与禁选原因），长属性移入右栏详情。
  - 底部固定操作栏（`.dw-confirm-bar`）：汇总当前待确认的「球员 → 槽位」或禁用原因，提供「取消选择」与最终「确认选入」按钮（`.dw-confirm-btn`），以及紧凑最近操作记录条。
- **右栏：当前选中球员详情面板 (`.dw-col-inspector` / `renderPlayerInspector`)**：
  - 未选中候选球员时显示简短三步引导（`1. 选择球员 → 2. 选择位置 → 3. 确认选入`）。
  - 选中候选球员后同步展示：高清头像、本地化主/副名称、俱乐部/联赛标识与赛季、当前总评（OVR）、可司职位置与具体空缺槽位芯片，以及现有五维能力条（`ATK / CRE / DEF / PHY / GK`）。

---

## 3. 三步选人与放置预览流程

实现了严格的本地预览与最终确认分离流程（`public/game/draft/preview-state.js`）：

1. **选择候选球员 (`handleSelectCandidate`)**：
   - 点击候选卡仅更新本地 `preview.selectedPlayerId`，同步刷新右栏详情与左栏可放置槽位高亮（`.dw-slot--eligible`），**绝不立即发送 `PICK`**。
   - 若尚未选择位置，底部确认按钮保持禁用并提示「请在左侧阵容或位置栏选择可放置的位置」。
   - 切换候选球员时自动重新校验已选槽位 `preview.selectedSlot`；若新候选人不再适配原槽位，立即清除 `selectedSlot`。
2. **选择放置位置 (`handleSelectSlot`)**：
   - 支持直接点击左栏阵型图槽位（`.fd-pitch-node.dw-slot--eligible`）、列表视图槽位（`.fd-slot-row.dw-slot--eligible`）、位置角色按钮（`.fd-slot-btn`）或右栏详情中的槽位芯片（`.dw-inspector-slot-chip--eligible`）。
   - 点击后仅更新本地 `preview.selectedSlot`，在阵容对应槽位渲染带有金色虚线边框与「预览 / PREVIEW」徽章的临时球员（`.dw-slot--preview`），与正式已选球员（`.fd-pitch-node--filled`）明确区分，**不立即发送 `PICK`**。
   - 已占用槽位（`.dw-slot--occupied`）与位置不符槽位（`.dw-slot--mismatch`）均标记为不可选且禁止提交。
3. **最终确认选入 (`handleConfirmPick`)**：
   - 仅当候选球员与合法空缺槽位均有效时启用 `.dw-confirm-btn`。
   - 点击 `.dw-confirm-btn` 时通过 `submittingPick` 与 `pendingPickKey` 锁定防重，调用 `ctx.send({ kind: 'pick', playerId, slot })` 与 `applyPick` 完成正式选入。
   - 触发 `ROLL`、`REROLL`、`FREE REDRAW`、完成 `PICK` 或阶段变化时，`reconcileDraftPreview` 立即清理任何失效预览状态。
4. **位置与评分边界**：
   - 严格使用现有运行时支持的四类角色（`GK / DF / MF / FW`）与 11 个具体槽位（`GK1`, `DF1..DF4`, `MF1..MF3`, `FW1..FW3`）及 `canPlayerFitSlot` / `isPlayerEntityInRoster` 规则。
   - 鉴于当前运行时数据不含独立各位置评分，右栏明确展示「暂无各位置独立评分（仅使用当前总评与位置资格）」，不将 `overall` 伪造或复制为各位置评分。

---

## 4. 响应式、键盘可访问性与旧样式清理

- **窄屏与移动端 (`< 1024px`, 如 `390×844`)**：
  - 通过顶部三标签切换栏（`.dw-mobile-tabs`：`候选池` / `阵容 (X/11)` / `详情`）分栏浏览，避免三栏横向硬塞，保证 `scrollWidth <= 390` 无横向溢出。
- **键盘无障碍与焦点恢复**：
  - 候选卡（`.fd-card--interactive`）、可放置槽位（`.dw-slot--eligible` / `.dw-slot--preview`）均支持 `tabIndex="0"`、`role="button"`、`aria-pressed` 及 `Enter` / `Space` 键触发。
  - `controller.js` 在每次 `render()` 前后通过 `data-focus-key` 与滚动容器选择器自动恢复键盘焦点与内部滚动位置，并支持 `@media (prefers-reduced-motion: reduce)`。
- **旧 CSS 清理**：
  - 从 `public/style.css` 中移除了已被对手进度小浮层直接替代的盲选位置分布死规则（`.fd-blind-role-list`、`.fd-blind-role-row`、`.fd-blind-pips`、`.fd-blind-pip`、`.fd-blind-note`），保留揭晓页、比赛页与大厅所需的全部样式。

---

## 5. 验证方法与截图清单

### 5.1 命令行构建与验证
```bash
npm run build:css
node scripts/check-i18n.mjs
node scripts/check-entity-localization-leaks.mjs
node scripts/smoke-player-media-ui.mjs
node scripts/smoke-draft-workbench.mjs
node scripts/smoke-11v11.mjs
node scripts/smoke-concurrent-draft.mjs
node scripts/smoke-draft-deadlock.mjs
node scripts/smoke-draft-roll-policy-v2.mjs
node scripts/smoke-unique-player-lock.mjs
```

### 5.2 浏览器多视口验证截图 (`docs/screenshots/draft-workbench-v1/`)
- [`01-draft-roll-1920x1080.png`](./screenshots/draft-workbench-v1/01-draft-roll-1920x1080.png)：`1920×1080` ROLL 阶段一屏三栏工作台
- [`02-draft-empty-inspector-1920x1080.png`](./screenshots/draft-workbench-v1/02-draft-empty-inspector-1920x1080.png)：`1920×1080` 抽取候选后未选人状态（右侧空状态引导 + 禁用确认原因）
- [`03-draft-candidate-selected-1920x1080.png`](./screenshots/draft-workbench-v1/03-draft-candidate-selected-1920x1080.png)：`1920×1080` 选中候选球员（右侧详情同步 + 左侧合法位置高亮 + 尚未发送 PICK）
- [`04-draft-slot-preview-1920x1080.png`](./screenshots/draft-workbench-v1/04-draft-slot-preview-1920x1080.png)：`1920×1080` 左侧槽位放置预览态（金色预览徽章 + 确认按钮激活）
- [`05-draft-slot-preview-1366x768.png`](./screenshots/draft-workbench-v1/05-draft-slot-preview-1366x768.png)：`1366×768` 桌面视口一屏零溢出预览态
- [`06-draft-slot-preview-1280x720.png`](./screenshots/draft-workbench-v1/06-draft-slot-preview-1280x720.png)：`1280×720` 紧凑桌面视口一屏零溢出预览态（候选区内部滚动）
- [`07-draft-list-preview-1366x768.png`](./screenshots/draft-workbench-v1/07-draft-list-preview-1366x768.png)：`1366×768` 左栏列表视图（List View）槽位预览态
- [`08-draft-mobile-candidates-390x844.png`](./screenshots/draft-workbench-v1/08-draft-mobile-candidates-390x844.png)：`390×844` 移动端「候选池」标签页
- [`09-draft-mobile-squad-390x844.png`](./screenshots/draft-workbench-v1/09-draft-mobile-squad-390x844.png)：`390×844` 移动端「阵容」标签页
- [`10-draft-mobile-inspector-390x844.png`](./screenshots/draft-workbench-v1/10-draft-mobile-inspector-390x844.png)：`390×844` 移动端「详情」标签页
- [`11-reveal-1366x768.png`](./screenshots/draft-workbench-v1/11-reveal-1366x768.png) / [`12-match-1366x768.png`](./screenshots/draft-workbench-v1/12-match-1366x768.png) / [`13-result-1366x768.png`](./screenshots/draft-workbench-v1/13-result-1366x768.png)：揭晓、比赛与结果阶段零回归验证
- [`metrics.json`](./screenshots/draft-workbench-v1/metrics.json)：多视口实测布局指标、三步交互状态与零控制台报错记录


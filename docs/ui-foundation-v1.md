# Tailwind Integration & UI Foundation v1

## 1. Technology Choice & Locked Versions

- **Architecture**: Native HTML + ES Modules (`type="module"`) + static CSS served by `server.js` (`ws` WebSocket relay).
- **UI Framework Policy**:
  - **No** frontend application framework (no React, Vue, Next.js) or bundler rewrite (no Vite).
  - **No** external component library (no daisyUI, Radix, etc.).
  - **No** runtime Play CDN or in-browser Tailwind compiler.
- **Locked DevDependencies** (`package.json` & `package-lock.json`):
  - `tailwindcss`: `4.3.3`
  - `@tailwindcss/cli`: `4.3.3`

---

## 2. CSS Source File, Generated Output & Cascade Layer Order

### File Roles

| Path | Role | Tracked in Git? | Edit Policy |
| :--- | :--- | :---: | :--- |
| `public/styles/app.src.css` | Unified CSS source entrypoint (imports layers, `@source`, `@theme` tokens, and `@layer components` helpers) | Yes | **Edit this file** |
| `public/style.css` | Legacy stylesheet (~2,245 lines) imported intact into `@layer legacy` | Yes | Legacy maintenance / gradual removal |
| `public/styles/app.css` | Compiled static CSS bundle served to pages (`index.html` and `ui-foundation.html`) | Yes | **Auto-generated — DO NOT EDIT DIRECTLY** |

> Because `public/styles/app.css` already bundles `public/style.css` inside `@layer legacy`, `public/index.html` links **only** `styles/app.css` (preventing duplicate stylesheet downloads or unlayered rule overrides). Keeping `public/styles/app.css` tracked in Git preserves direct `npm start` startup after clone.

### Explicit Cascade Layer Order

Defined at the top of `public/styles/app.src.css`:

```css
@layer theme, legacy, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "../style.css" layer(legacy);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
```

1. **`theme`**: Tailwind default theme variables plus UI Foundation v1 semantic tokens (`--color-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--spacing-panel-*`, `--z-*`).
2. **`legacy`**: Existing `public/style.css` imported as-is. All existing selectors (`body`, `h1`, `section`, `button`, `input`, `.fd-*`, and `@media` queries) keep their exact internal cascade order on legacy screens.
3. **`components`**: Scoped foundation base normalization (`.ui-scope`) and small dedicated surface/gradient/progress helpers (`.ui-panel-header-sheen`, `.ui-card-portrait-well`, `.ui-stat-bar-fill`).
4. **`utilities`**: Tailwind utility classes (`bg-panel`, `text-fg`, `border-selected`, `hover:*`, `focus-visible:*`, `disabled:*`, `sm:*`, `md:*`, `lg:*`) plus `.ui-scope [hidden] { display: none; }`. By CSS Cascade Layers specification, `@layer utilities` always overrides normal declarations in `@layer legacy` regardless of selector specificity—without needing global `!important`.

### Audit of Existing `public/style.css` Edge Cases
- **`!important`**: Only 1 rule exists in `public/style.css` (`.fd-logo-img--hidden { display: none !important; }`), which intentionally hides broken club/league logos via `applyLogoFallback()` and remains valid inside `@layer legacy`. Zero new `!important` rules are added by UI Foundation v1.
- **`url(...)` references**: `0` occurrences in `public/style.css` (all backgrounds use CSS gradients and solid colors), so importing `../style.css` from `public/styles/app.src.css` introduces no relative path shifts.
- **`@media` queries**: 3 responsive breakpoints (`max-width: 1060px`, `820px`, `520px`) remain in identical relative order inside `@layer legacy`.

---

## 3. Preflight Strategy

Tailwind Preflight (`tailwindcss/preflight.css` / `@layer base`) is **disabled by default** in v1:
- We import `tailwindcss/theme.css` and `tailwindcss/utilities.css` separately instead of `@import "tailwindcss";`.
- **Why**: `public/style.css` relies on bare element rules (`h1`, `section`, `button`, `input`, `ul`, `li`, `label`) and browser defaults on existing Lobby, Room, Draft, Reveal, and Match screens. Enabling global Preflight would strip heading sizes, button paddings, and section spacing on unmigrated screens.
- **Scoped Normalization for New UI**:
  - `.ui-scope [hidden] { display: none; }` in `@layer utilities` (specificity `(0,2,0)`) ensures HTML `hidden` attributes always win inside `.ui-scope` even when an element also carries single-class Tailwind display utilities (`flex`, `grid`, `inline-flex`, `block`), without using `!important` or altering legacy `[hidden]` behavior on existing screens.
  - `.ui-scope` provides local `box-sizing: border-box`, form control font inheritance, and `section { margin-bottom: 0 }` inside new UI Foundation containers without affecting legacy DOM outside `.ui-scope`.

---

## 4. Source Scanning Scope & Dynamic Class Name Rules

### Explicit `@source` Scope

Default automatic project-wide scanning is disabled via `source(none)` on the utilities import, and only frontend UI files are scanned:

```css
@source "../index.html";
@source "../ui-foundation.html";
@source "../main.js";
@source "../game.js";
@source "../game/**/*.js";
@source "../media/**/*.js";
@source "../ui/**/*.js";
```

**Excluded from scanning**: `data/`, `public/data/`, `research/`, `docs/`, `scripts/`, and external caches.

### Dynamic Class Name Rules for Native JS DOM

Because UI components are constructed in native ES modules via `el(tag, className, text)`:
1. **Use complete, statically detectable class strings**: Keep variant and state class maps in static lookup objects (see `public/ui/foundation-tokens.js`, e.g. `BUTTON_VARIANT_CLASSES`, `PLAYER_CARD_STATE_CLASSES`, `POSITION_BADGE_CLASSES`).
2. **Never concatenate partial utility names**: Do **not** write `bg-${color}-500`, `text-${tier}`, or `grid-cols-${count}`. Tailwind's static scanner cannot extract interpolated fragments.
3. **Use CSS variables or inline styles for continuous values**: For 0–100 ability bars, match timers, or pitch coordinates, set a CSS custom property (`el.style.setProperty('--stat-pct', String(score))`) consumed by a static helper class (`.ui-stat-bar-fill`), instead of generating hundreds of utility classes.

---

## 5. Semantic Design Tokens (v1)

Defined in `public/styles/app.src.css` (`@theme` and `@layer theme`) to support compact dark football tactical interfaces (referencing FO3/3M visual information hierarchy without locking components to raw hex codes):

| Category | CSS Custom Property | Tailwind Utility Examples | Purpose |
| :--- | :--- | :--- | :--- |
| **Background & Panels** | `--color-canvas` (`#0b111e`)<br>`--color-canvas-subtle` (`#101826`)<br>`--color-panel` (`#151f32`)<br>`--color-panel-elevated` (`#1c2942`)<br>`--color-panel-inset` (`#0d1422`)<br>`--color-panel-header` (`#18253d`) | `bg-canvas`, `bg-panel`, `bg-panel-elevated`, `bg-panel-inset` | Page background, primary tactical panels, elevated cards/headers, and recessed data wells |
| **Borders** | `--color-panel-border` (`#283959`)<br>`--color-panel-border-subtle` (`#1e2c46`)<br>`--color-panel-border-strong` (`#3b527e`) | `border-panel-border`, `border-panel-border-subtle`, `border-panel-border-strong` | Panel structural borders, subtle row dividers, and emphasized card borders |
| **Text Hierarchy** | `--color-fg` (`#eaf0ff`)<br>`--color-fg-secondary` (`#b6c5e3`)<br>`--color-fg-muted` / `--color-muted` (`#7e92b8`)<br>`--color-fg-on-accent` (`#ffffff`) | `text-fg`, `text-fg-secondary`, `text-muted`, `text-fg-on-accent` | Primary titles/names, secondary descriptions, muted labels/subtitles, and button text on accent fills |
| **Interactive & States** | `--color-accent` (`#2f8cff`)<br>`--color-accent-hover` (`#4ca0ff`)<br>`--color-accent-active` (`#1e70db`)<br>`--color-accent-soft` (`#162d52`)<br>`--color-selected` (`#38bdf8`)<br>`--color-selected-surface` (`#132a4a`)<br>`--color-disabled` (`#1b2436`)<br>`--color-disabled-fg` (`#596987`)<br>`--color-disabled-border` (`#233047`)<br>`--color-danger` (`#dc2626`)<br>`--color-danger-hover` (`#ef4444`)<br>`--color-danger-surface` (`#2c1621`) | `bg-accent`, `hover:bg-accent-hover`, `border-selected`, `bg-selected-surface`, `outline-selected`, `disabled:bg-disabled`, `disabled:text-disabled-fg`, `bg-danger` | Primary actions, explicit selected card/slot highlights, disabled states, and destructive/warning states |
| **Football Semantic Badges** | `--color-season-gold` (`#f59e0b`)<br>`--color-season-surface` (`#2b2111`)<br>`--color-pos-gk` (`#f59e0b`)<br>`--color-pos-df` (`#38bdf8`)<br>`--color-pos-mf` (`#22c55e`)<br>`--color-pos-fw` (`#f43f5e`) | `text-season-gold`, `bg-season-surface`, `text-pos-gk`, `text-pos-df`, `text-pos-mf`, `text-pos-fw` | Season year tags and GK / DF / MF / FW position role badges |
| **Typography & Radii** | `--text-2xs` (`0.6875rem`)<br>`--text-ovr` (`1.375rem`)<br>`--radius-badge` (`0.25rem`)<br>`--radius-control` (`0.375rem`)<br>`--radius-card` (`0.5rem`)<br>`--radius-panel` (`0.625rem`) | `text-2xs`, `text-ovr`, `rounded-badge`, `rounded-control`, `rounded-card`, `rounded-panel` | Compact stat/badge text, prominent OVR rating numeral, and consistent corner radii |
| **Shadows & Z-Index** | `--shadow-panel`, `--shadow-card`, `--shadow-selected`<br>`--z-base` (`1`), `--z-sticky` (`20`), `--z-overlay` (`40`), `--z-modal` (`60`), `--z-toast` (`80`) | `shadow-panel`, `shadow-card`, `shadow-selected` | Depth separation for panels/cards, cyan selection glow, and stacking order |

---

## 6. Installation, Build, Watch & Start Commands

After a fresh clone:

```bash
# 1. Install dependencies (uses package-lock.json)
npm ci

# 2. Build static CSS bundle (public/styles/app.src.css -> public/styles/app.css)
npm run build:css

# 3. Watch CSS changes during UI development (cross-platform, shell-independent)
npm run watch:css

# 4. Start the HTTP & WebSocket server (default port 8000)
npm start
```

> Because `public/styles/app.css` is committed to version control, running `npm start` works immediately after clone even before running `npm run build:css`. Whenever `public/styles/app.src.css` or any scanned HTML/JS file changes, run `npm run build:css` and commit the updated `public/styles/app.css`.

---

## 7. Standalone Verification Preview Page

- **URL Path**: `http://localhost:8000/ui-foundation.html`
- **Files**:
  - `public/ui-foundation.html`
  - `public/ui/ui-foundation-preview.js`
  - `public/ui/foundation-tokens.js`
- **Scope**:
  1. **Buttons Swatch**: Normal, Hover, Focus ring, and Disabled states on native `<button>` elements.
  2. **Panels Swatch**: Title, body, borders, and 3-tier surface hierarchy (`bg-panel`, `bg-panel-elevated`, `bg-panel-inset`) on `<section>` elements.
  3. **Player Cards Swatch**: Read-only `PlayerSeason` records from `TEAM_SEASONS` rendered with `createPlayerPortrait()`, `createClubCrest()`, `createLeagueEmblem()`, localized names (`ja` / `en` / `zh-CN`), season/position badges, read-only ability bars (`ATK`, `CRE`, `DEF`, `PHY`, `GK`, `OVR`), and interactive `normal` / `selected` / `unavailable` states.
- **Isolation**: Not linked from `public/index.html` or Draft UI; does not invoke game state transitions or WebSocket messages.

---

## 8. Incremental Migration & Legacy CSS Removal Guide

Subsequent UI tasks can migrate formal screens incrementally without big-bang rewrites:

1. **Scope a target screen/module** (e.g., Lobby/Room, Draft Header & Roll Bar, Squad Pitch/List Panel, or Match Center):
   - Add `.ui-scope` (or apply Tailwind utilities directly) to the target component root in `public/game/draft/ui.js`, `public/game/match/ui.js`, or `public/main.js`.
   - Use static class maps in `public/ui/` (or module-level constants) referencing semantic tokens (`bg-panel`, `border-panel-border`, `text-fg`, `text-muted`, `border-selected`, etc.).
2. **Verify override & coexistence**:
   - Because `@layer utilities` and `@layer components` sit above `@layer legacy`, migrated components immediately adopt new styles while unmigrated screens continue using `@layer legacy` (`public/style.css`).
3. **Delete dead legacy selectors**:
   - Once all references to a legacy `.fd-*` selector block in `public/style.css` have been replaced in JS/HTML, remove that corresponding block from `public/style.css` and run `npm run build:css`.
   - When all formal screens have been migrated and `public/style.css` is empty, remove `@import "../style.css" layer(legacy);` from `public/styles/app.src.css` and optionally enable or finalize base rules.

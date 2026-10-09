# ERA DERBY Design System v1

ERA DERBY should read as a classic PC football game client: a night stadium, a tactical HUD, historical football as the subject, and compact controls with clear hierarchy. Draft and REVEAL establish the density and restraint. New surfaces inherit that language without changing the proven in-game stage rules.

## Color and surface semantics

The additive client tokens live in `public/styles/theme/tokens.css`. Existing foundation values remain stable for Draft and REVEAL.

| Purpose | Tokens | Use |
| --- | --- | --- |
| Stadium and game stage | `--color-canvas`, `--surface-game-stage` | Keep the stadium visible through the stage; use overlays only for legibility. |
| HUD base / raised / inset | `--surface-hud-base`, `--surface-hud-raised`, `--surface-hud-inset` | One primary control grouping, a raised popover, or a recessed value area. Avoid nested card grids. |
| Overlay and navigation | `--surface-hud-overlay`, `--surface-nav`, `--surface-nav-active` | Dialog backing, full-width client navigation, and the active menu choice. |
| Disabled and borders | `--surface-disabled`, `--border-hud`, `--border-divider`, `--border-focus`, `--border-nav-active` | Disabled modes, quiet separators, standard frames, keyboard focus, and active selection. |
| Elevation | `--shadow-hud`, `--shadow-overlay`, `--shadow-action` | HUD separation, modal depth, and restrained primary-action emphasis. |

Gold (`--color-season-gold`) identifies the main action and notable historical context. Cyan (`--color-selected`, `--border-focus`) is for focus, selection, and secondary information. Position colors retain their football meanings: GK amber, DF cyan, MF green, FW rose. Green is reserved for an actual available/ready state. Do not use colored borders as decoration on every item.

## Surface recipes

`public/styles/shared/hud.css` provides opt-in recipes; these do not restyle `.fd-*` game primitives.

```html
<section class="bb-surface-stage">
  <nav class="bb-surface-hud">…</nav>
  <div class="bb-surface-inset">…</div>
</section>
<dialog class="bb-surface-overlay">…</dialog>
<button class="bb-nav-active">…</button>
```

- `.bb-surface-stage` is a translucent, unframed game stage.
- `.bb-surface-hud` is one compact panel with a quiet border and restrained depth.
- `.bb-surface-inset` separates recessed values without another raised card.
- `.bb-surface-overlay` is the modal surface, including its dimmed backdrop.
- `.bb-nav-active` marks the primary/selected navigation item.

Use the recipe first; only introduce page-specific surface values when the interaction truly differs. Controls need a visible `:focus-visible` outline. Honor `prefers-reduced-motion` for transitions.

## Typography

Use the shared scale for brand, menu, page heading, player details, tactical values, and supporting copy: `--text-brand`, `--text-menu`, `--text-menu-primary`, `--text-page-title`, `--text-player-info`, `--text-tactical-value`, and `--text-supporting`. The menu item must remain comfortably larger than its explanation. Supporting text should generally be at least 12px and use normal sentence case. Japanese, English, and Simplified Chinese labels must be allowed to wrap without shifting the page structure.

## Layout shells

| Shell | Geometry | Rules |
| --- | --- | --- |
| HOME / future Lobby navigation | Full viewport width, 56–64px, sticky, flat edge-to-edge background | Align its inner content with `--layout-home-stage`; keep in-game HUD compact and separate. |
| HOME stage | Centered `--layout-home-stage`; desktop left menu about 36%, football stage about 64% | No enclosing dashboard card. Make the open/available mode the sole dominant action. Keep future modes compact and explicitly unavailable. |
| Lobby entry | Centered `--layout-lobby-stage` form below the full-width navigation | Keep room creation and joining clear; this token does not authorize a Lobby v2 redesign. |
| Draft / REVEAL / MATCH / RESULT | Existing `--layout-game-hud` compact phase layout | Preserve one-screen and phase-specific geometry. Scope any future shell change to its phase. |
| Modal | `--layout-modal`, viewport-bounded height | Trap focus with a native dialog where practical, close with Escape, restore trigger focus, and keep touch targets usable. |

HOME should use the football imagery as the right-hand stage rather than repeating the brand headline. Prefer a reliable local historical portrait only when its existing media/fallback path is suitable for this role. A local tactical pitch and 4-3-3 shape are the fallback. Do not add external stock images, invented match data, or a second media-rendering system.

### HOME historical player showcase

- The wide HOME stage fades only its translucent backdrop with intersecting horizontal and vertical edge gradients; the mask reaches transparent at each outer edge without an oval spotlight. Keep the original pitch artwork itself unmasked so its full field lines and goal areas stay crisp. Menu surfaces, player portraits, ratings, names, and metadata stay sharp.
- On desktop, the left menu stays about 340px wide. The pitch uses `/assets/draft-pitch-vertical.jpg` at its native 651:1024 aspect ratio without cropping or stretching, capped at 620px high. The stage shows a random, position-eligible 4-3-3 assembled from real PlayerSeason records. Each player keeps that record's club, year, rating, identity, and existing portrait/crest fallback behavior.
- The desktop player presentation reuses the REVEAL 11-player visual vocabulary: circular portrait with cyan rim, gold corner OVR badge, player name, club crest (or a compact abbreviation when unavailable), two-digit year, and slot label. It uses HOME list semantics and does not make sample players interactive.
- The XI is freshly sampled every 8.75 seconds and crossfades. Hover, keyboard focus, an explicit pause control, hidden HOME, and hidden browser tabs stop rotation. Reduced motion keeps a static lineup.
- On mobile (640px and below), HOME hides the pitch and places a 144px horizontal player ribbon after the menu in normal page flow. Club labels use short, locale-independent abbreviations derived from each record's canonical English club name; full names remain available to assistive technology and tooltips. The ribbon loops slowly, supports touch scrolling, pauses on hover/focus/touch, and becomes a manual horizontal list for reduced-motion users. Repeated loop cards are hidden from assistive technology.

## Navigation variants and phase isolation

HOME and Lobby use the full-width client navigation. DRAFT, REVEAL, MATCH, and RESULT keep their current compact topbar and room strip. Scope shell rules under `body.in-home`, `body.in-lobby`, or the relevant phase root; do not broaden shared selectors onto `.fd-*`, `.dw-*`, or `.rv-*`.

When adding a page, consume the semantic tokens and recipes, then keep its unique layout in its own `pages/<page>.css` module. Add a shared recipe only after two or more independent phases need the same behavior. `public/styles/app.src.css` remains an import/source manifest; generated `app.css` is produced by `npm run build`.

## Anti-patterns

Do not turn a game menu into a SaaS dashboard of equally weighted cards. Avoid repeated brand headlines, fake counts or records, tiny all-caps labels, stacked borders, broad neon glows, or prominent disabled actions. Keep the stadium visible, the primary action obvious, and game controls information-dense without making text hard to read.

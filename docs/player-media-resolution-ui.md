# Player Media Resolution + UI v1 (`availability-v1`)

## 1. Architecture Overview

Battle Base separates external media discovery, deterministic resolution, compact browser indexing, and UI presentation into distinct layers:

```text
Candidate Audit (data/entities/player-media-candidates.json)
  ↓
Availability Resolver v1 (scripts/build-player-media-resolution.mjs)
  ↓
PlayerSeason Resolution (data/entities/player-media-resolutions.json)
  ↓
Browser Runtime Index (scripts/build-player-media-index.mjs -> public/data/player-media.js)
  ↓
Runtime Media Helpers (public/media/entity-media.js + public/media/media-ui.js)
  ↓
Game UI Render Boundary (public/game/draft/ui.js + public/game/match/ui.js)
```

### Key Design Principles

1. **Zero Re-Scraping during Build**: `scripts/build-player-media-resolution.mjs` consumes the audited facts in `data/entities/player-media-candidates.json` and `data/reports/player-media-provider-audit.json` directly.
2. **PlayerSeason-First Resolution (`player.id`)**: Runtime lookups key on `player.id` (`playerSeasonId`, e.g., `barcelona-2011-8` vs `barcelona-2015-8`) rather than canonical player name so multi-season entities resolve to their season-specific portraits.
3. **Clean Gameplay & Network State**: Media URLs, providers, and resolution metadata are never written into `TEAM_SEASONS`, draft state, match state, RNG, or WebSocket payloads.
4. **Concurrent Blind Draft Privacy**: `renderBlindOpponentPanel()` in `public/game/draft/ui.js` never queries player or club media and never mounts hidden `<img>` elements or identity attributes before both players `LOCK IN`.
5. **Graceful Runtime Failure Fallback**:
   - External player portrait load errors fall back to `/assets/player-silhouette.svg` via a one-shot `onerror` guard (`applyImageFallback`) that prevents infinite error loops.
   - Club crest and league emblem load errors hide the broken `<img>` cleanly (`applyLogoFallback`) while preserving localized club/league text and never substituting a player silhouette for a team logo.

---

## 2. `availability-v1` Resolution Policy & Coverage

Every `PlayerSeason` (`554` total across `418` unique player entities) is resolved deterministically using policy `availability-v1`:

1. **Manual Override (`manual-override`)**: Checked first via `data/manual/player-media-overrides.json` (`0` active overrides in v1).
2. **FIFAIndex Exact-Season Real Photo (`fifaindex-exact-year`)**: `454 / 554` (`81.9%`).
3. **FIFAIndex Nearest-Season Real Photo (`fifaindex-nearest-year`)**: `90 / 554` (`16.2%`, distance `1` to `6` years).
4. **FO3 Reliable Supplemental (`fo3-supplemental`)**: `4 / 554` (`0.7%` — Peter Schmeichel, Denis Irwin, Fernando Hierro, Stefan Effenberg), prioritizing full detail PNG cutouts over search thumbnails.
5. **FO4 Reliable Supplemental (`fo4-supplemental`)**: `1 / 554` (`0.2%` — Gabriel Batistuta).
6. **Local Silhouette Fallback (`silhouette`)**: `5 / 554` (`0.9%` — Diego Fuser, Donato, Francesco Antonioli, Jacques Songo'o, Roberto Mancini) -> `/assets/player-silhouette.svg` (`licenseStatus: "project-generated"`).

### Strict Candidate Filtering

External candidates must satisfy all of the following to be eligible:
- `assetKind === "real-photo"` (placeholders such as Kylian Mbappé's FIFA 16 `notfound_0.webp` and Jan Oblak's FIFA 14 placeholder are strictly rejected)
- `reachableImage === true` and `httpStatus === 200`
- `contentType` starts with `"image/"`
- `manualReview !== true`
- `matchConfidence` in `["exact-id", "exact-name", "alias-confirmed", "name+context"]`
- `licenseStatus === "external-provider"`

---

## 3. UI Surfaces Upgraded in v1

- **Draft Roll Banner (`public/game/draft/ui.js`)**: Displays the rolled league emblem (`createLeagueEmblem`) and club crest (`createClubCrest`) alongside localized league/club names (`formatLeagueName`, `formatClubName`).
- **Candidate Player Cards (`public/game/draft/ui.js`)**: Displays a fixed-height portrait container (`.fd-card-media`), bottom-aligned `object-fit: contain` portrait (`.fd-card-player-img`), corner club crest badge (`.fd-card-club-crest`), primary localized name + secondary English canonical name (`getPlayerDisplayName`), and position/overall/mini-stats.
- **Ready Roster & Own Team Panel (`public/game/draft/ui.js`)**: Displays compact mini portraits (`.fd-ready-player-img`, `.fd-slot-player-img`) for quick visual confirmation of the 11-player lineup.
- **Roster Reveal (`public/game/match/ui.js`)**: Upgrades both teams' reveal lineups into 11-player role-grouped visual card grids (`GK`, `DF`, `MF`, `FW`) with player portraits, club crests, localized names, and team profile chips (`OVR`, `ATK`, `CRE`, `DEF`, `PHY`, `GK`).

---

## 4. Roadmap Note: Media Quality Resolver v2 (Not Yet Implemented)

> [!IMPORTANT]
> **Quality Resolver v2 is intentionally not implemented in v1.**
> In v1 (`policyVersion: "availability-v1"`), resolution strictly follows provider availability order (`FIFAIndex exact -> FIFAIndex nearest -> FO3 -> FO4 -> silhouette`).

### Why `exact-year` Does Not Always Mean Best Visual Quality

An exact-year match on FIFAIndex guarantees historical edition alignment, but early FIFA editions (such as `FIFA05` or `FIFA06`) often use low-resolution or dated 3D headshots. For example, a 2005 player season (such as Paolo Maldini 2005) may have a significantly higher-quality, transparent cutout portrait in **FIFA Online 3 (`06U` / `WORLD LEGEND`)** or **FIFA Online 4** than its `FIFA05` exact-year image.

Because `data/entities/player-media-resolutions.json` records `policyVersion` and `selectionReason` while `public/data/player-media.js` exposes a provider-agnostic runtime index, a future **Media Quality Resolver v2 (`policyVersion: "quality-v2"`)** can upgrade image selection without changing any UI component code.

### Planned Factors for `quality-v2`

- **Season proximity**: Balancing `yearDistance` against render quality when exact-year assets are low-resolution.
- **Actual image quality & resolution**: Evaluating pixel dimensions, sharpness, and compression artifacts.
- **Crop & transparency**: Preferring clean waist/chest-up transparent PNG renders over opaque square crops.
- **Real photo vs. old 3D render**: Detecting early 2000s 3D engine face captures vs. real photographic cutouts.
- **FO3 / FO4 card series quality**: Ranking specific historical series (e.g., seasonal tournament cards vs. generic base cards).
- **Visual consistency**: Keeping card portrait styles cohesive across a drafted 11-man squad.
- **Legend render quality**: Evaluating dedicated icon/legend renders for retired players.
- **Curated manual overrides**: Populating `data/manual/player-media-overrides.json` for high-visibility historical seasons.

---

## 5. Build & Validation Commands

```bash
# 1. Resolve all 554 PlayerSeasons and generate resolution reports
node scripts/build-player-media-resolution.mjs

# 2. Build compact browser runtime index (public/data/player-media.js)
node scripts/build-player-media-index.mjs

# 3. Validate resolutions, fixtures, candidate integrity, and runtime index
node scripts/validate-player-media-resolution.mjs

# 4. Run Player Media UI & Blind Draft privacy smoke test
node scripts/smoke-player-media-ui.mjs
```

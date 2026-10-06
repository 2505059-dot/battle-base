# Frontend Game Architecture (`public/game/`)

`public/game.js` serves as a thin public entry point consumed by `public/main.js`, delegating all Draft and Match Simulation logic to focused ES modules under `public/game/`.

## Directory Structure & Module Responsibilities

```text
public/
  game.js                     # Thin entry point; re-exports startGame & console debug helpers
  data/
    team-seasons.js           # Historical club-season dataset & query indexes (League -> Club -> Year)
  game/
    controller.js             # Top-level game coordinator (concurrent draft transitions, ctx.send/onMessage, local card selection, playback timer, render dispatch)
    state.js                  # Game state factory (createInitialState) and per-team concurrent draft selectors/history helpers
    shared/
      constants.js            # Shared constants (ROLES, ROSTER_SLOTS, SLOTS, slot/role helpers, REROLL_TYPES, MAX_HISTORY_ITEMS)
      math.js                 # Generic pure math utilities (clamp)
      dom.js                  # Generic DOM element helper (el)
      event-formatters.js     # Pure localized formatters for structured Draft History & Match Events
    draft/
      random.js               # Draft random selection & 3-stage uniform League -> Club -> Year roll
      rules.js                # Pure Draft rules (11v11 slot/role fitting, duplicate player.id protection, role -> first empty slot resolution, reroll validation, team rating)
      ui.js                   # Draft UI components (independent team header, reroll bar, candidate cards with role buttons, compact blind opponent panel, grouped 11-player roster panels, per-team history box)
    match/
      rng.js                  # Deterministic Mulberry32 seeded RNG (createRng)
      config.js               # Role weights (ROLE_WEIGHTS, SHOT/ASSIST/DEFENSE weights) & MATCH_SIM_CONFIG
      team-profile.js         # Pure 6-dimension Team Profile calculation over 11-player 4-3-3 roster & structured GK lookup
      engine.js               # Pure deterministic 90-minute match simulation over 11v11 rosters (generateMatchScript)
      simulator.js            # Multi-season 11v11 sample roster builder & batch simulation debug helper (simulateManyMatches)
      ui.js                   # Roster Reveal (22-player Starting XI + Team Profiles), Live Match Center (scoreboard, clock, event feed), and Full Time stats UI
```

## 11v11 Abstract 4-3-3 Roster & Slot-Role Separation

Each team drafts an 11-player starting lineup (`Roster = 11`) using an **Abstract 4-3-3** formation (`GK × 1`, `DF × 4`, `MF × 3`, `FW × 3`; `FLEX` is no longer part of the active roster):

- **Structured Slot Definitions (`ROSTER_SLOTS`)**:
  - `GK1` (`role: 'GK', index: 1`)
  - `DF1`, `DF2`, `DF3`, `DF4` (`role: 'DF', index: 1..4`)
  - `MF1`, `MF2`, `MF3` (`role: 'MF', index: 1..3`)
  - `FW1`, `FW2`, `FW3` (`role: 'FW', index: 1..3`)
- **Abstract Containers Only (No Tactical Sub-Roles or Geometry Yet)**:
  - `DF1..DF4` are purely four interchangeable `DF` containers — they are **not** `LB / LCB / RCB / RB`.
  - `MF1..MF3` are purely three interchangeable `MF` containers — they are **not** `CDM / CM / CAM`.
  - `FW1..FW3` are purely three interchangeable `FW` containers — they are **not** `LW / ST / RW`.
  - No pitch geometry (`x/y`, `left/right`, or zone anchors) is attached to slots at this stage.
- **Role Selection in UI → Concrete Slot over Network**:
  - Candidate players still use abstract dataset positions (`GK`, `DF`, `MF`, `FW`).
  - When a player card is selected, the UI displays only available **Role** buttons (`GK`, `DF`, `MF`, `FW`) via `getAvailableRolesForPlayer(roster, player)`.
  - Clicking a role resolves the first empty slot for that role via `getFirstAvailableSlotForRole(roster, role)` (e.g., `DF` → `DF3`) and sends the concrete slot in the network payload (`{ kind: 'pick', playerId, slot: 'DF3' }`).
- **Exact `player.id` Duplicate Protection**:
  - Within a single team's 11-player roster, the exact same `PlayerSeason` (`player.id`) cannot be drafted twice (`isPlayerInRoster`), enforced both in UI candidate availability and in `controller.js` (`applyPick`).

## Concurrent Blind Draft State Model

Draft state is modeled per-team rather than via a global turn counter (`turnIndex` / `roundCount` are not used):

- **Global `state.phase`**: `'DRAFT' | 'REVEAL' | 'MATCH' | 'RESULT'`
- **Per-team `team.draft`**:
  - `phase`: `'ROLL' | 'PICK' | 'READY' | 'LOCKED'` (`READY` is reached only when all `11 / 11` slots are filled)
  - `currentRoll`: `TeamSeason | null` (isolated per team so both players can roll, reroll, and pick simultaneously)
  - `locked`: `boolean` (becomes `true` when the player presses `LOCK IN` from `READY`)
  - `history`: structured per-team action log (`draft.roll`, `draft.reroll`, `draft.pick`, `draft.lock`)
- **Local UI State**: `localSelectedPlayerId` lives exclusively in `controller.js` per client and is never broadcast over WebSocket.
- **Blind Draft UI & Reveal**:
  - While `state.phase === 'DRAFT'`, each client renders its own full draft controls and grouped 11-player roster, while the opponent panel renders in compact blind mode (`renderBlindOpponentPanel`), showing only total progress (`picked / 11`), status (`DRAFTING` / `READY` / `LOCKED ✓`), and role completion counts (`GK 1 / 1`, `DF 3 / 4`, `MF 2 / 3`, `FW 1 / 3`) without exposing opponent player names, clubs, years, ratings, rerolls, or history.
  - Once both teams send `draft_lock` (`areBothTeamsLocked(state)`), `state.phase` transitions to `'REVEAL'`, simultaneously revealing both complete 11-player starting lineups (grouped by `GK / DF / MF / FW`), 11-player team ratings, and 5-metric team profiles (`ATK / CRE / DEF / PHY / GK`) before Team A starts the deterministic match.

## Dependency Direction

Dependencies flow strictly downward with no circular imports:

1. **Data & Shared Primitives**: `data/team-seasons.js`, `shared/*`, `match/rng.js`, `match/config.js`
2. **Pure Domain Rules & Engine**: `draft/random.js` → `draft/rules.js` → `state.js` → `match/team-profile.js` → `match/engine.js` → `match/simulator.js`
3. **Stateless UI Renderers**: `draft/ui.js` → `match/ui.js`
4. **Orchestrator & Entry**: `controller.js` → `public/game.js`



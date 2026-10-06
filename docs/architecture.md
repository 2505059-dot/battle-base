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
      constants.js            # Shared constants (SLOTS, REROLL_TYPES, REROLL_LABELS, MAX_HISTORY_ITEMS)
      math.js                 # Generic pure math utilities (clamp)
      dom.js                  # Generic DOM element helper (el)
      event-formatters.js     # Pure localized formatters for structured Draft History & Match Events
    draft/
      random.js               # Draft random selection & 3-stage uniform League -> Club -> Year roll
      rules.js                # Pure Draft rules (slot fitting, reroll option/transition validation, team rating)
      ui.js                   # Draft UI components (independent team header, reroll bar, candidate cards, blind/full team roster panels, per-team history box)
    match/
      rng.js                  # Deterministic Mulberry32 seeded RNG (createRng)
      config.js               # Role weights (ROLE_WEIGHTS, SHOT/ASSIST/DEFENSE weights) & MATCH_SIM_CONFIG
      team-profile.js         # Pure 6-dimension Team Profile calculation & FLEX role resolution
      engine.js               # Pure deterministic 90-minute match simulation (generateMatchScript)
      simulator.js            # Batch simulation debug helper (simulateManyMatches)
      ui.js                   # Roster Reveal (Match Ready), Live Match Center (scoreboard, clock, event feed), and Full Time stats UI
```

## Concurrent Blind Draft State Model

Draft state is modeled per-team rather than via a global turn counter (`turnIndex` / `roundCount` are not used):

- **Global `state.phase`**: `'DRAFT' | 'REVEAL' | 'MATCH' | 'RESULT'`
- **Per-team `team.draft`**:
  - `phase`: `'ROLL' | 'PICK' | 'READY' | 'LOCKED'`
  - `currentRoll`: `TeamSeason | null` (isolated per team so both players can roll, reroll, and pick simultaneously)
  - `locked`: `boolean` (becomes `true` when the player presses `LOCK IN` from `READY`)
  - `history`: structured per-team action log (`draft.roll`, `draft.reroll`, `draft.pick`, `draft.lock`)
- **Local UI State**: `localSelectedPlayerId` lives exclusively in `controller.js` per client and is never broadcast over WebSocket.
- **Blind Draft UI & Reveal**:
  - While `state.phase === 'DRAFT'`, each client renders its own full draft controls and roster, while the opponent panel renders in blind mode (`renderBlindOpponentPanel`), showing only picked count (`picked / 5`) and status (`DRAFTING` / `READY` / `LOCKED ✓`) without exposing opponent player names, clubs, years, ratings, rerolls, or history.
  - Once both teams send `draft_lock` (`areBothTeamsLocked(state)`), `state.phase` transitions to `'REVEAL'`, simultaneously revealing both full rosters, team ratings, and 5-metric team profiles before Team A starts the deterministic match.

## Dependency Direction

Dependencies flow strictly downward with no circular imports:

1. **Data & Shared Primitives**: `data/team-seasons.js`, `shared/*`, `match/rng.js`, `match/config.js`
2. **Pure Domain Rules & Engine**: `draft/random.js` → `draft/rules.js` → `state.js` → `match/team-profile.js` → `match/engine.js` → `match/simulator.js`
3. **Stateless UI Renderers**: `draft/ui.js` → `match/ui.js`
4. **Orchestrator & Entry**: `controller.js` → `public/game.js`


# Frontend Game Architecture (`public/game/`)

`public/game.js` serves as a thin public entry point consumed by `public/main.js`, delegating all Draft and Match Simulation logic to focused ES modules under `public/game/`.

## Directory Structure & Module Responsibilities

```text
public/
  game.js                     # Thin entry point; re-exports startGame & console debug helpers
  data/
    team-seasons.js           # Historical club-season dataset & query indexes (League -> Club -> Year)
  game/
    controller.js             # Top-level game coordinator (state transitions, ctx.send/onMessage, playback timer, render dispatch)
    state.js                  # Game state factory (createInitialState) and pure state selectors/history helpers
    shared/
      constants.js            # Shared constants (SLOTS, REROLL_TYPES, REROLL_LABELS, MAX_HISTORY_ITEMS)
      math.js                 # Generic pure math utilities (clamp)
      dom.js                  # Generic DOM element helper (el)
    draft/
      random.js               # Draft random selection & 3-stage uniform League -> Club -> Year roll
      rules.js                # Pure Draft rules (slot fitting, reroll option/transition validation, team rating)
      ui.js                   # Draft UI components (header, reroll bar, candidate cards, team roster panels, history box)
    match/
      rng.js                  # Deterministic Mulberry32 seeded RNG (createRng)
      config.js               # Role weights (ROLE_WEIGHTS, SHOT/ASSIST/DEFENSE weights) & MATCH_SIM_CONFIG
      team-profile.js         # Pure 6-dimension Team Profile calculation & FLEX role resolution
      engine.js               # Pure deterministic 90-minute match simulation (generateMatchScript)
      simulator.js            # Batch simulation debug helper (simulateManyMatches)
      ui.js                   # Match Ready, Live Match Center (scoreboard, clock, event feed), and Full Time stats UI
```

## Dependency Direction

Dependencies flow strictly downward with no circular imports:

1. **Data & Shared Primitives**: `data/team-seasons.js`, `shared/*`, `match/rng.js`, `match/config.js`
2. **Pure Domain Rules & Engine**: `draft/random.js` → `draft/rules.js` → `state.js` → `match/team-profile.js` → `match/engine.js` → `match/simulator.js`
3. **Stateless UI Renderers**: `draft/ui.js` → `match/ui.js`
4. **Orchestrator & Entry**: `controller.js` → `public/game.js`

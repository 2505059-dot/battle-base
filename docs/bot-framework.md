# Bot Framework v1 Architecture

## Overview

The **Battle Base / Golden Road LoL Draft Bot Framework v1** (`public/game/bot/`) provides a pure-logic, deterministic, testable, and non-cheating AI decision engine for the 11v11 Concurrent Blind Draft (`4-3-3`).

It is decoupled from the DOM, WebSocket transport, and room server (`server.js` remains a pure message relay), enabling both future in-game bot opponents and high-throughput headless draft/match simulations.

---

## Module Structure

- [`public/game/bot/config.js`](../public/game/bot/config.js) — Difficulty constants (`random`, `casual`, `smart`, `expert`), reason codes, `BOT_ROLE_VALUE_WEIGHTS`, dataset role baselines (`PUBLIC_ROLE_BASELINES`), slot impact weights, and difficulty parameters.
- [`public/game/bot/rng.js`](../public/game/bot/rng.js) — Independent deterministic Mulberry32 PRNG (`createBotRng`) and state-aware seed derivation (`deriveBotDecisionSeed`). Never calls `Math.random()` and never shares state with Match RNG.
- [`public/game/bot/personas.js`](../public/game/bot/personas.js) — Orthogonal Coach Persona schema, `NEUTRAL_PERSONA`, `createPersona`, and `resolvePersona`.
- [`public/game/bot/scoring.js`](../public/game/bot/scoring.js) — `scorePlayerForRole`, `scoreRoleUrgency`, `evaluateCandidatePick`, and `scoreMarginalRosterGain`.
- [`public/game/bot/reroll-value.js`](../public/game/bot/reroll-value.js) — `getRerollOutcomeDistribution`, `getRerollOpportunityCost`, and `estimateRerollValue` over the 3-stage uniform `League -> Club -> Year` probability tree.
- [`public/game/bot/decision.js`](../public/game/bot/decision.js) — Primary entry point `chooseDraftAction`, `canFreeRedraw`, `diagnoseDeadRoll`, and `toPublicDraftAction`.
- [`public/game/draft/transitions.js`](../public/game/draft/transitions.js) — Pure state transitions (`applyDraftRoll`, `applyDraftReroll`, `applyDraftRedraw`, `applyDraftPick`, `applyDraftLock`, `resolveBotPickSlot`, `applyBotDraftAction`) shared between `public/game/controller.js` and headless simulators.

---

## Core API: `chooseDraftAction`

```js
const action = chooseDraftAction({
    team,
    difficulty = 'smart',   // 'random' | 'casual' | 'smart' | 'expert'
    persona = 'neutral',    // 'neutral' or custom persona object
    decisionSeed = 1,       // deterministic seed for decision noise & tie-breaking
    includeDebug = false,   // if true, makes action/debug enumerable on returned object
});
```

### Returned Action Shapes

- **ROLL phase**: `{ type: 'roll' }`
- **PICK phase (Pick)**: `{ type: 'pick', playerId, role }` where `role` is an abstract role (`'GK' | 'DF' | 'MF' | 'FW'`), never a concrete slot ID. The driver resolves the concrete slot via `getFirstAvailableSlotForRole(team.roster, action.role)`.
- **PICK phase (Reroll)**: `{ type: 'reroll', rerollType }` where `rerollType` is `'league' | 'club' | 'year'`.
- **PICK phase (Dead Roll Free Redraw)**: `{ type: 'redraw' }` when `canFreeRedraw(team) === true` (`0` legal picks AND `0` legal rerolls).
- **READY phase (11/11 complete)**: `{ type: 'lock' }`
- **Diagnostic fallback**: `{ type: 'stuck', reason }`

### Explainability (`debug` Metadata)

Every returned action carries non-enumerable `debug` metadata (or enumerable when `includeDebug: true`), ensuring zero leakage into serialized network payloads (`JSON.stringify(action)`) while exposing full explainability for diagnostics and future Persona UI:

```js
action.debug = {
    candidateScore,
    bestPickValue,
    rerollValue,
    reasonCode, // 'roll_next' | 'pick_best_value' | 'pick_role_urgent' | 'reroll_expected_upgrade' | 'reroll_no_good_pick' | 'dead_roll_free_redraw' | 'lock_complete' | 'random_choice' | 'stuck_dead_roll'
};
```

---

## Orthogonal Design: Difficulty vs. Persona

`Difficulty` and `Persona` are strictly independent dimensions:

1. **Difficulty** controls **decision quality**:
   - Evaluation accuracy (overall heuristic vs. true role-weighted attributes)
   - Marginal roster gain & role scarcity planning
   - Reroll Expected Value (EV) depth (`none` vs. `simple` vs. `exact` 3-stage tree)
   - Resource opportunity cost awareness
   - Decision noise amplitude (`randomNoise`)

2. **Persona** controls **football philosophy**:
   - `roleWeights`: relative preference for `GK`, `DF`, `MF`, `FW`
   - `attributeMultipliers`: relative preference for `attack`, `creation`, `defense`, `physical`, `goalkeeping`, `overall`
   - `balancePreference`: preference for stabilizing weak lines vs. stacking strengths
   - `riskPreference`: willingness to gamble on rerolls
   - `starPreference`: bonus weight for superstar peak ratings (`overall > 86`)

In v1, `NEUTRAL_PERSONA` sets all multipliers to `1.0` and preferences to neutral (`balancePreference: 1.0, riskPreference: 0.0, starPreference: 0.0`). Future personas (`Guardiola`, `Mourinho`, `Klopp`, `Forum Ultra`, `Data Nerd`) plug directly into `chooseDraftAction` across any difficulty without combinatorial explosion.

---

## Difficulty Definitions

| Difficulty | Candidate Scoring | Roster & Scarcity Planning | Reroll Strategy | Decision Noise |
| :--- | :--- | :--- | :--- | :--- |
| **`random`** | None | Legal actions only | 24% random chance when legal reroll exists | Uniform random |
| **`casual`** | `0.78 * overall + 0.22 * roleFit` | Basic final-slot completion nudge | Heuristic reroll (45% chance when best pick `< 81.5`) | High (`±5.8`) |
| **`smart`** | `0.88 * roleFit + 0.12 * overall` | Value Over Replacement + line stabilization + role urgency | Simple hierarchical EV minus opportunity cost | Low (`±1.6`) |
| **`expert`** | `0.92 * roleFit + 0.08 * overall` | Full VOR + line stabilization + scarcity + flexibility conservation | Exact 3-stage `League -> Club -> Year` EV with roster-offset tree, opportunity cost, and downside risk protection | Zero (`0.0`, deterministic tie-break) |

---

## Candidate Scoring & Marginal Roster Value

1. **Role Attribute Blend (`scorePlayerForRole`)**:
   - `GK`: `0.85 * goalkeeping + 0.08 * physical + 0.05 * defense + 0.02 * creation`
   - `DF`: `0.56 * defense + 0.30 * physical + 0.09 * creation + 0.05 * attack`
   - `MF`: `0.45 * creation + 0.22 * attack + 0.20 * physical + 0.13 * defense`
   - `FW`: `0.57 * attack + 0.20 * creation + 0.21 * physical + 0.02 * defense`
   - Blended with `overall` quality prior according to difficulty. Illegal role assignments always score `0`.
2. **Value Over Replacement (`PUBLIC_ROLE_BASELINES`)**:
   - Normalizes raw role scores against the public dataset baseline for each role (`GK: 79.3`, `DF: 81.8`, `MF: 80.9`, `FW: 83.1`) scaled by `ROLE_SLOT_IMPACT`, preventing raw attribute scale differences from biasing early pick order.
3. **Marginal Roster Gain (`scoreMarginalRosterGain`)**:
   - Evaluates `(player, role)` pairs individually so multi-position players (`DF/MF`, `MF/FW`, etc.) are assigned to the role with highest marginal value.
   - Combines Value Over Replacement, line weakness stabilization (`roleWeaknessBonus`), completion/scarcity pressure (`scoreRoleUrgency`), and multi-position scarcity conservation.

---

## Hierarchical Reroll Expected Value (`estimateRerollValue`)

Draft rolls follow a 3-stage uniform hierarchy (`League -> Club -> Year`). Reroll EV strictly respects this probability tree:

- **League Reroll (`league`)**:
  $$P(\text{ts}) = \frac{1}{|\text{otherLeagues}|} \cdot \frac{1}{|\text{clubs}(L)|} \cdot \frac{1}{|\text{years}(L, C)|}$$
- **Club Reroll (`club`)**:
  $$P(\text{ts}) = \frac{1}{|\text{otherClubs}(L_{\text{cur}})|} \cdot \frac{1}{|\text{years}(L_{\text{cur}}, C)|}$$
- **Year Reroll (`year`)**:
  $$P(\text{ts}) = \frac{1}{|\text{otherYears}(L_{\text{cur}}, C_{\text{cur}})|}$$

For `expert`, `estimateRerollValue` computes the exact expected best legal pick across all reachable `TeamSeason` outcomes (taking into account players already in `team.roster`), and subtracts:
1. **Reroll Opportunity Cost (`getRerollOpportunityCost`)**: scales with `remainingFutureRolls` and adds a reserve premium when holding the last remaining reroll token.
2. **Downside & Completion Risk Penalty**: protects strong current candidates (`> 83.0`) and decent late-draft role-completing starters from reckless gambling.

---

## Dead Roll Recovery Rule (`canFreeRedraw` / `applyDraftRedraw`)

In rare late-draft states (approximately `0.034%` of drafts before Deadlock Safety v1), a team in `PICK` phase can encounter a **Dead Roll** — for example, rolling a single-year club (`ajax-2019` or `benfica-2014`) when only `FW` slots remain open, all `FW` players on that `TeamSeason` are already in the team's own roster, `league` and `club` rerolls are `0`, and `year` reroll cannot be used because the club has only one year in the dataset.

To guarantee `100%` draft completion for both humans and bots without altering normal draft strategy:

1. **Strict Eligibility (`canFreeRedraw(team)`)**:
   - `team.draft.phase === 'PICK'` (and not locked)
   - `!isRosterComplete(team)`
   - `getLegalPickActions(team).length === 0`
   - `getLegalRerollActions(team).length === 0`
2. **Recovery Rule**:
   - `0 legal pick + 0 legal reroll -> unlimited free full redraw until a legal action exists.`
   - Executing `applyDraftRedraw(state, actorId, teamSeasonId)` draws a fresh 3-stage uniform `League -> Club -> Year` `TeamSeason` (`generateInitialRollTeamSeason`), keeps `team.draft.phase === 'PICK'`, does **not** consume or grant any `rerolls.{league, club, year}`, does **not** modify `roster`, and records a `{ type: 'draft.redraw', actorId, actorName, club, year }` event in `team.draft.history`.
   - **Free Redraw is not a strategic reroll resource**: if even a single legal pick or legal reroll exists, `canFreeRedraw(team)` is `false` and `applyDraftRedraw` rejects the action.

---

## Strict No-Cheating Guarantee

The Bot Framework enforces fair play at the API boundary:
- **No Opponent State**: `chooseDraftAction` receives only the bot's own `team` state. It has no access to the opponent's blind draft roster or current roll.
- **No Future RNG Peeking**: Reroll decisions are made purely from the public dataset probability distribution before any reroll RNG is invoked.
- **No Hidden Stat Bonuses**: All difficulties operate under the exact same draft rules, roll probabilities, reroll counts, and Match Simulation v1 engine.

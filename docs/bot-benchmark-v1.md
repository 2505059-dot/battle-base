# Bot Framework v1 Benchmark Report (`bot-benchmark-v1`)

## 1. Benchmark Methodology

- **Base Seed**: `20261006`
- **Persona**: `neutral` (`NEUTRAL_PERSONA`)
- **Draft Quality & Match Benchmark**: `node scripts/benchmark-bots.mjs --runs=5000 --base-seed=20261006`
  - `5,000` paired draft environments per difficulty (`20,000` drafts total).
  - All 4 difficulties (`random`, `casual`, `smart`, `expert`) receive the exact same per-round initial `TeamSeason` roll stream for each seed `i`.
  - Head-to-Head Match Simulation v1 runs `2,500` paired seeds × `2` legs with **Seat Swap** (`~5,000` matches per pairing; `~20,000` matches total) so both bots play identical draft environments and identical Match Engine seats (`Team A` and `Team B`).
- **100,000-Draft Dead-Roll Simulation**: `node scripts/simulate-bot-drafts.mjs --runs=100000 --base-seed=20261006`
  - `25,000` complete draft attempts per difficulty (`100,000` total attempts) under unmodified production draft rules.

---

## 2. Draft Quality Summary (5,000 Runs per Difficulty)

| Metric | `random` | `casual` | `smart` | `expert` |
| :--- | :---: | :---: | :---: | :---: |
| **Runs** | 5,000 | 5,000 | 5,000 | 5,000 |
| **Completed** | 4,997 | 4,998 | 4,998 | 4,999 |
| **Stuck (Dead-Roll)** | 3 | 2 | 2 | 1 |
| **Completion Rate** | 99.94% | 99.96% | 99.96% | 99.98% |
| **Stuck Rate** | 0.06% | 0.04% | 0.04% | 0.02% |
| **Average Team Rating** | **83.20** | **86.26** | **86.63** | **86.69** |
| **Profile: `attack`** | 76.61 | 80.28 | 83.04 | **83.61** |
| **Profile: `creation`** | 78.75 | 82.35 | 82.99 | **82.99** |
| **Profile: `defense`** | 78.21 | 79.87 | **81.92** | 81.80 |
| **Profile: `physical`** | 76.98 | 77.97 | 80.85 | **81.26** |
| **Profile: `goalkeeping`** | 78.41 | 80.12 | 82.67 | **84.12** |
| **Profile: `overall`** | 83.20 | 86.26 | 86.63 | **86.69** |
| **Role Quality: `GK`** | 77.69 | 79.42 | 81.93 | **83.34** |
| **Role Quality: `DF`** | 79.33 | 81.13 | **82.46** | 82.40 |
| **Role Quality: `MF`** | 77.60 | 80.30 | 82.44 | **82.62** |
| **Role Quality: `FW`** | 78.70 | 82.07 | 84.30 | **84.69** |
| **Avg Decisions / Draft** | 25.17 | 24.29 | 24.78 | 25.38 |
| **Duplicate Violations** | 0 | 0 | 0 | 0 |
| **Invalid Actions** | 0 | 0 | 0 | 0 |

---

## 3. Reroll Usage & Over-Reroll Calibration Analysis

| Difficulty | Avg `league` Reroll | Avg `club` Reroll | Avg `year` Reroll | Avg Total Rerolls | Pre-Reroll Best Score | Post-Reroll Picked Score | Avg Net Gain from Reroll |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`random`** | 0.85 | 0.85 | 0.47 | 2.17 | 82.58 | 78.69 | **-3.89** |
| **`casual`** | 0.62 | 0.62 | 0.05 | 1.29 | 78.69 | 80.68 | **+1.99** |
| **`smart`** | 0.66 | 0.83 | 0.30 | 1.78 | 79.20 | 85.02 | **+5.82** |
| **`expert`** | 0.90 | 0.93 | 0.55 | 2.38 | 79.59 | 85.01 | **+5.42** |

- **No Over-Reroll in `smart` or `expert`**:
  - `random` rerolls blindly (`24%` chance), throwing away `82.58` candidates and ending up with `78.69` (`-3.89` net loss).
  - `smart` and `expert` only reroll when the current best pick is weak (`~79.2–79.6`) or when a high-EV club/year upgrade clears the opportunity cost, yielding a **`+5.42` to `+5.82` point upgrade** (`~79.6 -> ~85.0`) on rerolled rounds.

---

## 4. Head-to-Head Match Simulation v1 Benchmark (Seat Swapped)

Each pairing runs `~2,500` paired draft seeds × `2` legs (`Seat Normal` + `Seat Swapped`) = `~5,000` matches per pairing.

### Combined Results (Both Seats)

| Pairing (`Left vs Right`) | Total Matches | Left Win % | Draw % | Right Win % | Left Avg Goals | Right Avg Goals | Winner |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`random` vs `casual`** | 4,988 | 28.15% (1,404) | 24.62% (1,228) | **47.23%** (2,356) | 1.23 | **1.65** | **`casual` (+19.08%)** |
| **`casual` vs `smart`** | 4,984 | 32.00% (1,595) | 22.25% (1,109) | **45.75%** (2,280) | 1.28 | **1.59** | **`smart` (+13.75%)** |
| **`smart` vs `expert`** | 4,988 | 36.75% (1,833) | 23.60% (1,177) | **39.66%** (1,978) | 1.40 | **1.47** | **`expert` (+2.91%)** |
| **`expert` vs `random`** | 4,992 | **55.11%** (2,751) | 22.76% (1,136) | 22.14% (1,105) | **1.82** | 1.05 | **`expert` (+32.97%)** |

### Seat-Normal vs. Seat-Swapped Breakdown

| Pairing (`Left vs Right`) | Leg 1 (`Left=Team A, Right=Team B`) | Leg 2 (`Right=Team A, Left=Team B`) |
| :--- | :--- | :--- |
| **`random` vs `casual`** | Random 27.87% / Draw 24.26% / **Casual 47.87%** | Random 28.43% / Draw 24.98% / **Casual 46.59%** |
| **`casual` vs `smart`** | Casual 31.54% / Draw 22.99% / **Smart 45.47%** | Casual 32.46% / Draw 21.51% / **Smart 46.03%** |
| **`smart` vs `expert`** | Smart 36.85% / Draw 23.98% / **Expert 39.17%** | Smart 36.65% / Draw 23.22% / **Expert 40.14%** |
| **`expert` vs `random`** | **Expert 55.45%** / Draw 22.28% / Random 22.28% | **Expert 54.77%** / Draw 23.24% / Random 22.00% |

All pairings confirm a strict positive skill gradient across both seats:
$$\text{Expert} > \text{Smart} > \text{Casual} > \text{Random}$$

---

## 5. 100,000-Draft Dead-Roll / Stuck Analysis

Executed via `node scripts/simulate-bot-drafts.mjs --runs=100000 --base-seed=20261006` (`25,000` attempts per difficulty):

| Difficulty | Attempts | Completed | Stuck | Completion Rate | Stuck Rate | `no_legal_pick` | `no_reroll_remaining` | `duplicate_only` | `role_unavailable` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`random`** | 25,000 | 24,984 | 16 | 99.936% | **0.064%** | 16 | 16 | 16 | 0 |
| **`casual`** | 25,000 | 24,988 | 12 | 99.952% | **0.048%** | 12 | 12 | 12 | 0 |
| **`smart`** | 25,000 | 24,996 | 4 | 99.984% | **0.016%** | 4 | 4 | 4 | 0 |
| **`expert`** | 25,000 | 24,998 | 2 | 99.992% | **0.008%** | 2 | 2 | 2 | 0 |
| **Total** | **100,000** | **99,966** | **34** | **99.966%** | **0.034%** | **34** | **34** | **34** | **0** |

### Root Cause of Dead-Rolls (`duplicate_only`)

Every single observed deadlock (`34 / 100,000`, `0.034%` overall; `0.008%` for `expert`) occurs under the exact same structural condition:
1. The team is at Pick 10 or Pick 11 (`pickedCount` 9 or 10) with only `FW` (or a single scarce role) still open.
2. The 3-stage uniform roll lands on a `TeamSeason` from a small league / single-year club (most commonly `ajax-2019` in Eredivisie, `benfica-2014` or `porto-2004` in Primeira Liga, or `roma-2001`) for the **3rd time** in the same draft.
3. Both of that `TeamSeason`'s 2 forwards (`FW`) were already drafted into the team's roster on earlier rolls (`duplicate_only`).
4. Both `league` and `club` rerolls have already been used (`league: 0, club: 0`), and even if `year: 1` remains, single-year clubs (`ajax-2019`, `benfica-2014`, `porto-2004`, `roma-2001`) have no alternate year (`hasRerollOption(currentRoll, 'year') === false`).

### Reproducible Dead-Roll Seeds

1. **`seed = 2154022250` (`difficulty = 'random'`)**:
   - `pickedCount = 10`, `openRoles = ['FW']`, `currentTeamSeason = 'ajax-2019'`, `remainingRerolls = { league: 0, club: 0, year: 1 }`.
   - `ajax-2019-7 (Hakim Ziyech)` and `ajax-2019-8 (Dusan Tadic)` are already in `FW1` and `FW2`; `Ajax` has only 1 year (`2019`), so `year` reroll is unavailable.
2. **`seed = 2446731682` (`difficulty = 'casual'`)**:
   - `pickedCount = 10`, `openRoles = ['FW']`, `currentTeamSeason = 'ajax-2019'`, `remainingRerolls = { league: 0, club: 0, year: 1 }`.
   - `ajax-2019-7 (Hakim Ziyech)` and `ajax-2019-8 (Dusan Tadic)` were drafted earlier into `MF2` and `MF3`.
3. **`seed = 3503798806` (`difficulty = 'smart'`)**:
   - `pickedCount = 10`, `openRoles = ['FW']`, `currentTeamSeason = 'roma-2001'`, `remainingRerolls = { league: 0, club: 0, year: 1 }`.
   - `roma-2001-7 (Francesco Totti)` and `roma-2001-8 (Gabriel Batistuta)` are already in `MF2` and `FW2`; `Roma` has only 1 year (`2001`).
4. **`seed = 1764790880` (`difficulty = 'expert'`)**:
   - `pickedCount = 10`, `openRoles = ['FW']`, `currentTeamSeason = 'benfica-2014'`, `remainingRerolls = { league: 0, club: 0, year: 0 }`.
   - `benfica-2014-7 (Rodrigo)` and `benfica-2014-8 (Lima)` are already in `FW1` and `FW2`, and all 3 rerolls were already spent.
5. **`seed = 691322844` (`difficulty = 'expert'`)**:
   - `pickedCount = 10`, `openRoles = ['FW']`, `currentTeamSeason = 'porto-2004'`, `remainingRerolls = { league: 0, club: 0, year: 1 }`.
   - `porto-2004-7 (Benni McCarthy)` and `porto-2004-8 (Derlei)` are already in `FW1` and `FW2`; `Porto` has only 1 year (`2004`).

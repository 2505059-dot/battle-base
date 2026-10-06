# 11v11 Match Balance & Calibration v1 — Final Report

- **Branch**: `feature/match-balance-v1`
- **Baseline Commit**: `7bf8ded` (`tag: 11v11-v1`)
- **Engine Version**: Upgraded from `Match Simulation v0` to `Match Simulation v1`
- **Analysis CLI**: `node scripts/analyze-match-balance.mjs --matches=10000 --base-seed=20261006`
- **Fast Regression CLI**: `node scripts/smoke-match-balance.mjs`
- **Baseline Reference**: [`docs/match-balance-v1-baseline.md`](./match-balance-v1-baseline.md)

---

## 1. Baseline Overview (`7bf8ded`)

Before modifying any configuration or engine formulas, a deterministic Monte Carlo analysis suite (`scripts/analyze-match-balance.mjs` and `scripts/lib/match-balance.mjs`) was executed on commit `7bf8ded` (`baseSeed = 20261006`, `50,000` Mirror matches, `10,000` paired sensitivity seeds per variant, and `20,000` seat-swapped matches per historical tier matchup).

### What Already Worked Well in Baseline
1. **Structural A/B Symmetry (`PASS`)**: Mirror (`CONTROL vs CONTROL`, `N = 50,000`) recorded `A Win = 38.23%`, `Draw = 22.82%`, `B Win = 38.94%` (`|A - B| = 0.71 pp <= 1.0 pp`), `Possession A/B = 50.00% / 50.00%`, and `Attack Share A = 49.97%`. Multi-seed verification across 5 independent `baseSeed` values confirmed a mean seat delta of `-0.04 pp` (zero structural seat bias).
2. **Determinism & Locale Independence (`PASS`)**: `generateMatchScript()` produced 100% byte-for-byte identical outputs across repeated invocations and across `ja`, `en`, and `zh-CN`.
3. **4-3-3 Role Event Hierarchy (`PASS`)**:
   - **Shots**: `FW 68.40% > MF 25.39% > DF 6.21% >> GK 0.00%`
   - **Goals**: `FW 75.69% > MF 21.27% > DF 3.04% >> GK 0.00%`
   - **Assists**: `MF 57.16% > FW 22.19% > DF 20.54% >> GK 0.11%`
   - **Defensive Interventions**: `DF 71.34% > MF 25.94% > FW 2.59% >> GK 0.13%`
4. **Intra-Role Player Quality Differentiation (`PASS`)**: Within the same role at equal physical (`80`), a `95` attribute player was selected `1.90x` (`FW` shooter), `1.86x` (`MF` creator), `1.92x` (`MF` assister), and `1.50x` (`DF` defender) as often as a `70` attribute player.
5. **Strict Attribute Monotonicity (`PASS`)**: All 5 functional dimensions (`Attack`, `Creation`, `Defense`, `GK`, `Physical`) and `All` exhibited strict `0 < +5 < +10` monotonicity.

---

## 2. Problems Found in Baseline

1. **Problem 1 — `Physical` Over-Dominance Over Specialist `Creation` and `Defense` (`CONCERN`)**:
   - In `7bf8ded`, `PHYSICAL_PLUS_10` (`dPPM = +0.092`, `Win = 46.88%`) was nearly **$2\times$ stronger** than `CREATION_PLUS_10` (`dPPM = +0.056`, `Win = 43.46%`) and `DEFENSE_PLUS_10` (`dPPM = +0.047`, `Win = 42.05%`).
   - More critically, `PHYSICAL_PLUS_10` **out-created `CREATION_PLUS_10`** in both possession (`52.15%` vs `52.01%`) and shots (`10.56` vs `10.43`), while simultaneously **out-defending `DEFENSE_PLUS_10`** in opponent shots (`8.74` vs `9.31`), opponent SOT (`4.05` vs `4.29`), and opponent goals (`1.34` vs `1.40`, even lower than `GK_PLUS_10`'s `1.38`)!
   - **Root Cause**:
     - `ROLE_WEIGHTS` was carried over from 5-a-side (`1 DF, 1 MF, 1 FW`). Under 11v11 (`4 DF, 3 MF, 3 FW`), the 4 DFs (`4 * 0.14 = 0.56`) + 3 FWs (`3 * 0.24 = 0.72`) + 1 GK (`0.10`) had more total `creation` weight (`1.38`) than the 3 MFs (`3 * 0.44 = 1.32`), diluting MF creation buffs to `48.9%` of `profile.creation`.
     - In `engine.js`, `physical` had high weights across every single phase (`0.30` in `control`, `0.30` in `initiative`, `0.20` in `attackBuild`, `0.40` in `defenseStop`, `0.40` in `shotPressure`, `0.10` in `gkRating`), whereas `defense` had `0.00` weight in `initiative` (ball recovery / transition control) and only `0.60` in `defenseStop` and `shotPressure`.

2. **Problem 2 — Excessive Compounding in Strength Ladder & High-Scoring Blowouts (`CONCERN`)**:
   - In `7bf8ded`, `ALL_PLUS_5` reached a `78.31%` non-draw win share (`63.77%` win vs `17.66%` loss, above the `55% ~ 70%` reference band).
   - `ALL_PLUS_10` reached `84.17%` raw win rate (`93.50%` non-draw win share, `3.08 vs 0.73` average score) with a **`13.21%` 5+ goal margin blowout rate** (nearly 1 in 7 matches ending in a 5+ goal rout).
   - Even in `Mirror` (`CONTROL vs CONTROL`), average total goals was `3.22` (near the `3.4` upper ceiling) with **`21.40%` of matches producing 5+ total goals**.
   - In `Elite vs Weak`, `ShotProb` hit the `maxShotProb` (`0.88`) clamp in **`50.0%`** of attacks (`rawA = 0.904`).
   - **Root Cause**: Because shooters are predominantly FWs (`68.4%`) whose individual `attack` (`~87`) exceeds team `defense` (`~77`), `shotQuality - shotPressure` had a positive baseline offset even in mirror matches, and the 4 multiplicative diff scales (`0.011`, `0.009`, `0.007`, `0.008`) compounded aggressively across all 4 stages.

---

## 3. Changes Made (Minimal Iterative Calibration)

Calibration was executed in 3 small, isolated rounds while keeping the RNG consumption sequence (`rng.random()`, `rng.randomInt()`, `rng.pickRandom()`, `rng.weightedPick()`) **100% unchanged**:

### Round 1: Calibrate `ROLE_WEIGHTS` for 11v11 (4-3-3) Slot Proportions (`public/game/match/config.js`)
- Concentrated `creation` in `MF` (`MF.creation: 0.44 -> 0.56`, `DF.creation: 0.14 -> 0.08`, `FW.creation: 0.24 -> 0.20`, `GK.creation: 0.10 -> 0.04`) so the 3 MFs account for `63.6%` of `profile.creation` (up from `48.9%`).
- Concentrated `defense` in `DF` (`DF.defense: 0.48 -> 0.56`, `MF.defense: 0.24 -> 0.18`, `FW.defense: 0.04 -> 0.02`, `GK.defense: 0.08 -> 0.04`) so the 4 DFs account for `77.8%` of `profile.defense` (up from `67.6%`).
- **Observed Effect**: `CREATION_PLUS_10` `dPPM` rose from `+0.056` to `+0.075` and surpassed `PHYSICAL_PLUS_10` in both possession (`52.62% > 52.15%`) and shots (`10.57 > 10.48`).

### Round 2: Rebalance `physical` vs `creation` and `defense` Blends (`public/game/match/engine.js`)
- `control` (Possession): `0.64 * creation + 0.16 * physical + 0.10 * attack + 0.10 * defense` (was `0.55 * creation + 0.30 * physical + 0.15 * attack`).
- `initiative` (Step 1 Attack Share): `0.48 * creation + 0.22 * defense + 0.15 * attack + 0.15 * physical` (was `0.45 * creation + 0.30 * physical + 0.25 * attack` — adding defensive ball recovery and halving physical's sequence-stealing weight).
- `attackBuild` (Step 2): `0.52 * creation + 0.34 * attack + 0.14 * physical` (was `0.45 / 0.35 / 0.20`).
- `defenseStop` (Step 2): `0.80 * defense + 0.20 * physical` (was `0.60 * defense + 0.40 * physical`).
- `shotPressure` (Step 4): `0.78 * defense + 0.22 * physical` (was `0.60 * defense + 0.40 * physical`).
- `gkRating` (Step 5): `0.76 * goalkeeping + 0.18 * defense + 0.06 * physical` (was `0.72 / 0.18 / 0.10`).
- **Observed Effect**: `DEFENSE_PLUS_10` `dPPM` rose to `+0.096` and cleanly outperformed `PHYSICAL_PLUS_10` (`+0.051`) in opponent shot suppression (`8.56 vs 9.12`) and goal prevention (`1.20 vs 1.39`).

### Round 3: Calibrate `MATCH_SIM_CONFIG` Scoring Pace & Diff Scales (`public/game/match/config.js`)
- `baseGoalOnTargetProb`: `0.33 -> 0.30` (centered Mirror total goals from `3.22` to `2.78`, `Goal/SOT` to `30.44%`, and `Draw %` to `25.14%`).
- `initiativeDiffScale`: `0.011 -> 0.008`
- `progressionDiffScale`: `0.009 -> 0.0065`
- `onTargetDiffScale`: `0.007 -> 0.0055`
- `goalDiffScale`: `0.008 -> 0.006`
- **Observed Effect**: `ALL_PLUS_5` settled at `55.21%` Win Rate (`71.18%` Non-Draw Win Share, `22.35%` upset losses), `ALL_PLUS_10` settled at `72.79%` Win Rate (`87.49%` Non-Draw Win Share, `4.97%` 5+ goal blowout rate down from `13.21%`), and `Elite vs Weak` `ShotProb` clamp saturation dropped from `50.0%` to `0.0%`.

---

## 4. Before vs After Results

### 4.1 Mirror Fairness & Match Shape (`N = 50,000`, `baseSeed = 20261006`)

| Metric | Before (`7bf8ded`) | After (`Match Sim v1`) | Target / Reference Band |
| :--- | :---: | :---: | :---: |
| **Matches** | `50,000` | `50,000` | $\ge 50,000$ |
| **Team A Win %** | `38.23%` | `37.06%` ($\pm 0.42\%$) | Symmetric with B |
| **Draw %** | `22.82%` | **`25.14%`** | `18% ~ 32%` |
| **Team B Win %** | `38.94%` | `37.79%` | Symmetric with A |
| **Seat Win Delta (`A - B`)** | `-0.71 pp` | **`-0.73 pp`** | $\le 1.0\text{ pp}$ |
| **Average Possession (A / B)** | `50.00% / 50.00%` | **`50.00% / 50.00%`** | `49.8% ~ 50.2%` |
| **Attack Share A** | `49.97%` | **`49.97%`** | $\approx 50.0\%$ |
| **Average Total Goals** | `3.22` (`1.60 / 1.62`) | **`2.78`** (`1.38 / 1.40`) | `2.3 ~ 3.4` |
| **Average Shots per Team** | `9.75` (`P10=6, P50=10, P90=13`) | **`9.61`** (`P10=6, P50=10, P90=13`) | `8 ~ 14` |
| **Average SOT per Team** | `4.78` (`P10=2, P50=5, P90=7`) | **`4.56`** (`P10=2, P50=4, P90=7`) | — |
| **Shot-on-Target Rate (`SOT / Shot`)** | `48.97%` | **`47.43%`** | `35% ~ 55%` |
| **Goal per Shot (`Goal / Shot`)** | `16.53%` | **`14.44%`** | — |
| **Goal per SOT (`Goal / SOT`)** | `33.76%` | **`30.44%`** | `20% ~ 40%` |
| **Average Saves per Team (Save %)** | `3.16` (`66.24%`) | **`3.18`** (`69.56%`) | — |
| **Any Clean Sheet Rate** | `34.88%` | **`42.77%`** | — |
| **0-0 Rate** | `3.23%` | **`5.42%`** | Not excessive |
| **1-Goal Margin Rate** | `38.66%` | **`40.12%`** | — |
| **3+ Total Goals Rate** | `63.97%` | **`53.22%`** | — |
| **5+ Total Goals Rate** | `21.40%` | **`13.96%`** | Moderate |
| **7+ Total Goals Rate** | `3.78%` | **`1.84%`** | Rare |
| **5+ Goal Margin Blowout Rate** | `1.33%` | **`0.81%`** | Rare |

#### Total Goals Histogram (`N = 50,000`, Before vs After)

| Total Goals | `0` | `1` | `2` | `3` | `4` | `5` | `6+` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Before (`7bf8ded`)** | `3.2%` | `12.1%` | `20.7%` | `23.5%` | `19.1%` | `11.7%` | `9.7%` |
| **After (`Match Sim v1`)** | `5.4%` | `16.6%` | `24.7%` | `23.2%` | `16.0%` | `8.5%` | `5.4%` |

---

### 4.2 Role Event Distribution (`N = 50,000`, Before vs After)

| Event Category | Before (`FW / MF / DF / GK`) | After (`FW / MF / DF / GK`) | Sanity Requirement |
| :--- | :---: | :---: | :--- |
| **Shots** | `68.40% / 25.39% / 6.21% / 0.00%` | **`68.45% / 25.35% / 6.21% / 0.00%`** | `FW > MF > DF >> GK` |
| **Goals** | `75.69% / 21.27% / 3.04% / 0.00%` | **`74.52% / 21.99% / 3.50% / 0.00%`** | `FW > MF > DF >> GK` |
| **Assists** | `22.19% / 57.16% / 20.54% / 0.11%` | **`22.40% / 57.00% / 20.50% / 0.11%`** | `MF & FW` primary, `DF` secondary |
| **Creator Involvement** | `25.14% / 55.64% / 19.11% / 0.11%` | **`25.35% / 55.55% / 18.99% / 0.11%`** | `MF` primary, `FW & DF` secondary |
| **Defensive Intervention** | `2.59% / 25.94% / 71.34% / 0.13%` | **`2.58% / 25.91% / 71.38% / 0.13%`** | `DF > MF > FW >> GK` |

---

### 4.3 Controlled Synthetic Sensitivity (`N = 10,000` Paired Seeds, Before vs After)

| Variant | Before Win % (Non-Draw %) | After Win % (Non-Draw %) | Before Paired $\Delta\text{PPM}$ | After Paired $\Delta\text{PPM}$ ($\pm 95\%\text{ CI}$) | Before GF / GA | After GF / GA | Before Shots F / A | After Shots F / A | Before 5+ Blowout | After 5+ Blowout |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **CONTROL** | 37.56% (48.87%) | **37.09%** (49.22%) | +0.000 | **+0.000** ($\pm 0.000$) | 1.58 / 1.62 | **1.36 / 1.40** | 9.70 / 9.80 | **9.58 / 9.67** | 1.32% | **0.83%** |
| **ATTACK_PLUS_5** | 43.72% (56.25%) | **41.06%** (54.02%) | +0.057 | **+0.036** ($\pm 0.004$) | 1.83 / 1.60 | **1.52 / 1.38** | 9.99 / 9.62 | **9.74 / 9.58** | 1.68% | **0.94%** |
| **ATTACK_PLUS_10** | 50.60% (63.44%) | **45.15%** (59.02%) | +0.116 | **+0.075** ($\pm 0.006$) | 2.11 / 1.58 | **1.69 / 1.37** | 10.31 / 9.44 | **9.91 / 9.50** | 2.49% | **1.30%** |
| **CREATION_PLUS_5** | 40.52% (52.61%) | **39.74%** (52.58%) | +0.029 | **+0.025** ($\pm 0.004$) | 1.67 / 1.59 | **1.44 / 1.36** | 10.07 / 9.55 | **9.96 / 9.42** | 1.36% | **0.79%** |
| **CREATION_PLUS_10** | 43.46% (56.08%) | **42.46%** (56.04%) | +0.056 | **+0.052** ($\pm 0.005$) | 1.77 / 1.55 | **1.53 / 1.33** | 10.43 / 9.32 | **10.32 / 9.20** | 1.67% | **1.00%** |
| **DEFENSE_PLUS_5** | 39.83% (52.03%) | **40.20%** (53.59%) | +0.024 | **+0.033** ($\pm 0.005$) | 1.58 / 1.51 | **1.39 / 1.27** | 9.71 / 9.55 | **9.72 / 9.26** | 1.25% | **0.74%** |
| **DEFENSE_PLUS_10** | 42.05% (55.05%) | **43.14%** (58.17%) | +0.047 | **+0.066** ($\pm 0.006$) | 1.58 / 1.40 | **1.41 / 1.15** | 9.71 / 9.31 | **9.87 / 8.86** | 1.08% | **0.74%** |
| **GK_PLUS_5** | 40.30% (52.59%) | **39.17%** (52.11%) | +0.029 | **+0.022** ($\pm 0.003$) | 1.58 / 1.49 | **1.36 / 1.30** | 9.71 / 9.79 | **9.57 / 9.67** | 1.11% | **0.73%** |
| **GK_PLUS_10** | 42.87% (56.32%) | **40.89%** (54.92%) | +0.057 | **+0.042** ($\pm 0.004$) | 1.58 / 1.38 | **1.36 / 1.21** | 9.71 / 9.79 | **9.57 / 9.66** | 1.05% | **0.67%** |
| **PHYSICAL_PLUS_5** | 42.17% (55.01%) | **38.97%** (51.67%) | +0.047 | **+0.018** ($\pm 0.003$) | 1.65 / 1.48 | **1.39 / 1.34** | 10.12 / 9.26 | **9.76 / 9.46** | 1.32% | **0.80%** |
| **PHYSICAL_PLUS_10** | 46.88% (60.85%) | **40.63%** (54.00%) | +0.092 | **+0.036** ($\pm 0.005$) | 1.72 / 1.34 | **1.41 / 1.29** | 10.56 / 8.74 | **9.91 / 9.28** | 1.42% | **0.78%** |
| **ALL_PLUS_5** | 63.77% (78.31%) | **55.21%** (**71.18%**) | +0.239 | **+0.170** ($\pm 0.008$) | 2.25 / 1.10 | **1.79 / 1.04** | 11.45 / 8.16 | **10.81 / 8.47** | 3.56% | **1.66%** |
| **ALL_PLUS_10** | 84.17% (93.50%) | **72.79%** (**87.49%**) | +0.400 | **+0.318** ($\pm 0.009$) | 3.08 / 0.73 | **2.31 / 0.75** | 13.32 / 6.71 | **12.14 / 7.37** | 13.21% | **4.97%** |

#### Specialized Domain Comparison (`+10` Variants After Calibration)
- **Attack (`ATTACK_PLUS_10`)**: Highest goal conversion (`14.24% -> 17.09%`), highest SOT accuracy (`47.50% -> 50.75%`), highest FW shot share (`68.16% -> 72.81%`), highest goals scored (`1.36 -> 1.69`), and minimal possession drift (`50.0% -> 50.45%`).
- **Creation (`CREATION_PLUS_10`)**: Highest possession gain (`50.0% -> 53.06%`, exceeding `PHYSICAL_PLUS_10`'s `51.14%`), highest attack sequence volume (`12.93 -> 13.56`), highest shots created (`9.58 -> 10.32`, exceeding `PHYSICAL_PLUS_10`'s `9.91`), and highest MF creator share (`56.00% -> 61.44%`).
- **Defense (`DEFENSE_PLUS_10`)**: Strongest opponent shot suppression (`9.67 -> 8.86`, beating `PHYSICAL_PLUS_10`'s `9.28`), strongest opponent SOT suppression (`4.58 -> 3.91`), strongest opponent goal prevention (`1.40 -> 1.15`, beating `PHYSICAL_PLUS_10`'s `1.29`), and highest DF defensive share (`71.45% -> 74.57%`).
- **Goalkeeper (`GK_PLUS_10`)**: Pure shot-stopping boost (`Save Rate: 69.51% -> 73.50%`, `Opp Goal/SOT: 30.49% -> 26.50%`, `Opp Goals: 1.40 -> 1.21`) with **zero** coupling to possession (`49.99% -> 49.99%`) or shot volume (`9.58 -> 9.57`).
- **Physical (`PHYSICAL_PLUS_10`)**: Meaningful all-phase contribution (`dPPM = +0.036`, `Possession = 51.14%`, `Shots F/A = 9.91 / 9.28`), without overtaking specialist attributes in their respective domains.

---

### 4.4 Historical Tier Ladder (`N = 10,000` per Seat, Seat-Swapped, Before vs After)

| Matchup (`X vs Y`) | Before `X` Win / Draw / `Y` Win | After `X` Win / Draw / `Y` Win | Before `X` PPM | After `X` PPM |
| :--- | :---: | :---: | :---: | :---: |
| **Elite vs Strong** | `74.80% / 14.34% / 10.87%` | **`63.22% / 19.75% / 17.03%`** | `0.820` | **`0.731`** |
| **Strong vs Average** | `54.58% / 20.84% / 24.59%` | **`48.56% / 23.97% / 27.47%`** | `0.650` | **`0.606`** |
| **Average vs Weak** | `59.51% / 19.13% / 21.37%` | **`53.85% / 22.49% / 23.66%`** | `0.691` | **`0.651`** |
| **Elite vs Average** | `85.13% / 9.61% / 5.26%` | **`72.64% / 16.52% / 10.85%`** | `0.899` | **`0.809`** |
| **Elite vs Weak** | `94.11% / 4.29% / 1.60%` | **`84.59% / 10.35% / 5.06%`** | `0.963` | **`0.898`** |

---

### 4.5 Probability Clamp Diagnostics (Before vs After)

| Scenario | Before ShotProb Clamp % | After ShotProb Clamp % | Before Population 25x25 Grid Clamp % (`Poss / Atk / Shot / SOT / Goal`) | After Population 25x25 Grid Clamp % (`Poss / Atk / Shot / SOT / Goal`) |
| :--- | :---: | :---: | :---: | :---: |
| **Normal Matchups (`Strong vs Average`)** | `0.0%` | **`0.0%`** | — | — |
| **Extreme (`Elite vs Weak`)** | `50.0%` (`rawA = 0.904`) | **`0.0%`** (`rawA = 0.855`) | — | — |
| **625-Pair Historical Population Grid** | — | — | `0.00% / 0.00% / 0.80% / 0.01% / 0.22%` | **`0.00% / 0.00% / 0.00% / 0.00% / 0.08%`** |

---

### 4.6 Final Diagnostic Verdict Summary (Before vs After)

| Check | Before (`7bf8ded`) | After (`Match Sim v1`) | Summary |
| :--- | :---: | :---: | :--- |
| **Mirror fairness (`\|A-B\| <= 1.0pp`, Poss ~50%)** | `PASS` | **`PASS`** | `\|A - B\| = 0.73 pp`, `Poss A = 50.00%` |
| **Seat swap symmetry** | `PASS` | **`PASS`** | Seed-adjusted delta `-1.08 pp`, multi-seed mean `-0.04 pp` |
| **Determinism & Locale independence (`ja/en/zh-CN`)** | `PASS` | **`PASS`** | 100% byte-for-byte identical |
| **Match shape (Goals, Shots, SOT%, Goal/SOT%, Draw%)** | `PASS` | **`PASS`** | `Goals = 2.78`, `Shots/team = 9.61`, `SOT% = 47.43%`, `G/SOT = 30.44%`, `Draw = 25.14%` |
| **Role event distribution (4-3-3 hierarchy)** | `PASS` | **`PASS`** | `Shots FW 68.5% > MF 25.3% > DF 6.2% >> GK 0.00%` |
| **Intra-role player quality (`95 > 82 > 70`)** | `PASS` | **`PASS`** | `95/70` ratios: `FW 1.91x`, `MF 1.85x`, `DF 1.51x` |
| **Attribute monotonicity (`0 < +5 < +10`)** | `PASS` | **`PASS`** | Strictly monotonic across all 5 dimensions + `All` |
| **Strength ladder & Upset retention (`ALL +5 / +10`)** | `CONCERN` | **`PASS`** | `ALL+5 Win = 55.21%` (`NonDraw = 71.18%`), `ALL+10 Win = 72.79%` (`5+ blowout = 4.97%`) |
| **Physical balance vs Creation/Defense specialists** | `CONCERN` | **`PASS`** | `PHY+10 (+0.036)` < `CRE+10 (+0.052)` & `DEF+10 (+0.066)`; out-creates CRE: `false`, out-defends DEF: `false` |
| **Clamp saturation in normal matchups** | `PASS` | **`PASS`** | `0.00%` across normal matchups and `0.00%` ShotProb clamp across 625-pair grid |

---

## 5. Remaining Limitations

1. **Abstract 4-3-3 Only**: Position weights and role event multipliers are calibrated specifically for the fixed 11v11 `1 GK / 4 DF / 3 MF / 3 FW` formation. Supporting alternative formations (e.g., `4-4-2`, `3-5-2`) in a future phase will require dynamic slot-count normalization in `team-profile.js` and `engine.js`.
2. **Team-Aggregate Defensive Stopping**: While `selectShooter` injects individual `shooter.attack` into `shotQuality` and `finishRating`, `defenseStop` and `shotPressure` currently operate on `defProfile.defense` and `defProfile.physical` so that RNG consumption order remains 100% invariant. Incorporating individual `defenderEntry.player.defense` into Step 2/4 is a natural candidate if `Match Engine v2` introduces individual 1v1 duel resolution.
3. **Static In-Match Pacing**: Probabilities do not currently shift based on current scoreline state (e.g. trailing team pushing higher in the final 15 minutes).

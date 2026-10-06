# 11v11 Match Balance & Calibration v1 — Baseline Report

- **Baseline Commit**: `7bf8ded` (`tag: 11v11-v1`, `origin/main`)
- **Analysis Tool**: `node scripts/analyze-match-balance.mjs --matches=10000 --base-seed=20261006`
- **Deterministic Seed Strategy**: `seed_i = (20261006 + Math.imul(i + 1, 0x9e3779b1)) >>> 0`
- **Sample Sizes**:
  - Mirror Fairness & Role Distribution: `50,000` matches (`i = 0 .. 49999`)
  - Controlled Synthetic Sensitivity & Intra-Role Quality: `10,000` paired seeds (`i = 0 .. 9999`)
  - Seat Swap & Historical Ladder: `10,000` matches per seat (`20,000` total per pair)
  - Clamp Diagnostics: Named scenarios + `25 x 25 = 625` historical quantile matchup grid

---

## 1. Test Rosters & Team Profiles (Baseline `7bf8ded`)

Rosters are selected deterministically by sorting each role pool (`GK`, `DF`, `MF`, `FW`) across `TEAM_SEASONS` by role-functional score (`0.75 * roleWeightedScore + 0.25 * overall`) and picking unique players at fixed quantiles (`Elite = 0.00`, `Strong = 0.22`, `Average = 0.50`, `Weak = 0.88`). `Average` serves as the `CONTROL` and `Mirror` roster.

| Tier / Roster | OVR | ATK | CRE | DEF | PHY | GK | Lineup (1 GK / 4 DF / 3 MF / 3 FW) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Elite** (`q=0.00`) | 93.4 | 90.9 | 85.8 | 84.6 | 88.9 | 91.8 | `GK1`: Gianluigi Buffon (94), `DF1`: Alessandro Nesta (93), `DF2`: Lilian Thuram (92), `DF3`: Roberto Carlos (93), `DF4`: Jaap Stam (92), `MF1`: Zinedine Zidane (96), `MF2`: Pavel Nedved (94), `MF3`: Steven Gerrard (90), `FW1`: Thierry Henry (96), `FW2`: Francesco Totti (94), `FW3`: Raul (93) |
| **Strong** (`q=0.22`) | 87.4 | 83.7 | 81.0 | 79.5 | 79.4 | 81.3 | `GK1`: Manuel Neuer (89), `DF1`: Jorge Costa (86), `DF2`: Thiago Silva (85), `DF3`: Gerard Pique (86), `DF4`: Denis Irwin (86), `MF1`: Arjen Robben (84), `MF2`: Bernardo Silva (88), `MF3`: Luka Modric (89), `FW1`: David Villa (90), `FW2`: Dwight Yorke (89), `FW3`: Roy Makaay (89) |
| **Average / CONTROL** (`q=0.50`) | 84.9 | 79.9 | 77.3 | 77.1 | 76.9 | 80.1 | `GK1`: Samir Handanovic (86), `DF1`: Cafu (83), `DF2`: Lucas Hernandez (84), `DF3`: Kalidou Koulibaly (84), `DF4`: Pepe (86), `MF1`: Cesc Fabregas (85), `MF2`: Enzo Fernandez (81), `MF3`: Piotr Zielinski (83), `FW1`: Gonzalo Higuain (89), `FW2`: Romelu Lukaku (86), `FW3`: Karim Benzema (87) |
| **Weak** (`q=0.88`) | 81.3 | 73.9 | 78.7 | 67.1 | 74.3 | 77.0 | `GK1`: Roman Weidenfeller (83), `DF1`: Maxi Pereira (77), `DF2`: Paolo Maldini (82), `DF3`: Jerome Boateng (81), `DF4`: Pablo Zabaleta (78), `MF1`: Rodrigo Bentancur (79), `MF2`: Dusan Tadic (84), `MF3`: David Silva (88), `FW1`: Khvicha Kvaratskhelia (81), `FW2`: Luis Garcia (79), `FW3`: Rafael Leao (82) |

### Controlled Synthetic Variant Definitions (Clamped to `1..99` on Deep Clone of `CONTROL`)
- `ATTACK_PLUS_5` / `ATTACK_PLUS_10`: `FW1..FW3` `attack` `+5` / `+10`
- `CREATION_PLUS_5` / `CREATION_PLUS_10`: `MF1..MF3` `creation` `+5` / `+10`
- `DEFENSE_PLUS_5` / `CREATION_PLUS_10`: `DF1..DF4` `defense` `+5` / `+10`
- `GK_PLUS_5` / `GK_PLUS_10`: `GK1` `goalkeeping` `+5` / `+10`
- `PHYSICAL_PLUS_5` / `PHYSICAL_PLUS_10`: All 10 outfield players (`DF1..DF4`, `MF1..MF3`, `FW1..FW3`) `physical` `+5` / `+10`
- `ALL_PLUS_5` / `ALL_PLUS_10`: All 11 players (`GK1..FW3`) all 5 match dimensions (`attack`, `creation`, `defense`, `physical`, `goalkeeping`) `+5` / `+10`

---

## 2. Mirror Fairness & Baseline Match Shape (`N = 50,000`)

| Metric | Baseline Value (`7bf8ded`) | Target / Reference Band |
| :--- | :---: | :---: |
| **Matches** | `50,000` | $\ge 50,000$ |
| **Team A Win %** | `38.23%` (`19,117`) $\pm 0.43\%$ | Symmetric with B |
| **Draw %** | `22.82%` (`11,412`) | `18% ~ 32%` |
| **Team B Win %** | `38.94%` (`19,471`) | Symmetric with A |
| **Seat Win Delta (`A - B`)** | `-0.71 pp` | $\le 1.0\text{ pp}$ |
| **Points Per Match (Team A)** | `0.4965` ($\pm 0.0039$) | $\approx 0.5000$ |
| **Average Possession (A / B)** | `50.00% / 50.00%` | `49.8% ~ 50.2%` |
| **Attack Sequence Share (A)** | `49.97%` | $\approx 50.0\%$ |
| **Average Total Goals** | `3.22` (`A: 1.60, B: 1.62`) | `2.3 ~ 3.4` |
| **Average Shots (Total / Per Team)** | `19.50` (`A: 9.74, B: 9.76`) | `8 ~ 14` per team |
| **Average SOT (Total / Per Team)** | `9.55` (`A: 4.77, B: 4.78`) | — |
| **Shot-on-Target Rate (`SOT / Shot`)** | `48.97%` | `35% ~ 55%` |
| **Goal per Shot (`Goal / Shot`)** | `16.53%` | — |
| **Goal per SOT (`Goal / SOT`)** | `33.76%` | `20% ~ 40%` |
| **Average Saves (A / B)** | `3.16 / 3.16` (`66.11% / 66.37%` save rate) | — |
| **Clean Sheet Rate (A / B / Any)** | `18.94% / 19.17% / 34.88%` | — |
| **0-0 Rate** | `3.23%` | Not excessive |
| **1-Goal Margin Rate** | `38.66%` | — |
| **3+ Total Goals Rate** | `63.97%` | — |
| **5+ Total Goals Rate** | `21.40%` | — |
| **7+ Total Goals Rate** | `3.78%` | Rare |
| **5+ Goal Margin Blowout Rate** | `1.33%` | Rare |

### Distributions & Percentiles (`N = 50,000`)
- **Total Goals Histogram**:
  - `0 goals`: `3.23%`
  - `1 goal`: `12.11%`
  - `2 goals`: `20.69%`
  - `3 goals`: `23.50%`
  - `4 goals`: `19.07%`
  - `5 goals`: `11.71%`
  - `6+ goals`: `9.69%`
- **Team Shots Percentiles**: `P10 = 6`, `P25 = 8`, `P50 = 10`, `P75 = 11`, `P90 = 13`
- **Team SOT Percentiles**: `P10 = 2`, `P25 = 3`, `P50 = 5`, `P75 = 6`, `P90 = 7`
- **Possession A Percentiles**: `P10 = 48%`, `P25 = 49%`, `P50 = 50%`, `P75 = 51%`, `P90 = 52%`
- **Key Scorelines**:
  - `0-0`: `3.23%`
  - `1-0 / 0-1`: `12.11%` (`1-0`: `6.0%`, `0-1`: `6.1%`)
  - `1-1`: `10.36%`
  - `2-1 / 1-2`: `17.69%` (`2-1`: `9.0%`, `1-2`: `8.7%`)
  - `2-2`: `7.17%`
  - Top 10 Scorelines: `1-1 (10.4%)`, `2-1 (9.0%)`, `1-2 (8.7%)`, `2-2 (7.2%)`, `0-1 (6.1%)`, `1-0 (6.0%)`, `2-0 (5.2%)`, `0-2 (5.1%)`, `1-3 (4.9%)`, `3-1 (4.5%)`

---

## 3. Position & Intra-Role Event Distribution (`N = 50,000`)

### Role Event Share (4-3-3: 1 GK, 4 DF, 3 MF, 3 FW)

| Event Category | FW Share | MF Share | DF Share | GK Share | Total Events |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Shots** | `68.40%` | `25.39%` | `6.21%` | `0.00%` | `975,119` |
| **Goals** | `75.69%` | `21.27%` | `3.04%` | `0.00%` | `161,191` |
| **Assists** | `22.19%` | `57.16%` | `20.54%` | `0.11%` | `138,671` |
| **Creator Involvement (Build-up + Assist)** | `25.14%` | `55.64%` | `19.11%` | `0.11%` | `463,545` |
| **Build-up Creator (`attack` events)** | `26.39%` | `55.00%` | `18.50%` | `0.11%` | `324,874` |
| **Defensive Intervention (`attack` + blocked `shot`)** | `2.59%` | `25.94%` | `71.34%` | `0.13%` | `533,696` |

### Intra-Role Player Quality Differentiation (`N = 10,000`, Equal Physical `80`)

| Role & Test | Slot 1 (`95`) | Slot 2 (`82`) | Slot 3 (`82` or `70`) | Slot 4 (`70`) | `95 vs 70` Ratio |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **FW Shooter Share** (`ATK 95 / 82 / 70`) | `29.37%` | `21.56%` | `15.42%` (`70`) | — | **`1.90x`** |
| **MF Creator Share** (`CRE 95 / 82 / 70`) | `24.21%` | `17.79%` | `13.00%` (`70`) | — | **`1.86x`** |
| **MF Assist Share** (`CRE 95 / 82 / 70`) | `24.98%` | `17.93%` | `13.03%` (`70`) | — | **`1.92x`** |
| **DF Defender Share** (`DEF 95 / 82 / 82 / 70`) | `21.16%` | `17.20%` | `17.60%` (`82`) | `14.08%` (`70`) | **`1.50x`** |

---

## 4. Controlled Synthetic Sensitivity (`N = 10,000` Paired Seeds)

| Variant | Win % | Draw % | Loss % | Non-Draw Win % | PPM ($\pm 95\%\text{ CI}$) | Paired $\Delta\text{PPM}$ ($\pm 95\%\text{ CI}$) | Goals For / Against | Shots For / Against | SOT For / Against | Poss % | Save % | 5+ Blowout % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **CONTROL** | 37.56% | 23.15% | 39.29% | 48.87% | 0.491 ($\pm 0.009$) | +0.000 ($\pm 0.000$) | 1.58 / 1.62 | 9.70 / 9.80 | 4.75 / 4.81 | 50.0% | 66.2% | 1.32% |
| **ATTACK_PLUS_5** | 43.72% | 22.28% | 34.00% | 56.25% | 0.549 ($\pm 0.009$) | **+0.057** ($\pm 0.005$) | 1.83 / 1.60 | 9.99 / 9.62 | 5.10 / 4.73 | 50.3% | 66.2% | 1.68% |
| **ATTACK_PLUS_10** | 50.60% | 20.24% | 29.16% | 63.44% | 0.607 ($\pm 0.008$) | **+0.116** ($\pm 0.007$) | 2.11 / 1.58 | 10.31 / 9.44 | 5.48 / 4.64 | 50.7% | 66.1% | 2.49% |
| **CREATION_PLUS_5** | 40.52% | 22.98% | 36.50% | 52.61% | 0.520 ($\pm 0.009$) | **+0.029** ($\pm 0.004$) | 1.67 / 1.59 | 10.07 / 9.55 | 4.97 / 4.69 | 51.0% | 66.1% | 1.36% |
| **CREATION_PLUS_10** | 43.46% | 22.50% | 34.04% | 56.08% | 0.547 ($\pm 0.009$) | **+0.056** ($\pm 0.005$) | 1.77 / 1.55 | 10.43 / 9.32 | 5.17 / 4.58 | 52.0% | 66.1% | 1.67% |
| **DEFENSE_PLUS_5** | 39.83% | 23.45% | 36.72% | 52.03% | 0.516 ($\pm 0.009$) | **+0.024** ($\pm 0.004$) | 1.58 / 1.51 | 9.71 / 9.55 | 4.75 / 4.54 | 50.0% | 66.8% | 1.25% |
| **DEFENSE_PLUS_10** | 42.05% | 23.62% | 34.33% | 55.05% | 0.539 ($\pm 0.009$) | **+0.047** ($\pm 0.006$) | 1.58 / 1.40 | 9.71 / 9.31 | 4.75 / 4.29 | 50.0% | 67.3% | 1.08% |
| **GK_PLUS_5** | 40.30% | 23.37% | 36.33% | 52.59% | 0.520 ($\pm 0.009$) | **+0.029** ($\pm 0.003$) | 1.58 / 1.49 | 9.71 / 9.79 | 4.76 / 4.80 | 50.0% | 68.8% | 1.11% |
| **GK_PLUS_10** | 42.87% | 23.88% | 33.25% | 56.32% | 0.548 ($\pm 0.008$) | **+0.057** ($\pm 0.004$) | 1.58 / 1.38 | 9.71 / 9.79 | 4.75 / 4.79 | 50.0% | 71.3% | 1.05% |
| **PHYSICAL_PLUS_5** | 42.17% | 23.34% | 34.49% | 55.01% | 0.538 ($\pm 0.009$) | **+0.047** ($\pm 0.005$) | 1.65 / 1.48 | 10.12 / 9.26 | 4.97 / 4.42 | 51.1% | 66.6% | 1.32% |
| **PHYSICAL_PLUS_10** | 46.88% | 22.96% | 30.16% | 60.85% | 0.584 ($\pm 0.008$) | **+0.092** ($\pm 0.007$) | 1.72 / 1.34 | 10.56 / 8.74 | 5.17 / 4.05 | 52.1% | 67.1% | 1.42% |
| **ALL_PLUS_5** | 63.77% | 18.57% | 17.66% | 78.31% | 0.731 ($\pm 0.008$) | **+0.239** ($\pm 0.009$) | 2.25 / 1.10 | 11.45 / 8.16 | 5.99 / 3.72 | 53.7% | 70.4% | 3.56% |
| **ALL_PLUS_10** | 84.17% | 9.98% | 5.85% | 93.50% | 0.892 ($\pm 0.005$) | **+0.400** ($\pm 0.009$) | 3.08 / 0.73 | 13.32 / 6.71 | 7.44 / 2.81 | 57.5% | 74.1% | **13.21%** |

### Specialized Dimension Diagnostics (Baseline)
- **Attack (`+5 / +10`)**:
  - `Goal / Shot`: `16.30% -> 18.27% -> 20.45%`
  - `SOT %`: `48.96% -> 51.08% -> 53.11%`
  - `FW Shot Share`: `68.20% -> 70.65% -> 72.99%`
  - `Possession`: `49.99% -> 50.33% -> 50.68%` (minimal possession coupling)
- **Creation (`+5 / +10`)**:
  - `Possession`: `49.99% -> 50.98% -> 52.01%`
  - `Attack Sequences`: `12.93 -> 13.25 -> 13.57`
  - `Shots For`: `9.70 -> 10.07 -> 10.43`
  - `MF Creator Share`: `55.92% -> 58.85% -> 61.06%`
- **Defense (`+5 / +10`)**:
  - `Opponent Shots`: `9.80 -> 9.55 -> 9.31`
  - `Opponent SOT`: `4.81 -> 4.54 -> 4.29`
  - `Opponent Goals`: `1.62 -> 1.51 -> 1.40`
  - `DF Defensive Share`: `71.42% -> 72.95% -> 74.49%`
- **Goalkeeper (`+5 / +10`)**:
  - `Save Rate`: `66.25% -> 68.84% -> 71.30%`
  - `Opponent Goal / SOT`: `33.75% -> 31.16% -> 28.70%`
  - `Opponent Goals`: `1.62 -> 1.49 -> 1.38`
  - `Possession`: `49.99% -> 49.99% -> 49.99%` (0.00% coupling)
  - `Shots For`: `9.70 -> 9.71 -> 9.71`
- **Physical (`+5 / +10`)**:
  - `Possession`: `49.99% -> 51.07% -> 52.15%` (exceeds `CREATION_PLUS_10`!)
  - `Shots For / Against`: `9.70 / 9.80 -> 10.12 / 9.26 -> 10.56 / 8.74` (creates more shots than `CREATION_PLUS_10` and suppresses more opponent shots than `DEFENSE_PLUS_10`!)
  - `Goals For / Against`: `1.58 / 1.62 -> 1.65 / 1.48 -> 1.72 / 1.34` (suppresses more opponent goals than `DEFENSE_PLUS_10` and `GK_PLUS_10`!)

---

## 5. Seat Swap & Historical Ladder (`N = 10,000` per Seat)

| Matchup (`X vs Y`) | `X` Overall Win % | `X as A` Win % | `X as B` Win % | Draw % | `Y` Overall Win % | `X` Overall PPM | Raw Seat Delta (`A - B`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Elite vs Strong** | `74.80%` | `74.41%` | `75.19%` | `14.34%` | `10.87%` | `0.820` | `-0.78 pp` |
| **Strong vs Average** | `54.58%` | `53.69%` | `55.47%` | `20.84%` | `24.59%` | `0.650` | `-1.78 pp` (Seed-adj: `-0.05 pp`) |
| **Average vs Weak** | `59.51%` | `58.92%` | `60.10%` | `19.13%` | `21.37%` | `0.691` | `-1.18 pp` |
| **Elite vs Average** | `85.13%` | `85.01%` | `85.26%` | `9.61%` | `5.26%` | `0.899` | `-0.25 pp` |
| **Elite vs Weak** | `94.11%` | `94.08%` | `94.14%` | `4.29%` | `1.60%` | `0.963` | `-0.06 pp` |

---

## 6. Probability Clamp Diagnostics (Baseline `7bf8ded`)

| Scenario | Possession Clamp % | Attack Share Clamp % (`raw`) | Shot Prob Clamp % (`rawA / rawB`) | SOT Prob Clamp % | Goal/SOT Clamp % |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Mirror (`CONTROL vs CONTROL`)** | `0.0%` | `0.0%` (`0.500`) | `0.0%` (`0.750 / 0.750`) | `0.0%` | `0.0%` |
| **Attack +10 vs CONTROL** | `0.0%` | `0.0%` (`0.517`) | `0.0%` (`0.770 / 0.750`) | `0.0%` | `0.0%` |
| **Creation +10 vs CONTROL** | `0.0%` | `0.0%` (`0.524`) | `0.0%` (`0.770 / 0.750`) | `0.0%` | `0.0%` |
| **Defense +10 vs CONTROL** | `0.0%` | `0.0%` (`0.500`) | `0.0%` (`0.750 / 0.714`) | `0.0%` | `0.0%` |
| **GK +10 vs CONTROL** | `0.0%` | `0.0%` (`0.500`) | `0.0%` (`0.750 / 0.750`) | `0.0%` | `0.6%` |
| **Physical +10 vs CONTROL** | `0.0%` | `0.0%` (`0.532`) | `0.0%` (`0.767 / 0.715`) | `0.0%` | `0.0%` |
| **All +5 vs CONTROL** | `0.0%` | `0.0%` (`0.555`) | `0.0%` (`0.795 / 0.705`) | `0.0%` | `0.0%` |
| **All +10 vs CONTROL** | `0.0%` | `0.0%` (`0.610`) | `0.0%` (`0.840 / 0.660`) | `0.0%` | `2.1%` |
| **Elite vs Strong** | `0.0%` | `0.0%` (`0.575`) | `0.0%` (`0.819 / 0.698`) | `0.0%` | `1.3%` |
| **Strong vs Average** | `0.0%` | `0.0%` (`0.537`) | `0.0%` (`0.781 / 0.728`) | `0.0%` | `0.0%` |
| **Average vs Weak** | `0.0%` | `0.0%` (`0.518`) | `0.0%` (`0.813 / 0.732`) | `0.0%` | `0.0%` |
| **Elite vs Average** | `0.0%` | `0.0%` (`0.612`) | `0.0%` (`0.841 / 0.666`) | `0.0%` | `2.1%` |
| **Elite vs Weak** | `0.0%` | `0.0%` (`0.630`) | `50.0%` (`0.904 / 0.648`) | `0.0%` | `1.4%` |
| **Population 25x25 Grid (`625` pairs)** | `0.00%` | `0.00%` | `0.80%` | `0.01%` | `0.22%` |

---

## 7. Baseline Diagnostic Summary (`PASS` / `CONCERN` / `FAIL`)

| Diagnostic Check | Verdict | Baseline Observation |
| :--- | :---: | :--- |
| **Mirror fairness (`\|A-B\| <= 1.0pp`, Poss ~50%)** | **PASS** | `\|A - B\| = 0.71 pp` (`38.23%` vs `38.94%`), `Possession A = 50.00%` |
| **Seat swap symmetry (`Strong vs Average`)** | **PASS** | Seed-adjusted delta = `-0.05 pp` (no structural A/B bias) |
| **Determinism & Locale independence (`ja/en/zh-CN`)** | **PASS** | 100% byte-for-byte identical across runs and locales |
| **Role event distribution (4-3-3 hierarchy)** | **PASS** | Shots `FW 68.4% > MF 25.4% > DF 6.2% >> GK 0.00%`; Def `DF 71.3% > MF 25.9% > FW 2.6% >> GK 0.13%` |
| **Intra-role player quality (`95 > 82 > 70`)** | **PASS** | `95/70` ratios: `FW 1.90x`, `MF cre 1.86x`, `MF ast 1.92x`, `DF def 1.50x` |
| **Attribute monotonicity (`0 < +5 < +10`)** | **PASS** | Strictly monotonic across `Attack`, `Creation`, `Defense`, `GK`, `Physical`, and `All` |
| **Clamp saturation in normal matchups** | **PASS** | `0.00%` in `Strong vs Average`; `< 1%` across 625-pair population grid |
| **Physical sensitivity vs Specialist attributes** | **CONCERN** | `PHYSICAL_PLUS_10` (`dPPM = +0.092`) is nearly $2\times$ stronger than `CREATION_PLUS_10` (`+0.056`) and `DEFENSE_PLUS_10` (`+0.047`), out-creating `CREATION_PLUS_10` in both possession (`52.15% > 52.01%`) and shots (`10.56 > 10.43`) while out-defending `DEFENSE_PLUS_10` in opponent shots (`8.74 < 9.31`) and opponent goals (`1.34 < 1.40`) |
| **Strength ladder & Upset retention (`ALL +5 / +10`)** | **CONCERN** | `ALL_PLUS_5` non-draw win tendency is `78.31%` (above `55% ~ 70%` reference band); `ALL_PLUS_10` produces a `13.21%` 5+ goal blowout rate (e.g. 5-0, 6-0, 6-1) and `93.50%` non-draw win share (`Elite vs Average` leaves only `5.26%` upset wins) |
| **Match shape scoring pace** | **PASS (Upper-Edge)** | Total goals `3.22` (`5+ goals = 21.40%`) is inside `2.3 ~ 3.4` but near the upper ceiling (`3.4`), contributing to frequent high-scoring blowouts when one team has an edge |

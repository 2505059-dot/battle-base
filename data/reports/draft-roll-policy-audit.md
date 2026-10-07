# Draft Roll Policy v2 Audit Report

- **Policy Version**: `teamseason-semantic-v2`
- **Dataset Counts**:
  - **TeamSeasons**: 62
  - **Leagues**: 7
  - **Clubs**: 28

---

## 1. Initial Roll Policy Comparison: v1 vs v2

Under Draft Roll Policy v1, roll generation was structured hierarchically:
$$\text{League uniform} \rightarrow \text{Club uniform within League} \rightarrow \text{Year uniform within Club}$$
This caused severe probability distortion, over-weighting isolated single-team clubs in small leagues (e.g. Porto 2004, Benfica 2014 at ~7.14%) and penalizing prominent clubs in large leagues (e.g. Real Madrid 2002 at ~0.57%).

Draft Roll Policy v2 replaces this with a strictly balanced, uniform TeamSeason distribution:
$$P(\text{TeamSeason}_i) = \frac{1}{N} = \frac{1}{62} \approx 1.612903\%$$

| Metric | Old Policy (v1) | New Policy (v2) | Status |
| :--- | :--- | :--- | :--- |
| **Formula** | $1/(L \times C_L \times Y_C)$ | $1/N$ | Strictly Balanced |
| **Min Probability** | 0.446429% (`1/224`) | 1.612903% (`1/62`) | **+261% boost for dense clubs** |
| **Max Probability** | 7.142857% (`1/14`) | 1.612903% (`1/62`) | **-77.4% nerf for isolated clubs** |
| **Max / Min Ratio** | **16.0x** | **1.0x** | **Variance eliminated** |
| **Probability Sum** | 1.000000 | 1.000000 | Normalized (1.0) |

---

## 2. Regression Highlights

| TeamSeason | League | Old Prob (v1) | New Prob (v2) | Impact / Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `porto-2004` | Primeira Liga | 7.142857% | 1.612903% | Overrepresentation corrected (0.23x) |
| `benfica-2014` | Primeira Liga | 7.142857% | 1.612903% | Overrepresentation corrected (0.23x) |
| `monaco-2017` | Ligue 1 | 7.142857% | 1.612903% | Overrepresentation corrected (0.23x) |
| `ajax-2019` | Eredivisie | 7.142857% | 1.612903% | Overrepresentation corrected (0.23x) |
| `real-madrid-2002` | La Liga | 0.571429% | 1.612903% | Underrepresentation corrected (2.82x) |
| `manchester-united-2008` | Premier League | 0.595238% | 1.612903% | Underrepresentation corrected (2.71x) |

---

## 3. Semantic Dice Availability Audit across 62 TeamSeasons

### 3.1 League Die (`rerollType === 'league'`)
- **Semantic Definition**: Change league, preserve era as closely as possible (nearest year across other leagues, maximum allowed drift $\le 3$ years).
- **Exact same-year available (`distance === 0`)**: **55 / 62** (88.71%)
- **Within ±1 year (`distance <= 1`)**: **62 / 62** (100.00%)
- **Within ±3 years (Final Availability)**: **62 / 62** (100.00%)
- **Max observed fallback distance**: **1 year** (League Die is 100% available across all 62 TeamSeasons).

### 3.2 Club Die (`rerollType === 'club'`)
- **Semantic Definition**: Keep league, change club, preserve era as closely as possible (nearest year across other clubs in same league, maximum allowed drift $\le 3$ years).
- **Exact same-year available (`distance === 0`)**: **16 / 62** (25.81%)
- **Within ±1 year (`distance <= 1`)**: **44 / 62** (70.97%)
- **Within ±2 years (`distance <= 2`)**: **50 / 62** (80.65%)
- **Within ±3 years (Final Availability)**: **54 / 62** (87.10%)
- **Unavailable (`distance > 3` or no other club in league)**: **8 / 62** (12.90%)

#### Unavailable TeamSeasons for Club Die (8 total):
| TeamSeason | League | Nearest Other-Club Season Distance | Rationale |
| :--- | :--- | :--- | :--- |
| `manchester-united-1999` | Premier League | 5 years | Exceeds drift cap (\le 3) |
| `bayern-munich-2001` | Bundesliga | 12 years | Exceeds drift cap (\le 3) |
| `monaco-2017` | Ligue 1 | 4 years | Exceeds drift cap (\le 3) |
| `lille-2021` | Ligue 1 | 4 years | Exceeds drift cap (\le 3) |
| `ajax-2019` | Eredivisie | 14 years | Exceeds drift cap (\le 3) |
| `psv-2005` | Eredivisie | 14 years | Exceeds drift cap (\le 3) |
| `porto-2004` | Primeira Liga | 10 years | Exceeds drift cap (\le 3) |
| `benfica-2014` | Primeira Liga | 10 years | Exceeds drift cap (\le 3) |

### 3.3 Season Die (`rerollType === 'year'`)
- **Semantic Definition**: Keep club identity, change era/season (uniform over all other season years of that club, no ±3 cap).
- **Available Count**: **46 / 62** (74.19%)
- **Unavailable Count (Single-Season Clubs)**: **16 / 62** (25.81%)
- **Single-Season Clubs (16)**: Leicester City, Valencia, Deportivo La Coruna, Atletico Madrid, Napoli, Roma, Lazio, Parma, Atalanta, Bayer Leverkusen, Monaco, Lille, Ajax, PSV, Porto, Benfica

---

## 4. Verification Conclusion

- All 62 TeamSeasons achieve mathematically uniform initial roll likelihood.
- Dice fallback preserves era coherence with deterministic ordering.
- Unavailable dice options are cleanly detected with zero runtime deadlock risks.

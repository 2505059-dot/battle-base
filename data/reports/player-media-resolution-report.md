# Player Media Resolution Report (v1)

- **Schema Version**: `1.0.0`
- **Policy Version**: `availability-v1`
- **Total PlayerSeasons**: **554**
- **Total Player Entities**: **418**
- **External Media Resolved**: **549 / 554 (99.1%)**
- **Local Silhouette Fallback**: **5 / 554 (0.9%)**
- **Manual Overrides Active**: **0**
- **Runtime Index Coverage**: **554 / 554 (100%)**

## 1. Resolution Type Distribution

| Resolution Type | Provider | Count | Percentage |
| :--- | :--- | ---: | ---: |
| `fifaindex-exact-year` | `fifaindex-current` | 454 | 81.9% |
| `fifaindex-nearest-year` | `fifaindex-current` | 90 | 16.2% |
| `fo3-supplemental` | `fifaaddict-fo3` | 4 | 0.7% |
| `fo4-supplemental` | `fifaaddict-fo4` | 1 | 0.2% |
| `silhouette` | `local-fallback` | 5 | 0.9% |
| **Total** | — | **554** | **100.0%** |

## 2. Provider Distribution

| Provider | Count |
| :--- | ---: |
| `fifaindex-current` | 544 |
| `fifaaddict-fo3` | 4 |
| `fifaaddict-fo4` | 1 |
| `local-fallback` | 5 |

## 3. Nearest-Year Distance Distribution (90 PlayerSeasons)

- **Total Nearest-Year Resolutions**: 90
- **Min Distance**: 1 year(s)
- **Max Distance**: 6 year(s)

| Year Distance (`|sourceYear - targetYear|`) | PlayerSeason Count |
| :--- | ---: |
| 1 year(s) | 28 |
| 2 year(s) | 9 |
| 3 year(s) | 8 |
| 4 year(s) | 15 |
| 5 year(s) | 15 |
| 6 year(s) | 15 |

## 4. Supplemental & Fallback Fixtures

### FO3 Supplemental (4 PlayerSeasons)

- `bayern-munich-2001-5` — **Stefan Effenberg** (Bayern Munich 2001) -> `https://fifaaddict.com/fo3img/players/p215558.png?2018`
- `manchester-united-1999-0` — **Peter Schmeichel** (Manchester United 1999) -> `https://fifaaddict.com/fo3img/players/p190053.png?2018`
- `manchester-united-1999-3` — **Denis Irwin** (Manchester United 1999) -> `https://fifaaddict.com/fo3img/players/p55053019.png?2018`
- `real-madrid-2002-2` — **Fernando Hierro** (Real Madrid 2002) -> `https://fifaaddict.com/fo3img/players/p93161840.png?2018`

### FO4 Supplemental (1 PlayerSeason)

- `roma-2001-8` — **Gabriel Batistuta** (Roma 2001) -> `https://s1.fifaaddict.com/fo4/players/wbgmlgqd.png?20260720`

### Silhouette Fallback (5 PlayerSeasons)

- `deportivo-la-coruna-2000-0` — **Jacques Songo'o** (`jacques-songo-o`, Deportivo La Coruna 2000) -> `/assets/player-silhouette.svg`
- `deportivo-la-coruna-2000-2` — **Donato** (`donato`, Deportivo La Coruna 2000) -> `/assets/player-silhouette.svg`
- `lazio-2000-8` — **Roberto Mancini** (`roberto-mancini`, Lazio 2000) -> `/assets/player-silhouette.svg`
- `parma-1999-6` — **Diego Fuser** (`diego-fuser`, Parma 1999) -> `/assets/player-silhouette.svg`
- `roma-2001-0` — **Francesco Antonioli** (`francesco-antonioli`, Roma 2001) -> `/assets/player-silhouette.svg`

## 5. Multi-Provider Availability (Future Quality Resolver v2 Context)

- **Entities with Reliable Media in >= 2 Providers**: 358
- **Entities with Reliable Media in All 3 Providers (FIFAIndex + FO3 + FO4)**: 294


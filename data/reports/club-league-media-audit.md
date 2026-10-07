# Club & League Media Audit Report v1

Comprehensive multi-provider media audit covering all 28 Club Entities and 7 League Entities (35 entities total).

## 1. Summary Metrics

| Metric | Value |
| :--- | :--- |
| **Club Entities Total** | 28 |
| **Club Preferred Reachable** | 28 (100.0%) |
| **League Entities Total** | 7 |
| **League Preferred Reachable** | 7 (100.0%) |
| **Total Entities** | 35 |
| **Total Preferred Reachable** | 35 (100.0%) |
| **Duplicate Preferred URLs** | 0 |
| **Transparent Alpha Verified** | 35 / 35 |
| **Manual Review Queue Size** | 4 |
| **Placeholder Rejected Count** | 0 |
| **Blocked Count** | 0 |
| **HTTP Error Count** | 0 |

## 2. FIFAIndex Priority & Single-Source Coverage

| Dimension | Count |
| :--- | :--- |
| **FIFAIndex Club Matched** | 28 / 28 |
| **FIFAIndex League Matched** | 7 / 7 |
| **FIFAIndex Total Entities** | 35 / 35 |
| **FIFAIndex Reachable (HTTP 200)** | 35 |
| **FIFAIndex 404 Not Found** | 0 |
| **FIFAIndex Identity Unresolved** | 0 |
| **Fallback Required (Unlicensed EA FC Badges)** | 4 |
| **Historical Asset Pattern Observed** | Yes (`fc24` / `fifa23` / `fifa22`) |

> **Note on Historical Pattern**: Historical FIFA team crests were verified on `images.fifaindex.com` under `/fc24/teams/{id}.webp`, `/fifa23/teams/{id}.webp`, and `/fifa22/teams/{id}.png`.

## 3. Provider Distribution

### 3.1 Preferred Assets

| Provider | Preferred Count | Share |
| :--- | :--- | :--- |
| `fifaindex` | 31 | 88.6% |
| `football-data` | 4 | 11.4% |

### 3.2 All Candidates Discovered

| Provider | Candidate Count |
| :--- | :--- |
| `football-data` | 58 |
| `wikimedia-commons` | 39 |
| `fifaindex` | 35 |
| `thesportsdb` | 34 |
| `wikipedia` | 23 |

## 4. Format & License Breakdown

| Format | Preferred Count |
| :--- | :--- |
| `image/svg+xml` | 4 |
| `image/webp` | 31 |
| `image/png` | 0 |
| `image/jpeg` | 0 |

| License Classification | Count |
| :--- | :--- |
| `external-provider` | 35 |
| `verified-free` | 0 |
| `unknown` | 0 |

## 5. Manual Review Queue

| Entity ID | Canonical Name | Selected Candidate | Reason |
| :--- | :--- | :--- | :--- |
| `ac-milan` | AC Milan | [Image URL](https://crests.football-data.org/98.svg) | Selected authentic vector SVG crest fallback over EA FC generic unlicensed shield (unlicensed generic shield in EA FC) |
| `atalanta` | Atalanta | [Image URL](https://crests.football-data.org/102.svg) | Selected authentic vector SVG crest fallback over EA FC generic unlicensed shield (unlicensed generic shield in EA FC) |
| `inter-milan` | Inter Milan | [Image URL](https://crests.football-data.org/108.svg) | Selected authentic vector SVG crest fallback over EA FC generic unlicensed shield (unlicensed generic shield in EA FC) |
| `lazio` | Lazio | [Image URL](https://crests.football-data.org/110.svg) | Selected authentic vector SVG crest fallback over EA FC generic unlicensed shield (unlicensed generic shield in EA FC) |

## 6. Per-Entity Audit Table

| Entity ID | Canonical Name | Selected Provider | Selected URL | Source Page | Format | Resolution | License Status | Alternative Candidate Count | Review Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ac-milan` | AC Milan | `football-data` | [Asset](https://crests.football-data.org/98.svg) | [Source](https://www.football-data.org/) | `image/svg+xml` | 200x200 | `external-provider` | 4 | manual-review |
| `ajax` | Ajax | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/245.webp) | [Source](https://www.fifaindex.com/team/245/ajax/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `arsenal` | Arsenal | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/1.webp) | [Source](https://www.fifaindex.com/team/1/arsenal/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `atalanta` | Atalanta | `football-data` | [Asset](https://crests.football-data.org/102.svg) | [Source](https://www.football-data.org/) | `image/svg+xml` | 200x200 | `external-provider` | 5 | manual-review |
| `atletico-madrid` | Atletico Madrid | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/240.webp) | [Source](https://www.fifaindex.com/team/240/atletico-de-madrid/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `barcelona` | Barcelona | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/241.webp) | [Source](https://www.fifaindex.com/team/241/fc-barcelona/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `bayer-leverkusen` | Bayer Leverkusen | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/32.webp) | [Source](https://www.fifaindex.com/team/32/bayer-04-leverkusen/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `bayern-munich` | Bayern Munich | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/21.webp) | [Source](https://www.fifaindex.com/team/21/bayern-munchen/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `benfica` | Benfica | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/234.webp) | [Source](https://www.fifaindex.com/team/234/benfica/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `borussia-dortmund` | Borussia Dortmund | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/22.webp) | [Source](https://www.fifaindex.com/team/22/borussia-dortmund/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `chelsea` | Chelsea | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/5.webp) | [Source](https://www.fifaindex.com/team/5/chelsea/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `deportivo-la-coruna` | Deportivo La Coruna | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/242.webp) | [Source](https://www.fifaindex.com/team/242/rc-deportivo/) | `image/webp` | 256x256 | `external-provider` | 2 | verified |
| `inter-milan` | Inter Milan | `football-data` | [Asset](https://crests.football-data.org/108.svg) | [Source](https://www.football-data.org/) | `image/svg+xml` | 200x200 | `external-provider` | 4 | manual-review |
| `juventus` | Juventus | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/45.webp) | [Source](https://www.fifaindex.com/team/45/juventus/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `lazio` | Lazio | `football-data` | [Asset](https://crests.football-data.org/110.svg) | [Source](https://www.football-data.org/) | `image/svg+xml` | 200x200 | `external-provider` | 6 | manual-review |
| `leicester-city` | Leicester City | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/95.webp) | [Source](https://www.fifaindex.com/team/95/leicester-city/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `lille` | Lille | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/65.webp) | [Source](https://www.fifaindex.com/team/65/losc-lille/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `liverpool` | Liverpool | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/9.webp) | [Source](https://www.fifaindex.com/team/9/liverpool/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `manchester-city` | Manchester City | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/10.webp) | [Source](https://www.fifaindex.com/team/10/manchester-city/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `manchester-united` | Manchester United | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/11.webp) | [Source](https://www.fifaindex.com/team/11/manchester-united/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `monaco` | Monaco | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/69.webp) | [Source](https://www.fifaindex.com/team/69/as-monaco/) | `image/webp` | 256x256 | `external-provider` | 3 | verified |
| `napoli` | Napoli | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/48.webp) | [Source](https://www.fifaindex.com/team/48/napoli/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `parma` | Parma | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/50.webp) | [Source](https://www.fifaindex.com/team/50/parma/) | `image/webp` | 256x256 | `external-provider` | 3 | verified |
| `porto` | Porto | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/236.webp) | [Source](https://www.fifaindex.com/team/236/fc-porto/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `psv` | PSV | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/247.webp) | [Source](https://www.fifaindex.com/team/247/psv/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `real-madrid` | Real Madrid | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/243.webp) | [Source](https://www.fifaindex.com/team/243/real-madrid/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `roma` | Roma | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/52.webp) | [Source](https://www.fifaindex.com/team/52/roma/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `valencia` | Valencia | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/teams/461.webp) | [Source](https://www.fifaindex.com/team/461/valencia-cf/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `bundesliga` | Bundesliga | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/19.webp) | [Source](https://www.fifaindex.com/leagues/19-germany-1-bundesliga-1/) | `image/webp` | 256x256 | `external-provider` | 7 | verified |
| `eredivisie` | Eredivisie | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/10.webp) | [Source](https://www.fifaindex.com/leagues/10-holland-eredivisie-1/) | `image/webp` | 256x256 | `external-provider` | 3 | verified |
| `la-liga` | La Liga | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/53.webp) | [Source](https://www.fifaindex.com/leagues/53-spain-primera-division-1/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `ligue-1` | Ligue 1 | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/16.webp) | [Source](https://www.fifaindex.com/leagues/16-france-ligue-1-1/) | `image/webp` | 256x256 | `external-provider` | 5 | verified |
| `premier-league` | Premier League | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/13.webp) | [Source](https://www.fifaindex.com/leagues/13-england-premier-league-1/) | `image/webp` | 256x256 | `external-provider` | 6 | verified |
| `primeira-liga` | Primeira Liga | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/308.webp) | [Source](https://www.fifaindex.com/leagues/308-portugal-primeira-liga-1/) | `image/webp` | 256x256 | `external-provider` | 4 | verified |
| `serie-a` | Serie A | `fifaindex` | [Asset](https://images.fifaindex.com/fc27/leagues/31.webp) | [Source](https://www.fifaindex.com/leagues/31-italy-serie-a-1/) | `image/webp` | 256x256 | `external-provider` | 6 | verified |


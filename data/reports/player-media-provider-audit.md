# Player Media Provider Audit v1

- **Generated At**: `2026-10-06T17:40:44.282Z`
- **Total Unique Player Entities**: **418**
- **Total PlayerSeasons**: **554**
- **Candidate Sidecar**: `data/entities/player-media-candidates.json`

---

## 1. Provider Summary

| Provider | Matched Entities | Reliable Media Entities | Total Candidates | Reachable Images | Placeholders | 404 / Not Found | Blocked | Timeouts | Distinct Image URLs |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `fifaindex-current` | 408 | **408** (97.6%) | 542 | 540 | 2 (hub total: 135) | 0 | 0 | 0 | 533 |
| `fifaaddict-fo3` | 321 | **321** (76.8%) | 1197 | 323 | 0 | 0 | 0 | 0 | 1008 |
| `fifaaddict-fo4` | 336 | **336** (80.4%) | 1911 | 340 | 0 | 0 | 0 | 0 | 1911 |

### Image Format & Path Variants

- **FIFAIndex Current CDN (`images.fifaindex.com`)**: PNG = 540, WEBP (`<source srcSet>`) = 542. Observed **137** candidate(s) using the legacy `/players/g/{key}.png` path variant (and **715** total `/g/` edition entries across all hub pages for FIFA 05–08).
- **FIFAAddict FO3 (`fifaaddict.com/fo3img`)**: PNG = 321, JPG = 876 (query string `?2018` preserved).
- **FIFAAddict FO4 (`s1.fifaaddict.com/fo4/players`)**: PNG = 1911 (opaque lowercase alphabetical keys of length 8–9 chars + `?20260720` query string preserved).

---

## 2. Unique Player Coverage (418 Entities)

| Resolution Stage | Covered Unique Players | Coverage % | Net-New Added | Remaining Missing |
| :--- | ---: | ---: | ---: | ---: |
| **FIFAIndex Only** | **408** / 418 | **97.6%** | +408 | 10 |
| **FIFAIndex + FO3** | **412** / 418 | **98.6%** | +4 (denis-irwin, fernando-hierro, peter-schmeichel, stefan-effenberg) | 6 |
| **FIFAIndex + FO3 + FO4** | **413** / 418 | **98.8%** | +1 (gabriel-batistuta) | **5** |

---

## 3. PlayerSeason Coverage (554 PlayerSeasons)

| Resolution Tier | PlayerSeasons | Percentage | Notes |
| :--- | ---: | ---: | :--- |
| **1. FIFAIndex Exact-Season Real Photo** | **454** / 554 | **81.9%** | Exact FIFA edition year matches `PlayerSeason.year` with verified `images.fifaindex.com` headshot |
| **2. FIFAIndex Nearest-Year Fallback** | **90** / 554 | **16.2%** | Same entity's nearest FIFAIndex real photo (e.g., 1999–2004 seasons resolved to FIFA 05/07, or Mbappé 2016 placeholder) |
| **3. FO3 / FO4 Verified Render Fallback** | **5** / 554 | **0.9%** | FO3 supplemental: 4, FO4 supplemental: 1 |
| **Combined Covered PlayerSeasons** | **549** / 554 | **99.1%** | All 3 providers combined |
| **4. No Media (Still Missing)** | **5** / 554 | **0.9%** | Candidates for future Wikimedia Commons enrichment / silhouette fallback |

---

## 4. Era Breakdown

| Era | Total PlayerSeasons | Unique Players | Exact FIFAIndex | Nearest FIFAIndex | FO3 Supplemental | FO4 Supplemental | Combined Covered | Missing |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **1999-2004** | 99 | 95 | 0 | 89 | 4 | 1 | **94** (94.9%) | 5 |
| **2005-2010** | 70 | 69 | 70 | 0 | 0 | 0 | **70** (100.0%) | 0 |
| **2011-2020** | 250 | 200 | 249 | 1 | 0 | 0 | **250** (100.0%) | 0 |
| **2021-2024** | 135 | 128 | 135 | 0 | 0 | 0 | **135** (100.0%) | 0 |

---

## 5. Legend / Historical Gap Report (1999–2004)

- **1999–2004 Unique Players without Exact-Year FIFAIndex Photo**: **95** (FIFAIndex archive begins at FIFA 05 / 2005)
  - Covered by **FIFAIndex Nearest-Year (2005+)**: **85**
  - Found in **FO3**: **42**
  - Found in **FO4**: **46**
  - Found in **Both FO3 & FO4**: **36**
  - Still completely missing across all 3 providers: **5**

- **1999–2004 Unique Players without ANY FIFAIndex Photo (Retired before FIFA 05)**: **10**
  - Found in **FO3**: **4**
  - Found in **FO4**: **4**
  - Found in **Both FO3 & FO4**: **3**
  - Net-new rescued by **FO3 or FO4**: **5**
  - Still completely missing after FO3 + FO4: **5**

| Entity ID | Canonical Name | Seasons | Clubs | FIFAIndex Nearest | FO3 | FO4 | Combined Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| `denis-irwin` | Denis Irwin | 1999 | Manchester United | NO | YES | NO | **COVERED** |
| `diego-fuser` | Diego Fuser | 1999 | Parma | NO | NO | NO | **MISSING** |
| `donato` | Donato | 2000 | Deportivo La Coruna | NO | NO | NO | **MISSING** |
| `fernando-hierro` | Fernando Hierro | 2002 | Real Madrid | NO | YES | YES | **COVERED** |
| `francesco-antonioli` | Francesco Antonioli | 2001 | Roma | NO | NO | NO | **MISSING** |
| `gabriel-batistuta` | Gabriel Batistuta | 2001 | Roma | NO | NO | YES | **COVERED** |
| `jacques-songo-o` | Jacques Songo'o | 2000 | Deportivo La Coruna | NO | NO | NO | **MISSING** |
| `peter-schmeichel` | Peter Schmeichel | 1999 | Manchester United | NO | YES | YES | **COVERED** |
| `roberto-mancini` | Roberto Mancini | 2000 | Lazio | NO | NO | NO | **MISSING** |
| `stefan-effenberg` | Stefan Effenberg | 2001 | Bayern Munich | NO | YES | YES | **COVERED** |

---

## 6. Famous Historical Sample Audit (Section 36)

> Only entities actually present in the current 418-player dataset are audited below (no synthetic entities added).

| Famous Sample Name | Entity ID | In FIFAIndex | In FO3 | In FO4 | FIFAIndex Candidates | FO3 Candidates | FO4 Candidates | Total Candidates |
| :--- | :--- | :---: | :---: | :---: | ---: | ---: | ---: | ---: |
| **Maldini** (Paolo Maldini) | `paolo-maldini` | YES | YES | YES | 2 | 6 | 6 | **14** |
| **Zidane** (Zinedine Zidane) | `zinedine-zidane` | YES | NO | YES | 1 | 0 | 6 | **7** |
| **Schmeichel** (Peter Schmeichel) | `peter-schmeichel` | NO | YES | YES | 0 | 2 | 6 | **8** |

- **Sample names not present in current 418 entities**: Pelé, Maradona, Cruyff, Beckenbauer, Baresi, Yashin, Gullit, Van Basten, Matthäus, Ronaldo Nazário, Ronaldinho, George Best, Weah.

---

## 7. Regression Fixtures Verification (Sections 37–40)

- **Placeholder Regression (`kylian-mbappe` FIFA 16)**: `assetKind = "placeholder"`, `availabilityStatus = "placeholder"`, `countedAsRealPhoto = false` (Page explicitly displays `"Player photo not found"` / `/notfound_0.webp`).
- **Current FIFAIndex CDN Regression**:
  - Modern: `lionel-messi` FIFA 20 -> `https://images.fifaindex.com/fifa20/players/158023.png` (`httpStatus = 200`)
  - Legacy `/g/`: `fifa06: https://images.fifaindex.com/fifa06/players/g/303111.png (200) | fifa05: https://images.fifaindex.com/fifa05/players/g/070312.png (200)`
- **FO3 Legend Regression**: `paolo-maldini` -> `https://fifaaddict.com/fo3img/players/p93001109.png?2018` (WORLD LEGEND, status=200); `peter-schmeichel` -> `https://fifaaddict.com/fo3img/players/p190053.png?2018` (WORLD LEGEND, status=200); `fernando-hierro` -> `https://fifaaddict.com/fo3img/players/p93161840.png?2018` (WORLD LEGEND, status=200); `stefan-effenberg` -> `https://fifaaddict.com/fo3img/players/p215558.png?2018` (WORLD LEGEND, status=200)
- **FO4 Opaque CDN Regression**: `paolo-maldini` -> `https://s1.fifaaddict.com/fo4/players/kmljmybo.png?20260720` (ICON, status=200); `peter-schmeichel` -> `https://s1.fifaaddict.com/fo4/players/bmdyvpolb.png?20260720` (Greatest Runner-Ups, status=200); `zinedine-zidane` -> `https://s1.fifaaddict.com/fo4/players/yolzbbvg.png?20260720` (Eternal Legends, status=200); `gabriel-batistuta` -> `https://s1.fifaaddict.com/fo4/players/wbgmlgqd.png?20260720` (Eternal Legends, status=200)

---

## 8. Manual Review Queue (Ambiguous Identities Not Auto-Adopted)

| Entity ID | Canonical Name | Provider | Candidate Names Observed | Source Page | Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `andre-frank-zambo-anguissa` | Andre-Frank Zambo Anguissa | `fifaaddict-fo4` | André-Franck Zambo Anguissa | https://en.fifaaddict.com/fo4db?playername=Anguissa | Unconfirmed identity on FO4: detailName="André-Franck Zambo Anguissa" (born 1995-11-16) vs "Andre-Frank Zambo Anguissa" |
| `benni-mccarthy` | Benni McCarthy | `fifaaddict-fo4` | Alex McCarthy | https://en.fifaaddict.com/fo4db?playername=McCarthy | Unconfirmed identity on FO4: detailName="Alex McCarthy" (born 1989-12-03) vs "Benni McCarthy" |
| `dino-baggio` | Dino Baggio | `fifaaddict-fo4` | Roberto Baggio | https://en.fifaaddict.com/fo4db?playername=Baggio | Unconfirmed identity on FO4: detailName="Roberto Baggio" (born 1967-02-18) vs "Dino Baggio" |
| `jacques-songo-o` | Jacques Songo'o | `fifaaddict-fo3` | Yann Songo'o | https://en.fifaaddict.com/fo3db.php?q=player&name=Songo | Surname collision on FO3: "Yann Songo'o" vs "Jacques Songo'o" |
| `lucio` | Lucio | `fifaaddict-fo4` | Lúcio | https://en.fifaaddict.com/fo4db?playername=Lucio | Single-word mononym "Lúcio" on FO4 without confirming birth date |
| `ramires` | Ramires | `fifaaddict-fo4` | Ramires | https://en.fifaaddict.com/fo4db?playername=Ramires | Single-word mononym "Ramires" on FO4 without confirming birth date |
| `roberto-mancini` | Roberto Mancini | `fifaaddict-fo3` | Daniel Mancini, Gianluca Mancini, Andrea Mancini, Simone Mancini | https://en.fifaaddict.com/fo3db.php?q=player&name=Mancini | Surname collision on FO3: "Daniel Mancini" vs "Roberto Mancini" |
| `vicente` | Vicente | `fifaaddict-fo4` | Bruno Leonardo Vicente | https://en.fifaaddict.com/fo4db?playername=Vicente | Unconfirmed identity on FO4: detailName="Bruno Leonardo Vicente" (born 1989-02-18) vs "Vicente" |
| `victor-valdes` | Victor Valdes | `fifaaddict-fo4` | Diego Valdés | https://en.fifaaddict.com/fo4db?playername=Valdes | Unconfirmed identity on FO4: detailName="Diego Valdés" (born 1994-01-30) vs "Victor Valdes" |

---

## 9. Still Missing Players (Input for Future Commons Enrichment)

| Entity ID | Canonical Name | Clubs | Seasons | Audit Reason |
| :--- | :--- | :--- | :--- | :--- |
| `diego-fuser` | Diego Fuser | Parma | 1999 | FIFAIndex: not-found-on-fifaindex; FO3: no-matching-player-on-fo3; FO4: no-matching-player-on-fo4 |
| `donato` | Donato | Deportivo La Coruna | 2000 | FIFAIndex: not-found-on-fifaindex; FO3: no-matching-player-on-fo3; FO4: no-matching-player-on-fo4 |
| `francesco-antonioli` | Francesco Antonioli | Roma | 2001 | FIFAIndex: not-found-on-fifaindex; FO3: no-matching-player-on-fo3; FO4: no-matching-player-on-fo4 |
| `jacques-songo-o` | Jacques Songo'o | Deportivo La Coruna | 2000 | FIFAIndex: not-found-on-fifaindex; FO3: manual-review (Surname collision on FO3: "Yann Songo'o" vs "Jacques Songo'o"); FO4: no-matching-player-on-fo4 |
| `roberto-mancini` | Roberto Mancini | Lazio | 2000 | FIFAIndex: not-found-on-fifaindex; FO3: manual-review (Surname collision on FO3: "Daniel Mancini" vs "Roberto Mancini"); FO4: no-matching-player-on-fo4 |

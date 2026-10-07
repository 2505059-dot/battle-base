# Football Entity & Media Foundation v1 — Audit Report

*Generated: 2026-10-07T03:57:35.946Z*

---

## A. PlayerSeason Summary

- **Total PlayerSeasons in Dataset**: **554** (from 62 TeamSeasons in `public/data/team-seasons.js`)
- **Mapped PlayerSeasons**: **554** (100% mapped)

---

## B. Unique Player Entities

- **Total Unique Canonical Player Entities**: **418**
- **Unresolved Identity Conflicts**: **0** (Zero ambiguity across multi-season players)
- **Identity Status**: 100% `resolved`

---

## C. External Identity Coverage

| Metric | PlayerSeasons (N = 554) | Unique Players (N = 418) | Coverage % (Players) |
| :--- | :---: | :---: | :---: |
| **SoFIFA / EA FC ID** | 428 (77.26%) | 316 | 75.6% |
| **FIFA Index ID** | 319 (57.58%) | 242 | 57.89% |
| **Both External IDs** | — | 223 | 53.35% |
| **Neither External ID** | — | 83 | 19.86% |

> [!NOTE]
> Players with neither external ID are historical pre-2005 players (e.g. 1999 Manchester United roster members who retired before FIFA 05 release) whose attributes are verified via fallback squad registers.

---

## D. FIFA Index Headshot Audit

### 1. Syntactic Validation
- **PlayerSeasons with Valid Headshot URL**: **315**
- **PlayerSeasons with Raw Headshot URL**: **319**
- **PlayerSeasons with Malformed Headshot URL**: **4** (filtered out of entities)
- **Unique Players with at Least 1 Valid Headshot**: **238**
- **Total Distinct Valid Headshot URLs**: **315**
- **Distinct Malformed Headshot URLs**: **2**
- **Duplicate Valid URLs Across PlayerSeasons**: **0**

#### Malformed URLs Filtered at Ingestion:
| PlayerSeason ID | Player Name | Malformed Raw URL | Issue |
| :--- | :--- | :--- | :--- |
| `leicester-city-2016-4` | N'Golo Kante | `https://www.fifaindex.com` | Root path or malformed TLD (.comNA) |
| `inter-milan-2010-8` | Samuel Eto'o | `https://www.fifaindex.com` | Root path or malformed TLD (.comNA) |
| `inter-milan-2016-3` | Danilo D'Ambrosio | `https://www.fifaindex.com` | Root path or malformed TLD (.comNA) |
| `benfica-2014-0` | Jan Oblak | `https://www.fifaindex.comNA` | Root path or malformed TLD (.comNA) |

### 2. HTTP Availability Check
- **Reachable (HTTP 200..299)**: **0**
- **Unreachable**: **315**
- **Untested**: **0**

| HTTP Status Category | URL Count | Notes |
| :--- | :---: | :--- |
| **Blocked (403/429/Challenge)** | 315 | Cloudflare bot management challenge (`cf-mitigated: challenge`) |
| **Reachable (200..299)** | 0 | Direct static asset response |
| **Redirect (300..399)** | 0 | Asset relocated |
| **Not Found (404/410)** | 0 | Missing asset |
| **Timeout** | 0 | Request timed out (> 4000ms) |
| **Not Tested** | 0 | Skipped via offline flag |

> [!IMPORTANT]
> Automated requests to `www.fifaindex.com` receive HTTP 403 Forbidden with Cloudflare Turnstile challenge headers. Client browsers rendering FIFA Index images directly or through an image proxy load images under standard browser session rules, but the dataset explicitly tags all external provider media with `licenseStatus: "external-provider"` and `status: "blocked"`.

---

## E. Coverage by Year Band

| Era Band | PlayerSeasons | SoFIFA IDs | FIFA Index IDs | Same-Year Headshot | Other-Year Headshot | No Headshot |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1999–2004** | 99 | 0 (0%) | 0 (0%) | 0 (0%) | 13 (13.13%) | 86 (86.87%) |
| **2005–2010** | 70 | 44 (62.86%) | 69 (98.57%) | 68 (97.14%) | 0 (0%) | 2 (2.86%) |
| **2011–2020** | 250 | 249 (99.6%) | 250 (100%) | 247 (98.8%) | 0 (0%) | 3 (1.2%) |
| **2021–2024** | 135 | 135 (100%) | 0 (0%) | 0 (0%) | 36 (26.67%) | 99 (73.33%) |

---

## F. Identity Conflicts & Cross-Season Stability Audit

| Conflict Check | Result | Status |
| :--- | :---: | :--- |
| **Slug Collisions** | 0 | PASS (all 418 canonical names produce distinct slugs) |
| **Multiple SoFIFA IDs per Player** | 0 | PASS (0 multi-ID conflicts) |
| **Multiple FIFA Index IDs per Player** | 0 | PASS (0 multi-ID conflicts) |
| **External ID Reused Across Different Players** | 0 | PASS (no external ID hijacking) |
| **Role Conflict (GK mixed with Outfield)** | 0 | PASS (no GK identity contamination) |
| **Multi-Season Players Cross-Season ID Stability** | 93 / 98 stable | PASS (5 missing, 0 conflicting) |
| **SoFIFA == FIFA Index Agreement** | 223 / 223 (100%) | PASS (100% agreement when both IDs exist) |

---

## G. Club Entities Audit

- **Expected Canonical Clubs**: **28**
- **Actual Canonical Club Entities**: **28**
- **Status**: 100% represented in `data/entities/clubs.json`

---

## H. League Entities Audit

- **Expected Canonical Leagues**: **7**
- **Actual Canonical League Entities**: **7**
- **Status**: 100% represented in `data/entities/leagues.json`

---

## I. Historical Headshot Coverage per TeamSeason

### Aggregate Coverage
- **Same-Year FIFA Index Headshot**: **315** (56.86%)
- **Same-Player Other-Year Fallback Headshot**: **49** (8.84%)
- **No Headshot (Silhouette Fallback)**: **190** (34.3%)
- **Combined Headshot Availability**: **364** (**65.70%**)

### Full TeamSeason Breakdown (62 Teams)
| TeamSeason ID | Club | Year | League | Total | Same-Year | Other-Year | None |
| :--- | :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `manchester-united-1999` | Manchester United | 1999 | Premier League | 9 | 0 | 2 | 7 |
| `manchester-united-2008` | Manchester United | 2008 | Premier League | 9 | 9 | 0 | 0 |
| `manchester-united-2013` | Manchester United | 2013 | Premier League | 8 | 8 | 0 | 0 |
| `manchester-united-2022` | Manchester United | 2022 | Premier League | 9 | 0 | 3 | 6 |
| `arsenal-2004` | Arsenal | 2004 | Premier League | 9 | 0 | 2 | 7 |
| `arsenal-2008` | Arsenal | 2008 | Premier League | 9 | 9 | 0 | 0 |
| `arsenal-2020` | Arsenal | 2020 | Premier League | 9 | 9 | 0 | 0 |
| `chelsea-2005` | Chelsea | 2005 | Premier League | 8 | 8 | 0 | 0 |
| `chelsea-2012` | Chelsea | 2012 | Premier League | 8 | 8 | 0 | 0 |
| `chelsea-2016` | Chelsea | 2016 | Premier League | 9 | 9 | 0 | 0 |
| `chelsea-2021` | Chelsea | 2021 | Premier League | 9 | 0 | 1 | 8 |
| `chelsea-2023` | Chelsea | 2023 | Premier League | 9 | 0 | 1 | 8 |
| `manchester-city-2012` | Manchester City | 2012 | Premier League | 9 | 9 | 0 | 0 |
| `manchester-city-2023` | Manchester City | 2023 | Premier League | 9 | 0 | 1 | 8 |
| `liverpool-2005` | Liverpool | 2005 | Premier League | 8 | 8 | 0 | 0 |
| `liverpool-2019` | Liverpool | 2019 | Premier League | 9 | 9 | 0 | 0 |
| `leicester-city-2016` | Leicester City | 2016 | Premier League | 9 | 8 | 0 | 1 |
| `barcelona-2009` | Barcelona | 2009 | La Liga | 9 | 8 | 0 | 1 |
| `barcelona-2011` | Barcelona | 2011 | La Liga | 9 | 9 | 0 | 0 |
| `barcelona-2015` | Barcelona | 2015 | La Liga | 9 | 9 | 0 | 0 |
| `barcelona-2020` | Barcelona | 2020 | La Liga | 9 | 9 | 0 | 0 |
| `barcelona-2022` | Barcelona | 2022 | La Liga | 9 | 0 | 7 | 2 |
| `real-madrid-2002` | Real Madrid | 2002 | La Liga | 9 | 0 | 2 | 7 |
| `real-madrid-2012` | Real Madrid | 2012 | La Liga | 9 | 9 | 0 | 0 |
| `real-madrid-2017` | Real Madrid | 2017 | La Liga | 9 | 9 | 0 | 0 |
| `real-madrid-2019` | Real Madrid | 2019 | La Liga | 9 | 9 | 0 | 0 |
| `real-madrid-2022` | Real Madrid | 2022 | La Liga | 9 | 0 | 8 | 1 |
| `valencia-2004` | Valencia | 2004 | La Liga | 9 | 0 | 0 | 9 |
| `deportivo-la-coruna-2000` | Deportivo La Coruna | 2000 | La Liga | 9 | 0 | 0 | 9 |
| `atletico-madrid-2014` | Atletico Madrid | 2014 | La Liga | 9 | 9 | 0 | 0 |
| `ac-milan-2007` | AC Milan | 2007 | Serie A | 9 | 9 | 0 | 0 |
| `ac-milan-2011` | AC Milan | 2011 | Serie A | 9 | 9 | 0 | 0 |
| `ac-milan-2015` | AC Milan | 2015 | Serie A | 9 | 9 | 0 | 0 |
| `ac-milan-2022` | AC Milan | 2022 | Serie A | 9 | 0 | 0 | 9 |
| `inter-milan-2010` | Inter Milan | 2010 | Serie A | 9 | 8 | 0 | 1 |
| `inter-milan-2016` | Inter Milan | 2016 | Serie A | 9 | 8 | 0 | 1 |
| `inter-milan-2021` | Inter Milan | 2021 | Serie A | 9 | 0 | 2 | 7 |
| `inter-milan-2024` | Inter Milan | 2024 | Serie A | 9 | 0 | 1 | 8 |
| `juventus-2003` | Juventus | 2003 | Serie A | 9 | 0 | 2 | 7 |
| `juventus-2012` | Juventus | 2012 | Serie A | 9 | 9 | 0 | 0 |
| `juventus-2017` | Juventus | 2017 | Serie A | 9 | 9 | 0 | 0 |
| `juventus-2021` | Juventus | 2021 | Serie A | 9 | 0 | 3 | 6 |
| `napoli-2023` | Napoli | 2023 | Serie A | 9 | 0 | 0 | 9 |
| `roma-2001` | Roma | 2001 | Serie A | 9 | 0 | 2 | 7 |
| `lazio-2000` | Lazio | 2000 | Serie A | 9 | 0 | 1 | 8 |
| `parma-1999` | Parma | 1999 | Serie A | 9 | 0 | 1 | 8 |
| `atalanta-2020` | Atalanta | 2020 | Serie A | 9 | 9 | 0 | 0 |
| `bayern-munich-2001` | Bayern Munich | 2001 | Bundesliga | 9 | 0 | 0 | 9 |
| `bayern-munich-2013` | Bayern Munich | 2013 | Bundesliga | 9 | 9 | 0 | 0 |
| `bayern-munich-2020` | Bayern Munich | 2020 | Bundesliga | 9 | 9 | 0 | 0 |
| `bayern-munich-2022` | Bayern Munich | 2022 | Bundesliga | 9 | 0 | 6 | 3 |
| `borussia-dortmund-2013` | Borussia Dortmund | 2013 | Bundesliga | 9 | 9 | 0 | 0 |
| `borussia-dortmund-2015` | Borussia Dortmund | 2015 | Bundesliga | 9 | 9 | 0 | 0 |
| `borussia-dortmund-2017` | Borussia Dortmund | 2017 | Bundesliga | 9 | 9 | 0 | 0 |
| `borussia-dortmund-2023` | Borussia Dortmund | 2023 | Bundesliga | 9 | 0 | 2 | 7 |
| `bayer-leverkusen-2024` | Bayer Leverkusen | 2024 | Bundesliga | 9 | 0 | 1 | 8 |
| `monaco-2017` | Monaco | 2017 | Ligue 1 | 9 | 9 | 0 | 0 |
| `lille-2021` | Lille | 2021 | Ligue 1 | 9 | 0 | 0 | 9 |
| `ajax-2019` | Ajax | 2019 | Eredivisie | 9 | 9 | 0 | 0 |
| `psv-2005` | PSV | 2005 | Eredivisie | 9 | 9 | 0 | 0 |
| `porto-2004` | Porto | 2004 | Primeira Liga | 9 | 0 | 1 | 8 |
| `benfica-2014` | Benfica | 2014 | Primeira Liga | 9 | 8 | 0 | 1 |

---

## J. Club Crest & League Emblem Provider Audit

### 1. `football-data.org`
- **Resource Format**: SVG vectors via `https://crests.football-data.org/{id}.svg`
- **Authentication**: Mandatory `X-Auth-Token` HTTP header.
- **Rate Limit**: Free tier strictly capped at 10 requests per minute.
- **Architecture**: Ideal for offline hydration cache during pipeline build. Never expose directly in web runtime.
- **Licensing / Trademark**: Club and league crests are registered trademarks. Fair use / editorial display only.

### 2. `TheSportsDB`
- **Resource Format**: High-resolution PNG badges, jersey equipment graphics, stadium photos.
- **Authentication**: Developer key `3` (free) or commercial Patreon v2 token.
- **Rate Limit**: Moderate concurrency restrictions on free tier.
- **Architecture**: Recommended for offline badge and jersey equipment cataloging.
- **Licensing / Trademark**: Community-submitted assets; trademarks remain property of individual clubs.

### 3. `Wikidata / Wikimedia Commons`
- **Resource Format**: SVG logos (`P154`), player photographs (`P18`), competition symbols (`P41`).
- **Authentication**: None required; requires compliant User-Agent identifier.
- **Rate Limit**: Generous SPARQL limits (~60 queries/min).
- **Architecture**: Optimal source for open-licensed historical player photos (`licenseStatus: "verified-free"`).
- **Licensing / Trademark**: Creative Commons / Public Domain licenses clearly recorded in Commons metadata.

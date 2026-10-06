# Football Data Pipeline — Candidate & Selected Data Sources

This document records the investigation and live HTTP verification of publicly accessible historical football squad and FIFA/SoFIFA player rating datasets prior to importing them into the build pipeline.

---

## 1. Summary of Investigated Data Sources

| Source Name | Role in Pipeline | Coverage Years | License | Programmatic Download | Selected? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`ewenme/squads`** | Historical Squad Rosters & Granular Positions (All 7 Game Leagues) | 2004/05 – 2020/21 (`2005`–`2021`) | Public GitHub Repo (Transfermarkt source) | Yes (`raw.githubusercontent.com`, ~45 KB/file) | **Yes (Primary Squad Source 2005–2021)** |
| **`footballcsv/cache.footballsquads`** | Historical Squad Rosters & Positions (1998–2024, incl. Pre-2005 & 2022–2024) | 1993/94 – 2023/24 (`1994`–`2024`) | **CC0-1.0** (Public Domain) | Yes (`raw.githubusercontent.com`, ~4 KB/team) | **Yes (Primary Squad Source 1999–2004 & 2022–2024; Cross-Verification 2005–2021)** |
| **`mzafram2001/ea-fc`** | Historical FIFA 07 – EA FC 24 Squads, Positions, Overall & Technical Attributes | 2006/07 – 2023/24 (`2007`–`2024`) | **MIT License** | Yes (`raw.githubusercontent.com`, ~3–5.7 MB/year) | **Yes (Primary FIFA Rating Source 2011–2024)** |
| **`lbenz730/fifa_model`** | Historical FIFA 05 – FIFA 20 Squads, Positions, Overall & Technical Attributes | 2004/05 – 2019/20 (`2005`–`2020`) | Public Academic GitHub Repo | Yes (`raw.githubusercontent.com`, ~3.8 MB/year) | **Yes (Primary Rating Source 2005–2010 & Cross-Check 2011–2020)** |
| **`kushal-gopal/EA-Sports-Fifa`** | Mirror of `stefanoleone992` Kaggle FIFA 15–20 Player CSVs | 2014/15 – 2019/20 (`2015`–`2020`) | Public GitHub Repo (CC0 on Kaggle) | Yes (`raw.githubusercontent.com`, ~8 MB/year) | **Evaluated (Superseded by `mzafram2001/ea-fc` which covers 2007–2024 under MIT)** |
| **`statsbomb/open-data`** (`hudl/open-data`) | Match Event Streams & Lineups | Selected competitions (1999–2024) | StatsBomb Public Data License | Yes (`raw.githubusercontent.com`) | **Deferred (Reserved for Match Simulation Event Distribution Research)** |

> [!IMPORTANT]
> All downloaded raw CSV, TXT, and intermediate index files under `data/raw/squads/` and `data/raw/fifa/` are ignored via `.gitignore` to keep the Git repository lightweight and license-compliant.

---

## 2. Detailed Source Evaluations

### 2.1 `ewenme/squads`
- **Source Name**: `ewenme/squads`
- **URL**:
  - Repository: `https://github.com/ewenme/squads`
  - Raw File Pattern: `https://raw.githubusercontent.com/ewenme/squads/master/data/{start_year}/{league_slug}.csv`
- **License**: Public GitHub repository (no SPDX file; README notes data compiled from Transfermarkt in accordance with terms of use for non-commercial analysis)
- **Coverage Years**: Season start years `2004` through `2020`, corresponding to canonical season-end years **`2005` through `2021`** (`2004/2005` to `2020/2021`).
- **Leagues Covered**: Covers all **7 leagues** in our game:
  - `premier_league.csv` → `Premier League`
  - `primera_division.csv` → `La Liga`
  - `serie_a.csv` → `Serie A`
  - `1_bundesliga.csv` → `Bundesliga`
  - `ligue_1.csv` → `Ligue 1`
  - `eredivisie.csv` → `Eredivisie`
  - `liga_nos.csv` → `Primeira Liga`
- **Exact Schema / Fields**:
  - **Club field**: `club_name` (e.g., `Manchester United`, `Arsenal FC`, `AC Milan`, `FC Internazionale`, `Bayern Munich`, `FC Porto`, `SL Benfica`)
  - **Season field**: `season` (e.g., `2007/2008` → normalized to `2008`) and `year` (start year `2007`)
  - **Player name field**: `player_name` (e.g., `Cristiano Ronaldo`, `Wayne Rooney`)
  - **Position field**: `position` (`Goalkeeper`, `Centre-Back`, `Left-Back`, `Right-Back`, `Defensive Midfield`, `Central Midfield`, `Attacking Midfield`, `Left Midfield`, `Right Midfield`, `Left Winger`, `Right Winger`, `Second Striker`, `Centre-Forward`)
  - **Overall field**: None
  - **Technical attribute fields**: None
- **Programmatic Download**: Yes, direct HTTP GET via Node `fetch` (~38–62 KB per league-season CSV).
- **Suitability**: **Highly suitable** for verifying squad rosters and roles across all 7 leagues for seasons `2005`–`2021`.

---

### 2.2 `footballcsv/cache.footballsquads`
- **Source Name**: `footballcsv/cache.footballsquads`
- **URL**:
  - Repository: `https://github.com/footballcsv/cache.footballsquads`
  - Raw File Pattern: `https://raw.githubusercontent.com/footballcsv/cache.footballsquads/master/{country}/{season}/{league}/{team_slug}.txt`
- **License**: **`CC0-1.0`** (Creative Commons Zero v1.0 Universal / Public Domain Dedication)
- **Coverage Years**: `1993-1994` through `2023-2024` (canonical years **`1994` through `2024`**)
- **Leagues Covered**:
  - England (`eng/{season}/faprem` for 1993–2018, `eng/{season}/engprem` for 2018–2024)
  - Spain (`spain/{season}/laliga`)
  - Italy (`italy/{season}/seriea`)
  - Germany (`ger/{season}/bundes`)
  - France (`france/{season}/div1` for 1998–2002, `france/{season}/ligue1` for 2002–2024)
  - Netherlands (`ned/{season}/erediv`)
  - Portugal (`portugal/{season}/primeira` / Champions League `uefa/{season}/cl`)
- **Exact Schema / Fields**:
  - Line 1 header: `=  <Club Name> - <League> <Season>`
  - Table columns: `Number, Name, [Nat,] Pos, Height, Weight, Date of Birth, Birth Place, Previous Club`
  - **Club field**: Header line & `{team_slug}.txt`
  - **Season field**: Header line & `{season}` folder (e.g., `1998-1999` → `1999`)
  - **Player name field**: `Name`
  - **Position field**: `Pos` (`G`, `D`, `M`, `F`)
  - **Overall field**: None
  - **Technical attribute fields**: None
- **Programmatic Download**: Yes, direct HTTP GET via `raw.githubusercontent.com` (~3–6 KB per team-season file).
- **Suitability**: **Essential** for verifying pre-2005 historical squads (`1999`–`2004`, such as `manchester-united-1999`, `parma-1999`, `deportivo-la-coruna-2000`, `lazio-2000`, `roma-2001`, `bayern-munich-2001`, `real-madrid-2002`, `juventus-2003`, `arsenal-2004`, `valencia-2004`, `porto-2004`) as well as `2022`–`2024` squads.

---

### 2.3 `mzafram2001/ea-fc` (Historical FIFA 07 – EA FC 24 Dataset)
- **Source Name**: `mzafram2001/ea-fc`
- **URL**:
  - Repository: `https://github.com/mzafram2001/ea-fc`
  - Raw File Pattern:
    - `https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/dataset_fifa_{yy}.csv` (`yy` = `07`..`23`)
    - `https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/dataset_ea_fc_24.csv` (`24`)
- **License**: **MIT License**
- **Coverage Years**: FIFA 07 (`2007`) through EA FC 24 (`2024`)
- **Leagues Covered**: All leagues in EA Sports FIFA / EA FC (covers all 7 leagues and 28 clubs in our game)
- **Exact Schema / Fields (59 columns)**:
  - **Club field**: `club_name`
  - **Season field**: `game_version` (`FIFA 07` → `2007`, ..., `EA FC 24` → `2024`)
  - **Player name fields**: `short_name`, `long_name`, `alias`
  - **Position field**: `positions` (comma-separated, e.g., `"ST, LW"`, `"CB"`)
  - **Overall field**: `overall`
  - **Technical attribute fields**:
    - **Attack**: `finishing`, `positioning`, `shot_power`, `long_shots`, `heading_accuracy`
    - **Creation**: `vision`, `short_passing`, `long_passing`, `crossing`, `ball_control`, `dribbling_stat`
    - **Defense**: `interceptions`, `defensive_awareness`, `standing_tackle`, `sliding_tackle`
    - **Physical**: `strength`, `stamina`, `acceleration`, `sprint_speed`, `aggression`
    - **Goalkeeping**: `gk_diving`, `gk_handling`, `gk_kicking`, `gk_positioning`, `gk_reflexes`
  - **Schema Caveat**: In FIFA 07–10 (`2007`–`2010`), several attributes introduced or renamed in FIFA 11 (`positioning`, `vision`, `interceptions`, `sliding_tackle`, `gk_kicking`) are recorded as `0` in `mzafram2001/ea-fc`. Therefore, for `2011`–`2024`, `mzafram2001/ea-fc` has complete 1–99 values for all required technical attributes; for `2005`–`2010`, we also consult `lbenz730/fifa_model`.
- **Programmatic Download**: Yes, direct HTTP GET (~2.9–5.7 MB per yearly CSV).
- **Suitability**: **Primary FIFA rating and position source for 2011–2024** (and overall/club source for 2007–2024).

---

### 2.4 `lbenz730/fifa_model` (Historical FIFA 05 – FIFA 20 Dataset)
- **Source Name**: `lbenz730/fifa_model`
- **URL**:
  - Repository: `https://github.com/lbenz730/fifa_model`
  - Raw File Pattern: `https://raw.githubusercontent.com/lbenz730/fifa_model/master/stats/player_stats_{yyyy}.csv` (`yyyy` = `2005`..`2020`)
- **License**: Public academic GitHub repository (FIFA Index historical scrape)
- **Coverage Years**: FIFA 05 (`2005`) through FIFA 20 (`2020`)
- **Leagues Covered**: All leagues in FIFA 05–20
- **Exact Schema / Fields (63 columns)**:
  - **Club field**: `club`
  - **Season field**: `year` (`2005`..`2020`) and `season` (`05`..`20`)
  - **Player name field**: `name`
  - **Position fields**: `preferred_positions` (slash-separated, e.g., `"ST/CF"`), `club_position`
  - **Overall field**: `rating`
  - **Technical attribute fields**:
    - **Attack**: `finishing`, `att_position`, `shot_power`, `long_shots`, `heading`
    - **Creation**: `vision` (or `creativity` in 2005), `short_pass`, `long_pass`, `crossing`, `ball_control`, `dribbling`
    - **Defense**: `interceptions`, `marking`, `stand_tackle`, `slide_tackle`
    - **Physical**: `strength`, `stamina`, `acceleration`, `sprint_speed`, `aggression`
    - **Goalkeeping**: `gk_diving`, `gk_handling`, `gk_kicking`, `gk_positioning`, `gk_reflexes`
  - **Schema Caveat**: In FIFA 05 (`2005`), `slide_tackle`, `interceptions`, and `vision` were not yet split out as separate attributes in FIFA (`NA` in CSV); in FIFA 07–10 (`2007`–`2010`), `vision` is `NA` until FIFA 11 (`2011`), though `reactions`, `short_pass`, `long_pass`, `ball_control`, `dribbling`, `crossing`, `marking`, `stand_tackle`, `slide_tackle`, `interceptions` (from 2007+) are present.
- **Programmatic Download**: Yes, direct HTTP GET (~3.7–4.0 MB per yearly CSV).
- **Suitability**: **Highly suitable** for extending FIFA coverage back to `2005`–`2010` and cross-checking `2011`–`2020`.

---

### 2.5 `kushal-gopal/EA-Sports-Fifa` (Stefano Leone FIFA 15–20 Mirror)
- **Source Name**: `kushal-gopal/EA-Sports-Fifa`
- **URL**: `https://github.com/kushal-gopal/EA-Sports-Fifa` (`players_15.csv`..`players_20.csv`)
- **License**: Public GitHub mirror of Kaggle CC0 dataset
- **Coverage Years**: `2015`–`2020`
- **Suitability**: Evaluated as a valid alternative, but `mzafram2001/ea-fc` already provides the exact same SoFIFA attributes for `2007`–`2024` under an explicit MIT license with a unified schema.

---

### 2.6 `statsbomb/open-data` (`hudl/open-data`)
- **Source Name**: StatsBomb Open Data
- **URL**: `https://github.com/statsbomb/open-data`
- **License**: StatsBomb Public Data License (free for non-commercial research with attribution)
- **Coverage Years**: 80 competition-seasons (including Arsenal 2003/04, La Liga 2004/05–2020/21, Big 5 Leagues 2015/16, Bayer Leverkusen 2023/24, Champions League finals 1999–2019)
- **Suitability**: Recorded for future **Match Simulation** event distribution research (pass/shot/duel frequencies and xG distributions). Not used for 1–99 player attribute ratings.

# Early FIFA and Online rating calibration experiment

## ERA DERBY baseline v2 retention

The imported source revision is `61ce94636c4b5142ca16c52e14202fe42147768c`. This baseline retains the cohort, aggregate coverage, mapping, summaries, and tools, but intentionally excludes `evidence.json`, `calibration-results.json`, and `identity-crosswalk-v1/source-attributes.json`. These files contain detailed FIFAIndex-attributed observations; the source revision and redistribution rights are unresolved. Consequently, `calibrate.py` and `identity-crosswalk-v1/audit.py` cannot reproduce their source-backed outputs from this checkout and must not be reported as passed offline checks. `mapping.json` contains identity IDs, URLs, and page-observed identity facts, not player attribute values; no independent redistribution license was found for it either. Do not run the external cache restoration script until its terms and redistribution permission are reviewed.

This bounded study covers the repository’s 11 pre-2005 TeamSeasons: 99 player-season entries and 95 canonical players. It examines game ratings and detailed attributes only; it does not establish real-world season membership. Runtime rosters, identity indexes, ability-v2 output, and the game engine are unchanged.

## Reproduction availability

The source-backed calibration is not reproducible from this baseline: `evidence.json`, `calibration-results.json`, and the identity package's `source-attributes.json` were excluded because redistribution rights are unresolved. The commands below are intentionally not run; the first two require the missing evidence, and cache restoration would retrieve third-party data without a resolved license. The committed `coverage.csv`, `mapping.json`, and summaries are preserved snapshots, not regenerated outputs. Python syntax checks do not validate the analysis or its results. Revisit only after rights review and restore exact inputs into a private, ignored research cache.

## Evidence and 99-entry coverage

The specific cache endpoint was `https://raw.githubusercontent.com/lbenz730/fifa_model/master/player_stats.csv`, fetched 2026-10-08. Its pinned size is 62,733,624 bytes and SHA-256 is `90403e4a7d30e94198b4c031d805fe06f170833efcae0d738e04108bba436758`, matching the existing audit manifest. The URL is mutable `master`; exact source revision, source capture vintage, and redistribution rights are unresolved. Records are FIFAIndex-attributed but were not all independently rechecked against live pages; the full CSV remains ignored.

Exact numeric IDs identify 12 existing cohort players; three explicit page-ID crosswalks add Henry (1625), Bergkamp (4000), and Vieira (1419). This gives 44 FIFA 05/06/07 observations for 15 distinct players. Each has every edition-supported field in the existing schema matrix: 23 fields per FIFA 05 row, 18 per FIFA 06 row, and 23 per FIFA 07 row. The evidence preserves all 36 raw source columns, with fields unavailable in that edition as null. FIFAIndex URLs, IDs, positions, OVRs, raw details, and edition uncertainty are recorded.

The mutually exclusive primary classification across all 99 TeamSeason entries is:

| Primary class | Entries | Unique players | Meaning |
|---|---:|---:|---|
| Full ordinary FIFA detail, exact numeric ID | 16 | 15 | Nearby FIFA 05/06/07 observations; Buffon appears in both Parma 1999 and Juventus 2003. |
| Full FUT detail only | 0 | 0 | Three complete FIFA20 Icon records overlap the regular-source group. |
| Full OL detail with explicit card state, no regular FIFA source | 1 | 1 | Peter Schmeichel, FIFA Online 3 World Legend, +1/LV.1/BN+0, 34 numeric fields. Target-season phase remains unknown. |
| Full OL profile, base/grade state unverified | 3 | 3 | Roberto Carlos (FO4 24 World Legend), David Beckham (FO4 CAPTAIN), and Zidane (FO4 BTB); each has 34 raw fields, but grade/base state is unresolved, so they are excluded from reliable base coverage and training. |
| Exact-name candidate, identity unverified | 65 | 62 | Kept separate; these do not count as observed values. |
| No match found in the bounded checks | 14 | 14 | This is a bounded-search result, not proof that no card exists. |

All 11 teams currently contain 9 entries, leaving 2 per team (22 total) to reach 11. The 3 full FUT records are FIFA20 standard Icon pages for Henry, Bergkamp, and Vieira. They are not labeled Base/Mid/Prime and are not mapped to historical career stages. FIFA17 Vieira and FIFA15 Schmeichel Legend pages are partial in the captured FUT evidence. The three full FUT20 Icon profiles overlap entries already covered by ordinary FIFA, so the mutually exclusive FUT-only (B) count is zero; their career stage remains unverified.
Across sources, 20/99 TeamSeason entries have a full detailed profile (A16 + C1 + D3), while 17/99 have reliable full details with explicit source/card state (A16 + C1); the three D profiles are raw FO4 observations and excluded from reliable coverage and training. OL base state is confirmed for two rows overall (Schmeichel and Giggs), but Giggs overlaps A because FIFAIndex ID 241 is verified and is not a separate C row. Zidane’s partial FO4 ICON page is an overlapping partial source, not another primary entry.

Limited FIFA Online and FO4 observations were reviewed for identity and card-state confidence. Legend records are not assigned to a target career phase; partial or state-unverified profiles remain excluded from reliable coverage and training. Individual OVRs and detailed player ratings are omitted here because third-party redistribution rights are unresolved.

A feasible next step is a bounded source-by-source review of the 22 missing slots. Prefer ordinary same/near-edition FIFA cards. Count an Online source only when player identity, card type, base state, position, and detailed values are explicit; keep Legend career phase separate from the target season. This experiment does not authorize adding names or assigning target-season values.

## Calibration

Three same-player FIFA 05/FIFA20 Icon pairs were considered for total-difference diagnostics; the small sample and uncertain career phase are not sufficient for calibration.

| Diagnostic | Result |
|---|---|
| Player-group holdout | Numerical metrics omitted; no coefficients or player-season predictions are emitted. |

Fifteen non-OVR detailed attribute families had complete pairs across the reviewed Icon records; individual values and derived error metrics are omitted. The sample did not meet the fit threshold, career phase is unknown, and no estimated player values or predictions were emitted. Other Online/Legend comparisons were descriptive only and did not establish an effect.

The value-state categories remain observed, derived, estimated, and unavailable. No estimated player values or season predictions are emitted; absent values remain unavailable, not zero.

## Files

- `cohort.json`: the 99 read-only runtime player-season rows.
- `evidence.json`: source records, IDs, URLs, card state, captured values, search outcomes, and uncertainty.
- `coverage.csv`: one mutually classified row per TeamSeason entry, including overlap and candidate status.
- `calibrate.py`: offline source-sample refresh, coverage generation, and player-group holdout calculations.
- `calibration-results.json`: detailed observations, errors, failures, null coefficients, and coverage totals.
- `restore-lbenz-cache.ps1`: optional checksum-verified restoration of the specific ignored CSV.

Source recovery and cross-check: the pinned 62,733,624-byte FIFAIndex-attributed CSV has SHA256 90403e4a7d30e94198b4c031d805fe06f170833efcae0d738e04108bba436758; it rebuilds 44 exact-ID rows for 15 unique players. FUT and bounded Online transcript checks were reviewed with unsupported fields left unavailable. A cross-source field-alignment issue was corrected; numeric observations are omitted here. Schmeichel FIFA15 has named generic fields and additional unlabeled panel values, which remain unavailable as goalkeeper attributes.

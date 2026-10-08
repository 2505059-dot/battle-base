# Early FIFA and Online rating calibration experiment

This bounded study covers the repository’s 11 pre-2005 TeamSeasons: 99 player-season entries and 95 canonical players. It examines game ratings and detailed attributes only; it does not establish real-world season membership. Runtime rosters, identity indexes, ability-v2 output, and the game engine are unchanged.

## Reproduce

The standard-library Python script runs offline from the committed cohort and evidence files:

```powershell
python research/fifa-legacy-ol-calibration/calibrate.py
```

To rebuild the embedded FIFAIndex-attributed sample from the ignored local CSV cache, run it with PowerShell 7 (`pwsh`, which provides `Get-FileHash`) and then:

```powershell
pwsh -NoProfile -File research/fifa-legacy-ol-calibration/restore-lbenz-cache.ps1
python research/fifa-legacy-ol-calibration/calibrate.py --refresh-cache
```

Cache refresh verifies exact bytes and SHA-256 before filtering FIFA 05/06/07. It uses the existing `research/fifa-rating-audit/outputs/schema-matrix.csv` to count only detail fields present in each edition. A source `NA` remains null; a numeric zero remains zero. Default mode needs no cache or network access and regenerates `coverage.csv` and `calibration-results.json` from `cohort.json` and `evidence.json`.

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

The FIFA Online 3 Schmeichel page was verified in the live browser DOM: World Legend (WL), GK, OVR 92, `+1 / LV.1 / BN+0`, 34 numeric details plus categorical Consistency=`Average`. An earlier static extraction showed a stale OVR 87 and omitted rendered values; the live DOM record supersedes it. The card is a Legend and is not assigned to the target 1999 phase. A FIFA Online 3 Henry page was identified as Ultimate Legend and excluded. The FO4 Zidane page shows OVR 114 and six top stats, but its 34 zero placeholders are not treated as ratings and its enhancement/training/add-on state is unknown. Roberto Carlos has a full FO4 24 World Legend profile (OVR 117, 34 raw fields) and David Beckham a full FO4 CAP profile (OVR 104, 34 raw fields); both show Level 1 but have no selected grade or visible add-on/training state, so they are recorded as full-profile/state-unverified and excluded from training. These raw observed values are not clipped; only derived predictions are limited to 1–99. A second ordinary FO3 record is Ryan Giggs Season 2010 (OVR 74, LM, +1/LV.1/BN+0, 34 numeric details); its exact-name pair to FIFA05 Giggs (OVR 92) is a later-card descriptive difference of -18, not a target-season proxy or fitted model.

A feasible next step is a bounded source-by-source review of the 22 missing slots. Prefer ordinary same/near-edition FIFA cards. Count an Online source only when player identity, card type, base state, position, and detailed values are explicit; keep Legend career phase separate from the target season. This experiment does not authorize adding names or assigning target-season values.

## Calibration

Three same-player FIFA 05 → FIFA20 Icon pairs support total-difference diagnostics only. OVR differences (FUT minus FIFA05) are −4, +2, and −3. Player-group leave-one-out results are:

| OVR method | MAE | Bias (prediction − actual) | Test players |
|---|---:|---:|---:|
| Direct value | 3.00 | +1.67 | 3 |
| Fixed offset | 3.67 | 0.00 | 3 |
| Linear regression | unavailable | unavailable | 0; only 2 training groups per fold, below the 3-group minimum |

Fifteen non-OVR detailed attributes have complete pairs across the three FIFA20 standard Icon players (45 attribute comparisons total); OVR is reported separately. OVR direct-value leave-one-player-out MAE is 3.00 (bias +1.67), fixed-offset MAE 3.67 (bias 0.00), while linear regression fails with too few training groups. These descriptive results do not meet the 8-player fit threshold, and Icon career phase is unknown; final coefficients are null and no player-season predictions are emitted. The single FIFA05-to-FIFA17 Vieira Legend pair is descriptive only. One verified FIFA05-to-OL3 ordinary Season 2010 Giggs pair has OVR 92 to 74 (total difference -18), but one distinct player and a later card phase provide no holdout MAE/bias or coefficient. OL3 ordinary-to-Legend and FIFA regular-to-OL4 have no eligible paired records. No separate online-inflation or Legend-inflation effect is identified.

Values are distinguished as `observed`, `derived`, `estimated`, and `unavailable`. The experiment emits no `estimated` player values; absent values are null, never zero. The observed OL4 OVR 114 remains as sourced.

## Files

- `cohort.json`: the 99 read-only runtime player-season rows.
- `evidence.json`: source records, IDs, URLs, card state, captured values, search outcomes, and uncertainty.
- `coverage.csv`: one mutually classified row per TeamSeason entry, including overlap and candidate status.
- `calibrate.py`: offline source-sample refresh, coverage generation, and player-group holdout calculations.
- `calibration-results.json`: detailed observations, errors, failures, null coefficients, and coverage totals.
- `restore-lbenz-cache.ps1`: optional checksum-verified restoration of the specific ignored CSV.

Source recovery and cross-check: the pinned 62,733,624-byte FIFAIndex-attributed CSV has SHA256 `90403e4a7d30e94198b4c031d805fe06f170833efcae0d738e04108bba436758`; it rebuilds 44 exact-ID rows for 15 unique players. Five FUT pages and the bounded Online records were reconstructed from captured source-page transcripts, with unsupported fields left unavailable. WeFUT and FUTWIZ Henry20 values match (Long Shots 87, Volleys 90); the apparent Volleys discrepancy was a field-alignment error. Schmeichel FIFA15 has only 28 named generic fields; its six unlabeled panel values are not treated as GK attributes.

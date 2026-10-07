# FIFA Historical Schema & Position Rating Audit v1

Research-only reproducible audit. Runtime implementation was not changed.

## Rebuild

Use Python 3 with NumPy. The Codex bundled runtime used here provides NumPy; pandas is not required. The source cache under `research/cache/fifa-rating-audit/` is gitignored. If it is absent or needs refresh, download sources sequentially from the repository root; otherwise rebuild directly from the existing cache.

## Required outputs

The 11 required CSVs are `outputs/source-summary.csv`, `outputs/schema-matrix.csv`, `outputs/edition-distributions.csv`, `outputs/position-vocabulary.csv`, `outputs/position-formula-fit.csv`, `outputs/position-formula-stability.csv`, `outputs/same-player-continuity.csv`, `outputs/snapshot-alignment.csv`, `outputs/psv-2005-case.csv`, `outputs/battle-base-coverage.csv`, and `outputs/breakpoint-score.csv`. Supplementary 554-PlayerSeason and 418-entity tables, cross-source conflict aggregates and sample, and other diagnostics also live under `outputs/`.

```powershell
python research/fifa-rating-audit/src/download_sources.py
python research/fifa-rating-audit/src/download_position_labels.py
python research/fifa-rating-audit/src/download_multi_position_labels.py
python research/fifa-rating-audit/src/audit.py
python research/fifa-rating-audit/src/audit.py --check
```

The analysis reads only the pre-existing `male_players (legacy).csv` member from the Stefano archive, never the 5.64 GB all-updates player table. `--check` is read-only and checks analysis-script/cache/output hashes, CSV schemas and row counts, all 62 TeamSeasons, 554 PlayerSeasons, 418 entities, all six cases, nine PSV players, the 300-row multi-era spot-check, held-out position fits, and eight figures. Required CSVs are in `outputs/`; the report, manifest, README and SVGs are in this directory. Check `source-manifest.json` for source URLs, checksums, verification date, revisions, license notes, actual edition rows, and the missing FC26 result.

## Methods and limits

The target-position regression uses the source's base integer separately from a signed suffix modifier. Player IDs are SHA256-folded once into a deterministic 80/20 train/test partition shared across editions; feature eligibility, imputation, centering, and the common FIFA15–23 feature scale use training IDs only. The model is standardized ridge prediction, not an EA formula reconstruction. The `legacy` source is its second-year-update snapshot and FIFA18 demo has a 155-column source-listing / 75-column retrieved-file mismatch. No bulk dataset is committed; underlying game-data redistribution rights are unresolved even where a dataset listing declares a license.

Tables preserve each source and edition separately. Exact normalized name plus nationality is used only for cross-source conflict rows; lower-confidence name/club matches remain explicit. Missing values are not synthesized. Source disagreements remain observations, not automatic errors. SVG figures are generated from the same CSV outputs by this script without external plotting packages.

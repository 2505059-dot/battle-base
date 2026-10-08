# FIFA Legacy OL Calibration — Identity Crosswalk v1

## ERA DERBY baseline v2 retention

`source-attributes.json` is intentionally excluded from this baseline because its FIFAIndex-attributed values have unresolved redistribution rights. This means `audit.py` cannot rebuild `coverage.csv` or `summary.json` from the retained files; those checked-in aggregates and `mapping.json` are preserved as source snapshots, not rerun results. The map records source-local IDs, URLs, and page-observed identity facts, and has no independently confirmed redistribution license. Restore the exact file from source revision `61ce94636c4b5142ca16c52e14202fe42147768c` only after rights are resolved.

This bounded audit re-evaluates the 181 candidate records already in the v1 evidence against the existing 99 PlayerSeason rows (95 distinct canonical players). It uses only prior FIFAIndex page observations and the pinned, gitignored lbenz CSV; it does not add data sources or research real-world team rosters.

`mapping.json` records canonical IDs, every candidate FIFAIndex ID, page URLs, observed identity facts, and the reason each edge was confirmed, rejected, or left unresolved. A null DOB means it was not exposed or not observed. FIFAIndex DOBs are page observations, not independently verified canonical DOBs. Five multi-ID names retain unread alternatives; Roberto Carlos is resolved within the candidate set. Cafú 3215 is rejected as a namesake; v1 ID 5003 remains an inherited mapping.

`source-attributes.json` carries selected original FIFA 05–07 CSV fields and the cache URL, size, and SHA-256. Numeric rows are included only for fresh page-confirmed IDs; unresolved and rejected IDs have availability metadata only. The 62.7 MiB source cache remains gitignored. Its data is FIFAIndex-attributed and is not independently verified as official EA data.

`python audit.py` is not runnable from this baseline because the required `source-attributes.json` and upstream source evidence are intentionally excluded. The checked-in `coverage.csv` and `summary.json` are retained source snapshots, not regenerated outputs. Do not restore source values or run this audit until their redistribution rights are resolved; syntax checking the tool is not a result reproduction.

No runtime roster, ability v2 data, identity index, Draft, engine, prior v1 evidence, or calibration coefficients are changed.

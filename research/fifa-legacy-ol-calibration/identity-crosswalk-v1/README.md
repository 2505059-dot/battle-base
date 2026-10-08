# FIFA Legacy OL Calibration — Identity Crosswalk v1

This bounded audit re-evaluates the 181 candidate records already in the v1 evidence against the existing 99 PlayerSeason rows (95 distinct canonical players). It uses only prior FIFAIndex page observations and the pinned, gitignored lbenz CSV; it does not add data sources or research real-world team rosters.

`mapping.json` records canonical IDs, every candidate FIFAIndex ID, page URLs, observed identity facts, and the reason each edge was confirmed, rejected, or left unresolved. A null DOB means it was not exposed or not observed. FIFAIndex DOBs are page observations, not independently verified canonical DOBs. Five multi-ID names retain unread alternatives; Roberto Carlos is resolved within the candidate set. Cafú 3215 is rejected as a namesake; v1 ID 5003 remains an inherited mapping.

`source-attributes.json` carries selected original FIFA 05–07 CSV fields and the cache URL, size, and SHA-256. Numeric rows are included only for fresh page-confirmed IDs; unresolved and rejected IDs have availability metadata only. The 62.7 MiB source cache remains gitignored. Its data is FIFAIndex-attributed and is not independently verified as official EA data.

Run `python audit.py` offline to rebuild `coverage.csv` and `summary.json`. It reads committed v1 evidence plus this package, makes no network calls, and uses atomic write/read-back verification. The timing fields use the earliest complete FIFA 05/06/07 edition retained for each identity: fresh page-confirmed IDs use records in this package, while inherited mappings use records from the committed v1 evidence and are not refreshed from the pinned CSV. The timing bins therefore describe the retained evidence, not a cache-wide earliest-edition scan. Edition-year gaps are nominal edition labels, not exact source snapshot dates.

No runtime roster, ability v2 data, identity index, Draft, engine, prior v1 evidence, or calibration coefficients are changed.

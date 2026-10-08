# PES Legacy Bridge v0.1

## ERA DERBY baseline v2 retention

The imported source revision is `91cba4f8cee9f61dce9833f490b3a6461f905c26`. This baseline preserves the parser, synthetic fixture, aggregate coverage report, and source manifest. The raw `candidates.json` and captured live HTML excerpt are intentionally excluded: PES Master is a third-party source and the retail-data extraction and redistribution rights are unresolved. `test_pes_master_probe.py` runs only the synthetic parser cases for the 28 fields and values above 99; it does not reproduce the excluded 99-player candidate dataset. `finalize_pes5.py` requires the excluded `candidates.json` and cannot be run from this baseline. Do not reacquire source pages until current access terms and redistribution rights are reviewed.

This is an isolated research probe for whether PES 5 can supply a historical player-rating sidecar for early FIFA TeamSeasons. It does not change official datasets or convert PES ratings into FIFA fields.

The first four-team test (Valencia 2004, Porto 2004, Deportivo 2000, Parma 1999) was expanded to all 99 early PlayerSeason rows. The measured result is in [coverage-report.md](coverage-report.md): 94 rows have at least one PES Master candidate page and displayed OVR; manual review accepts 40 high-confidence identities plus 45 probable identities; 9 remain identity-uncertain and 5 have no candidate in the one targeted query. Complete 28-field pages are available for 57 target rows, including unresolved candidate rows; 52 of the 85 accepted/probable identity rows have full attributes on a selected candidate page.

PES Master is a third-party site. Its PES 5 labels and values are preserved as shown; the site does not document whether PES 5 values were extracted from retail game files, transcribed, or recalculated. PES 5 OVR is retained as displayed and may exceed 99. The native-versus-recomputed status of the PES 5 OVR is not confirmed. See [schema-comparison.md](schema-comparison.md) for field and cross-game limits.

## Files

- `source-manifest.json` records source/version/provenance findings, source URLs, aliases, and access limits.
- Upstream `candidates.json` contains the raw candidate observations and is intentionally absent from this baseline; its hash and recovery path are recorded in the integration report.
- `pes_master_probe.py` is the standard-library search/team/detail parser and paced collector.
- `supplement_pes5.py` resumes the saved collector output without refetching team pages.
- `finalize_pes5.py` applies the explicit manual identity-review map and rebuilds the row-level coverage report.
- `test_pes_master_probe.py` checks only synthetic roster/detail fixtures, including all 28 field labels and values/OVR above 99.
- `fixtures/pes5-parser-sample.html` is a small synthetic high-OVR fixture. The upstream live Vicente excerpt is excluded from this baseline.
- `.gitignore` excludes raw HTML/cache files.

## Reproduce

The reproducible check in this baseline is the synthetic parser suite (Python 3.10+):

```powershell
python -B research/pes-legacy-bridge/test_pes_master_probe.py
```

`finalize_pes5.py` cannot rebuild the retained `coverage-report.md` because the source `candidates.json` is excluded. The upstream aggregate is a frozen snapshot, not a result reproduced by this test. The collector and supplement scripts are retained for code review but were not run: PES Master extraction and redistribution terms are unresolved. Reacquisition and report regeneration require a source-terms review and a separately approved private cache; do not write third-party records into this release baseline.

## Candidate and identity statuses

- `identity_confirmed`: normalized full-name match or curated alias, checked against displayed country/position/age evidence.
- `identity_probable`: surname/initial match with supporting country, position, age, and where available club/roster evidence; first name is not fully shown.
- `identity_unresolved`: one or more candidate pages exist, but a namesake, conflicting profile, incomplete name, or contradictory age/profile prevents selecting a target identity.
- `no_candidate_in_targeted_name_search`: the one targeted surname query returned no candidate. This is not a claim that PES 5 or every archive lacks the player.

A PES 5 page's current club is not assumed to match the earlier target TeamSeason. Game-year deltas use a nominal 2005 anchor and are not an assertion about the exact roster cutoff. “Near target” is defined as a delta of at most one calendar year.

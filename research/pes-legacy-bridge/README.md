# PES Legacy Bridge v0.1

This is an isolated research probe for whether PES 5 can supply a historical player-rating sidecar for early FIFA TeamSeasons. It does not change official datasets or convert PES ratings into FIFA fields.

The first four-team test (Valencia 2004, Porto 2004, Deportivo 2000, Parma 1999) was expanded to all 99 early PlayerSeason rows. The measured result is in [coverage-report.md](coverage-report.md): 94 rows have at least one PES Master candidate page and displayed OVR; manual review accepts 40 high-confidence identities plus 45 probable identities; 9 remain identity-uncertain and 5 have no candidate in the one targeted query. Complete 28-field pages are available for 57 target rows, including unresolved candidate rows; 52 of the 85 accepted/probable identity rows have full attributes on a selected candidate page.

PES Master is a third-party site. Its PES 5 labels and values are preserved as shown; the site does not document whether PES 5 values were extracted from retail game files, transcribed, or recalculated. PES 5 OVR is retained as displayed and may exceed 99. The native-versus-recomputed status of the PES 5 OVR is not confirmed. See [schema-comparison.md](schema-comparison.md) for field and cross-game limits.

## Files

- `source-manifest.json` records source/version/provenance findings, source URLs, aliases, and access limits.
- `candidates.json` contains 99 stable `PlayerSeason` keys, source candidate rows, search/detail evidence, manual identity review, raw PES values, per-row year deltas, and the request ledger. No raw HTML is embedded.
- `pes_master_probe.py` is the standard-library search/team/detail parser and paced collector.
- `supplement_pes5.py` resumes the saved collector output without refetching team pages.
- `finalize_pes5.py` applies the explicit manual identity-review map and rebuilds the row-level coverage report.
- `test_pes_master_probe.py` checks the synthetic roster/detail fixture and the authentic live detail excerpt, including all 28 raw field labels; it also checks that values/OVR above 99 are not clipped.
- `fixtures/pes5-parser-sample.html` is a small synthetic high-OVR fixture. `fixtures/pes5-live-vicente-excerpt.html` is a <10 KB authentic excerpt from one PES Master response, with source URL, retrieval time, HTTP status, and SHA-256 of the original full response; excerpt line endings are normalized to LF and the full page was discarded.
- `.gitignore` excludes raw HTML/cache files.

## Reproduce

Offline checks use Python 3.10+ and the repository's existing `data/manual/fallback-team-seasons.json`:

```powershell
python -B research/pes-legacy-bridge/test_pes_master_probe.py
python -B research/pes-legacy-bridge/finalize_pes5.py
```

The second command reads the saved candidates and source TeamSeasons, rewrites the manual review annotations in `candidates.json`, and regenerates `coverage-report.md`. It makes no network requests.

To repeat the live bounded collection from scratch, use the visible public PES Master routes with normal requests only:

```powershell
python -B research/pes-legacy-bridge/pes_master_probe.py `
  --manifest research/pes-legacy-bridge/source-manifest.json `
  --targets data/manual/fallback-team-seasons.json `
  --output research/pes-legacy-bridge/candidates.json `
  --max-requests 100 --delay 1.5
python -B research/pes-legacy-bridge/supplement_pes5.py `
  --manifest research/pes-legacy-bridge/source-manifest.json `
  --targets data/manual/fallback-team-seasons.json `
  --candidates research/pes-legacy-bridge/candidates.json `
  --max-requests 50 --delay 1.5
python -B research/pes-legacy-bridge/finalize_pes5.py
```

Live collection is optional. The saved sample and offline tests are sufficient to inspect the result. The scripts use a fixed user agent, at least 1.5 seconds between requests, no retry, no pagination crawl, no challenge bypass, and stop on network/HTTP error or challenge marker. They retain only parsed records and a request ledger, not webpage bodies. Check the source site's current access terms and `robots.txt` before a new run.

## Candidate and identity statuses

- `identity_confirmed`: normalized full-name match or curated alias, checked against displayed country/position/age evidence.
- `identity_probable`: surname/initial match with supporting country, position, age, and where available club/roster evidence; first name is not fully shown.
- `identity_unresolved`: one or more candidate pages exist, but a namesake, conflicting profile, incomplete name, or contradictory age/profile prevents selecting a target identity.
- `no_candidate_in_targeted_name_search`: the one targeted surname query returned no candidate. This is not a claim that PES 5 or every archive lacks the player.

A PES 5 page's current club is not assumed to match the earlier target TeamSeason. Game-year deltas use a nominal 2005 anchor and are not an assertion about the exact roster cutoff. “Near target” is defined as a delta of at most one calendar year.

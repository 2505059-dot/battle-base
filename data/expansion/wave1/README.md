# Wave 1 expansion data package

This is a standalone preparation package for the first 29 proposed TeamSeasons. It is not imported into the game, data/manual/season-pool.json, the canonical player index, aliases, generated public data, or the shared build pipeline. Nothing here is ready for formal v2 ingestion until the v2 input contract is available.

## Layout

- manifest.json records all 29 candidates, their planned group, real entity type/competition, version audit, source availability, open issues, and handoff readiness.
- sources/ keeps source-specific raw values and provenance separate from package-level interpretation. Raw CSV scalars remain strings; blank and NA values stay missing, while literal 0 stays 0.
- rosters/ contains per-candidate roster snapshots and membership evidence. National tournament submissions/final lists, game rosters, and attribute-only candidates are distinct records.
- identity-matches.json is an expansion-only matching proposal. Only exact existing source-ID matches are confirmed; name similarity is a review clue, not identity proof.
- coverage-report.json and coverage-report.md define coverage by record type and source.
- scripts/expansion/ contains isolated build/check scripts for this package only.

## Source and version rules

SoFIFA and FIFAIndex are the preferred historical ability sources. The package records the specific edition, team ID, source URL, fetched-file checksum, and any update date actually evidenced by the source. FIFAIndex edition pages generally do not expose a patch date; an unknown date is left unknown. Cached mirror data is attributed to the mirror and is not presented as a direct live-page read. The CSV cache is retained locally under data/raw/fifa/expansion-wave1/ for reproducibility and is intentionally excluded from this deliverable.

A candidate year is not itself proof of a roster snapshot. Club years are audited against the project's season convention and the source edition. Examples of open version issues include Milan's later FIFA18 cache snapshot versus the February 2018 SoFIFA target, Liverpool's September 2014 FIFA14 snapshot still listing Luis Suárez, and Arsenal's late FIFA19 update. These remain explicitly marked supplemental or date-sensitive in the per-team records.

For national teams, the tournament roster is the membership reference. A game's national-team roster is a separate game snapshot and can differ in players and count. Mexico's submitted list (with Diego Reyes) and final list (with Erick Gutiérrez) are retained separately; the replacement is sourced to secondary reports of the federation/FIFA update. FIFAIndex attributes matched by exact normalized full name plus nationality are only attribute candidates and do not prove tournament membership or canonical identity.

Americas Wildcard and World Wildcard are planning labels only. Each record separately states the real club/competition. National teams remain national-team entities. These groups do not set league membership or imply a draft weight.

## Rebuild and read-only verification

Run from the repository root with the local cache present:

- node scripts/expansion/build-wave1-package.mjs rebuilds the package from the cache.
- node scripts/expansion/build-national-attribute-candidates.mjs adds the separate national-team attribute-candidate layer.
- node scripts/expansion/build-wave1-package.mjs --check and node scripts/expansion/build-national-attribute-candidates.mjs --check validate the existing package without writing it.

A successful source audit does not imply a complete roster, complete attributes, or v2 readiness. Coverage denominators are separated by main game records, event rosters, national attribute candidates, and unique source IDs. Empty coverage means no usable matching rows were obtained from the available cache; it does not prove that the source has no such data.

## Integration items

- Confirm v2's accepted raw attribute fields, missing-value representation, provenance fields, and source-version precedence before ingestion.
- Review unresolved, proposed-new, placeholder-heuristic, and multi-candidate identities; do not merge this list into the canonical index automatically.
- Audit draft distribution and refresh reachability after adding TeamSeasons. The current package does not implement wildcard weights.
- Define country display/entity handling before integrating national teams.
- Resolve candidates with incomplete source coverage and verify any source snapshots whose dates do not match the intended story roster.

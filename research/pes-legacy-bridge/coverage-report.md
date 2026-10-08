# PES 5 pilot and early-99 coverage report

Research snapshot: **2026-10-08**. Target universe: 99 PlayerSeason rows from `data/manual/fallback-team-seasons.json`. PES Master PES 5 is treated as a nominal **2005** game-year anchor; the site does not establish an exact roster cutoff. A “near” snapshot means an absolute year difference of at most one.

## Result

- PES Master returned a candidate page for **94/99** rows; **94/99** have a displayed OVR on a candidate row or detail page. This is candidate presence, not verified target identity.
- Manual review accepted **40 high-confidence identities** (normalized full name or curated alias with supporting page attributes) and **45 probable identities** (surname/initial plus matching nationality, position and age/context). Together that is **85/99** usable identity candidates for follow-up, with 45 at medium confidence.
- **9** rows have one or more plausible/name-collision pages but insufficient evidence to select the target; **5** returned no candidate in the one targeted PES Master query. A no-hit does not prove absence from every PES5 source.
- Full 28-field PES attributes were captured for **57/99 PlayerSeason rows** when at least one linked candidate page had every expected field; among high/probable identities, **52** have full attributes on the selected candidate page. There are **66** unique complete candidate detail pages.
- By the stated <=1-year rule, **27/27** target rows have an identity candidate close to the PES5 year. These are the 2004 TeamSeasons; PES5 is still only a 2005-era snapshot and says nothing about the target's exact season rating.

## Coverage by target team

| TeamSeason club | Target year | PES5 year delta | Rows | Candidate page | OVR | Complete 28 fields | High | Probable | Identity unresolved | Targeted no-hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Manchester United | 1999 | 6 | 9 | 7 | 7 | 7 | 1 | 5 | 1 | 2 |
| Arsenal | 2004 | 1 | 9 | 9 | 9 | 9 | 2 | 7 | 0 | 0 |
| Real Madrid | 2002 | 3 | 9 | 9 | 9 | 2 | 2 | 6 | 1 | 0 |
| Valencia | 2004 | 1 | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 0 |
| Deportivo La Coruna | 2000 | 5 | 9 | 8 | 8 | 8 | 6 | 0 | 2 | 1 |
| Juventus | 2003 | 2 | 9 | 8 | 8 | 2 | 2 | 6 | 0 | 1 |
| Roma | 2001 | 4 | 9 | 9 | 9 | 2 | 2 | 6 | 1 | 0 |
| Lazio | 2000 | 5 | 9 | 9 | 9 | 1 | 1 | 6 | 2 | 0 |
| Parma | 1999 | 6 | 9 | 8 | 8 | 8 | 6 | 0 | 2 | 1 |
| Bayern Munich | 2001 | 4 | 9 | 9 | 9 | 0 | 0 | 9 | 0 | 0 |
| Porto | 2004 | 1 | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 0 |

## Four-team pilot

The initial pilot contains Valencia 2004, Porto 2004, Deportivo 2000 and Parma 1999 (36 rows). PES Master team pages supplied all nine Valencia and all nine Porto identities; targeted surname searches found candidates for Deportivo and Parma players who had moved by PES5. The manual review yields:

| Pilot club | Rows | Candidate page | OVR | Full 28 fields (candidate) | High | Probable | Identity unresolved | Targeted no-hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Valencia | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 0 |
| Porto | 9 | 9 | 9 | 9 | 9 | 0 | 0 | 0 |
| Deportivo La Coruna | 9 | 8 | 8 | 8 | 6 | 0 | 2 | 1 |
| Parma | 9 | 8 | 8 | 8 | 6 | 0 | 2 | 1 |

PES5 team roster status is not treated as target-year club membership. For example, players found at Bayern, Chelsea, Inter, PSG, Tottenham or Juventus may still be candidates for an earlier target club if the identity evidence fits.

## Method, request accounting, and limitations

The probe checked the 11 PES5 team pages, queried target surnames only, retained the first result page (up to 30 rows), and fetched selected candidate detail pages. It did not enumerate the full PES5 database. Each request was paced at >=1.5 seconds. The bounded collector logged **151** requests with URL, status, timestamp, byte count and purpose; **10** initial exploratory GETs were counted but their exact URLs were not persisted, so they are explicitly unlogged rather than reconstructed. Total observed requests: **161**. No challenge or retry was observed. One full response was held temporarily for excerpt extraction and then removed; no full-page or bulk cache remains.

PES Master is a third-party presentation of PES5 data. The site/page does not prove retail-game extraction, and PES5 OVR native-versus-recomputed status is unverified. The reported OVR is kept as displayed, without 1–99 clipping. Search results can be truncated; name-only search misses do not establish that a player is absent from the game or from other sources. Identity review is human-readable evidence triage, not a ground-truth roster validation.

Reproduce the offline review and parser tests with the commands in [README.md](README.md). The synthetic fixture exercises OVR >99. A separate under-10-KB authentic Vicente detail excerpt is retained at [fixtures/pes5-live-vicente-excerpt.html](fixtures/pes5-live-vicente-excerpt.html), with source URL/date and the SHA-256 of the original full response; its line endings are normalized to LF. The complete response was removed after extraction.

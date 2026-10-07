# Wave 1 coverage report

Generated: 2026-10-07T15:25:04.192Z

## Denominators

- Candidates: 29 candidate TeamSeason IDs.
- Roster extraction: per-team raw player rows matching exact source team text in one locally cached game edition; this does not measure authoritative full squad coverage.
- Raw attributes: non-empty and non-NA source cells divided by raw source attribute cells present in extracted rows; literal source 0 remains a value and is separately counted.
- Identity: extracted player records with exact external source-ID match divided by records having source IDs; name-only matches remain unconfirmed.
- Formal event lists: players printed in a cited formal competition roster source; event roster snapshots remain separate from game roster snapshots.

## Counts

- Candidate IDs recorded: 29/29.
- Teams with game-edition raw player rows: 22/29.
- Teams with formal event roster source rows: 6/29.
- Raw player rows extracted: 636.
- Raw attribute cells present: 25668/25980.
- Raw attribute cells blank/NA: 312.
- Literal source zero cells: 1105.
- Separate national attribute-candidate cells present: 4592/4592; blank/NA: 0; literal zero: 122.
- Main game-edition player records: 636.
- Formal event-roster entries (separate snapshots): 161.
- National attribute-candidate records (not roster membership): 112.
- Identity record rows across those categories: 909.
- Rows with source IDs: 748; distinct source-system/ID keys: 713.
- Rows without source IDs (mostly official event lists): 161.
- Record-level exact-ID identity matches: 98.
- Final tournament roster attribute-name candidates: 111/138 unique names.
- Submitted/final snapshot union candidates: 112/139 unique names.
- Data v2 integration-ready teams: 0/29.

## Per-team status

| Candidate | Season/event | Main rows | Main attribute cells P/M | Event entries | National attribute rows | National attribute cells P/M | Identity records | Source IDs | Group | Audit | Version | V2 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| ac-milan-2018 | 2017/18 | 26 | 1066/0 | 0 | 0 | 0/0 | 26 | 26 | story-club | edition-page metadata reviewed; mirror row coverage audited | later supplemental snapshot r180084 does not match target r180040 | pending interface |
| manchester-united-2014 | 2013/14 | 32 | 1312/0 | 0 | 0 | 0/0 | 32 | 32 | story-club | edition-page metadata reviewed; mirror row coverage audited | SoFIFA target r140002 (date unconfirmed) differs from cached r140052; cached revision is supplemental | pending interface |
| liverpool-2014 | 2013/14 | 33 | 1353/0 | 0 | 0 | 0/0 | 33 | 33 | story-club | edition-page metadata reviewed; mirror row coverage audited | 2014-09-19 snapshot still lists Luis Suárez; story-season content needs review | pending interface |
| real-madrid-2009 | 2008/09 | 34 | 1394/0 | 0 | 0 | 0/0 | 34 | 34 | story-club | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex FIFA09 list excludes Cristiano Ronaldo; SoFIFA date is a community squad page, not a confirmed official team revision | pending interface |
| arsenal-2019 | 2018/19 | 33 | 1353/0 | 0 | 0 | 0/0 | 33 | 33 | story-club | edition-page metadata reviewed; mirror row coverage audited | late FIFA19 update; season alignment needs review | pending interface |
| porto-2011 | 2010/11 | 24 | 984/0 | 0 | 0 | 0/0 | 24 | 24 | story-club | edition-page metadata reviewed; mirror row coverage audited | SoFIFA target r110001 dated 2010-08-30 differs from cached r110002; cache is supplemental | pending interface |
| paris-saint-germain-2018 | 2017/18 | 29 | 1189/0 | 0 | 0 | 0/0 | 29 | 29 | club-league | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| lyon-2010 | 2009/10 | 35 | 1435/0 | 0 | 0 | 0/0 | 35 | 35 | club-league | edition-page metadata reviewed; mirror row coverage audited | SoFIFA target r100002 dated 2010-02-22 matches observed cached revision r100002 | pending interface |
| feyenoord-2017 | 2016/17 | 29 | 1189/0 | 0 | 0 | 0/0 | 29 | 29 | club-league | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| sporting-cp-2017 | 2016/17 | 30 | 1230/0 | 0 | 0 | 0/0 | 30 | 30 | club-league | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| benfica-2010 | 2009/10 | 29 | 1189/0 | 0 | 0 | 0/0 | 29 | 29 | club-league | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| bayer-leverkusen-2011 | 2010/11 | 22 | 902/0 | 0 | 0 | 0/0 | 22 | 22 | club-league | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| spain-2010 | 2010 World Cup | 0 | 0/0 | 23 | 11 | 451/0 | 34 | 11 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| germany-2014 | 2014 World Cup | 0 | 0/0 | 23 | 23 | 943/0 | 46 | 23 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| france-2018 | 2018 World Cup | 0 | 0/0 | 23 | 23 | 943/0 | 46 | 23 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| russia-2018 | 2018 World Cup | 0 | 0/0 | 23 | 13 | 533/0 | 36 | 13 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| belgium-2018 | 2018 World Cup | 0 | 0/0 | 23 | 22 | 902/0 | 45 | 22 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| mexico-2018 | 2018 World Cup | 0 | 0/0 | 46 | 20 | 820/0 | 66 | 20 | national-team | event roster source audited; game-edition comparison partial because game names are not transcribed | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| inter-miami-2024 | 2023/24 | 30 | 1230/0 | 0 | 0 | 0/0 | 30 | 30 | Americas Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| la-galaxy-2019 | 2018/19 | 28 | 1148/0 | 0 | 0 | 0/0 | 28 | 28 | Americas Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| sao-paulo-2005 | 2004/05 ID convention; calendar-year club season needs confirmation | 24 | 576/312 | 0 | 0 | 0/0 | 24 | 24 | Americas Wildcard | mirror rows extracted; direct source-page/version audit incomplete | FIFAIndex-derived player dataset; no team-edition page or update date captured | pending interface |
| santos-2011 | 2010/11 | 30 | 1230/0 | 0 | 0 | 0/0 | 30 | 30 | Americas Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| river-plate-2018 | 2017/18 | 28 | 1148/0 | 0 | 0 | 0/0 | 28 | 28 | Americas Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| kashima-antlers-2016 | 2016; FIFA Club World Cup | 28 | 1148/0 | 0 | 0 | 0/0 | 28 | 28 | World Wildcard | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| guangzhou-rf-2019 | 2018/19 | 0 | 0/0 | 0 | 0 | 0/0 | 0 | 0 | World Wildcard | incomplete source-team mapping; Guangzhou R&F alias/page not verified | edition only; exact target update not audited | pending interface |
| anzhi-2013 | 2012/13 | 27 | 1107/0 | 0 | 0 | 0/0 | 27 | 27 | World Wildcard | edition-page metadata reviewed; mirror row coverage audited | FIFAIndex edition page identifies game version but does not disclose patch/update date | pending interface |
| zenit-2015 | 2014/15 | 30 | 1230/0 | 0 | 0 | 0/0 | 30 | 30 | World Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| galatasaray-2013 | 2012/13 | 25 | 1025/0 | 0 | 0 | 0/0 | 25 | 25 | World Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |
| al-nassr-2024 | 2023/24 | 30 | 1230/0 | 0 | 0 | 0/0 | 30 | 30 | World Wildcard | mirror rows extracted; direct source-page/version audit incomplete | edition only; exact target update not audited | pending interface |

## Known limits

- Data v2 source-field and handoff contract is not yet defined; integration readiness is false for every team.
- FIFAIndex edition-page counts and mirrored SoFIFA CSV row counts are separate observations and are not forced to match.
- Most cache acquisition timestamps and most game revision dates are unavailable; see per-source metadata.
- FIFAIndex game roster names are not transcribed for the six national teams; only edition, page URL, count and reviewed event-list comparison are available.
- Possible-placeholder labels use a name-pattern heuristic only and do not establish that a player is fictional.
- FIFAIndex edition pages do not disclose a verified patch/update date for the cited snapshots; unknown dates remain null.
- National final-list attribute coverage is 111/138 unique final-list names; the submitted/final snapshot union is 112/139 unique names because Mexico replaced Diego Reyes with Erick Gutiérrez.
- National-team attribute candidates are SoFIFA club rows linked to event names by exact full name and nationality; they remain separate from official and game national-team rosters.

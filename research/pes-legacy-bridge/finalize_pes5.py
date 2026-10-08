#!/usr/bin/env python3
"""Offline identity review and coverage-report builder for the bounded PES5 sample."""
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'source-manifest.json'
CANDIDATES=ROOT/'candidates.json'
TARGETS=ROOT.parent.parent/'data'/'manual'/'fallback-team-seasons.json'
manifest=json.loads(MANIFEST.read_text(encoding='utf-8'))
data=json.loads(CANDIDATES.read_text(encoding='utf-8'))
targets=json.loads(TARGETS.read_text(encoding='utf-8'))
source_by_id={s['id']:s for s in targets}

# Manual review accepts only records whose name/alias and PES5-facing roster
# facts agree. Abbreviated surnames remain medium-confidence, never high.
def spec(name=None, nationality=None, age=None, position=None):
    return {'name':name,'nationality':nationality,'age':age,'position':position}

probable={
('manchester-united-1999','Jaap Stam'):spec('Stam','Netherlands',33,'CB'),
('manchester-united-1999','Gary Neville'):spec('G. Neville','England',30,'SB'),
('manchester-united-1999','David Beckham'):spec('Beckham','England',30,'SM'),
('manchester-united-1999','Paul Scholes'):spec('Scholes','England',30,'CM'),
('manchester-united-1999','Ryan Giggs'):spec('Giggs','Wales',31,'WF'),
('arsenal-2004','Jens Lehmann'):spec('Lehmann','Germany',35,'GK'),
('arsenal-2004','Sol Campbell'):spec('Campbell','England',31,'CB'),
('arsenal-2004','Kolo Toure'):spec('Toure',"Côte d'Ivoire",24,'CB'),
('arsenal-2004','Patrick Vieira'):spec('Vieira','France',29,'CM'),
('arsenal-2004','Robert Pires'):spec('Pires','France',32,'AM'),
('arsenal-2004','Thierry Henry'):spec('Henry','France',28,'CF'),
('arsenal-2004','Dennis Bergkamp'):spec('Bergkamp','Netherlands',36,'SS'),
('real-madrid-2002','Iker Casillas'):spec('Casillas','Spain',24,'GK'),
('real-madrid-2002','Michel Salgado'):spec('Salgado','Spain',30,'SB'),
('real-madrid-2002','Zinedine Zidane'):spec('Zidane','France',33,'AM'),
('real-madrid-2002','Claude Makelele'):spec('Makelele','France',32,'DM'),
('real-madrid-2002','Luis Figo'):spec('Figo','Portugal',32,'SM'),
('real-madrid-2002','Fernando Morientes'):spec('Morientes','Spain',29,'CF'),
('juventus-2003','Gianluca Zambrotta'):spec('Zambrotta','Italy',28,'SB'),
('juventus-2003','Pavel Nedved'):spec('Nedved','Czech Republic',33,'AM'),
('juventus-2003','Edgar Davids'):spec('Davids','Netherlands',32,'CM'),
('juventus-2003','Mauro Camoranesi'):spec('Camoranesi','Italy',29,'SM'),
('juventus-2003','Alessandro Del Piero'):spec('Del Piero','Italy',30,'SS'),
('juventus-2003','David Trezeguet'):spec('Trezeguet','France',28,'CF'),
('roma-2001','Francesco Antonioli'):spec('Antonioli','Italy',36,'GK'),
('roma-2001','Walter Samuel'):spec('Samuel','Argentina',27,'CB'),
('roma-2001','Vincent Candela'):spec('Candela','France',31,'SB'),
('roma-2001','Damiano Tommasi'):spec('Tommasi','Italy',31,'CM'),
('roma-2001','Hidetoshi Nakata'):spec('H. Nakata','Japan',28,'AM'),
('roma-2001','Francesco Totti'):spec('Totti','Italy',29,'SS'),
('lazio-2000','Luca Marchegiani'):spec('Marchegiani','Italy',39,'GK'),
('lazio-2000','Alessandro Nesta'):spec('Nesta','Italy',29,'CB'),
('lazio-2000','Sinisa Mihajlovic'):spec('Mihajlovic','Serbia and Montenegro',36,'CB'),
('lazio-2000','Giuseppe Pancaro'):spec('Pancaro','Italy',34,'SB'),
('lazio-2000','Pavel Nedved'):spec('Nedved','Czech Republic',33,'AM'),
('lazio-2000','Diego Simeone'):spec('Simeone','Argentina',35,'DM'),
('bayern-munich-2001','Oliver Kahn'):spec('Kahn','Germany',36,'GK'),
('bayern-munich-2001','Sammy Kuffour'):spec('Kuffour','Ghana',29,'CB'),
('bayern-munich-2001','Patrik Andersson'):spec('P. Andersson','Sweden',30,'CB'),
('bayern-munich-2001','Bixente Lizarazu'):spec('Lizarazu','France',35,'SB'),
('bayern-munich-2001','Willy Sagnol'):spec('Sagnol','France',28,'SB'),
('bayern-munich-2001','Stefan Effenberg'):spec('Effenberg','Germany',37,'DM'),
('bayern-munich-2001','Owen Hargreaves'):spec('Hargreaves','England',24,'DM'),
('bayern-munich-2001','Mehmet Scholl'):spec('Scholl','Germany',35,'AM'),
('bayern-munich-2001','Giovane Elber'):spec('Elber','Brazil',33,'CF'),
}
uncertain_reasons={
('manchester-united-1999','Peter Schmeichel'):'Surname results include a 29-year-old Schmeichel and an 18-year-old K. Schmeichel; neither page establishes the target full identity.',
('real-madrid-2002','Fernando Hierro'):'The only candidate is listed as Hierro, Spain/DM, age 28; the abbreviated name and age/profile conflict leave identity unconfirmed.',
('deportivo-la-coruna-2000','Donato'):'The targeted query returns Di Donato (Italy/DM); the name and nationality do not support the Deportivo target.',
('deportivo-la-coruna-2000','Mauro Silva'):'Exact text appears, but this page has no corroborating roster link and its age/profile is inconsistent with the historical Deportivo identity; retained as a namesake candidate only.',
('roma-2001','Gabriel Batistuta'):'The candidate is surname-only. Nationality and position fit, but its displayed age differs materially from the target-era profile and the page offers no first-name corroboration.',
('lazio-2000','Roberto Mancini'):'Search results return two players named Mancini with different nationalities/positions; neither has enough evidence to identify the historical target.',
('lazio-2000','Marcelo Salas'):'Two separate Chilean CF pages are both labelled Salas and have similar ages/roles; the source does not distinguish which page is the target.',
('parma-1999','Dino Baggio'):'The results are Baggio (SS, age 38) and Di Baggio (SW, age 34); neither page identifies Dino and their profiles conflict.',
('parma-1999','Roberto Sensini'):'The abbreviated Sensini candidate lacks first-name corroboration and displays a materially inconsistent age for the historical target.',
}
nohit_reasons={
('manchester-united-1999','Denis Irwin'):'One targeted surname search returned no candidate row.',
('manchester-united-1999','Dwight Yorke'):'One targeted surname search returned no candidate row.',
('deportivo-la-coruna-2000',"Jacques Songo'o"):'The corrected Songo surname query returned no candidate row; the earlier apostrophe query was discarded.',
('juventus-2003','Ciro Ferrara'):'One targeted surname search returned no candidate row.',
('parma-1999','Diego Fuser'):'One targeted surname search returned no candidate row.',
}

def matches(c, wanted):
    return all(value is None or c.get(field)==value for field,value in wanted.items())

def candidate_evidence(c):
    return {'candidate_name':c.get('name'),'nationality':c.get('nationality'),'age_at_PES5_page':c.get('age'),'position':c.get('position'),'PES5_team_or_search_club':c.get('team_label') or c.get('club'),'displayed_ovr':c.get('displayed_ovr') or (c.get('detail_page') or {}).get('displayed_ovr'),'source_url':c.get('player_url'),'full_detail_attributes':bool((c.get('detail_page') or {}).get('complete_detail_attributes'))}

all_players=[]
for season in data['target_seasons']:
    target=source_by_id[season['target_season_id']]
    season['target_year']=target['year']
    season['game_year_anchor']=2005
    season['game_year_delta']=2005-target['year']
    season['snapshot_year_is_nominal']=True
    for player in season['players']:
        k=(season['target_season_id'],player['target_player_name'])
        player['player_season_key']=f"{season['target_season_id']}::{player['target_player_name']}"
        player['target_year']=target['year']
        player['game_year_anchor']=2005
        player['game_year_delta']=2005-target['year']
        player['auto_identity_status']=player.get('auto_identity_status',player.get('identity_status'))
        cands=player.get('candidates',[])
        chosen=[]
        if k in nohit_reasons:
            status='no_candidate_in_targeted_name_search'
            reason=nohit_reasons[k]
            confidence='none'
            method='one targeted PES5 surname search; no result'
        elif k in uncertain_reasons:
            status='identity_unresolved'
            reason=uncertain_reasons[k]
            confidence='unresolved'
            method='manual collision/profile review; no unambiguous selected identity'
        elif k in probable:
            wanted=probable[k]
            chosen=[c for c in cands if matches(c,wanted)]
            if not chosen:
                raise SystemExit(f'missing expected probable candidate for {k}: {wanted}')
            status='identity_probable'
            confidence='medium'
            reason='Surname or initial plus nationality, position, and age support the match, but PES Master does not show the target full name; keep this below a direct identity match.'
            method='manual review of first-page PES5 search row against nationality/position/age and, when present, club/roster context'
        elif player.get('auto_identity_status')=='verified_pes5_record':
            chosen=[c for c in cands if c.get('match_status','').startswith('verified_')]
            if player['target_player_name']=='Juan Sebastian Veron':
                chosen=[c for c in chosen if c.get('nationality')=='Argentina' and c.get('position')=='AM' and c.get('age')==30]
            chosen=list({c.get('player_url'):c for c in chosen}.values())
            if not chosen:
                raise SystemExit(f'no direct candidate for auto-matched row {k}')
            status='identity_confirmed'
            confidence='high'
            reason='Normalized exact name or manually reviewed abbreviation/accent alias matches; nationality and listed role/age are consistent with the target identity.'
            method='exact normalized name or curated alias, checked against displayed nationality/position/age'
        else:
            raise SystemExit(f'row not adjudicated: {k}, old status={player.get("auto_identity_status")}')
        chosen_urls=sorted({c.get('player_url') for c in chosen if c.get('player_url')})
        chosen_evidence=[candidate_evidence(c) for c in chosen]
        player['identity_status']=status
        player['identity_confidence']=confidence
        player['identity_review']={'method':method,'reason':reason,'selected_candidate_urls':chosen_urls,'evidence':chosen_evidence,'candidate_page_count':len(chosen_urls),'full_detail_on_selected_candidate':any(e['full_detail_attributes'] for e in chosen_evidence)}
        for c in cands:
            selected=c.get('player_url') in chosen_urls
            c['identity_confidence']=confidence if selected else ('unresolved' if c.get('match_status','').startswith('unresolved_') or k in uncertain_reasons else 'not_selected')
            c['identity_review_status']='selected_for_target' if selected else ('unresolved_collision_candidate' if k in uncertain_reasons else 'alternate_candidate')
            c['target_year']=target['year']
            c['game_version']='PES 5'
            c['game_year_anchor']=2005
            c['game_year_delta']=2005-target['year']
            c['source_original_game_provenance']='unconfirmed'
        all_players.append((season,player))

# Add auditable request accounting: collector log is complete for two bounded runs;
# initial manual probes are counted but exact URLs were not persisted.
policy=data['request_policy']
logged=len(policy.get('request_log',[]))
policy['fully_logged_request_count']=logged
policy['preflight_unlogged_request_count']=10
policy['total_observed_request_count']=logged+10
policy['preflight_note']='Ten initial exploratory public GETs are included in the task-level total but their exact request URLs were not persisted; they are not reconstructed or fabricated here.'
policy['all_requests_spaced_at_least_seconds']=1.5
policy['http_errors_or_challenges_observed']=False
policy['raw_html_saved']=False
policy['stop_reason']='planned_request_budget_completed_without_error'
data['research_method']={'identity_review':'manual identity review kept separate from source parser automatic exact/alias rules','snapshot_year_anchor':2005,'near_target_threshold_years':1,'near_target_definition':'absolute nominal game-year minus TeamSeason.year <= 1','raw_attribute_labels_preserved':True,'ovr_clipped':False,'target_source_read_only':True}
data['generated_at_utc']=datetime.now(timezone.utc).isoformat()

# Coverage counts are at PlayerSeason-row level unless noted.
rows=[p for _,p in all_players]
counts=Counter(p['identity_status'] for p in rows)
summary={
 'total':len(rows),
 'high':counts['identity_confirmed'],
 'probable':counts['identity_probable'],
 'unresolved':counts['identity_unresolved'],
 'no_candidate':counts['no_candidate_in_targeted_name_search'],
 'candidate_rows':sum(bool(p.get('candidates')) for p in rows),
 'ovr_rows':sum(any(c.get('displayed_ovr') is not None or (c.get('detail_page') or {}).get('displayed_ovr') is not None for c in p.get('candidates',[])) for p in rows),
 'full_detail_any_candidate':sum(any((c.get('detail_page') or {}).get('complete_detail_attributes') for c in p.get('candidates',[])) for p in rows),
 'full_detail_selected':sum(p['identity_status'] in ('identity_confirmed','identity_probable') and p['identity_review']['full_detail_on_selected_candidate'] for p in rows),
 'near_target_rows':sum(abs(p['game_year_delta'])<=1 for p in rows),
 'near_target_with_identity':sum(abs(p['game_year_delta'])<=1 and p['identity_status'] in ('identity_confirmed','identity_probable') for p in rows),
 'unique_candidate_urls':len({c.get('player_url') for p in rows for c in p.get('candidates',[]) if c.get('player_url')}),
 'unique_full_detail_pages':len({c.get('player_url') for p in rows for c in p.get('candidates',[]) if c.get('player_url') and (c.get('detail_page') or {}).get('complete_detail_attributes')}),
 'logged_requests':logged,
 'unlogged_preflight':10,
 'total_observed_requests':logged+10,
}
data['coverage_summary']=summary
CANDIDATES.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# The 11-team table separates candidate evidence from identity confidence.
lines=[]
for season in data['target_seasons']:
    ps=season['players']
    team=season['target_club']
    lines.append('| {team} | {year} | {delta} | {n} | {cand} | {ovr} | {detail} | {high} | {prob} | {unres} | {miss} |'.format(
        team=team,year=season['target_year'],delta=season['game_year_delta'],n=len(ps),
        cand=sum(bool(p['candidates']) for p in ps),
        ovr=sum(any(c.get('displayed_ovr') is not None or (c.get('detail_page') or {}).get('displayed_ovr') is not None for c in p['candidates']) for p in ps),
        detail=sum(any((c.get('detail_page') or {}).get('complete_detail_attributes') for c in p['candidates']) for p in ps),
        high=sum(p['identity_status']=='identity_confirmed' for p in ps),
        prob=sum(p['identity_status']=='identity_probable' for p in ps),
        unres=sum(p['identity_status']=='identity_unresolved' for p in ps),
        miss=sum(p['identity_status']=='no_candidate_in_targeted_name_search' for p in ps)))
team_table='\n'.join(lines)
report=f'''# PES 5 pilot and early-99 coverage report

Research snapshot: **2026-10-08**. Target universe: 99 PlayerSeason rows from `data/manual/fallback-team-seasons.json`. PES Master PES 5 is treated as a nominal **2005** game-year anchor; the site does not establish an exact roster cutoff. A “near” snapshot means an absolute year difference of at most one.

## Result

- PES Master returned a candidate page for **{summary['candidate_rows']}/99** rows; **{summary['ovr_rows']}/99** have a displayed OVR on a candidate row or detail page. This is candidate presence, not verified target identity.
- Manual review accepted **{summary['high']} high-confidence identities** (normalized full name or curated alias with supporting page attributes) and **{summary['probable']} probable identities** (surname/initial plus matching nationality, position and age/context). Together that is **{summary['high']+summary['probable']}/99** usable identity candidates for follow-up, with 45 at medium confidence.
- **{summary['unresolved']}** rows have one or more plausible/name-collision pages but insufficient evidence to select the target; **{summary['no_candidate']}** returned no candidate in the one targeted PES Master query. A no-hit does not prove absence from every PES5 source.
- Full 28-field PES attributes were captured for **{summary['full_detail_any_candidate']}/99 PlayerSeason rows** when at least one linked candidate page had every expected field; among high/probable identities, **{summary['full_detail_selected']}** have full attributes on the selected candidate page. There are **{summary['unique_full_detail_pages']}** unique complete candidate detail pages.
- By the stated <=1-year rule, **{summary['near_target_with_identity']}/{summary['near_target_rows']}** target rows have an identity candidate close to the PES5 year. These are the 2004 TeamSeasons; PES5 is still only a 2005-era snapshot and says nothing about the target's exact season rating.

## Coverage by target team

| TeamSeason club | Target year | PES5 year delta | Rows | Candidate page | OVR | Complete 28 fields | High | Probable | Identity unresolved | Targeted no-hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
{team_table}

## Four-team pilot

The initial pilot contains Valencia 2004, Porto 2004, Deportivo 2000 and Parma 1999 (36 rows). PES Master team pages supplied all nine Valencia and all nine Porto identities; targeted surname searches found candidates for Deportivo and Parma players who had moved by PES5. The manual review yields:

| Pilot club | Rows | Candidate page | OVR | Full 28 fields (candidate) | High | Probable | Identity unresolved | Targeted no-hit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
'''
for sid in manifest['pilotSeasonIds']:
    s=next(x for x in data['target_seasons'] if x['target_season_id']==sid); ps=s['players']
    report+='| {club} | {n} | {cand} | {ovr} | {detail} | {high} | {prob} | {unres} | {miss} |\n'.format(club=s['target_club'],n=len(ps),cand=sum(bool(p['candidates']) for p in ps),ovr=sum(any(c.get('displayed_ovr') is not None or (c.get('detail_page') or {}).get('displayed_ovr') is not None for c in p['candidates']) for p in ps),detail=sum(any((c.get('detail_page') or {}).get('complete_detail_attributes') for c in p['candidates']) for p in ps),high=sum(p['identity_status']=='identity_confirmed' for p in ps),prob=sum(p['identity_status']=='identity_probable' for p in ps),unres=sum(p['identity_status']=='identity_unresolved' for p in ps),miss=sum(p['identity_status']=='no_candidate_in_targeted_name_search' for p in ps))
report+='''
PES5 team roster status is not treated as target-year club membership. For example, players found at Bayern, Chelsea, Inter, PSG, Tottenham or Juventus may still be candidates for an earlier target club if the identity evidence fits.

## Method, request accounting, and limitations

The probe checked the 11 PES5 team pages, queried target surnames only, retained the first result page (up to 30 rows), and fetched selected candidate detail pages. It did not enumerate the full PES5 database. Each request was paced at >=1.5 seconds. The bounded collector logged **{logged}** requests with URL, status, timestamp, byte count and purpose; **10** initial exploratory GETs were counted but their exact URLs were not persisted, so they are explicitly unlogged rather than reconstructed. Total observed requests: **{total}**. No challenge or retry was observed. One full response was held temporarily for excerpt extraction and then removed; no full-page or bulk cache remains.

PES Master is a third-party presentation of PES5 data. The site/page does not prove retail-game extraction, and PES5 OVR native-versus-recomputed status is unverified. The reported OVR is kept as displayed, without 1–99 clipping. Search results can be truncated; name-only search misses do not establish that a player is absent from the game or from other sources. Identity review is human-readable evidence triage, not a ground-truth roster validation.

Reproduce the offline review and parser tests with the commands in [README.md](README.md). The synthetic fixture exercises OVR >99. A separate under-10-KB authentic Vicente detail excerpt is retained at [fixtures/pes5-live-vicente-excerpt.html](fixtures/pes5-live-vicente-excerpt.html), with source URL/date and the SHA-256 of the original full response; its line endings are normalized to LF. The complete response was removed after extraction.
'''.format(logged=logged,total=logged+10)
(ROOT/'coverage-report.md').write_text(report,encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))

#!/usr/bin/env python3
"""Bounded continuation for the saved PES5 probe; no duplicate roster requests."""
import argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path
import pes_master_probe as probe

ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--manifest',type=Path,required=True)
ap.add_argument('--targets',type=Path,required=True)
ap.add_argument('--candidates',type=Path,required=True)
ap.add_argument('--max-requests',type=int,default=50)
ap.add_argument('--delay',type=float,default=1.5)
a=ap.parse_args()
manifest=json.loads(a.manifest.read_text(encoding='utf-8'))
data=json.loads(a.candidates.read_text(encoding='utf-8'))
source=json.loads(a.targets.read_text(encoding='utf-8'))
by_season={s['id']:s for s in source}
rows={}
for season in data['target_seasons']:
    src=by_season[season['target_season_id']]
    for player in season['players']:
        rows[probe.target_key(season['target_season_id'],player['target_player_name'])]=player
req=probe.Requester(a.max_requests,a.delay)
searches={}
# Previously untouched players plus the apostrophe-sensitive pilot query.
queries=[]
for season in data['target_seasons']:
    for player in season['players']:
        k=probe.target_key(season['target_season_id'],player['target_player_name'])
        if player['identity_status']=='not_searched_or_budget_stopped':
            queries.append((k,player['target_player_name']))
for season in data['target_seasons']:
    if season['target_season_id']=='deportivo-la-coruna-2000':
        for player in season['players']:
            if player['target_player_name']=='Jacques Songo\'o':
                queries.append((probe.target_key(season['target_season_id'],player['target_player_name']),player['target_player_name']))
                manifest.setdefault('searchNameOverrides',{})[player['target_player_name']]='Songo'
# Deduplicate by term, retaining all targets that share a query.
terms={}
for k,name in queries:
    term=probe.search_term(name,manifest)
    terms.setdefault(term,[]).append((k,name))
for term,targets in terms.items():
    html=req.get(probe.search_url(term),'targeted PES5 name search (supplement; previously unsearched or corrected apostrophe query)')
    if html is None: break
    result=probe.parse(html,is_search=True)
    for k,name in targets:
        found=[]
        for r in result.rows:
            status=probe.match_status(name,r['name'],manifest)
            if status:
                found.append({**r,'match_status':status,'search_term':term})
        possible=found
        if not possible and len(result.rows)==1:
            possible=[{**result.rows[0],'match_status':'unresolved_unique_surname','search_term':term}]
        elif not possible:
            possible=[{**r,'match_status':'unresolved_search_candidate','search_term':term} for r in result.rows[:30]]
        search={'term':term,'result_count_on_page':len(result.rows),'possible_more_than_first_30':len(result.rows)>=30,'candidates':possible}
        searches[k]=search
        p=rows[k]
        p['search']=search
        verified=[c for c in possible if c['match_status'].startswith('verified_')]
        p['identity_status']='verified_pes5_record' if verified else ('identity_unresolved' if possible else 'no_candidate_in_targeted_name_search')
        # Replace stale response from the old malformed apostrophe query.
        if name=='Jacques Songo\'o':
            p['candidates']=possible
        elif possible:
            existing={c.get('player_url'):c for c in p.get('candidates',[]) if c.get('player_url')}
            for c in possible:
                existing[c.get('player_url')]=c
            p['candidates']=list(existing.values())
        else:
            p['candidates']=[]

# Fetch details for confirmed records first, then review-only pilot candidates.
def get_detail(c):
    url=c.get('player_url')
    if not url: return False
    html=req.get(url,'linked player detail page for confirmed or pilot-review candidate')
    if html is None:return False
    page=probe.parse(html)
    import re
    heading=probe.clean(page.h1)
    rating=re.match(r'#?\s*(\d{1,3})\s+(.+)',heading)
    c['detail_page']={'url':url,'page_heading':heading,'displayed_ovr':int(rating.group(1)) if rating else None,'raw_attributes':page.abilities,'complete_detail_attributes':set(page.abilities)==set(probe.ABILITY_LABELS)}
    return True

def candidates_all():
    for season in data['target_seasons']:
        for player in season['players']:
            for c in player.get('candidates',[]):
                yield season,player,c

seen=set()
# Strongly matched records first (includes new matches and six confirmed pages left from run 1).
for _,_,c in candidates_all():
    if c.get('match_status','').startswith('verified_') and c.get('player_url') and not c.get('detail_page') and c['player_url'] not in seen:
        seen.add(c['player_url'])
        if req.stop_reason: break
        get_detail(c)
# Then inspect plausible/ambiguous candidates in the four pilot seasons, preserving unresolved status.
pilot=set(manifest['pilotSeasonIds'])
for season,player,c in candidates_all():
    if season['target_season_id'] not in pilot or c.get('match_status','').startswith('verified_') or not c.get('player_url') or c.get('detail_page') or c['player_url'] in seen:
        continue
    seen.add(c['player_url'])
    if req.stop_reason: break
    get_detail(c)
# Spend remaining allowance on distinct ambiguous candidates in the early-99 set.
for _,_,c in candidates_all():
    if c.get('match_status','').startswith('verified_') or not c.get('player_url') or c.get('detail_page') or c['player_url'] in seen:
        continue
    seen.add(c['player_url'])
    if req.stop_reason: break
    get_detail(c)

# Propagate a fetched page to every target row that references the same source URL.\npage_by_url={}\nfor _,_,candidate in candidates_all():\n    if candidate.get('detail_page'):\n        page_by_url[candidate.get('player_url')]=candidate['detail_page']\nfor _,_,candidate in candidates_all():\n    if candidate.get('player_url') in page_by_url and not candidate.get('detail_page'):\n        candidate['detail_page']=page_by_url[candidate['player_url']]\n\n# Refresh per-candidate evidence/confidence and aggregate the complete request ledger.
for season,player,c in candidates_all():
    c['identity_confidence']='high' if c.get('match_status')=='verified_exact_name' else ('medium' if c.get('match_status')=='verified_manual_alias' else 'unresolved')
    c['identity_evidence']={'rule':c.get('match_status'),'candidate_name':c.get('name'),'team_label':c.get('team_label') or c.get('club'),'nationality':c.get('nationality'),'age':c.get('age'),'position':c.get('position'),'source_url':c.get('team_page_url') or c.get('player_url')}
old=data['request_policy'].get('request_log',[])
combined=old+req.log
data['request_policy']['request_log']=combined
data['request_policy']['requests_made']=len(combined)
data['request_policy']['max_requests_total']=160
data['request_policy']['delay_seconds_minimum']=1.5
data['request_policy']['supplement']={'requests_made':len(req.log),'max_requests':a.max_requests,'stop_reason':req.stop_reason,'request_log':req.log}
data['request_policy']['stop_reason']=req.stop_reason or ('request_budget_exhausted' if len(combined)>=160 else None)
data['generated_at_utc']=datetime.now(timezone.utc).isoformat()
a.candidates.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
a.manifest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
summary={'new_requests':len(req.log),'total_requests':len(combined),'new_search_queries':len(req.log)-sum(1 for x in req.log if 'detail page' in x.get('purpose','')),'records':sum(len(s['players']) for s in data['target_seasons']),'verified':sum(p['identity_status']=='verified_pes5_record' for s in data['target_seasons'] for p in s['players']),'unresolved':sum(p['identity_status']=='identity_unresolved' for s in data['target_seasons'] for p in s['players']),'no_hit':sum(p['identity_status']=='no_candidate_in_targeted_name_search' for s in data['target_seasons'] for p in s['players']),'not_searched':sum(p['identity_status']=='not_searched_or_budget_stopped' for s in data['target_seasons'] for p in s['players']),'target_rows_with_any_complete_detail':sum(any((c.get('detail_page') or {}).get('complete_detail_attributes') for c in p['candidates']) for s in data['target_seasons'] for p in s['players']),'stop_reason':req.stop_reason}
print(json.dumps(summary,ensure_ascii=False,indent=2))

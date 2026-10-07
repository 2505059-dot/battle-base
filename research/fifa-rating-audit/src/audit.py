#!/usr/bin/env python3
"""Reproducible, cache-first historical FIFA position-rating audit."""
import csv, hashlib, json, math, os, re, sys, zipfile, unicodedata
from pathlib import Path
from collections import Counter, defaultdict
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'research' / 'fifa-rating-audit'
CACHE = ROOT / 'research' / 'cache' / 'fifa-rating-audit'
ZIP = CACHE / 'stefanoleone_fifa23_complete.zip'
EDITIONS = [str(y) for y in range(15,24)]
POSITIONS = ['ls','st','rs','lw','lf','cf','rf','rw','lam','cam','ram','lm','lcm','cm','rcm','rm','lwb','ldm','cdm','rdm','rwb','lb','lcb','cb','rcb','rb','gk']
GK = {'gk'}
FEATURES = ['crossing','finishing','heading_accuracy','short_passing','volleys','dribbling_stat','curve','fk_accuracy','long_passing','ball_control','acceleration','sprint_speed','agility','reactions','balance','shot_power','jumping','stamina','strength','long_shots','aggression','interceptions','positioning','vision','penalties','composure','defensive_awareness','standing_tackle','sliding_tackle','gk_diving','gk_handling','gk_kicking','gk_positioning','gk_reflexes']
ATTR = ['crossing','finishing','heading_accuracy','short_passing','volleys','dribbling','curve','fk_accuracy','long_passing','ball_control','acceleration','sprint_speed','agility','reactions','balance','shot_power','jumping','stamina','strength','long_shots','aggression','interceptions','positioning','vision','penalties','composure','defensive_awareness','standing_tackle','sliding_tackle','gk_diving','gk_handling','gk_kicking','gk_positioning','gk_reflexes']
RAW_FEATURES = ['attacking_crossing','attacking_finishing','attacking_heading_accuracy','attacking_short_passing','attacking_volleys','skill_dribbling','skill_curve','skill_fk_accuracy','skill_long_passing','skill_ball_control','movement_acceleration','movement_sprint_speed','movement_agility','movement_reactions','movement_balance','power_shot_power','power_jumping','power_stamina','power_strength','power_long_shots','mentality_aggression','mentality_interceptions','mentality_positioning','mentality_vision','mentality_penalties','mentality_composure','defending_marking_awareness','defending_standing_tackle','defending_sliding_tackle','goalkeeping_diving','goalkeeping_handling','goalkeeping_kicking','goalkeeping_positioning','goalkeeping_reflexes']

def read_csv(path):
    with open(path,encoding='utf-8-sig',newline='') as f: return list(csv.DictReader(f))
def write_csv(name, rows, fields=None):
    rows=list(rows); p=OUT/'outputs'/name; p.parent.mkdir(parents=True,exist_ok=True)
    if fields is None: fields=list(rows[0]) if rows else []
    with open(p,'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    return len(rows)
def num(x):
    try:
        if x is None or str(x).strip() in ('','NA','-','nan'): return None
        v=float(x); return v if math.isfinite(v) else None
    except (TypeError,ValueError): return None
def mean(xs): return float(np.mean(xs)) if xs else None
def norm(x): return re.sub(r'[^a-z0-9]+','',unicodedata.normalize('NFKD',str(x).lower()).encode('ascii','ignore').decode('ascii'))
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def git_blob_sha1(path):
    size=path.stat().st_size; h=hashlib.sha1(f'blob {size}\0'.encode())
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def jsonwrite(path,obj): path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def write_cache_csv(name,rows):
    rows=list(rows);path=CACHE/name;path.parent.mkdir(parents=True,exist_ok=True)
    fields=list(rows[0]) if rows else []
    with open(path,'w',encoding='utf8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
    return len(rows)
def position_family(code):
    c=str(code or '').upper()
    groups={'GK':'GK','LCB':'CB','CB':'CB','RCB':'CB','LB':'LB/RB','RB':'LB/RB','LWB':'LWB/RWB','RWB':'LWB/RWB',
        'LDM':'CDM','CDM':'CDM','RDM':'CDM','LCM':'CM','CM':'CM','RCM':'CM','LAM':'CAM','CAM':'CAM','RAM':'CAM',
        'LM':'LM/RM','RM':'LM/RM','LW':'LW/RW','RW':'LW/RW','LS':'CF/ST','ST':'CF/ST','RS':'CF/ST','LF':'CF/ST','CF':'CF/ST','RF':'CF/ST',
        'DF':'coarse-DF','MF':'coarse-MF','FW':'coarse-FW'}
    return groups.get(c,'unresolved-fine-position')

def source_stephano():
    """Read only the 90 MB legacy snapshot member; never inflate 5.6 GB all-updates."""
    by=defaultdict(list); fields=None; coverage=defaultdict(Counter)
    keep_order=RAW_FEATURES+POSITIONS+['player_id','fifa_version','fifa_update','fifa_update_date','short_name','long_name','player_positions','overall','potential','club_name','nationality_name','international_reputation','age','dob','height_cm','weight_kg','preferred_foot','weak_foot','skill_moves','nation_position','club_position']
    keep=set(keep_order)
    with zipfile.ZipFile(ZIP) as z, z.open('male_players (legacy).csv') as raw:
        import io
        f=io.TextIOWrapper(raw,encoding='utf-8-sig',errors='replace',newline='')
        rd=csv.DictReader(f); fields=rd.fieldnames
        for r in rd:
            ed=str(r.get('fifa_version','')).strip()
            if ed not in EDITIONS: continue
            for col,val in r.items():
                if val is not None and str(val).strip() not in ('','NA','nan','-'): coverage[ed][col]+=1
            feat=[num(r.get(k)) for k in RAW_FEATURES]
            ybase=[]; ymod=[]
            for p in POSITIONS:
                s=(r.get(p) or '').strip(); m=re.fullmatch(r'(\d{1,3})(?:\s*([+-])\s*(\d{1,2}))?',s)
                ybase.append(float(m.group(1)) if m else None)
                ymod.append((1 if m.group(2)=='+' else -1)*int(m.group(3)) if m and m.group(2) else (0 if m else None))
            compact={k:r.get(k) for k in keep_order}
            by[ed].append({'id':r.get('player_id',''),'name':r.get('long_name') or r.get('short_name',''),
                'short':r.get('short_name',''),'nation':r.get('nationality_name',''),'club':r.get('club_name',''),
                'overall':num(r.get('overall')),'potential':num(r.get('potential')),'modifier':ymod,
                'features':feat,'targets':ybase,'positions':r.get('player_positions',''),'raw':compact})
    return by,fields,coverage

def source_mzafram():
    out={}; headers={}
    for p in sorted(CACHE.glob('mzafram_*.csv')):
        ed=p.stem.replace('mzafram_','')
        rows=read_csv(p); out[ed]=rows
        with open(p,encoding='utf-8-sig',newline='') as f: headers[ed]=next(csv.reader(f))
    return out,headers

def source_lbenz():
    p=CACHE/'lbenz_fifa05_20_player_stats.csv'; rows=read_csv(p)
    out=defaultdict(list)
    for r in rows:
        ed=str(r.get('season','')).zfill(2)
        out[ed].append(r)
    with open(p,encoding='utf-8-sig',newline='') as f: h=next(csv.reader(f))
    return out,h

def file_schema(path):
    with open(path,encoding='utf-8-sig',newline='') as f: return next(csv.reader(f))

def describe_sources(legacy,mz,lbenz,legacy_coverage):
    rows=[]; schemas=[]; dists=[]
    def add(source,edition,records,header,identity,target,kind):
        n=len(records); o=[]; pot=[]
        if source=='Mzafram SoFIFA':
            lineage='Current repository identifies SoFIFA as its source; historical per-edition origin and update vintage UNRESOLVED.'
        elif source=='lbenz FIFAIndex':
            lineage='Attributed to FIFAIndex by dataset; immutable source release and historical snapshot vintage UNRESOLVED.'
        elif source=='Stefano legacy':
            lineage='Kaggle legacy member observed; second-year-update vintage; original scrape lineage/version id unresolved.'
        else:
            lineage='FIFA18 demo per dataset listing; actual local file fields and rows observed; underlying origin remains third-party.'
        for r in records:
            if isinstance(r,dict):
                v=num(r.get('overall',r.get('rating',r.get('Overall')))); q=num(r.get('potential',r.get('Potential')))
            else: v=r['overall']; q=r['potential']
            if v is not None:o.append(v)
            if q is not None:pot.append(q)
        rows.append({'source':source,'edition':edition,'rows':n,'raw_columns':len(header),'overall_nonnull':len(o),
            'potential_nonnull':len(pot),'identity_key':identity,'position_rating_targets':target,'snapshot_kind':kind,
            'lineage_status':lineage,'availability':'available file observed',
            'overall_mean':mean(o),'overall_median':float(np.median(o)) if o else None,'overall_std':float(np.std(o)) if o else None,
            'overall_min':min(o) if o else None,'overall_max':max(o) if o else None})
        for col in header:
            if source=='Stefano legacy': non=legacy_coverage[edition][col]
            else:
                vals=[r.get(col) for r in records]
                non=sum(x is not None and str(x).strip() not in ('','NA','nan','-') for x in vals)
            schemas.append({'source':source,'edition':edition,'raw_field':col,'semantic_group':semantic(col),
                'row_count':n,'nonnull_count':non,'nonnull_pct':round(non/n,6) if n else None,'has_field':1})
        if o:
            top=sorted(o,reverse=True)[:min(500,len(o))]
            dists.append({'source':source,'edition':edition,'n_overall':len(o),'mean':mean(o),'median':float(np.median(o)),
                'std_pop':float(np.std(o)),'p10':float(np.percentile(o,10)),'p90':float(np.percentile(o,90)),
                'min':min(o),'max':max(o),'top_n':len(top),'top500_mean':mean(top),'top500_std_pop':float(np.std(top)),'potential_mean':mean(pot)})
    for e,recs in legacy.items(): add('Stefano legacy',e,recs, list(recs[0]['raw']) if recs else [],'player_id','27 base+modifier strings','second-year-update legacy snapshot')
    for e,recs in mz.items(): add('Mzafram SoFIFA',e,recs, file_schema(CACHE/f'mzafram_{e}.csv'),'sofifa_id','none; native positions only','single retrieved CSV snapshot')
    for e,recs in lbenz.items(): add('lbenz FIFAIndex',e,recs,file_schema(CACHE/'lbenz_fifa05_20_player_stats.csv'),'player_id','none; preferred/club/country positions','single retrieved CSV snapshot')
    demo=CACHE/'kaggle_fifa18_CompleteDataset.csv'
    if demo.exists():
        rr=read_csv(demo); add('FIFA18 demo SoFIFA', '18',rr,file_schema(demo),'ID','27 scalar position ratings','single retrieved demo dataset')
    rows.append({'source':'Mzafram SoFIFA','edition':'FC26','rows':0,'raw_columns':0,'overall_nonnull':0,'potential_nonnull':0,
        'identity_key':'sofifa_id','position_rating_targets':'none observed; no retrieved file','snapshot_kind':'expected candidate; live tree lacks blob',
        'lineage_status':'UNRESOLVED: current live repository tree/API/raw at pinned main SHA has no FC26 data file; stale indexed listing is superseded.',
        'availability':'unavailable: fresh API/tree/raw returned HTTP 404 at repository main SHA 90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0',
        'overall_mean':None,'overall_median':None,'overall_std':None,'overall_min':None,'overall_max':None})
    schemas.sort(key=lambda r:(r['source'],str(r['edition']),r['raw_field']))
    write_csv('source-summary.csv',rows)
    write_csv('schema-matrix.csv',schemas)
    write_csv('edition-distributions.csv',dists)
    return rows,schemas,dists

def semantic(c):
    s=c.lower()
    if s in ('overall','rating'): return 'overall rating; labels differ by publisher/source'
    if s in ('potential','pot'): return 'potential; not current ability'
    if s in ('player_positions','positions','preferred_positions','preferred positions','club_position','country_position'): return 'position vocabulary / roster label; not formation geometry'
    if s in ('fifa_update','fifa_update_date','game_version'): return 'snapshot/version metadata'
    if s in ('ls','st','rs','lw','lf','cf','rf','rw','lam','cam','ram','lm','lcm','cm','rcm','rm','lwb','ldm','cdm','rdm','rwb','lb','lcb','cb','rcb','rb','gk') or s in ('cam','cb','cdm','cf','cm','lam','lb','lcb','lcm','ldm','lf','lm','ls','lw','lwb','ram','rb','rcb','rcm','rdm','rf','rm','rs','rw','rwb','st'):
        return 'native position rating label (source-specific code)'
    if any(t in s for t in ('acceleration','sprint_speed','agility','pace')): return 'physical speed/agility attribute; source-era meaning needs verification'
    if any(t in s for t in ('gk_','goalkeeping')): return 'goalkeeping attribute'
    if any(t in s for t in ('cross','pass','vision','curve','fk_accuracy','creativity')): return 'passing/creation attribute; mapping is approximate'
    if any(t in s for t in ('tackle','defend','intercept','marking','aggression')): return 'defensive attribute; mapping is approximate'
    if any(t in s for t in ('name','nation','club','player_id','sofifa_id','id')): return 'identity / roster metadata'
    if s in ('age','height_cm','height','weight_kg','weight','dob','birthdate'): return 'biographical covariate'
    if s in ('international_reputation','ir'): return 'international reputation; optional non-ability covariate'
    return 'other raw field; semantics source-specific/unmapped'

def build_source_indexes(legacy,mz,lbenz):
    source_rows={}; idmaps={}
    for src,group,kind in [('Stefano legacy',legacy,'legacy'),('Mzafram SoFIFA',mz,'mz'),('lbenz FIFAIndex',lbenz,'lb')]:
        for ed,recs in group.items():
            im=defaultdict(list)
            for r in recs:
                if kind=='legacy': ident=r['id']; name=r['name']; aliases=[r['name'],r['short']]; nat=r['nation']; overall=r['overall']; pot=r['potential']; club=r['club']; raw=r['raw']
                elif kind=='mz': ident=r.get('sofifa_id',''); name=r.get('long_name') or r.get('alias') or r.get('short_name',''); aliases=[r.get('long_name'),r.get('alias'),r.get('short_name')]; nat=r.get('nationality',''); overall=num(r.get('overall')); pot=num(r.get('potential')); club=r.get('club_name',''); raw=r
                else: ident=r.get('player_id',''); name=r.get('name',''); aliases=[name]; nat=r.get('nationality',''); overall=num(r.get('rating')); pot=num(r.get('potential')); club=r.get('club',''); raw=r
                if str(ident): im[str(ident)].append(r)
            source_rows[(src,ed)]=recs; idmaps[(src,ed)]=im
    return source_rows,idmaps

def emit_vocabulary(legacy,mz):
    counts=Counter(); seen=defaultdict(set); ranges=defaultdict(list)
    for ed,rs in legacy.items():
        for r in rs:
            for p,y in zip(POSITIONS,r['targets']):
                if y is not None: counts[('Stefano legacy','native_rating_code',p)]+=1; seen[('Stefano legacy','native_rating_code',p)].add(ed)
            for p in re.split(r'[,/; ]+',str(r['positions']).strip()):
                if p: counts[('Stefano legacy','roster_position_code',p.upper())]+=1; seen[('Stefano legacy','roster_position_code',p.upper())].add(ed)
    for ed,rs in mz.items():
        for r in rs:
            for p in re.split(r'[,/; ]+',str(r.get('positions','')).strip()):
                if p: counts[('Mzafram SoFIFA','roster_position_code',p.upper())]+=1; seen[('Mzafram SoFIFA','roster_position_code',p.upper())].add(ed)
    geom={'LS':'striker','ST':'striker','RS':'striker','LW':'wing','RW':'wing','LF':'forward','CF':'forward','RF':'forward','LAM':'attacking-mid','CAM':'attacking-mid','RAM':'attacking-mid','LM':'wide-mid','RM':'wide-mid','LCM':'central-mid','CM':'central-mid','RCM':'central-mid','LDM':'defensive-mid','CDM':'defensive-mid','RDM':'defensive-mid','LWB':'wide-defender','RWB':'wide-defender','LB':'fullback','RB':'fullback','LCB':'centre-back','CB':'centre-back','RCB':'centre-back','GK':'goalkeeper'}
    for code,g in geom.items(): counts[('derived slot mapping','slot_geometry_group',code)]+=1; seen[('derived slot mapping','slot_geometry_group',code)].add('static-map-v1')
    rows=[]
    for (src,typ,code),n in sorted(counts.items()):
        rows.append({'source':src,'vocabulary_type':typ,'native_code':code,'slot_geometry_group':geom.get(code,'') if typ=='slot_geometry_group' else '',
            'observations':n,'editions':';'.join(sorted(seen[(src,typ,code)],key=lambda x:(9999,x) if x.startswith('static-map') else (edition_year(x),x))),
            'mapping_status':'explicit derived grouping only' if typ=='slot_geometry_group' else 'source-native; no automatic geometry inference'})
    write_csv('position-vocabulary.csv',rows)

def fit_model(X,y,ids,ref_mu=None,ref_sd=None,alpha=2.0):
    # Keep rows with a real target; missing predictors are training-median imputed.
    mask=np.isfinite(y)
    X=X[mask]; y=y[mask]; ids=np.asarray(ids)[mask]
    test=np.array([int(hashlib.sha256(str(i).encode()).hexdigest()[:8],16)%5==0 for i in ids],dtype=bool)
    tr=~test
    if tr.sum()<50 or test.sum()<10:return None
    count=np.isfinite(X[tr]).sum(0); mu=np.array([np.nanmean(X[tr,j]) if count[j] else np.nan for j in range(X.shape[1])])
    local_sd=np.array([np.nanstd(X[tr,j]) if count[j] else np.nan for j in range(X.shape[1])])
    ref_mu=np.asarray(ref_mu if ref_mu is not None else mu,dtype=float); ref_sd=np.asarray(ref_sd if ref_sd is not None else local_sd,dtype=float)
    active=(count>=50)&np.isfinite(mu)&np.isfinite(ref_sd)&(ref_sd>1e-8)&(local_sd>1e-8)
    if active.sum()==0:return None
    Xi=X[:,active].copy(); fill=mu[active]
    miss=~np.isfinite(Xi); Xi[miss]=np.broadcast_to(fill,Xi.shape)[miss]
    Z=(Xi-ref_mu[active])/ref_sd[active]
    zmu=Z[tr].mean(0); Z=Z-zmu
    ym=y[tr].mean(); A=Z[tr].T@Z[tr]+alpha*np.eye(active.sum()); b=Z[tr].T@(y[tr]-ym)
    try: beta=np.linalg.solve(A,b)
    except np.linalg.LinAlgError: beta=np.linalg.lstsq(A,b,rcond=None)[0]
    pred=ym+Z@beta; resid=y[test]-pred[test]
    ss=np.sum((y[test]-y[test].mean())**2); r2=1-float(resid@resid)/float(ss) if ss>1e-9 else None
    return {'n':len(y),'train':int(tr.sum()),'test':int(test.sum()),'mae':float(np.mean(abs(resid))),
        'rmse':float(np.sqrt(np.mean(resid**2))),'r2':r2,'exact':float(np.mean(np.rint(pred[test])==y[test])),
        'within1':float(np.mean(abs(pred[test]-y[test])<=1)),'features':int(active.sum()),'mu':mu,'sd':ref_sd,
        'imputed_cells':int(miss.sum()),'excluded_features':int(X.shape[1]-active.sum()),
        'active':active,'beta':beta,'feature_names':None,'pred':pred,'ids':ids,'test_mask':test}

def formula_audit(legacy):
    fitrows=[]; weightrows=[]; models={}
    # The stable-ID holdout fold is excluded across every edition before any global scale is estimated.
    pooled=np.array([r['features'] for ed in EDITIONS for r in legacy.get(ed,[])
        if int(hashlib.sha256(str(r['id']).encode()).hexdigest()[:8],16)%5!=0],dtype=float)
    ref_mu=np.array([np.nanmean(pooled[:,j]) if np.isfinite(pooled[:,j]).any() else np.nan for j in range(pooled.shape[1])])
    ref_sd=np.array([np.nanstd(pooled[:,j]) if np.isfinite(pooled[:,j]).any() else np.nan for j in range(pooled.shape[1])])
    for ed in EDITIONS:
        rs=legacy.get(ed,[])
        if not rs: continue
        X=np.array([r['features'] for r in rs],dtype=float); ids=[r['id'] for r in rs]
        # Mark target player cohort by roster label, not by synthetic positional score.
        gk=np.array(['GK' in str(r['positions']).upper().split(',') for r in rs])
        for j,p in enumerate(POSITIONS):
            cohort=gk if p=='gk' else ~gk
            base=np.array([r['targets'][j] if r['targets'][j] is not None else np.nan for r in rs])
            mods=np.array([r['modifier'][j] if r['modifier'][j] is not None and re.search(r'[+-]',str(r['raw'].get(p,''))) else np.nan for r in rs])
            for kind,y in [('base_rating',base),('signed_modifier_explicit_only',mods)]:
                q=cohort & np.isfinite(y)
                if q.sum()<50: continue
                m=fit_model(X[q],y[q],np.asarray(ids)[q],ref_mu,ref_sd)
                if not m: continue
                m['feature_names']=FEATURES; models[(ed,p,kind)]=m
                modraw=[r['raw'].get(p,'') for k,r in enumerate(rs) if cohort[k] and y[k] is not None]
                explicit=sum(bool(re.search(r'[+-]',str(s))) for s in modraw)
                fitrows.append({'source':'Stefano legacy','edition':ed,'snapshot_kind':'second-year-update legacy','position_code':p,
                    'cohort':'goalkeeper' if p=='gk' else 'outfield','target_kind':kind,'label_count':m['n'],'train_n':m['train'],'test_n':m['test'],
                    'feature_n':m['features'],'excluded_feature_n':m['excluded_features'],'imputed_cells':m['imputed_cells'],
                    'feature_scale_scope':'pooled numeric FIFA15-23 training-fold IDs only; per-model imputation/centering from training rows only',
                    'alpha_standardized_ridge':2.0,'heldout_mae':m['mae'],'heldout_rmse':m['rmse'],'heldout_r2':m['r2'],
                    'heldout_exact_integer_rate':m['exact'],'heldout_within1_rate':m['within1'],'modifier_explicit_count':explicit,
                    'modifier_explicit_rate':round(explicit/m['n'],6) if kind=='base_rating' else None,
                    'formula_status':'empirical held-out regression; not official EA formula'})
                active_ids=np.flatnonzero(m['active'])
                for ix,beta in zip(active_ids,m['beta']):
                    weightrows.append({'source':'Stefano legacy','edition':ed,'position_code':p,'cohort':'goalkeeper' if p=='gk' else 'outfield',
                        'target_kind':kind,'feature':FEATURES[ix],'standardized_weight':float(beta),'train_scale_sd':float(m['sd'][ix])})
    write_csv('position-formula-fit.csv',fitrows)
    write_csv('position-formula-weights.csv',weightrows)
    stable=[]
    for p in POSITIONS:
        for k in ('base_rating','signed_modifier_explicit_only'):
            edits=[e for e in EDITIONS if (e,p,k) in models]
            for i,a in enumerate(edits):
                for b in edits[i+1:]:
                    wa={(r['feature']):r['standardized_weight'] for r in weightrows if r['position_code']==p and r['target_kind']==k and r['edition']==a}
                    wb={(r['feature']):r['standardized_weight'] for r in weightrows if r['position_code']==p and r['target_kind']==k and r['edition']==b}
                    common=sorted(set(wa)&set(wb)); x=np.array([wa[f] for f in common]); y=np.array([wb[f] for f in common])
                    cos=float(x@y/(np.linalg.norm(x)*np.linalg.norm(y))) if len(common) and np.linalg.norm(x)*np.linalg.norm(y)>0 else None
                    corr=float(np.corrcoef(x,y)[0,1]) if len(common)>2 and np.std(x)>0 and np.std(y)>0 else None
                    stable.append({'source':'Stefano legacy','position_code':p,'target_kind':k,'edition_a':a,'edition_b':b,
                        'snapshot_a':'second-year-update legacy','snapshot_b':'second-year-update legacy','common_feature_n':len(common),
                        'coefficient_cosine':cos,'coefficient_pearson':corr,'interpretation':'standardized predictive coefficients; edition-specific correlations/semantics remain'} )
    write_csv('position-formula-stability.csv',stable)
    return fitrows,weightrows,stable

def edition_year(e):
    s=str(e)
    if s.upper().startswith('FIFA'): s=s[4:]
    if s.upper().startswith('FC'): return 2000+int(s[2:])
    return 2000+int(s) if len(s)==2 else int(s)

def continuity_and_conflicts(legacy,mz,lbenz,indexes):
    cont=[]; snap={}
    def add_series(src,groups,kind):
        players=defaultdict(dict)
        for ed,recs in groups.items():
            for r in recs:
                if kind=='legacy': ident=str(r['id']); rating=r['overall']; name=r['name']; nat=r['nation']; meta=r['raw']
                elif kind=='mz': ident=str(r.get('sofifa_id','')); rating=num(r.get('overall')); name=r.get('long_name') or r.get('alias') or r.get('short_name',''); nat=r.get('nationality',''); meta=r
                else: ident=str(r.get('player_id','')); rating=num(r.get('rating')); name=r.get('name',''); nat=r.get('nationality',''); meta=r
                if ident and rating is not None:
                    posraw=meta.get('player_positions',meta.get('positions',meta.get('preferred_positions','')))
                    primary=next((x for x in re.split(r'[,/;\s]+',str(posraw).upper().strip()) if x),'UNRESOLVED')
                    players[ident][edition_year(ed)]={'edition':ed,'rating':rating,'name':name,'nation':nat,'meta':meta,'primary':primary,'position_group':position_family(primary)}
                    keys=set((norm(a),norm(nat)) for a in ([name, meta.get('short_name','')] if isinstance(meta,dict) else [name]) if a and nat)
                    for key in keys: snap.setdefault((src,ed,key),[]).append({'id':ident,'name':name,'nation':nat,'rating':rating,'record':r})
        for ident,vals in players.items():
            yrs=sorted(vals)
            for a,b in zip(yrs,yrs[1:]):
                if b-a!=1: continue
                x,y=vals[a],vals[b]
                cont.append({'source':src,'player_id':ident,'name_a':x['name'],'name_b':y['name'],'club_a':x['meta'].get('club_name',x['meta'].get('club','')),
                    'club_b':y['meta'].get('club_name',y['meta'].get('club','')),
                    'club_changed':x['meta'].get('club_name',x['meta'].get('club',''))!=y['meta'].get('club_name',y['meta'].get('club','')),
                    'position_group':x['position_group'],'native_primary_code_a':x['primary'],'native_primary_code_b':y['primary'],
                    'edition_a':x['edition'],'edition_b':y['edition'],
                    'year_a':a,'year_b':b,'overall_a':x['rating'],'overall_b':y['rating'],'delta_b_minus_a':y['rating']-x['rating'],
                    'nation_a':x['nation'],'nation_b':y['nation'],'interpretation':'within-source adjacent edition; snapshot/source changes may explain delta'})
    add_series('Stefano legacy',legacy,'legacy'); add_series('Mzafram SoFIFA',mz,'mz'); add_series('lbenz FIFAIndex',lbenz,'lb')
    write_cache_csv('derived-same-player-continuity-intermediate.csv',cont)
    cg=defaultdict(list)
    for r in cont:cg[(r['source'],r['edition_a'],r['edition_b'],r['year_a'],r['year_b'],r['position_group'])].append(r)
    cont_summary=[]
    for (src,ea,eb,ya,yb,posgrp),rs in sorted(cg.items()):
        ds=[r['delta_b_minus_a'] for r in rs]; changed=sum(bool(r['club_changed']) for r in rs)
        cont_summary.append({'source':src,'edition_a':ea,'edition_b':eb,'year_a':ya,'year_b':yb,'position_group':posgrp,'matched_player_pairs':len(rs),
            'mean_delta_b_minus_a':mean(ds),'median_delta':float(np.median(ds)),'p10_delta':float(np.percentile(ds,10)),'p90_delta':float(np.percentile(ds,90)),
            'mean_absolute_delta':mean([abs(x) for x in ds]),'unchanged_pct':round(sum(x==0 for x in ds)/len(ds),6),
            'within_plus_minus_1_pct':round(sum(abs(x)<=1 for x in ds)/len(ds),6),'increase_pct':round(sum(x>0 for x in ds)/len(ds),6),
            'decrease_pct':round(sum(x<0 for x in ds)/len(ds),6),'club_changed_pairs':changed,'club_changed_pct':round(changed/len(rs),6),
            'privacy_scope':'aggregated counts and deltas; no source player names, IDs, or row-level ratings'})
    write_csv('same-player-continuity.csv',cont_summary)
    conflicts=[]; editions=sorted({e for src,e,k in snap if src in ('Stefano legacy','Mzafram SoFIFA','lbenz FIFAIndex')},key=lambda x:edition_year(x))
    sources=['Stefano legacy','Mzafram SoFIFA','lbenz FIFAIndex']
    years=sorted({edition_year(e) for e in editions})
    for yr in years:
        e_for={s:next((e for e in editions if any(k[0]==s and k[1]==e for k in snap) and edition_year(e)==yr),None) for s in sources}
        active=[s for s in sources if e_for[s] is not None]
        for ia,a in enumerate(active):
            for b in active[ia+1:]:
                ea,eb=e_for[a],e_for[b]
                keys_a={k[2] for k in snap if k[0]==a and k[1]==ea}; keys_b={k[2] for k in snap if k[0]==b and k[1]==eb}
                for key in sorted(keys_a & keys_b):
                    ar=snap.get((a,ea,key),[]); br=snap.get((b,eb,key),[])
                    if len(ar)!=1 or len(br)!=1: continue
                    av,bv=ar[0],br[0]
                    # Only exact normalized name + nationality joins; keep disagreement, never overwrite.
                    conflicts.append({'edition_a':ea,'edition_b':eb,'year':yr,'source_a':a,'source_b':b,'name_key':key[0],'nationality_key':key[1],
                        'player_a_id':av['id'],'player_b_id':bv['id'],'name_a':av['name'],'name_b':bv['name'],'overall_a':av['rating'],'overall_b':bv['rating'],
                        'delta_b_minus_a':bv['rating']-av['rating'],'source_difference_status':'reported source/snapshot difference; not automatically an error',
                        'join_method':'unique normalized name + nationality exact'})
    # Full join universe is analyzed in memory; committed output is a small, deterministic cross-era fixture.
    cg=defaultdict(list)
    for r in conflicts: cg[(r['year'],r['source_a'],r['source_b'])].append(r)
    conflict_summary=[]
    for (yr,a,b),rs in sorted(cg.items()):
        ds=[float(r['delta_b_minus_a']) for r in rs]
        conflict_summary.append({'year':yr,'source_a':a,'source_b':b,'unique_exact_name_nationality_joins':len(rs),
            'overall_equal_n':sum(x==0 for x in ds),'overall_different_n':sum(x!=0 for x in ds),'different_pct':round(sum(x!=0 for x in ds)/len(ds),6),
            'mean_delta_b_minus_a':mean(ds),'median_absolute_delta':float(np.median(np.abs(ds))),'mean_absolute_delta':mean([abs(x) for x in ds]),
            'identity_policy':'exact normalized full/alias name plus nationality; unique row in each source edition only'})
    write_csv('source-conflict-summary.csv',conflict_summary)
    write_cache_csv('derived-cross-source-comparisons-intermediate.csv',conflicts)
    fixture=[]; target_years=[2010,2015,2020]
    for yr in target_years:
        candidates=[r for r in conflicts if r['year']==yr and {r['source_a'],r['source_b']}=={'lbenz FIFAIndex','Mzafram SoFIFA'}]
        candidates=sorted(candidates,key=lambda r:hashlib.sha256((r['name_key']+'|'+r['nationality_key']).encode()).hexdigest())
        seen=set()
        for r in candidates:
            key=(r['name_key'],r['nationality_key'])
            if key in seen:continue
            seen.add(key)
            fixture.append({'fixture_era':str(yr),'year':yr,'source_a':r['source_a'],'source_b':r['source_b'],'player_a_id':r['player_a_id'],'player_b_id':r['player_b_id'],
                'name_a':r['name_a'],'name_b':r['name_b'],'nationality':r['nationality_key'],'overall_a':r['overall_a'],'overall_b':r['overall_b'],
                'delta_b_minus_a':r['delta_b_minus_a'],'join_method':r['join_method'],'fixture_policy':'first 100 deterministic SHA256-sorted unique name+nationality joins for lbenz vs Mzafram; spot-check only, not prevalence'})
            if len(seen)>=100:break
    write_csv('source-conflicts.csv',fixture)
    write_csv('cross-source-verification.csv',fixture)
    return cont,conflicts

def source_info(src,ed,r):
    if src=='Stefano legacy':
        q=r.get('raw',r); return str(q.get('player_id',r.get('id',''))),q.get('long_name') or q.get('short_name') or r.get('name',''),q.get('nationality_name') or r.get('nation',''),q.get('club_name') or r.get('club',''),num(q.get('overall',r.get('overall'))),num(q.get('potential',r.get('potential')))
    if src=='Mzafram SoFIFA': return str(r.get('sofifa_id','')),r.get('long_name') or r.get('alias') or r.get('short_name',''),r.get('nationality',''),r.get('club_name',''),num(r.get('overall')),num(r.get('potential'))
    return str(r.get('player_id','')),r.get('name',''),r.get('nationality',''),r.get('club',''),num(r.get('rating')),num(r.get('potential'))

def entity_lookup(data): return {e['id']:e for e in data['entities']}
def row_entity_id(row,players): return players['playerSeasonMap'].get(row.get('id'))
def entity_names(entity):
    names=[entity.get('canonicalName','')]
    names.extend((entity.get('localizedNames') or {}).values())
    for v in (entity.get('aliases') or {}).values(): names.extend(v if isinstance(v,list) else [])
    return {norm(x) for x in names if norm(x)}
def candidate_source_row(row,entity,src,ed,source_rows,idmaps):
    recs=source_rows.get((src,ed),[]); ext=(entity or {}).get('externalIds',{})
    idkey={'lbenz FIFAIndex':'fifaIndex','Mzafram SoFIFA':'sofifa','Stefano legacy':'sofifa'}[src]
    target=ext.get(idkey)
    if target is not None:
        hits=idmaps.get((src,ed),{}).get(str(target),[])
        if len(hits)==1: return hits[0],'stable_external_id',len(hits)
        if len(hits)>1: return None,'ambiguous_external_id',len(hits)
    names=entity_names(entity) if entity else {norm(row.get('name',''))}
    hits=[]
    for raw in recs:
        ident,name,nat,club,ov,pot=source_info(src,ed,raw)
        aliases=[name]
        if src=='Stefano legacy': aliases += [raw.get('short_name',raw.get('short',''))]
        elif src=='Mzafram SoFIFA': aliases += [raw.get('alias',''),raw.get('short_name','')]
        if any(norm(a) in names for a in aliases if a): hits.append((raw,club,ident))
    # Deduplicate records reached through aliases.
    hits=list({h[2]:h for h in hits}.values())
    if len(hits)==1: return hits[0][0],'unique_exact_name_only',1
    if len(hits)>1:
        team=norm(row.get('club','')); c=[h for h in hits if team and team in norm(h[1])]
        if len(c)==1:return c[0][0],'name_plus_club_context',len(hits)
        return None,'ambiguous_name',len(hits)
    return None,'unmatched',0

def edition_for_year(source_rows,src,year):
    return next((ed for (s,ed),rs in source_rows.items() if s==src and rs and edition_year(ed)==year),None)

def coverage_audit(battle,players,entities,source_rows,idmaps):
    groups=defaultdict(list)
    for r in battle: groups[r['teamSeasonId']].append(r)
    rows=[]; totals=Counter()
    for team,rs in sorted(groups.items()):
        year=rs[0]['year']
        for src in ['lbenz FIFAIndex','Mzafram SoFIFA','Stefano legacy']:
            ed=edition_for_year(source_rows,src,year)
            matched=Counter()
            if ed is None:
                matched['unmatched']=len(rs)
                rows.append({'teamSeasonId':team,'club':rs[0]['club'],'year':year,'source':src,'edition':'',
                    'bb_player_n':len(rs),'matched_n':0,'stable_id_match_n':0,'unique_name_only_n':0,
                    'ambiguous_n':0,'unmatched_n':len(rs),'match_rate':0.0,
                    'matching_policy':'no same-year edition in retrieved corpus; explicit unavailable source row; no historical attributes fabricated'})
                continue
            for r in rs:
                ent=entities.get(row_entity_id(r,players))
                raw,status,nc=candidate_source_row(r,ent,src,ed,source_rows,idmaps)
                if raw is not None: matched[status]+=1
                elif status.startswith('ambiguous'): matched['ambiguous']+=1
                else: matched['unmatched']+=1
            good=sum(v for k,v in matched.items() if k not in ('ambiguous','unmatched'))
            rows.append({'teamSeasonId':team,'club':rs[0]['club'],'year':year,'source':src,'edition':ed,'bb_player_n':len(rs),
                'matched_n':good,'stable_id_match_n':matched['stable_external_id'],'unique_name_only_n':matched['unique_exact_name_only']+matched['name_plus_club_context'],
                'ambiguous_n':matched['ambiguous'],'unmatched_n':matched['unmatched'],'match_rate':round(good/len(rs),6) if rs else None,
                'matching_policy':'stable source-specific external ID first; else unique exact normalized name, optional club context; ambiguous retained'})
            for k,v in matched.items(): totals[(src,k)]+=v
    rows.append({'teamSeasonId':'ALL_62_TEAMSEASONS','club':'','year':'','source':'ALL_AVAILABLE_SAME_YEAR_SOURCES','edition':'','bb_player_n':554,
        'matched_n':'','stable_id_match_n':'','unique_name_only_n':'','ambiguous_n':'','unmatched_n':'','match_rate':'',
        'matching_policy':'Scope: 418 entities / 554 player-seasons / 62 TeamSeasons; per-edition rows above; no fabricated pre-2005 ability evidence'})
    write_csv('battle-base-coverage.csv',rows)
    return rows

def player_season_audit(battle,players,entities,source_rows,idmaps):
    rows=[]; entity_acc=defaultdict(lambda:Counter())
    srcs=['lbenz FIFAIndex','Mzafram SoFIFA','Stefano legacy']
    for r in battle:
        eid=row_entity_id(r,players);ent=entities.get(eid);same={};post={}
        poscode,mapping_precision=position_mapping_for_bb(r);position_target=None
        for src in srcs:
            for targetyr,dest in [(r['year'],same),(r['year']+1,post)]:
                ed=edition_for_year(source_rows,src,targetyr)
                if ed is None:
                    dest[src]={'edition':'','status':'no retrieved edition','source_id':'','overall':None,'potential':None,
                        'attribute_nonnull':0,'attribute_field_count':0,'source_position_label_count':None,
                        'source_position_label_exists':'not_observed','position_target_for_mapped_code':None,
                        'position_target_mapping_precision':mapping_precision}
                    continue
                raw,status,nc=candidate_source_row(r,ent,src,ed,source_rows,idmaps)
                if raw is None:
                    dest[src]={'edition':ed,'status':status,'source_id':'','overall':None,'potential':None,
                        'attribute_nonnull':0,'attribute_field_count':0,'source_position_label_count':None,
                        'source_position_label_exists':'not_observed','position_target_for_mapped_code':None,
                        'position_target_mapping_precision':mapping_precision}
                    continue
                ident,name,nat,club,ov,pot=source_info(src,ed,raw)
                if src=='Stefano legacy': fields=RAW_FEATURES
                elif src=='Mzafram SoFIFA': fields=MZ_ATTRS
                else: fields=['ball_control','dribbling','marking','slide_tackle','stand_tackle','aggression','reactions','att_position','interceptions','vision','composure','crossing','short_pass','long_pass','acceleration','stamina','strength','sprint_speed','creativity','heading','shot_power','finishing','long_shots','shot_accuracy','penalties','gk_positioning','gk_diving','gk_handling','gk_kicking','gk_reflexes','gk_rushing']
                raw_attrs=raw.get('raw',raw) if src=='Stefano legacy' else raw
                nonnull=sum(num(raw_attrs.get(f)) is not None for f in fields)
                label_count=None;target=None;mod=None
                if src=='Stefano legacy':
                    labels=raw.get('targets',[])
                    label_count=sum(num(v) is not None for v in labels)
                    if poscode in POSITIONS:
                        ix=POSITIONS.index(poscode);target=labels[ix] if ix<len(labels) else None
                        modifiers=raw.get('modifier',[])
                        mod=modifiers[ix] if ix<len(modifiers) else None
                    if target is not None and (position_target is None or targetyr==r['year']):
                        position_target={'source_year':targetyr,'base':target,'modifier':mod,'mapping_precision':mapping_precision}
                dest[src]={'edition':ed,'status':status,'source_id':ident,'source_name':name,'source_club':club,'source_overall':ov,'source_potential':pot,
                    'attribute_nonnull':nonnull,'attribute_field_count':len(fields),'position_code':poscode or '',
                    'source_position_label_count':label_count,
                    'source_position_label_exists':('yes' if label_count else 'no') if label_count is not None else 'not_observed',
                    'position_target_for_mapped_code':target,'position_modifier_for_mapped_code':mod,
                    'position_target_mapping_precision':mapping_precision}
        same_n=sum(v.get('source_overall') is not None for v in same.values())
        post_n=sum(v.get('source_overall') is not None for v in post.values())
        missing=''
        if not same_n and not post_n:
            missing='no source edition for calendar year before 2007/after FC25' if r['year']<2007 or r['year']>2025 else 'no unique external-ID/name match in available same/post-year snapshots'
        legacy_same=same.get('Stefano legacy',{})
        label_count=legacy_same.get('source_position_label_count')
        mapped_target_same=legacy_same.get('position_target_for_mapped_code')
        label_exists=('yes' if label_count else 'no') if label_count is not None else 'unknown_no_unique_source_row'
        if poscode is None:
            mapped_target_exists='not_comparable_unmapped_bb_position'
        elif label_count is None:
            mapped_target_exists='unknown_no_unique_source_row'
        else:
            mapped_target_exists='yes' if mapped_target_same is not None else 'no'
        if position_target is not None:
            precision=position_target['mapping_precision']
            if precision=='exact_native_code':
                target_class='observed_source_label_exact_native_code'
                alignment='exact_native_code_match'
                detail='exact native-code mapping'
            elif precision=='coarse_proxy':
                target_class='observed_source_label_coarse_proxy'
                alignment='unknown_coarse_proxy'
                detail='coarse proxy; native alignment unknown'
            else:
                target_class='observed_source_label_alignment_unknown'
                alignment='unknown_ambiguous_or_unmapped'
                detail='ambiguous/unmapped BB position; native alignment unknown'
            timing='same-year' if position_target['source_year']==r['year'] else 'post-year'
            pos_status=f"{timing} source target observed via {detail}"
        else:
            target_class='no_target_observed'
            alignment='unknown'
            if label_count is None:
                pos_status='no same-year uniquely matched legacy source row'
            elif label_count==0:
                pos_status='same-year legacy source row has no position labels'
            elif poscode is None:
                pos_status='same-year source position labels exist; BB position unmapped'
            else:
                pos_status='same-year source position labels exist; no target for mapped BB code'
        out={'playerSeasonId':r.get('id'),'entityId':eid or 'UNMAPPED','canonicalName':ent.get('canonicalName') if ent else r.get('name'),
            'identityStatus':ent.get('identityStatus') if ent else 'UNRESOLVED','teamSeasonId':r.get('teamSeasonId'),'club':r.get('club'),'season_year':r.get('year'),
            'bb_positions':';'.join(r.get('positions') or []),'bb_position_mapped_code':poscode or '',
            'bb_position_mapping_precision':mapping_precision,'bb_overall':r.get('overall'),'bb_raw_overall':r.get('provenance',{}).get('rawOverall'),
            'bb_calibrated_overall':r.get('provenance',{}).get('calibratedOverall'),'bb_calibration_method':r.get('provenance',{}).get('calibrationMethod'),
            'entity_external_ids_json':json.dumps(ent.get('externalIds',{}) if ent else {},ensure_ascii=False,sort_keys=True),
            'same_year_source_matches_json':json.dumps(same,ensure_ascii=False,sort_keys=True),'post_year_source_matches_json':json.dumps(post,ensure_ascii=False,sort_keys=True),
            'same_year_match_count':same_n,'post_year_match_count':post_n,
            'same_year_source_position_label_count':label_count if label_count is not None else '',
            'same_year_source_position_label_exists':label_exists,
            'same_year_source_target_for_mapped_code_exists':mapped_target_exists,
            'position_target_source_year':position_target['source_year'] if position_target else '',
            'position_target_source_base':position_target['base'] if position_target else '',
            'position_target_source_modifier':position_target['modifier'] if position_target else '',
            'position_target_origin_classification':'observed_source_label' if position_target else 'not_observed',
            'position_target_classification':target_class,'native_bb_position_alignment':alignment,
            'position_target_status':pos_status,
            'missing_reason':missing or 'source match exists; missing individual fields remain explicitly counted'}
        rows.append(out)
        if eid:
            ac=entity_acc[eid];ac['player_seasons']+=1;ac['same_year_match']+=bool(same_n);ac['post_year_match']+=bool(post_n)
            if position_target and position_target['source_year']==r['year']:
                ac['same_year_position_source_targets']+=1
                if mapping_precision=='exact_native_code': ac['same_year_position_exact']+=1
                elif mapping_precision=='coarse_proxy': ac['same_year_position_coarse_proxy']+=1
                else: ac['same_year_position_alignment_unknown']+=1
            ac['fallback_current']+=r.get('status')=='fallback-generated'
    write_csv('player-season-coverage.csv',rows)
    summary=[]
    for eid,ent in sorted(entities.items()):
        c=entity_acc[eid];summary.append({'entityId':eid,'canonicalName':ent.get('canonicalName'),'identityStatus':ent.get('identityStatus'),
            'player_season_count':c['player_seasons'],'same_year_source_match_seasons':c['same_year_match'],'post_year_source_match_seasons':c['post_year_match'],
            'same_year_position_source_target_seasons':c['same_year_position_source_targets'],
            'same_year_position_target_exact_native_alignment_seasons':c['same_year_position_exact'],
            'same_year_position_target_coarse_proxy_seasons':c['same_year_position_coarse_proxy'],
            'same_year_position_target_alignment_unknown_seasons':c['same_year_position_alignment_unknown'],
            'current_fallback_player_seasons':c['fallback_current'],
            'externalIds_json':json.dumps(ent.get('externalIds',{}),ensure_ascii=False,sort_keys=True),'battle_seasons':';'.join(map(str,ent.get('seasons',[]))),
            'coverage_note':'one row per resolved BB entity; source availability limited to retrieved editions and confident matching rules; source-label existence is separated from BB native-position alignment'})
    write_csv('entity-coverage-summary.csv',summary)
    return rows,summary

PSV_NAMES=['Heurelho Gomes','Alex','Wilfred Bouma','Lee Young-pyo','Mark van Bommel','Phillip Cocu','Park Ji-sung','Jefferson Farfan','Jan Vennegoor of Hesselink']
CASE_TEAMS=[('psv-2005','PSV Eindhoven',2005),('ac-milan-2007','AC Milan',2007),('barcelona-2011','Barcelona',2011),('real-madrid-2017','Real Madrid',2017),('bayern-munich-2020','Bayern Munich',2020),('manchester-united-2008','Manchester United',2008)]

PSV_STABLE_ID_EVIDENCE={
    'Heurelho Gomes':('135451','FIFA05 unique exact-name PSV row'),
    'Alex':('136130','FIFA05 unique PSV roster row'),
    'Wilfred Bouma':('5741','FIFA05 unique exact-name PSV row'),
    'Lee Young-pyo':('34666','FIFA07 unique PSV roster row'),
    'Mark van Bommel':('19765','FIFA05 unique exact-name PSV row'),
    'Phillip Cocu':('5736','FIFA05-07 unique Philip Cocu rows; Netherlands; PSV'),
    'Park Ji-sung':('39943','FIFA07 unique PSV roster row'),
    'Jefferson Farfan':('158133','FIFA05 unique PSV roster row'),
    'Jan Vennegoor of Hesselink':('27488','FIFA05 source row Jan Vennegoor of H.; stable ID verified across FIFA05-07'),
}
PSV_VALIDATED_SOURCE_ALIASES={'Phillip Cocu':'Philip Cocu'}
PSV_NATIVE_ATTRIBUTE_FIELDS=['ball_control','dribbling','marking','slide_tackle','stand_tackle','aggression','reactions','att_position','interceptions','vision','composure','crossing','short_pass','long_pass','acceleration','stamina','strength','balance','sprint_speed','agility','jumping','creativity','heading','shot_power','finishing','long_shots','curve','free_kick_accuracy','shot_accuracy','penalties','gk_positioning','gk_diving','gk_handling','gk_kicking','gk_reflexes','gk_rushing']

def psv_case(battle,players,entities,source_rows,idmaps):
    out=[]; by_name={}
    for r in battle:
        if r['teamSeasonId']=='psv-2005': by_name[norm(r['name'])]=r
    lb={ed:rs for (src,ed),rs in source_rows.items() if src=='lbenz FIFAIndex'}
    attr_map={'ball_control':'ball_control','dribbling':'dribbling','marking':'marking','slide_tackle':'slide_tackle','stand_tackle':'stand_tackle','aggression':'aggression','reactions':'reactions','att_position':'att_position','interceptions':'interceptions','vision':'vision','composure':'composure','crossing':'crossing','short_pass':'short_pass','long_pass':'long_pass','acceleration':'acceleration','stamina':'stamina','strength':'strength','sprint_speed':'sprint_speed','creativity':'creativity','heading':'heading','shot_power':'shot_power','finishing':'finishing','long_shots':'long_shots','shot_accuracy':'shot_accuracy','penalties':'penalties'}
    for wanted in PSV_NAMES:
        bb=by_name.get(norm(wanted)); ent=entities.get(row_entity_id(bb,players)) if bb else None
        source_id,evidence=PSV_STABLE_ID_EVIDENCE.get(wanted,('',''))
        validated_alias=PSV_VALIDATED_SOURCE_ALIASES.get(wanted,'')
        for yr in (2005,2006,2007):
            ed=edition_for_year(source_rows,'lbenz FIFAIndex',yr); name_hits=[]; hits=[];raw=None
            if ed:
                aliases={norm(wanted)} | (entity_names(ent) if ent else set())
                if validated_alias: aliases.add(norm(validated_alias))
                name_hits=[x for x in lb.get(ed,[]) if norm(x.get('name','')) in aliases]
                if source_id:
                    hits=[x for x in lb.get(ed,[]) if str(x.get('player_id',''))==source_id]
                    method='validated_alias_stable_id' if validated_alias else 'anchored_stable_id'
                    if len(hits)==1: raw=hits[0]
                else:
                    hits=list(name_hits)
                    if len(hits)==1:
                        raw=hits[0];method='global_unique_name_alias'
                    elif len(hits)>1 and bb:
                        member_club=norm(bb.get('club',''))
                        club_hits=[x for x in hits if member_club and member_club in norm(x.get('club',''))]
                        if len(club_hits)==1:
                            hits=club_hits;raw=hits[0];method='club_disambiguated_name_alias'
                        else: method='ambiguous_name_alias'
                    elif len(hits)>1: method='ambiguous_name_alias'
                    else: method='exact_name_verified_alias_not_found'
            else: method='edition_unavailable'
            if not ed: match_status='no edition available'
            elif source_id and len(hits)==1: match_status='stable ID match; source club recorded independently'
            elif source_id and len(hits)>1: match_status='stable ID is non-unique within edition'
            elif source_id: match_status='anchored stable ID absent in edition'
            elif raw and method=='global_unique_name_alias': match_status='globally unique exact name/verified alias'
            elif raw and method=='club_disambiguated_name_alias': match_status='duplicate exact names disambiguated by PSV membership club'
            elif len(name_hits)>1: match_status='ambiguous exact name/verified aliases after PSV club context'
            else: match_status='exact name/verified aliases failed'
            attrs={k:num(raw.get(v)) for k,v in attr_map.items()} if raw else {}
            native_attrs={k:num(raw.get(k)) for k in PSV_NATIVE_ATTRIBUTE_FIELDS if raw is not None and k in raw}
            native_nonnull=sum(v is not None for v in native_attrs.values())
            prov=bb.get('provenance',{}) if bb else {}
            out.append({'requested_player':wanted,'battle_base_name':bb.get('name') if bb else '',
                'player_season_id':bb.get('id') if bb else '','teamSeasonId':'psv-2005',
                'membership_club':bb.get('club') if bb else '',
                'membership_semantics':'Battle Base PSV 2005 TeamSeason roster membership; independent from ability snapshot club',
                'edition_year':yr,'source':'lbenz FIFAIndex' if ed else 'unavailable','source_edition':ed or '',
                'match_method':method,'match_status':match_status,'stable_id_match_provenance':evidence,
                'validated_source_alias':validated_alias,
                'source_name_candidate_count':len(name_hits),'source_row_count_matches':len(hits),
                'source_player_id':raw.get('player_id','') if raw else '',
                'source_name':raw.get('name','') if raw else '','source_club':raw.get('club','') if raw else '',
                'source_nationality':raw.get('nationality','') if raw else '',
                'source_overall':num(raw.get('rating')) if raw else None,'source_potential':num(raw.get('potential')) if raw else None,
                'detailed_attributes_json':json.dumps(attrs,ensure_ascii=False,sort_keys=True) if raw else '',
                'detailed_attributes_semantics':'existing audit mapped subset; values remain source edition observations, not modern semantic equivalences',
                'source_detailed_attributes_json':json.dumps(native_attrs,ensure_ascii=False,sort_keys=True) if raw else '',
                'source_native_attribute_field_names':';'.join(native_attrs),
                'source_native_attribute_nonnull_count':native_nonnull if raw else '',
                'source_native_attribute_semantics':'lbenz source-native columns and values; no modern canonical-equivalence claim',
                'current_battle_base_overall':bb.get('overall') if bb else None,
                'current_battle_base_raw_overall':prov.get('rawOverall') if bb else None,
                'current_battle_base_calibrated_overall':prov.get('calibratedOverall') if bb else None,
                'current_calibration_method':prov.get('calibrationMethod') if bb else '',
                'current_overall_source':prov.get('overallSource') if bb else ''})
    write_csv('psv-2005-case.csv',out)
    return out

def position_code_for_bb(row):
    p=row.get('positions') or []
    if isinstance(p,str): p=re.split(r'[;,/|]+',p)
    t=' '.join(str(x).upper() for x in p)
    if 'GK' in t:return 'gk'
    if 'DF' in t or 'CB' in t or 'FB' in t:return 'cb'
    if 'MF' in t or 'CM' in t:return 'cm'
    if 'FW' in t or 'ST' in t:return 'st'
    return None

def position_mapping_for_bb(row):
    p=row.get('positions') or []
    if isinstance(p,str): p=re.split(r'[;,/|]+',p)
    tokens=[str(x).strip().upper() for x in p if str(x).strip()]
    code=position_code_for_bb(row)
    if not code:return None,'unmapped'
    if len(tokens)==1 and tokens[0].lower() in POSITIONS:
        return code,'exact_native_code'
    if len(tokens)==1 and tokens[0] in ('DF','FB','MF','FW'):
        return code,'coarse_proxy'
    return code,'ambiguous_multiple_positions'

def snapshot_alignment(battle,players,entities,source_rows,idmaps,legacy,mz,lbenz):
    # Pooled Mzafram FIFA17-FC24 serves only as an explicit reference CDF for the quantile candidate.
    ref=[]
    for (src,ed),recs in source_rows.items():
        if src=='Mzafram SoFIFA' and 2017<=edition_year(ed)<=2024:
            ref.extend(x for x in (source_info(src,ed,r)[4] for r in recs) if x is not None)
    ref=np.sort(np.asarray(ref,dtype=float))
    groups=defaultdict(list)
    for r in battle: groups[r['teamSeasonId']].append(r)
    output=[]
    priorities=['Mzafram SoFIFA','Stefano legacy','lbenz FIFAIndex']
    cases={x[0]:x[1] for x in CASE_TEAMS}
    for team,rs in sorted(groups.items()):
        if not rs: continue
        teamname=rs[0]['club']; year=rs[0]['year']; highlighted=team in cases
        def emit(strategy,src,ed,ratings,bbvals,details='',position='',mapping_precision='',position_target_classification=''):
            vals=[x for x in ratings if x is not None]; bbs=[x for x in bbvals if x is not None]
            ds=[a-b for a,b in zip(ratings,bbvals) if a is not None and b is not None]
            output.append({'teamSeasonId':team,'club':teamname,'year':year,'highlight_case':highlighted,'strategy':strategy,'source':src,'edition':ed,
                'bb_roster_n':len(rs),'matched_n':len(vals),'unmatched_n':len(rs)-len(vals),'rating_mean':mean(vals),
                'rating_std':float(np.std(vals)) if vals else None,'bb_mean_same_matched':mean(bbs),'mean_delta_vs_bb':mean(ds),
                'mae_vs_bb':mean([abs(x) for x in ds]),'position_code':position,'position_mapping_precision':mapping_precision,
                'position_target_classification':position_target_classification,'notes':details})
        bbvals=[num(r.get('overall')) for r in rs]
        emit('current_BattleBase_overall','Battle Base','current build-report',bbvals,bbvals,'Current report values; denominator is all roster rows')
        matches={}
        for src in priorities:
            for yr,tag in [(year,'same_year_raw'),(year+1,'post_year_raw')]:
                ed=edition_for_year(source_rows,src,yr)
                if ed is None:
                    if src==priorities[0]:
                        empty=[None]*len(rs); bb=[num(r.get('overall')) for r in rs]
                        emit(tag,'unavailable',f'no retrieved edition for calendar {yr}',empty,bb,'No source file in collected corpus; this does not prove the game lacked data')
                        if tag=='same_year_raw': emit('same_year_quantile_candidate','unavailable',f'no retrieved edition for calendar {yr}',empty,bb,'No same-year source snapshot to rank-map')
                    continue
                vals=[]; bbs=[]; quant=[]; posvals=[]; posprecisions=[]
                for r in rs:
                    ent=entities.get(row_entity_id(r,players)); raw,status,nc=candidate_source_row(r,ent,src,ed,source_rows,idmaps)
                    if raw is None:
                        vals.append(None); bbs.append(num(r.get('overall'))); quant.append(None); posvals.append(None); continue
                    ov=source_info(src,ed,raw)[4]; vals.append(ov); bbs.append(num(r.get('overall')))
                    if ov is not None and len(ref):
                        q=np.searchsorted(ref,ov,side='right')/len(ref); quant.append(float(np.quantile(ref,q)))
                    else: quant.append(None)
                    if src=='Stefano legacy' and edition_year(ed)==year and isinstance(raw,dict) and 'targets' in raw:
                        pc,precision=position_mapping_for_bb(r); v=raw['targets'][POSITIONS.index(pc)] if pc in POSITIONS else None
                        posprecisions.append(precision)
                        posvals.append((num(r.get('overall'))+(v-ov)) if v is not None and ov is not None and num(r.get('overall')) is not None else None)
                    else:
                        posvals.append(None)
                        if src=='Stefano legacy' and edition_year(ed)==year: posprecisions.append(position_mapping_for_bb(r)[1])
                    matches[(r['id'],src,tag)]=(raw,status,ed,ov,quant[-1])
                emit(tag,src,ed,vals,bbs,('highlight case; ' if highlighted else '')+'same-year or following-edition raw source snapshot')
                if tag=='same_year_raw': emit('same_year_quantile_candidate',src,ed,quant,bbs,'Empirical CDF maps source OVR percentile to pooled Mzafram FIFA17-FC24 OVR; exploratory only')
                if tag=='same_year_raw' and src=='Stefano legacy' and edition_year(ed)==year:
                    pc=next((position_code_for_bb(x) for x in rs if position_code_for_bb(x)), '')
                    precision_counts=Counter(posprecisions)
                    precision_summary=';'.join(f'{k}={precision_counts[k]}' for k in sorted(precision_counts))
                    emit('possible_position_offset_proposal',src,ed,posvals,bbs,
                        'BB OVR + (source position base target - source OVR); modifiers excluded; proposal only. Coarse/ambiguous BB classes are representative proxies, not source-precise native-position alignment.',
                        pc,precision_summary,'source_observed_target_with_rowwise_mapping_precision')
        if edition_for_year(source_rows,'Stefano legacy',year) is None:
            emit('possible_position_offset_proposal','unavailable','no retrieved native position labels for this year',[None]*len(rs),bbvals,
                'No same-year position target in collected sources; proposal unavailable, no fabricated labels')
        # Hybrid chooses same-year source if any (fixed priority); else next-year source, with source provenance retained.
        hv=[]; hb=[]; chosen=[]
        for r in rs:
            ent=entities.get(row_entity_id(r,players)); selection=None
            for yr,tag in [(year,'same_year_raw'),(year+1,'post_year_raw')]:
                for src in priorities:
                    ed=edition_for_year(source_rows,src,yr)
                    if not ed: continue
                    raw,status,nc=candidate_source_row(r,ent,src,ed,source_rows,idmaps)
                    if raw is not None:
                        ov=source_info(src,ed,raw)[4]
                        if ov is not None: selection=(ov,src,ed,tag,status); break
                if selection: break
            if selection:
                hv.append(selection[0]); chosen.append(f"{selection[1]}:{selection[2]}:{selection[3]}")
            else: hv.append(None)
            hb.append(num(r.get('overall')))
        emit('hybrid_same_year_then_post',','.join(sorted(set(x.split(':')[0] for x in chosen))),';'.join(sorted(set(x.split(':')[1] for x in chosen))),hv,hb,
            ('highlight case; ' if highlighted else '')+'first matched source per player; same-year before post-year; priority Mzafram > Stefano legacy > lbenz; provenance varies by row')
    write_csv('snapshot-alignment.csv',output)
    return output

def breakpoint_audit(continuity,source_summary,adjacent_distances):
    dist={(r['source'],edition_year(r['edition'])):r for r in source_summary if r.get('rows')}
    shapes={(r['source'],r['year_a'],r['year_b'],r['cohort']):r for r in adjacent_distances}
    groups=defaultdict(list)
    for r in continuity: groups[(r['source'],r['year_a'],r['year_b'])].append(r)
    out=[]
    for (src,ya,yb),rs in sorted(groups.items()):
        ds=[r['delta_b_minus_a'] for r in rs]; eda=dist.get((src,ya)); edb=dist.get((src,yb))
        drift=(edb['overall_mean']-eda['overall_mean']) if eda and edb and eda['overall_mean'] is not None and edb['overall_mean'] is not None else mean(ds)
        if abs(drift)>0.20: allowed=-1 if drift>0 else 1
        else: allowed=0
        good=sum(1 for d in ds if (d<=0 if allowed==-1 else (d>=0 if allowed==1 else True)))
        opposing=sum(1 for d in ds if (d>0 if allowed==-1 else (d<0 if allowed==1 else False)))
        shape=shapes.get((src,ya,yb,'all_players'),{})
        out.append({'signal_class':'adjacent-player-and-population-change','source':src,'edition_a':rs[0]['edition_a'],'edition_b':rs[0]['edition_b'],'year_a':ya,'year_b':yb,'same_player_pairs':len(ds),
            'source_population_mean_drift_b_minus_a':(edb['overall_mean']-eda['overall_mean']) if eda and edb and eda['overall_mean'] is not None and edb['overall_mean'] is not None else None,
            'population_ks_2sample':shape.get('ks_2sample'),'population_wasserstein1_quantile_grid_201':shape.get('wasserstein1_quantile_grid_201'),
            'raw_column_count_delta':(int(edb.get('raw_columns',0))-int(eda.get('raw_columns',0))) if eda and edb else None,
            'edition_row_count_delta':(int(edb.get('rows',0))-int(eda.get('rows',0))) if eda and edb else None,
            'paired_player_mean_delta':mean(ds),'paired_player_median_delta':float(np.median(ds)),'paired_increase_pct':round(sum(d>0 for d in ds)/len(ds),6),
            'paired_unchanged_pct':round(sum(d==0 for d in ds)/len(ds),6),'paired_decrease_pct':round(sum(d<0 for d in ds)/len(ds),6),
            'guard_direction_proxy':'downward-only' if allowed==-1 else ('upward-only' if allowed==1 else 'aligned/neutral'),
            'paired_share_following_proxy_guard':round(good/len(ds),6) if ds else None,'paired_share_opposing_proxy_guard':round(opposing/len(ds),6) if ds else None,
            'position_label_columns_observed':None,'breakpoint_interpretation':'paired player scores + whole-population distribution shape/coverage deltas; descriptive cohort-composition confounds remain',
            'rule_evidence':'scripts/lib/calibrate.mjs edition meanDrift > +0.20 restricts individual deltas to <=0; < -0.20 restricts >=0; else aligned; this source-pair proxy is not an exact replay of calibrator state'})
    out.append({'signal_class':'position-rating-label-onset','source':'Stefano legacy','edition_a':'no retrieved prior edition','edition_b':'15','year_a':2014,'year_b':2015,'same_player_pairs':0,
        'source_population_mean_drift_b_minus_a':None,'population_ks_2sample':None,'population_wasserstein1_quantile_grid_201':None,'raw_column_count_delta':None,'edition_row_count_delta':None,
        'position_label_columns_observed':27,'breakpoint_interpretation':'first retrieved native position-rating targets in this corpus; available-label boundary, not proof EA introduced positions in FIFA15',
        'paired_player_mean_delta':None,'paired_player_median_delta':None,'paired_increase_pct':None,'paired_unchanged_pct':None,'paired_decrease_pct':None,
        'guard_direction_proxy':'not applicable','paired_share_following_proxy_guard':None,'paired_share_opposing_proxy_guard':None,
        'rule_evidence':'observed schema availability boundary from source-summary/schema-matrix'})
    write_csv('breakpoint-score.csv',out)
    return out

MZ_ATTRS=['pace','shooting','passing','dribbling','defending','physical','crossing','finishing','heading_accuracy','short_passing','volleys','dribbling_stat','curve','fk_accuracy','long_passing','ball_control','acceleration','sprint_speed','agility','reactions','balance','shot_power','jumping','stamina','strength','long_shots','aggression','interceptions','positioning','vision','penalties','composure','defensive_awareness','standing_tackle','sliding_tackle','gk_diving','gk_handling','gk_kicking','gk_positioning','gk_reflexes']

def attribute_drift(mz):
    raw=[]; pooled=defaultdict(list)
    for ed,rs in mz.items():
        for field in MZ_ATTRS:
            vals=[num(r.get(field)) for r in rs]; vals=[x for x in vals if x is not None]
            if not vals: continue
            yr=edition_year(ed)
            raw.append({'source':'Mzafram SoFIFA','edition':ed,'year':yr,'attribute':field,'n_nonnull':len(vals),'row_count':len(rs),
                'nonnull_pct':round(len(vals)/len(rs),6),'mean':mean(vals),'std_pop':float(np.std(vals)),'median':float(np.median(vals)),
                'drift_universe':'all players in single retrieved source snapshot; composition-confounded'})
            if 2017<=yr<=2024: pooled[field].extend(vals)
    for r in raw:
        vals=pooled.get(r['attribute'],[]); m=mean(vals); sd=float(np.std(vals)) if vals else None
        r['reference_2017_24_mean']=m;r['reference_2017_24_std']=sd
        r['z_vs_reference']=((r['mean']-m)/sd) if sd and sd>0 else None
    write_csv('attribute-drift.csv',raw)
    return raw

def reference_candidates(dists,continuity):
    mz={edition_year(r['edition']):r for r in dists if r['source']=='Mzafram SoFIFA'}
    windows=[('FIFA15–23 legacy-label overlap',2015,2023),('FIFA17–FC24 current-reference window',2017,2024),
        ('FIFA18–FC25 recent window',2018,2025),('FIFA07–FC25 broad raw window',2007,2025)]
    rows=[]
    for name,a,b in windows:
        avail=[yr for yr in sorted(mz) if a<=yr<=b]; ds=[mz[y] for y in avail]
        pairs=[r for r in continuity if r['source']=='Mzafram SoFIFA' and a<=r['year_a'] and r['year_b']<=b]
        means=[r['mean'] for r in ds]; tops=[r['top500_mean'] for r in ds]; stds=[r['std_pop'] for r in ds]
        rows.append({'candidate_window':name,'year_start':a,'year_end':b,'available_editions':len(ds),'editions_in_data':';'.join(str(y) for y in avail),
            'mean_of_edition_means':mean(means),'sd_between_edition_means':float(np.std(means)) if means else None,
            'mean_top500_by_edition':mean(tops),'sd_top500_means':float(np.std(tops)) if tops else None,
            'mean_within_edition_std':mean(stds),'same_player_adjacent_pairs':len(pairs),
            'mean_abs_adjacent_same_player_delta':mean([abs(r['delta_b_minus_a']) for r in pairs]),
            'same_player_pair_zero_delta_pct':round(sum(r['delta_b_minus_a']==0 for r in pairs)/len(pairs),6) if pairs else None,
            'limitation':'all-player source composition differs by edition; comparison is descriptive, not proof of scale equivalence'})
    write_csv('reference-candidate-ranges.csv',rows)
    return rows

def position_cohort_and_distances(legacy,mz,lbenz):
    data=defaultdict(lambda:defaultdict(list)); roster=Counter(); samples=defaultdict(list)
    slot={'GK':'GK','LCB':'CB','CB':'CB','RCB':'CB','LB':'LB/RB','RB':'LB/RB','LWB':'LWB/RWB','RWB':'LWB/RWB',
        'LDM':'CDM','CDM':'CDM','RDM':'CDM','LCM':'CM','CM':'CM','RCM':'CM','LAM':'CAM','CAM':'CAM','RAM':'CAM',
        'LM':'LM/RM','RM':'LM/RM','LW':'LW/RW','RW':'LW/RW','LS':'CF/ST','ST':'CF/ST','RS':'CF/ST','LF':'CF/ST','CF':'CF/ST','RF':'CF/ST',
        'DF':'coarse-DF','MF':'coarse-MF','FW':'coarse-FW'}
    def add(src,ed,posraw,ov,pot,attrs):
        tokens=[x for x in re.split(r'[,/;\s]+',str(posraw).upper().strip()) if x]
        primary=tokens[0] if tokens else 'UNRESOLVED'
        family=slot.get(primary,'unresolved-fine-position')
        cohorts=[('all_players','ALL'),(family,primary)]
        for cohort,code in cohorts:
            key=(src,ed,cohort,code); roster[key]+=1
            data[key]['overall'].append(ov);data[key]['potential'].append(pot)
            for field,value in attrs.items(): data[key][field].append(value)
        samples[(src,'all_players',ed)].append(ov)
        samples[(src,family,ed)].append(ov)
    # Each row belongs to one primary-position cohort; all-player aggregate is separately labeled.
    for ed,rs in legacy.items():
        for r in rs:
            raw=r['raw']; add('Stefano legacy',ed,r['positions'],r['overall'],r['potential'],{f:num(raw.get(f)) for f in RAW_FEATURES})
    for ed,rs in mz.items():
        for r in rs: add('Mzafram SoFIFA',ed,r.get('positions',''),num(r.get('overall')),num(r.get('potential')),{f:num(r.get(f)) for f in MZ_ATTRS})
    lbfields=['ball_control','dribbling','marking','slide_tackle','stand_tackle','aggression','reactions','att_position','interceptions','vision','composure','crossing','short_pass','long_pass','acceleration','stamina','strength','sprint_speed','creativity','heading','shot_power','finishing','long_shots','shot_accuracy','penalties','gk_positioning','gk_diving','gk_handling','gk_kicking','gk_reflexes','gk_rushing']
    for ed,rs in lbenz.items():
        for r in rs: add('lbenz FIFAIndex',ed,r.get('preferred_positions',''),num(r.get('rating')),num(r.get('potential')),{f:num(r.get(f)) for f in lbfields})
    demo=CACHE/'kaggle_fifa18_CompleteDataset.csv'
    if demo.exists():
        attrs=['Acceleration','Aggression','Agility','Balance','Ball control','Composure','Crossing','Curve','Dribbling','Finishing','Free kick accuracy','GK diving','GK handling','GK kicking','GK positioning','GK reflexes','Heading accuracy','Interceptions','Jumping','Long passing','Long shots','Marking','Penalties','Positioning','Reactions','Short passing','Shot power','Sliding tackle','Sprint speed','Stamina','Standing tackle','Strength','Vision','Volleys']
        for r in read_csv(demo): add('FIFA18 demo SoFIFA','18',r.get('Preferred Positions',''),num(r.get('Overall')),num(r.get('Potential')),{f:num(r.get(f)) for f in attrs})
    rows=[]
    for (src,ed,cohort,code),metrics in data.items():
        n=roster[(src,ed,cohort,code)]
        for field,vals0 in metrics.items():
            vals=[v for v in vals0 if v is not None]
            rows.append({'source':src,'edition':ed,'year':edition_year(ed),'cohort':cohort,'native_primary_code':code,'metric_type':'overall' if field=='overall' else ('potential' if field=='potential' else 'attribute'),
                'raw_field':field,'n_players':n,'n_nonnull':len(vals),'nonnull_pct':round(len(vals)/n,6) if n else None,'mean':mean(vals),
                'std_pop':float(np.std(vals)) if vals else None,'median':float(np.median(vals)) if vals else None,
                'universe':'all players; position cohorts use first listed native roster position, mutually exclusive within edition; all_players is separately labeled'})
    write_csv('position-cohort-distributions.csv',rows)
    distrows=[]
    grouped=defaultdict(dict)
    for (src,cohort,ed),vals in samples.items():grouped[(src,cohort)][ed]=[v for v in vals if v is not None]
    for (src,cohort),vers in grouped.items():
        years=sorted((edition_year(ed),ed) for ed in vers)
        for (ya,ea),(yb,eb) in zip(years,years[1:]):
            if yb!=ya+1:continue
            a=np.sort(np.asarray(vers[ea],float)); b=np.sort(np.asarray(vers[eb],float))
            if min(len(a),len(b))<50:continue
            grid=np.sort(np.concatenate([a,b])); ca=np.searchsorted(a,grid,side='right')/len(a); cb=np.searchsorted(b,grid,side='right')/len(b)
            ks=float(np.max(np.abs(ca-cb))); q=np.linspace(0,1,201); w1=float(np.mean(np.abs(np.quantile(a,q)-np.quantile(b,q))))
            distrows.append({'source':src,'cohort':cohort,'edition_a':ea,'edition_b':eb,'year_a':ya,'year_b':yb,'n_a':len(a),'n_b':len(b),
                'mean_a':float(np.mean(a)),'mean_b':float(np.mean(b)),'mean_drift_b_minus_a':float(np.mean(b)-np.mean(a)),
                'std_a':float(np.std(a)),'std_b':float(np.std(b)),'ks_2sample':ks,'wasserstein1_quantile_grid_201':w1,
                'scope':'population distribution of source-native overall; edition roster composition differs'})
    write_csv('adjacent-distribution-distances.csv',distrows)
    return rows,distrows

def _svg_text(s):
    import html
    return html.escape(str(s))

def svg_lines(path,title,series,ylabel='',width=980,height=520):
    pts=[(float(x),float(y)) for sr in series for x,y in sr['points'] if x is not None and y is not None and math.isfinite(float(y))]
    if not pts:return
    xs=sorted(set(x for x,y in pts)); ys=[y for x,y in pts]; ymin=min(ys);ymax=max(ys)
    if ymax==ymin:ymax+=1
    pad=(ymax-ymin)*.08; ymin-=pad;ymax+=pad
    left,right,top,bottom=75,width-30,65,height-75
    xp=lambda x:left+(x-min(xs))/(max(xs)-min(xs) or 1)*(right-left)
    yp=lambda y:bottom-(y-ymin)/(ymax-ymin)*(bottom-top)
    colors=['#1769aa','#d45500','#168a55','#8a58a6','#b23b65','#777700']
    s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">','<rect width="100%" height="100%" fill="white"/>']
    s.append(f'<text x="{width/2}" y="30" text-anchor="middle" font-size="20" font-family="Arial">{_svg_text(title)}</text>')
    for i in range(6):
        y=ymin+(ymax-ymin)*i/5; py=yp(y)
        s.append(f'<line x1="{left}" y1="{py:.1f}" x2="{right}" y2="{py:.1f}" stroke="#ddd"/>')
        s.append(f'<text x="{left-8}" y="{py+4:.1f}" text-anchor="end" font-size="11" fill="#444" font-family="Arial">{y:.1f}</text>')
    for x in xs:
        s.append(f'<line x1="{xp(x):.1f}" y1="{top}" x2="{xp(x):.1f}" y2="{bottom}" stroke="#f0f0f0"/>')
        s.append(f'<text x="{xp(x):.1f}" y="{bottom+20}" text-anchor="middle" font-size="10" fill="#444" font-family="Arial">{int(x)}</text>')
    s.append(f'<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="#333"/><line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" stroke="#333"/>')
    for j,sr in enumerate(series):
        p=sorted((float(x),float(y)) for x,y in sr['points'] if x is not None and y is not None and math.isfinite(float(y)))
        if not p:continue
        color=colors[j%len(colors)]; ptsstr=' '.join(f'{xp(x):.1f},{yp(y):.1f}' for x,y in p)
        s.append(f'<polyline points="{ptsstr}" fill="none" stroke="{color}" stroke-width="2"/>')
        for x,y in p:s.append(f'<circle cx="{xp(x):.1f}" cy="{yp(y):.1f}" r="3" fill="{color}"/>')
        lx=left+10+(j%3)*290;ly=top-15+(j//3)*16
        s.append(f'<line x1="{lx}" y1="{ly}" x2="{lx+18}" y2="{ly}" stroke="{color}" stroke-width="3"/><text x="{lx+23}" y="{ly+4}" font-size="11" font-family="Arial">{_svg_text(sr["name"])}</text>')
    if ylabel:s.append(f'<text transform="translate(18 {height/2}) rotate(-90)" text-anchor="middle" font-size="12" font-family="Arial">{_svg_text(ylabel)}</text>')
    s.append('</svg>'); path.parent.mkdir(parents=True,exist_ok=True);path.write_text('\n'.join(s),encoding='utf8')

def svg_heatmap(path,title,rows):
    attrs=sorted({r['attribute'] for r in rows}); eds=sorted({int(r['year']) for r in rows}); lookup={(int(r['year']),r['attribute']):num(r.get('z_vs_reference')) for r in rows}
    cellw=34;cellh=20;left=145;top=70;width=left+cellw*len(eds)+25;height=top+cellh*len(attrs)+50
    s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">','<rect width="100%" height="100%" fill="white"/>',f'<text x="{width/2}" y="28" text-anchor="middle" font-size="18" font-family="Arial">{_svg_text(title)}</text>']
    for j,y in enumerate(eds):s.append(f'<text x="{left+j*cellw+cellw/2}" y="{top-8}" text-anchor="middle" font-size="9" font-family="Arial">{y}</text>')
    for i,a in enumerate(attrs):
        s.append(f'<text x="{left-7}" y="{top+i*cellh+14}" text-anchor="end" font-size="9" font-family="Arial">{_svg_text(a)}</text>')
        for j,y in enumerate(eds):
            v=lookup.get((y,a)); t=max(-3,min(3,v or 0))/3
            if t<0: col=f'rgb({int(255+90*t)}, {int(255+90*t)},255)'
            else: col=f'rgb(255,{int(255-90*t)},{int(255-90*t)})'
            s.append(f'<rect x="{left+j*cellw}" y="{top+i*cellh}" width="{cellw-1}" height="{cellh-1}" fill="{col}"/>')
    s.append('</svg>');path.parent.mkdir(parents=True,exist_ok=True);path.write_text('\n'.join(s),encoding='utf8')

def generate_figures(summary,dists,continuity,stability,drift,psv):
    f=OUT/'figures'; bysrc=defaultdict(list)
    for r in dists:bysrc[r['source']].append(r)
    svg_lines(f/'ovr-by-edition.svg','OVR population mean by source and edition',[
        {'name':s,'points':[(edition_year(r['edition']),r['mean']) for r in rs]} for s,rs in bysrc.items()])
    svg_lines(f/'top500-mean-by-edition.svg','Top-500 OVR mean by source/edition',[
        {'name':s,'points':[(edition_year(r['edition']),r['top500_mean']) for r in rs]} for s,rs in bysrc.items()])
    svg_lines(f/'top500-std-by-edition.svg','Top-500 OVR population standard deviation',[
        {'name':s,'points':[(edition_year(r['edition']),r['top500_std_pop']) for r in rs]} for s,rs in bysrc.items()])
    c=defaultdict(list)
    for r in continuity:c[(r['source'],r['year_b'])].append(r['delta_b_minus_a'])
    cseries=[]
    for src in sorted({k[0] for k in c}): cseries.append({'name':src,'points':[(y,mean(v)) for (s,y),v in sorted(c.items()) if s==src]})
    svg_lines(f/'same-player-adjacent-delta.svg','Mean OVR delta among same-source adjacent-year player IDs',cseries,'mean paired delta')
    bysrc=defaultdict(list)
    for r in summary:bysrc[r['source']].append(r)
    svg_lines(f/'schema-field-count.svg','Raw CSV columns per edition (schema count is not semantic equivalence)',[
        {'name':s,'points':[(edition_year(r['edition']),r['raw_columns']) for r in rs if r['availability']=='available file observed']} for s,rs in bysrc.items()])
    co=defaultdict(list)
    for r in stability:
        if r['target_kind']=='base_rating' and r['coefficient_cosine'] is not None:
            co[(int(r['edition_a']),int(r['edition_b']))].append(r['coefficient_cosine'])
    svg_lines(f/'position-coefficient-similarity.svg','Pairwise positional base-rating coefficient cosine (position mean)',[
        {'name':'mean across position codes','points':[(b,mean(v)) for (a,b),v in sorted(co.items())]}],'cosine')
    svg_heatmap(f/'attribute-drift-heatmap.svg','Mzafram attribute mean shift vs FIFA17–FC24 pooled distribution (z)',drift)
    pp=defaultdict(list)
    for r in psv:
        if r['source_overall'] is not None: pp[r['requested_player']].append((int(r['edition_year']),r['source_overall']))
    svg_lines(f/'psv-2005-nine-players-fifa05-07.svg','PSV 2005 case: nine players in FIFAIndex editions',[
        {'name':n,'points':sorted(v)} for n,v in pp.items()])
    return sorted(str(x.relative_to(OUT)).replace('\\','/') for x in f.glob('*.svg'))

def source_manifest(summary,figures):
    downloads=json.load(open(CACHE/'downloads.json',encoding='utf8'))
    data=json.load(open(CACHE/'position_labels.json',encoding='utf8'))
    leone=json.load(open(CACHE/'stefanoleone_download.json',encoding='utf8'))
    rows=[]
    for p in sorted(CACHE.iterdir()):
        if not p.is_file() or p.suffix.lower() not in ('.csv','.zip'): continue
        if p.name.startswith('derived-'): continue
        item={'cache_path':str(p.relative_to(ROOT)).replace('\\','/'),'verified_date':'2026-10-07','bytes':p.stat().st_size,'sha256':sha(p),'redistribute_in_repo':False}
        if p.name.startswith('mzafram_'):
            filename='dataset_ea_fc_'+p.stem[-2:]+'.csv' if p.stem.startswith('mzafram_FC') else 'dataset_fifa_'+p.stem[-2:]+'.csv'
            item.update({'source':'Mzafram ea-fc repository','source_revision':'main at pinned SHA 90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0',
                'source_url_mutable':False,'license':'MIT for scraper/code; underlying SoFIFA/game data rights unresolved',
                'repository_source_description':'current scraper/API identifies SoFIFA as upstream',
                'historical_edition_lineage':'UNRESOLVED: current repo does not independently establish the origin or update vintage of every historical edition CSV',
                'url':f'https://raw.githubusercontent.com/mzafram2001/ea-fc/90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0/data/{filename}'})
            item['git_blob_sha1']=git_blob_sha1(p)
        elif 'lbenz' in p.name:
            item.update({'source':'lbenz730/fifa_model','source_revision':'UNRESOLVED; fetched endpoint is mutable master branch; cached payload pinned by SHA256',
                'source_url_mutable':True,'dataset_version':'UNRESOLVED','license':'no repository/data license identified; redistribution rights unresolved',
                'url':'https://raw.githubusercontent.com/lbenz730/fifa_model/master/player_stats.csv'})
        elif p.name in ('stefanoleone_fifa23_complete.zip',):
            item.update({'source':'Stefano Leone Kaggle dataset','source_revision':'Kaggle version id unavailable in retrieved evidence; cached archive pinned by SHA256',
                'source_url_mutable':True,'declared_license':leone.get('metadata',{}).get('licenseNameNullable') or 'CC0 per verified Kaggle API metadata',
                'underlying_rights':'FIFA/SoFIFA-derived data rights unresolved separately; do not redistribute full archive','url':leone.get('origin')})
        elif p.name in ('kaggle_fifa18_demo.zip','kaggle_fifa18_CompleteDataset.csv'):
            item.update({'source':'thec03u5 FIFA 18 Demo Player Dataset','source_url_mutable':True,
                'declared_license':'CC BY-NC-SA 4.0 per listing evidence','underlying_rights':'SoFIFA-derived player data; no full CSV redistribution in this repository',
                'listing_schema_claim_columns':155,'observed_csv_rows':17981,'observed_csv_columns':75,'url':data.get('origin')})
        rows.append(item)
    actual=[r for r in summary if r.get('availability')=='available file observed']
    outputs=[]
    for rel in ['source-summary.csv','schema-matrix.csv','edition-distributions.csv','position-vocabulary.csv','position-formula-fit.csv','position-formula-stability.csv','same-player-continuity.csv','snapshot-alignment.csv','psv-2005-case.csv','battle-base-coverage.csv','player-season-coverage.csv','entity-coverage-summary.csv','breakpoint-score.csv','source-conflicts.csv','cross-source-verification.csv','source-conflict-summary.csv','attribute-drift.csv','reference-candidate-ranges.csv','position-cohort-distributions.csv','adjacent-distribution-distances.csv','FIFA-HISTORICAL-RATING-AUDIT.md','README.md']+figures:
        p=OUT/'outputs'/rel if rel.endswith('.csv') else OUT/rel
        if not p.exists():continue
        output_rel=str(p.relative_to(OUT)).replace('\\','/')
        rec={'path':output_rel,'bytes':p.stat().st_size,'sha256':sha(p)}
        if p.suffix=='.csv': rec['rows']=sum(1 for _ in open(p,encoding='utf8',newline=''))-1
        outputs.append(rec)
    intermediates=[]
    for p in sorted(CACHE.glob('derived-*.csv')):
        intermediates.append({'cache_path':str(p.relative_to(ROOT)).replace('\\','/'),'bytes':p.stat().st_size,'rows':sum(1 for _ in open(p,encoding='utf8',newline=''))-1,'sha256':sha(p),'redistribute_in_repo':False})
    metadata_files=[]
    for path in (CACHE/'downloads.json',CACHE/'position_labels.json',CACHE/'stefanoleone_download.json'):
        if path.exists(): metadata_files.append({'cache_path':str(path.relative_to(ROOT)).replace('\\','/'),'bytes':path.stat().st_size,'sha256':sha(path)})
    result={'audit':'FIFA Historical Schema & Position Rating Audit v1','verified_date':'2026-10-07','worktree_baseline':'3bcb487388b655c9ac0fde34555af98284114719',
        'branch':'research/fifa-historical-schema-audit-v1','source_files':rows,'source_summary_observations':len(summary),
        'available_source_edition_rows':len(actual),'source_lineage_assessment':{
            'Mzafram':'Pinned current repository/code identifies SoFIFA as upstream, but per-edition historical payload origin/update vintage is UNRESOLVED; use as retrieved third-party observations, not verified primary SoFIFA history.',
            'lbenz':'The mutable source endpoint has no pinned repository revision; local payload SHA256 identifies only the observed downloaded file.',
            'Stefano Leone':'Kaggle API declares CC0; FIFA/SoFIFA-derived data rights remain separate and unresolved.',
            'FIFA18 demo':'Listing says 155 columns; actual downloaded file has 17,981 rows and 75 columns.'},
        'metadata_files':metadata_files,'unavailable_expected_sources':[{'source':'Mzafram ea-fc','edition':'FC26','http_status':404,
            'live_repository_revision':'90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0','updated_at':'2026-10-07T06:48:32Z',
            'tree_verified_no_FC26_blob':True,'note':'A stale six-day-old indexed listing claimed 5.44MB; live tree/API/raw checks supersede it.'}],
        'source_license_policy':{'lbenz':'unknown/unresolved; cache only','mzafram':'MIT code only; dataset rights unresolved; cache only',
            'Stefano Leone':'Kaggle declares CC0, underlying FIFA/SoFIFA data rights separate and unresolved; cache only',
            'FIFA18 demo':'CC BY-NC-SA 4.0 source listing; full CSV remains in ignored cache only'},
        'position_label_sources':{'Stefano legacy':'FIFA15–23, 27 native position labels; label strings parsed to base and signed modifier independently; legacy snapshot is second-year-update vintage',
            'FIFA18 demo':'17,981×75 actual file; source listing described 155 columns; 27 scalar position ratings; schema discrepancy reported'},
        'analysis_script':{'path':'research/fifa-rating-audit/src/audit.py','sha256':sha(Path(__file__).resolve())},
        'outputs':outputs,'derived_intermediate_cache':intermediates,'figures':figures,
        'rebuild_command':'python research/fifa-rating-audit/src/audit.py','read_only_check_command':'python research/fifa-rating-audit/src/audit.py --check',
        'analysis_method':'NumPy ridge regression, stable player_id SHA256 fold (20% held out consistently across editions), training-only global feature scales and per-model training-only imputations; no sklearn/scipy/matplotlib dependency.'}
    jsonwrite(OUT/'source-manifest.json',result)
    return result

def write_readme():
    body='''# FIFA Historical Schema & Position Rating Audit v1

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
'''
    (OUT/'README.md').write_text(body,encoding='utf8')

def write_report(summary,dists,fit,stability,continuity,conflicts,alignment,psv,coverage,breaks,refs,drift,figures):
    by={(r['source'],str(r['edition'])):r for r in summary}
    def srow(src,ed): return by.get((src,str(ed)),{})
    psv_f=[r for r in psv if norm(r['requested_player'])==norm('Jefferson Farfan')]
    farfan={int(r['edition_year']):r for r in psv_f}
    fa=[f"{y}: OVR {farfan[y]['source_overall']} (POT {farfan[y]['source_potential']})" for y in (2005,2006,2007) if y in farfan and farfan[y]['source_overall'] is not None]
    p05=[r for r in psv if r['edition_year']==2005 and r['source_overall'] is not None]
    p06=[r for r in psv if r['edition_year']==2006 and r['source_overall'] is not None]
    deltas={norm(r['requested_player']):r['source_overall'] for r in p05}; delta6={norm(r['requested_player']):r['source_overall'] for r in p06}
    paired=[(deltas[k],delta6[k]-deltas[k]) for k in deltas.keys()&delta6.keys()]
    base=[r for r in fit if r['target_kind']=='base_rating']
    mae=mean([r['heldout_mae'] for r in base]); r2=mean([r['heldout_r2'] for r in base if r['heldout_r2'] is not None])
    stbase=[r for r in stability if r['target_kind']=='base_rating' and r['coefficient_cosine'] is not None]
    cos=mean([r['coefficient_cosine'] for r in stbase])
    delta_by_src=defaultdict(list)
    for r in continuity: delta_by_src[r['source']].append(abs(r['delta_b_minus_a']))
    stable_rows=[]
    for src,ds in delta_by_src.items():stable_rows.append(f"{src}: {len(ds):,} adjacent pairs; median |ΔOVR| {np.median(ds):.2f}; within ±1 {sum(x<=1 for x in ds)/len(ds):.1%}.")
    align_mae=defaultdict(list)
    for r in alignment:
        if r['mae_vs_bb'] is not None: align_mae[r['strategy']].append(r['mae_vs_bb'])
    align_text='; '.join(f"{k}: mean case MAE {mean(v):.2f} across {len(v)} case rows" for k,v in align_mae.items())
    mza=[r for r in summary if r['source']=='Mzafram SoFIFA' and r['availability']=='available file observed']
    coverage_rows=[r for r in coverage if r.get('teamSeasonId')!='ALL_62_TEAMSEASONS']
    covered=sum(int(r['matched_n'] or 0) for r in coverage_rows); denom=sum(int(r['bb_player_n'] or 0) for r in coverage_rows)
    confyears=sorted({int(r['year']) for r in conflicts})
    l05=srow('lbenz FIFAIndex','05'); m07=srow('Mzafram SoFIFA','FIFA07')
    refs_text='; '.join(f"{r['candidate_window']}: {r['available_editions']} eds, edition-mean SD {r['sd_between_edition_means']:.2f}, top500-mean SD {r['sd_top500_means']:.2f}, adjacent-player pairs {r['same_player_adjacent_pairs']}" for r in refs)
    breaktext=(f"Across {len(breaks)} adjacent source-edition pairs, median share of player deltas compatible with the proxy one-sided guard is {np.median([r['paired_share_following_proxy_guard'] for r in breaks if r['paired_share_following_proxy_guard'] is not None]):.1%}; this is not a direct replay of production calibration state.") if breaks else 'UNRESOLVED: no adjacent source-edition pairs.'
    body='''### Scope and evidence tiers

This is an empirical, source-separated audit. Tier A means the retrieved file directly contains the field/value and local checksum; Tier B means a uniquely mapped cross-source or held-out statistical comparison; Tier C means a derived mapping or proposal. None establishes EA's proprietary formula. Data rows identify source edition/vintage, and population distributions describe the full available player sample rather than Battle Base's selected teams.

Retrieved direct files: lbenz/FIFAIndex-attributed FIFA05–20 (16 snapshots; 64 columns; source version unresolved), 19 Mzafram repository CSVs FIFA07–FC25 (59 columns each), Stefano legacy FIFA15–23 (110 fields, 27 position labels), and a FIFA18 demo extract (17,981×75). The Mzafram repository's current scraper points to SoFIFA, but historical per-edition origin/update vintage is UNRESOLVED; payloads are pinned observations, not verified primary SoFIFA history. The demo listing's 155-column claim differs from the actual file. Live Mzafram tree/API at `90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0` has no FC26 file; the stale indexed 5.44 MB listing is superseded. Kaggle API declares Leone CC0, but underlying FIFA/SoFIFA rights remain unresolved. The 5.64 GB all-updates member was not inflated; only the 90.9 MB legacy member was read.

Battle Base coverage scope: 418 entities, 554 PlayerSeasons, 62 TeamSeasons and 554 fallback records in the existing build report. Coverage uses source-specific external IDs first, then unique normalized names, and records ambiguous/unmatched status. The cross-source conflict table uses only unique normalized name plus nationality joins. It includes **{len(conflicts):,}** comparison rows across years **{', '.join(map(str,confyears[:20]))}**; source differences are not treated as errors.

### Executive summary (A–J)

**A. Schema breakpoint.** FIFA15 is the first observed edition here with 27 native position-rating labels alongside detailed attributes in the Stefano legacy file. This is a corpus-availability boundary, not proof that EA changed the game schema in FIFA15. Raw column counts (64 / 59 / 110 / 75) also reflect exporter shape and unresolved historical lineage; inspect per-field non-null coverage.

**B. Modern reference era.** Keep 2017–2024 only as a provisional descriptive baseline, not a universal scaler. Candidate-window measurements: {refs_text}. These Mzafram historical edition populations have unresolved per-file lineage, so the best verified primary reference interval remains UNRESOLVED. Select future calibration data by target cohort and recorded edition/update snapshot.

**C. TeamSeason snapshot rule.** Because TeamSeason Y is a completed season, prefer ability snapshot FIFA/FC Y+1 when identity confidence is adequate, while retaining Y membership separately. Fall back to Y when Y+1 is unavailable or the match is unreliable; record edition/update date. `snapshot-alignment.csv` covers all 62 TeamSeasons with six cases highlighted. MAEs against the current Battle Base report are not ground truth. Same-year can match exactly because that report cites the same FIFAIndex source; this is circular agreement, not validation of timing.

**D. Canonical attributes.** Preserve source-native raw values first. A versioned v2 canonical candidate can map clearly overlapping modern details (crossing, finishing, heading accuracy, short passing, volleys, dribbling, curve, free-kick accuracy, long passing, ball control, acceleration/sprint speed/agility/reactions/balance, shot power, jumping, stamina, strength, long shots, aggression/interceptions/positioning/vision/penalties/composure, tackles/defensive awareness, GK attributes) only with per-source semantic/version tags. Do not equate early `creativity` to later `vision`, aggregate `pace` to acceleration/sprint speed, or fill absent fields.

**E. Canonical positions.** Proposed vocabulary: GK, LB, CB, RB, LWB, RWB, CDM, CM, CAM, LM, RM, LW, RW, CF, ST. Preserve source strings/codes; derive `naturalPositions` through a versioned mapping and keep side/role detail. Position labels describe source/natural role; they are not ability ratings. See `position-vocabulary.csv`.

**F. Position ratings.** Prefer a raw observed source position label when available and entitled; do not silently manufacture one. The research regression is a validation/proposal path only. Across {len(base):,} held-out base-rating models the macro mean MAE is {mae:.3f}, mean R² {r2:.4f}; across same-position/version-pair coefficient comparisons the mean cosine is {cos:.3f}. FIFA18 examples ST/CM/CB/GK are about MAE .25 and R² .999. These are predictive fits to SoFIFA-derived targets, not proof of EA source code or formula.

**G. PSV 2005 cause.** The psv-2005-case.csv directly traces all nine players across FIFA05/06/07 by explicit stable source IDs, preserving PSV TeamSeason membership separately from each edition's source club. The source spelling Philip Cocu is a validated alias for requested Phillip Cocu (ID 5736), supported by the unique Netherlands/PSV rows across those editions. The CSV retains full source-native attributes as well as the mapped subset, with the two semantics labeled separately. The PSV05 report OVRs were sourced from the same FIFAIndex payload; there is no evidence here that the current report introduced a PSV05 OVR rewrite. Attribution among roster selection, early-era rating philosophy, update vintage, and calibration remains a causal hypothesis, not a resolved fact.

**H. Preserve from current calibration.** Preserve source provenance, raw versus calibrated values, reference era metadata, and separate attribute dimensions. These support auditability and future controlled migration.

**I. Rework.** Re-evaluate the edition-wide one-sided direction guard against paired-player/source evidence. Current code uses edition `meanDrift > +0.20` to allow only individual non-positive deltas, `< -0.20` to allow only non-negative deltas, otherwise aligned; this is a heuristic. {breaktext} Do not infer one fixed rule is correct across distinct source vintages.

**J. PlayerAbilityModel v2 priority.** Implement a source-observation layer with immutable source/edition/update/version/IDs, raw values, field coverage and missing reasons; put canonical mapping, quantile transforms, position projections and calibration in versioned derived records. Do not execute the proposal as part of this research task.

### §48 answers (1–25)

1. **Reliable sources:** Tier A pins observed local files, fields, edition labels, values, and checksums, not official ground truth. Stefano FIFA15–23 has the richest retrieved position labels; FIFA18 demo is another third-party label source. Mzafram historical edition lineage is UNRESOLVED; see the source manifest.
2. **Bulk-download sources:** lbenz CSV; Mzafram versioned CSVs; Kaggle Stefano archive (stream only the legacy member); FIFA18 demo archive. Checksums and versions are in `source-manifest.json`.
3. **Spot-verification only:** SoFIFA web calculator/API and FIFAIndex pages are useful to inspect individual examples, not to silently bulk-scrape or treat as official EA formula documentation. The 2018 GitHub calculator is reverse-engineered third-party evidence.
4. **FIFA05–FC26 schema evolution:** FIFAIndex-attributed FIFA05–20 (64 columns, sparse early fields); 19 Mzafram repository files FIFA07–FC25 (59 columns, upstream identified as SoFIFA but historical per-edition lineage UNRESOLVED); Stefano legacy FIFA15–23 (110 fields, 27 position labels); FIFA18 demo (75 actual columns); FC26 unavailable in the live repository checked. Compare per-field non-null coverage, not union-column count.
5. **Largest breakpoint:** availability of 27 native positional outputs appears at FIFA15 in the retrieved position-label series. There is also an exporter/schema boundary between FIFAIndex, Mzafram and Leone; that is not automatically a game-engine breakpoint.
6. **Earliest modern-compatible detailed attributes:** the first retrieved detailed-attribute file is Mzafram FIFA07, but historical origin/vintage and cross-era semantics are not independently established. The earliest *reliable canonical* edition is therefore UNRESOLVED; FIFA15 is the first detailed-plus-position-label source here.
7. **Earliest retrieved position-specific labels:** FIFA15 in the Stefano legacy dataset. Treat them as third-party source targets, not EA-authored formula proof; underlying data redistribution rights remain unresolved.
8. **Formula stability:** common-feature standardized coefficients and held-out model statistics are in the position fit/stability tables. FIFA18 label base predictions reach MAE≈0.25/R²≈0.999 for sampled ST/CM/CB/GK models; edition coefficient stability is reported only on common features and is sensitive to missingness, snapshots and source semantics.
9. **Best modern-reference interval:** compare candidate windows in `reference-candidate-ranges.csv`. 2017–24 has eight available Mzafram editions; 2018–25 has eight; window stability alone is not enough to optimize against selected historical teams.
10. **Current 2017–24 interval:** provisionally retain as a clearly named descriptive reference; revise only with a target-population objective and explicit edition vintage. Preserve it as a source-compatible baseline.
11. **Early OVR scale/variance:** FIFAIndex FIFA05 has {l05.get('rows')} rows, mean {float(l05.get('overall_mean') or 0):.2f}; full-roster composition differs sharply from team-season samples, so do not read this as direct ability-scale bias. Compare within-source top-end and matched IDs.
12. **Linear versus distribution shape:** edition means/std/top-500 and quantile candidates are reported separately. Current evidence shows multiple moving parts (population composition, tail and attribute coverage); no single global linear correction is validated. Keep distribution and cohort-level diagnostics.
13. **Same-player continuity:** {('; '.join(stable_rows) if stable_rows else 'No eligible adjacent pairs')}. A released-version change, update snapshot, and source scrape vintage can move the same-player score; report the observed pair counts and club changes separately.
14. **TeamSeason Y or Y+1:** for a completed season, prefer Y+1 as the post-season ability snapshot when identity confidence is adequate; use Y as an explicit fallback. This is a semantic recommendation, not an MAE result.
15. **Why:** Y+1 follows the completed Y season, but annual edition names do not establish each row's scrape/update date. Store team membership, ability snapshot edition, and update vintage separately.
16. **Transfers:** keep Y roster membership separate from Y+1 ability. A verified stable player ID can link the player after a transfer; store the new club as source metadata, not as the old season's membership.
17. **PSV05 cause:** the nine source rows and current-report provenance are in `psv-2005-case.csv`. FIFAIndex raw OVRs match the build report's cited raw source for PSV05; that argues against a new runtime calibration change for those raw OVRs, but cannot choose among historical rating philosophy and snapshot composition.
18. **Farfán:** observed source sequence: {('; '.join(fa) if fa else 'UNRESOLVED: no unique match')}. FIFA05→06 paired delta over {len(paired)} matched PSV names has mean {mean([x[1] for x in paired]):.2f} when available. Potential is missing/NA in FIFAIndex rather than inferred. The sharp jump is an observed edition change; a cause is not established by this source alone.
19. **Attributes to retain:** native source fields, OVR, POT as a separate forecast field, body/foot/work-rate/reputation separately, detailed attributes only with source/version semantics and null reasons. Never backfill missing early values from later editions.
20. **Positions to retain:** original roster-position strings and native position-rating codes; a separate derived family/geometry mapping with mapping version and provenance.
21. **Use of position ratings:** use observed raw position labels where present, explicitly identify third-party provenance; mark absent editions unavailable. A derived value belongs in a separate proposal field, never masquerading as a source label.
22. **High-accuracy derivation:** yes for the tested FIFA15–23 SoFIFA-derived labels under this fit, with the metrics above and actual held-out ID split. Because the target labels are themselves formula-like, this only validates reproducibility of this target source, not proprietary EA scoring.
23. **FIFA05–08:** preserve OVR plus actually observed sparse attributes; keep source-specific scale/cohort and missingness; no invented position labels or POT. FIFA05 PSV Farfán's 48 is a real retrieved row unless a source error is independently shown.
24. **FIFA09–11:** preserve source-native detailed values/positions; use a version-specific interpretation and matched-ID continuity; no direct position-rating labels were recovered for these editions in this audit.
25. **FIFA12+:** FIFA12–14 offer detailed source fields but no recovered position targets here; FIFA15+ provides position targets in the legacy archive; FC24/25 Mzafram provide modern OVR/details without positional labels; FC26 unresolved/unavailable. Each boundary follows observed source coverage, not an assumed gameplay formula.

### Reproduction artifacts and figures

Required tables are emitted as CSV. Source/cache/output checksums and all source license notes are in `source-manifest.json`. Figures are deterministic SVGs generated from the CSV analysis outputs:

'''
    lines=[f"- `{f}`" for f in figures]
    body=body.replace('{len(conflicts):,}',f'{len(conflicts):,}').replace('{', '{') # preserve regular format markers below
    # Format only the narrative placeholders, with stable scalar values.
    vals={'{len(conflicts):,}':f'{len(conflicts):,}','{", ".join(map(str,confyears[:20]))}':', '.join(map(str,confyears[:20])) or 'none',
        '{refs_text}':refs_text,'{align_text}':align_text,'{len(base):,}':f'{len(base):,}','{mae:.3f}':f'{mae:.3f}','{r2:.4f}':f'{r2:.4f}','{cos:.3f}':f'{cos:.3f}',
        '{breaktext}':breaktext,'{l05.get(\'rows\')}':str(l05.get('rows','UNRESOLVED')),'{float(l05.get(\'overall_mean\') or 0):.2f}':f"{float(l05.get('overall_mean') or 0):.2f}",
        '{("; ".join(stable_rows) if stable_rows else \'No eligible adjacent pairs\')}':'; '.join(stable_rows) if stable_rows else 'No eligible adjacent pairs',
        '{("; ".join(fa) if fa else \'UNRESOLVED: no unique match\')}':'; '.join(fa) if fa else 'UNRESOLVED: no unique match',
        '{mean([x[1] for x in paired]):.2f}':f"{mean([x[1] for x in paired]) if paired else float('nan'):.2f}",'{len(paired)}':str(len(paired))}
    for k,v in vals.items():body=body.replace(k,v)
    body+='\n'.join(lines)+'\n'
    for name in ['source-summary.csv', 'schema-matrix.csv', 'edition-distributions.csv', 'position-vocabulary.csv', 'position-formula-fit.csv', 'position-formula-weights.csv', 'position-formula-stability.csv', 'same-player-continuity.csv', 'snapshot-alignment.csv', 'psv-2005-case.csv', 'battle-base-coverage.csv', 'player-season-coverage.csv', 'entity-coverage-summary.csv', 'breakpoint-score.csv', 'source-conflicts.csv', 'cross-source-verification.csv', 'source-conflict-summary.csv', 'attribute-drift.csv', 'reference-candidate-ranges.csv', 'position-cohort-distributions.csv', 'adjacent-distribution-distances.csv']:
        body=body.replace(f'`{name}`',f'[{name}](outputs/{name})')
    (OUT/'FIFA-HISTORICAL-RATING-AUDIT.md').write_text(body,encoding='utf8')

def write_report_zh(summary,dists,fit,stability,continuity,conflicts,alignment,psv,coverage,breaks,refs,cohort,adjacent,figures,playercoverage,entitycoverage):
    l05=next((r for r in summary if r['source']=='lbenz FIFAIndex' and str(r['edition'])=='05'),{})
    base=[r for r in fit if r['target_kind']=='base_rating']
    base_mae=mean([r['heldout_mae'] for r in base]); base_r2=mean([r['heldout_r2'] for r in base if r['heldout_r2'] is not None])
    stab=[r['coefficient_cosine'] for r in stability if r['target_kind']=='base_rating' and r['coefficient_cosine'] is not None]
    med_cos=float(np.median(stab)) if stab else None
    far=[r for r in psv if norm(r['requested_player'])==norm('Jefferson Farfan')]
    farseq=' → '.join(f"{r['edition_year']}:{int(r['source_overall'])}（{r['match_status']}）" for r in far if r['source_overall'] is not None)
    psv_match=[r for r in psv if r['edition_year'] in (2005,2006) and r['source_overall'] is not None]
    vals05={norm(r['requested_player']):r['source_overall'] for r in psv_match if r['edition_year']==2005}
    vals06={norm(r['requested_player']):r['source_overall'] for r in psv_match if r['edition_year']==2006}
    psv_deltas=[vals06[k]-vals05[k] for k in vals05.keys()&vals06.keys()]
    bysrc=defaultdict(list)
    for r in continuity:bysrc[r['source']].append(abs(r['delta_b_minus_a']))
    conttext='；'.join(f"{s}：{len(v):,}组相邻版同ID；|ΔOVR|中位数 {np.median(v):.2f}；变化≤1分占 {sum(x<=1 for x in v)/len(v):.1%}" for s,v in bysrc.items()) or '无可用相邻版数据'
    align=defaultdict(list)
    case_ids={x[0] for x in CASE_TEAMS}
    for r in alignment:
        if r.get('teamSeasonId') in case_ids and r.get('mae_vs_bb') not in (None,''):align[r['strategy']].append(float(r['mae_vs_bb']))
    aligntext='；'.join(f"{k}：六案可比行平均MAE {mean(v):.2f}（n={len(v)}）" for k,v in align.items())
    wintext='；'.join(f"{r['candidate_window']}：{r['available_editions']}个可用版，版均值SD {r['sd_between_edition_means']:.2f}，Top500均值SD {r['sd_top500_means']:.2f}，相邻同玩家样本 {r['same_player_adjacent_pairs']:,}" for r in refs)
    case_rows=[r for r in coverage if r.get('teamSeasonId')!='ALL_62_TEAMSEASONS']
    total_match=sum(int(r.get('matched_n') or 0) for r in case_rows); total_opps=sum(int(r.get('bb_player_n') or 0) for r in case_rows)
    years=sorted({int(r['year']) for r in conflicts})
    diff=sum(float(r.get('delta_b_minus_a') or 0)!=0 for r in conflicts)
    f18={r['position_code']:r for r in base if r['edition']=='18' and r['position_code'] in ('st','cm','cb','gk')}
    f18text='、'.join(f"{p.upper()} MAE {f18[p]['heldout_mae']:.3f}/R² {f18[p]['heldout_r2']:.4f}" for p in ['st','cm','cb','gk'] if p in f18)
    position_target_n=sum(r['position_target_origin_classification']=='observed_source_label' and r['position_target_source_year']==r['season_year'] for r in playercoverage)
    position_exact_n=sum(r['position_target_classification']=='observed_source_label_exact_native_code' and r['position_target_source_year']==r['season_year'] for r in playercoverage)
    position_coarse_n=sum(r['position_target_classification']=='observed_source_label_coarse_proxy' and r['position_target_source_year']==r['season_year'] for r in playercoverage)
    position_unknown_n=sum(r['position_target_classification']=='observed_source_label_alignment_unknown' and r['position_target_source_year']==r['season_year'] for r in playercoverage)
    psv_resolved_n=sum(bool(r.get('source_player_id')) for r in psv)
    psv_native_detail_n=sum(bool(r.get('source_detailed_attributes_json')) for r in psv)
    psv_id_n=len({r.get('source_player_id') for r in psv if r.get('source_player_id')})
    shape_ov=[r for r in adjacent if r['cohort']=='all_players']
    median_ks=float(np.median([r['ks_2sample'] for r in shape_ov])) if shape_ov else None
    median_w=float(np.median([r['wasserstein1_quantile_grid_201'] for r in shape_ov])) if shape_ov else None
    break_share=float(np.median([r['paired_share_following_proxy_guard'] for r in breaks if r.get('paired_share_following_proxy_guard') is not None])) if breaks else None
    sourceN={r['source']:sum(x['source']==r['source'] and x.get('availability')=='available file observed' for x in summary) for r in summary}
    figures_md='\n'.join(f"- `{x}`" for x in figures)
    body=f'''# FIFA Historical Schema & Position Rating Audit v1

## 结论与证据等级

这份工作是隔离工作树里的独立研究交付；没有修改 Battle Base 运行时代码、数据或校准器。Tier A 表示本地源文件直接观察到的值、字段、版本及SHA256；Tier B 表示明确匹配后的跨源比较或固定玩家ID留出集统计；Tier C 表示派生映射、量化变换或尚待验证的方案。没有Tier声称掌握EA专有公式。

实际取得lbenz/FIFAIndex-attributed FIFA05–20共16版、Mzafram repo FIFA07–23与FC24/25共19个CSV（每版59列）、Leone legacy FIFA15–23共9版及FIFA18 demo。Mzafram当前仓库/抓取器指向SoFIFA，但各历史CSV的原始来源和更新vintage为UNRESOLVED；作为第三方观察值，manifest以commit及payload SHA固定本次文件。lbenz来源branch可变，数据版本UNRESOLVED但本地payload有SHA。Leone Kaggle API声明CC0，底层FIFA/SoFIFA权利另行UNRESOLVED。FIFA18 listing声称155列，实际17,981×75。FC26实时API/tree在仓库SHA `90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0` 无文件、404；过期索引页被实时证据取代。各文件URL可变性、版本/校验和、许可与来源限制在`source-manifest.json`。

Stefano archive里 `male_players.csv` 解压后约5.64GB，本次未展开；拟合仅读 `male_players (legacy).csv`，该member原始90.9MB。位置标签覆盖FIFA15–23，27个native position codes。字符串中的base整数与`+/-modifier`拆分保存，并分别拟合；modifier不并入base。

Battle Base既有报告数据规模：418个实体、554个PlayerSeason、62个TeamSeason；当前报告含554条fallback记录。`player-season-coverage.csv`逐行保留全部554个PlayerSeason，`entity-coverage-summary.csv`逐行保留418实体；1999–2004会明确记录本次source corpus无版可匹配的缺口。`snapshot-alignment.csv`覆盖全部62个TeamSeason，六个指定案例用`highlight_case`标记。覆盖表按同年有文件的source×TeamSeason分别统计，合计 {total_match:,}/{total_opps:,} 个可匹配机会；这是重复source机会数，不是554个不同球员的唯一覆盖率。优先用来源各自external ID，退回唯一标准化名字时保留较低置信度；多解和未匹配单列。完整跨源结果先在内存计算并放入gitignored derived cache；`source-conflict-summary.csv`汇总全部source pair/edition，`source-conflicts.csv`与`cross-source-verification.csv`保留2010/2015/2020每年最多100个确定性去歧义spot-check身份样本。full-join universe共 {len(conflicts):,} 条，跨年 {', '.join(map(str,years)) or '无'}，OVR不相等 {diff:,} 条；差异是来源/快照观察，不自动判错。

### 执行摘要 A–J

**A. Schema断点。** FIFA15是本语料首次同时取得细项属性和27个位置评分label的版本，这是数据可用性边界，不能据此认定EA在FIFA15改变了游戏schema。64/59/110/75列还包含不同导出器差异，需看逐字段非空率；Mzafram历史版lineage未证实。

**B. 现代reference区间。** 暂保留2017–2024作为描述基线，不做通用线性映射。候选窗口统计（`reference-candidate-ranges.csv`）：{wintext}。Mzafram历史edition lineage未能独立证实，所以更可靠的primary-reference最佳区间仍UNRESOLVED；后续应按目标人群和明确update snapshot选。

**C. TeamSeason快照。** TeamSeason Y代表Y年结束的完整赛季，因此建议优先使用赛季后的Y+1 ability snapshot；球队成员关系仍属于Y。Y+1缺失/身份不可靠时显式退回Y，记录edition和update date。`snapshot-alignment.csv`比较全部62个TeamSeason，六个案例有highlight标记。当前BB不是真值；同年MAE可为零是因为BB本身引用同一FIFAIndex数据，属于循环吻合，不能验证时点。

**D. Canonical attributes。** 保留源字段和值。v2可为现代细项建立版本化候选映射（crossing、finishing、heading_accuracy、short_passing、volleys、dribbling、curve、fk_accuracy、long_passing、ball_control、速度/反应/平衡、shot_power、jumping、stamina、strength、long_shots、aggression/interceptions/positioning/vision/penalties/composure、tackles/defensive_awareness及GK细项），但每项都要附source/version/semantic。不要把早期`creativity`等同`vision`、把aggregate `pace`当作加速/冲刺，也不要补造早期缺值。

**E. Canonical positions。** 原样保存source-native位置串和位置评分码；另做版本化的派生slot family映射（GK、CB、LB/RB、LWB/RWB、CDM、CM、CAM、LM/RM、LW/RW、CF/ST）。位置代码与球场几何不是同一概念；左右侧位置信息不能被family吞掉。见 `position-vocabulary.csv` 和首位置分组 `position-cohort-distributions.csv`。

**F. Position rating策略。** 同年legacy来源标签与BB位置映射必须分开解释：554条PlayerSeason中有{position_target_n}行取到同年source position target，其中{position_exact_n}行是单一BB native code一对一映射，{position_coarse_n}行来自DF/FB/MF/FW粗粒度代理，{position_unknown_n}行有目标但BB映射仍有歧义。来源label被观察到不等于证明它对齐了BB球员的native位置；逐行字段区分source label存在性、派生mapping精度和alignment。研究回归只用于验证/候选，不可写回生产字段。{len(base):,}个base留出拟合的宏平均MAE {base_mae:.3f}、平均R² {base_r2:.4f}；同position/version的base系数cosine中位数 {med_cos:.3f}。FIFA18样本：{f18text}。这是对SoFIFA衍生目标的预测能力，不是EA公式证明。

**G. PSV 2005。** 九名指定球员×FIFA05/06/07逐行记录在 psv-2005-case.csv：本次稳定ID命中{psv_resolved_n}/27行，九个ID各自跨edition保持一致；mapped detail与完整source-native detail均为{psv_native_detail_n}/27行。稳定ID锚点、Cocu的验证拼写alias和解析方法写在CSV；Cocu的source名Philip Cocu对应ID 5736，FIFA05–07均为唯一荷兰籍PSV source row。membership_club是BB的PSV 2005 TeamSeason成员关系；source_club单列每个ability edition的真实来源俱乐部，跨队不改变历史名单成员关系。Jan Vennegoor ID 27488的2007 source club为Celtic、OVR 81。PSV05当前报告raw OVR来自同一条lbenz FIFA05 source provenance；现有证据不支持说BB在PSV05对这些raw OVR做了新的校准改写。Farfán可观察序列：{farseq or 'UNRESOLVED：没有唯一匹配'}。05→06匹配球员数{len(psv_deltas)}、平均变化 {mean(psv_deltas) if psv_deltas else float('nan'):.2f}。FIFAIndex的POT没有可靠数值，不能推断。其异常为何发生（早期rating哲学、源错、快照或calibration）仍属因果假设，不能只凭上涨定性。

**H. 保留现有校准的部分。** 保留来源、原始/校准值、reference era及分属性结果的provenance；这些信息支持回溯和迁移比较。

**I. 重审/重写部分。** `scripts/lib/calibrate.mjs`按版均值drift>+0.20约束个体delta≤0，drift<−0.20约束delta≥0，区间内对齐；这是单向启发式。基于来源相邻版同ID的方向比例中位数 {break_share:.1%}与完整球员池相邻版OVR形状距离中位KS {median_ks:.3f}、Wasserstein近似 {median_w:.3f}（201个分位点网格），需要按source/vintage审查；guard proxy不是直接重放生产校准状态，也不控制名单构成变化。

**J. PlayerAbilityModel v2优先实现。** 建议分成观察层和派生层：观察层存不可变source/version/update date/IDs/raw value/字段非空率/许可和missing reason；派生层存canonical mapping version、quantile或position projection、calibration版本及输入来源。不要在本研究里实现或部署该建议。

### §48问题逐题回答（1–25）

1. **可靠sources：** Tier A是本地校验过的CSV及其edition/字段；position targets主要来自Leone FIFA15–23 legacy，FIFA18 demo作为第二来源。许可声明与底层游戏数据权利分开记。见`source-manifest.json`。
2. **可bulk download：** lbenz单CSV、Mzafram逐版CSV、Stefano Kaggle archive（只读legacy member）、FIFA18 demo archive；复跑校验和逐项见manifest。
3. **只宜spot verify：** SoFIFA/FIFAIndex页面、SoFIFA calculator/API适合核对个例和字段，不应未经许可抓站构造历史全集，也不是EA公式原始文档。GitHub FIFA18 calculator是第三方反向实现。
4. **FIFA05–FC26 schema如何演进：** FIFAIndex-attributed FIFA05–20共64列、早年多项稀疏；Mzafram repo FIFA07–FC25有19个59列文件，但逐版历史来源/update vintage UNRESOLVED；Leone FIFA15–23有110列与27个位置评分字符串；FIFA18 demo实测75列；FC26无实时源文件。逐版coverage在`schema-matrix.csv`。
5. **最大attribute-schema breakpoint：** 可观察目标标签首次覆盖边界为FIFA15。导出器列数也分出FIFAIndex/Mzafram/Leone/demo几族，但不能据此推断底层游戏机制改变。
6. **最早modern-compatible详细属性系统：** 最早取得的细项CSV是Mzafram FIFA07，但历史来源/vintage未独立证实，同名字段也不证明跨版同义。因此最早可靠canonical起点UNRESOLVED；FIFA15是本语料最早同时有细项与position target的版本。
7. **最早取得position-specific ratings：** FIFA15，来自Leone legacy可解析的27个原生code；是第三方SoFIFA衍生观察，不是EA公式证明，底层数据再分发权利仍未确认。
8. **跨版公式稳定性：** `position-formula-fit.csv`给train/test数、有效属性数、遗漏/插补和heldout误差；`position-formula-stability.csv`只比较相同位置、target kind和共同属性。标准化尺度来自稳定player ID训练fold，测试fold不参与选特征/插补/scale。数据源second-year-update vintage差异仍在。
9. **最佳modern-reference interval：** `reference-candidate-ranges.csv`比较四个候选窗口的版均值方差、Top500与相邻同玩家统计。2017–24的8版可暂作描述基线；Mzafram历史lineage未证实，因此primary reference最佳年份仍UNRESOLVED。
10. **保留还是改2017–2024：** 暂时保留为命名清楚的描述基线；按目标cohort做额外校准时保留该reference作兼容对照，不要用它对全历史数据做无条件线性缩放。
11. **早期OVR scale/variance：** `source-summary.csv` key为source/edition；FIFA05全池{l05.get('rows')}人、均值{float(l05.get('overall_mean') or 0):.2f}。样本覆盖的是完整源名册，不等于历史TeamSeason明星名单，不能单凭均值差说scale错。Top500与matched IDs见`edition-distributions.csv`/连续性表。
12. **全局linear还是分布shape：** 同时检查均值、标准差、尾部分位、Top500、同玩家delta及KS/Wasserstein；相邻总体差异含名单组成效应，当前数据不支持一个统一线性修正作为解决方案。
13. **同玩家连续性何时稳定：** `same-player-continuity.csv`源内按stable ID配对：{conttext}。没有一个所有source/vintage通用的稳定起点；相邻版变化和转会分开记录。
14. **TeamSeason Y还是Y+1：** 已完成赛季语义下优先取Y+1 ability snapshot；稳定player ID可跨转会匹配。Y+1数据缺失或身份不可靠再fallback到Y，明确记录选择和update date。
15. **原因：** Y+1在赛季结束后发布，较符合完成态；但edition年份不表示具体抓取/数据库更新时间。球队成员期、ability edition与update date分开保存，不能靠与BB MAE接近来证明。
16. **转会处理：** Y赛季球员留在历史俱乐部名单；能力可从Y+1新俱乐部快照读取，前提是stable ID可靠。转会仅作为source metadata。
17. **PSV05异常原因：** source row、club/nationality、current BB raw/calibrated与source provenance逐人见`psv-2005-case.csv`。同源raw OVR与BB记录一致，因此当前证据没有证明运行时新校准改写了该组raw OVR；历史评级哲学、具体快照和source error还需独立一手证据。
18. **Farfán具体发生什么：** FIFAIndex观测为{farseq or 'UNRESOLVED'}；05→06同组可匹配者的均值变化{mean(psv_deltas) if psv_deltas else float('nan'):.2f}。是source相邻edition变化，POT无实值；仅凭此不能判定其是真实发展或错录。
19. **Canonical attributes保留什么：** source-native OVR、potential（单独字段）、细项、foot/work-rate/reputation及raw names/IDs；modern同名细项可做版本化映射。缺值保持missing，早期`creativity`、后期`vision`等不强行合并。
20. **Canonical positions：** native roster-position字符串/score code原样保留；另存可版本化的coarse family/slot geometry。首位置分组只用于分布分析，字段见`position-cohort-distributions.csv`，不是替换原native code。
21. **Position ratings来自哪：** 有来源label时储存observed value与source/vintage；缺源的版标记unavailable。模型输出只放derived/proposal层。
22. **能否高精度复现：** 能对本次FIFA15–23的SoFIFA-derived base目标做高精度heldout拟合，整体指标如本节F所列；不能把这种结果外推为EA内部评分公式。
23. **FIFA05–08：** 保留raw OVR、实际有值的早期属性、缺值说明和source版；不要补造位置rating/POT，也不要直接套现代attribute公式。PSV Farfán FIFA05的48是本地source行实见值。
24. **FIFA09–11：** 保留当年source的细项/OVR并与同玩家相邻版作敏感性分析；这次没找到该段可靠position-specific target，不把后来公式倒推为实测。
25. **FIFA12+：** FIFA12–14可有详细属性但本次未拿到position labels；FIFA15+才有Leone位置target；FC24/25有现代SoFIFA OVR/属性但无此处position targets；FC26本次实时源缺失。结论按观察到的source availability，不预设历史断点。

### Football Model v2提案（仅设计）

`PlayerSeason`建议分别保存来源观察和派生结果：

```json
{{
  "teamSeasonId": "psv-2005",
  "sourceSnapshot": {{"edition": "FIFA06", "updateDate": null, "datasetVersion": "...", "payloadSha256": "...", "sourcePlayerId": "..."}},
  "rawAttributes": {{"acceleration": 76, "finishing": 66}},
  "sourceNativePositions": ["RM", "ST"],
  "naturalPositions": [{{"code": "RM", "mappingVersion": "..."}}],
  "observedPositionRatings": {{"RM": {{"base": 73, "modifier": 2, "source": "..."}}}},
  "positionRatings": {{"CM": 71, "CAM": 77}},
  "overall": 73,
  "potential": null,
  "provenance": {{"sourceFieldMapVersion": "...", "missingReasons": {{"potential": "not reported"}}}}
}}
```

`sourceSnapshot`、source IDs、`rawAttributes`、native code、OVR/POT和observed position labels是来源观察；`naturalPositions`、canonical attributes和`positionRatings`是需版本化并附provenance/null reason的派生值。POT不混入当前ability。授权来源label可训练/验证派生position model；无label年代不伪装成source rating。该数据边界未来可支持4-3-3、4-2-3-1、4-4-2、3-5-2、5-3-2，本研究不添加formation/tactics代码。

### 当前 calibration 审计（只读代码证据）

`[calibrate.mjs](../../scripts/lib/calibrate.mjs)` 的`calibrateSingleStat`在hybrid模式用40% raw + 35% elite-cohort z-score + 25%粗位置percentile；`computeArchetypeTaper`使用62/68/75分数门槛，另有direction guard与OVR ±4、属性 ±5硬上限。保留raw与calibrated分开、reference metadata、独立属性通道、分布诊断；保护非专长属性可保留为待验证设计假设。固定权重、taper门槛和delta clamp都不是FIFA证据。

有一个需先修正的实现不一致：`mergeCohortDistributions`把年度histogram相加用于percentile，却把reference标准差设为各年标准差的简单平均，遗漏年份间方差；它还把各年均值无权平均。`[analyze-era-drift.mjs](../../scripts/analyze-era-drift.mjs)`将该结果用作2017–24 reference，所以hybrid中的z路径与percentile路径基于不同统计量。应先对池化数值计算一致的均值/方差，或明确按edition等权后令histogram也遵循同一规则。

`calibrateSingleStat`的2005–16 guard只看年度elite cohort mean drift，就强制该年每个球员同向变化或归零。报告里的`paired_share_following_proxy_guard`只是历史数据代理检查，不是生产model重放。应验证配对球员/角色与分布形状后再定方向规则，允许同年代球员有不同方向；2017–24分支大多归零，仅对2023–24的高OVR留有限正修正。±4/±5上限只能作为明示且验证过的安全边界，不能补救reference分布错误。

### 补充统计与限制

- `position-cohort-distributions.csv`按source/edition的**首个**native roster位置划分GK、CB、LB/RB、LWB/RWB、CDM、CM、CAM、LM/RM、LW/RW、CF/ST及粗分类；每行保留native code。各玩家在版本内按首位分到一个互斥位置组，`all_players`单独标记；早版没有细位置码时不反推。
- `adjacent-distribution-distances.csv`提供overall总体与首位位置组的两样本KS和Wasserstein-1近似。KS直接比较两经验CDF；Wasserstein使用201个分位点网格，是数值近似。两者都受各版名册构成影响，不能单独视为能力量尺变化。
- `breakpoint-score.csv`列相邻同玩家变化、总体分布shape、行/列数变化与position-label availability边界。Direction guard的paired-share是proxy，不是调用production calibrator的检验。
- FIFAIndex POT列没有可用实值；1999–2004没有经验证的技能能力数据，本研究没有构造。
- Mzafram代码可见MIT声明不自动覆盖SoFIFA派生数据；lbenz未发现数据许可；Leone Kaggle接口声明CC0，但底层FIFA/SoFIFA数据权利需独立确认；FIFA18 demo listing为CC BY-NC-SA 4.0。完整原始表保留在gitignored cache，不纳入研究提交。

### 可重复产物

11个必交表与额外CSV在`outputs/`；报告、README、manifest和8个SVG在本目录。仓库根目录重建命令为`python research/fifa-rating-audit/src/audit.py`，只读检查为`python research/fifa-rating-audit/src/audit.py --check`。source payload、脚本和元数据SHA256，版本/lineage状态、许可声明、权利限制、URL可变性与图表清单均记录在`source-manifest.json`。

'''+figures_md+'\n'
    for name in ['source-summary.csv', 'schema-matrix.csv', 'edition-distributions.csv', 'position-vocabulary.csv', 'position-formula-fit.csv', 'position-formula-weights.csv', 'position-formula-stability.csv', 'same-player-continuity.csv', 'snapshot-alignment.csv', 'psv-2005-case.csv', 'battle-base-coverage.csv', 'player-season-coverage.csv', 'entity-coverage-summary.csv', 'breakpoint-score.csv', 'source-conflicts.csv', 'cross-source-verification.csv', 'source-conflict-summary.csv', 'attribute-drift.csv', 'reference-candidate-ranges.csv', 'position-cohort-distributions.csv', 'adjacent-distribution-distances.csv']:
        body=body.replace(f'`{name}`',f'[{name}](outputs/{name})')
    (OUT/'FIFA-HISTORICAL-RATING-AUDIT.md').write_text(body,encoding='utf8')

def run_full():
    print('loading cached sources...',flush=True)
    legacy,legacy_header,legacy_cov=source_stephano()
    mz,mz_headers=source_mzafram()
    lbenz,lb_header=source_lbenz()
    print(f'loaded legacy={sum(map(len,legacy.values())):,}; Mzafram editions={len(mz)}; lbenz editions={len(lbenz)}',flush=True)
    summary,schemas,dists=describe_sources(legacy,mz,lbenz,legacy_cov)
    emit_vocabulary(legacy,mz)
    print('fitting source position labels...',flush=True)
    fit,weights,stability=formula_audit(legacy)
    source_rows,idmaps=build_source_indexes(legacy,mz,lbenz)
    print('computing continuity and cross-source joins...',flush=True)
    continuity,conflicts=continuity_and_conflicts(legacy,mz,lbenz,None)
    battles=json.load(open(ROOT/'data/reports/build-report.json',encoding='utf8'))['players']
    players=json.load(open(ROOT/'data/entities/players.json',encoding='utf8'))
    entities=entity_lookup(players)
    coverage=coverage_audit(battles,players,entities,source_rows,idmaps)
    playercoverage,entitycoverage=player_season_audit(battles,players,entities,source_rows,idmaps)
    psv=psv_case(battles,players,entities,source_rows,idmaps)
    alignment=snapshot_alignment(battles,players,entities,source_rows,idmaps,legacy,mz,lbenz)
    cohort,adjacent=position_cohort_and_distances(legacy,mz,lbenz)
    breaks=breakpoint_audit(continuity,summary,adjacent)
    drift=attribute_drift(mz)
    refs=reference_candidates(dists,continuity)
    figures=generate_figures(summary,dists,continuity,stability,drift,psv)
    write_readme()
    write_report_zh(summary,dists,fit,stability,continuity,conflicts,alignment,psv,coverage,breaks,refs,cohort,adjacent,figures,playercoverage,entitycoverage)
    manifest=source_manifest(summary,figures)
    print('OUTPUT_COUNTS',json.dumps({'source_summary':len(summary),'schema_matrix':len(schemas),'distributions':len(dists),'position_fit':len(fit),
        'coefficient_weights':len(weights),'stability':len(stability),'continuity':len(continuity),'source_conflicts':len(conflicts),
        'coverage_rows':len(coverage),'player_season_coverage_rows':len(playercoverage),'entity_coverage_rows':len(entitycoverage),'PSV_rows':len(psv),'alignment_rows':len(alignment),'cohort_rows':len(cohort),
        'adjacent_shape_rows':len(adjacent),'breakpoints':len(breaks),'attribute_drift':len(drift),'reference_windows':len(refs),'figures':len(figures)},ensure_ascii=False),flush=True)
    print('CASE_ALIGNMENT_MAE',json.dumps({r['strategy']:r['mae_vs_bb'] for r in alignment if r['teamSeasonId']=='psv-2005' and r['mae_vs_bb'] is not None},ensure_ascii=False),flush=True)
    print('FARFAN',json.dumps([r for r in psv if norm(r['requested_player'])==norm('Jefferson Farfan')],ensure_ascii=True),flush=True)
    print('MANIFEST',len(manifest['outputs']),'derived files hashed',flush=True)

def check_outputs():
    required=['source-summary.csv','schema-matrix.csv','edition-distributions.csv','position-vocabulary.csv','position-formula-fit.csv','position-formula-stability.csv','same-player-continuity.csv','snapshot-alignment.csv','psv-2005-case.csv','battle-base-coverage.csv','breakpoint-score.csv']
    errors=[]; mp=OUT/'source-manifest.json'
    if not mp.exists(): errors.append('source-manifest.json missing'); print('CHECK_FAILED',errors); return 1
    manifest=json.load(open(mp,encoding='utf8'))
    for rel in required:
        if not (OUT/'outputs'/rel).exists(): errors.append(f'missing outputs/{rel}')
    for rel in ('FIFA-HISTORICAL-RATING-AUDIT.md','README.md'):
        if not (OUT/rel).exists(): errors.append(f'missing {rel}')
    outputs={r['path']:r for r in manifest.get('outputs',[])}
    required_paths={f'outputs/{name}' for name in required}
    required_paths.update({'outputs/player-season-coverage.csv','outputs/entity-coverage-summary.csv','outputs/source-conflicts.csv',
        'outputs/cross-source-verification.csv','outputs/source-conflict-summary.csv','FIFA-HISTORICAL-RATING-AUDIT.md','README.md'})
    missing_hashes=sorted(required_paths-set(outputs))
    if missing_hashes: errors.append(f'required outputs not hashed in manifest: {missing_hashes}')
    for rel,r in outputs.items():
        p=OUT/rel
        if not p.exists(): errors.append(f'manifest output missing {rel}'); continue
        if sha(p)!=r['sha256']: errors.append(f'hash mismatch {rel}')
        if p.suffix=='.csv':
            with open(p,encoding='utf8',newline='') as f:
                reader=csv.DictReader(f); count=sum(1 for _ in reader)
            if count!=r.get('rows'): errors.append(f'row count mismatch {rel}: {count}!={r.get("rows")}')
    script=manifest.get('analysis_script',{})
    sp=ROOT/script.get('path','')
    if not sp.is_file(): errors.append('analysis script missing from manifest')
    elif sha(sp)!=script.get('sha256'): errors.append('analysis script hash mismatch')
    for item in manifest.get('source_files',[]):
        p=ROOT/item['cache_path']
        if not p.exists(): errors.append(f'cache source missing {item["cache_path"]}')
        elif sha(p)!=item['sha256']: errors.append(f'cache source hash mismatch {item["cache_path"]}')
    for item in manifest.get('derived_intermediate_cache',[]):
        p=ROOT/item['cache_path']
        if not p.exists(): errors.append(f'derived cache missing {item["cache_path"]}')
        elif sha(p)!=item['sha256']: errors.append(f'derived cache hash mismatch {item["cache_path"]}')
        elif sum(1 for _ in open(p,encoding='utf8',newline=''))-1!=item['rows']: errors.append(f'derived cache row count mismatch {item["cache_path"]}')
    for item in manifest.get('metadata_files',[]):
        p=ROOT/item['cache_path']
        if not p.exists(): errors.append(f'source metadata missing {item["cache_path"]}')
        elif sha(p)!=item['sha256']: errors.append(f'source metadata hash mismatch {item["cache_path"]}')
    try:
        def rows(name): return list(csv.DictReader(open(OUT/'outputs'/name,encoding='utf8',newline='')))
        cov=rows('battle-base-coverage.csv'); align=rows('snapshot-alignment.csv')
        playercov=rows('player-season-coverage.csv'); entitycov=rows('entity-coverage-summary.csv')
        psv=rows('psv-2005-case.csv'); fits=rows('position-formula-fit.csv'); stab=rows('position-formula-stability.csv')
        fixture=rows('source-conflicts.csv'); verification=rows('cross-source-verification.csv')
        expected_cases={'psv-2005','ac-milan-2007','barcelona-2011','real-madrid-2017','bayern-munich-2020','manchester-united-2008'}
        team_ids={r['teamSeasonId'] for r in align}
        coverage_team_ids={r['teamSeasonId'] for r in cov if r['teamSeasonId']!='ALL_62_TEAMSEASONS'}
        if len(coverage_team_ids)!=62: errors.append(f'coverage TeamSeason count != 62: {len(coverage_team_ids)}')
        if len(cov)!=187: errors.append(f'coverage matrix should be 62 TeamSeasons x 3 sources plus total row; got {len(cov)} rows')
        if len(team_ids)!=62: errors.append(f'snapshot alignment TeamSeason count != 62: {len(team_ids)}')
        if len(playercov)!=554 or len({r['playerSeasonId'] for r in playercov})!=554: errors.append('PlayerSeason coverage is not 554 unique rows')
        if len(entitycov)!=418 or len({r['entityId'] for r in entitycov})!=418: errors.append('entity coverage is not 418 unique rows')
        if not expected_cases.issubset(team_ids): errors.append('six named cases incomplete')
        if len(psv)!=27 or len({r['requested_player'] for r in psv})!=9: errors.append('PSV case should have 9 players x FIFA05/06/07 rows')
        if len(psv)==27 and (any(not r.get('source_player_id') for r in psv) or any(not r.get('detailed_attributes_json') for r in psv) or any(not r.get('source_detailed_attributes_json') for r in psv)): errors.append('PSV evidence must resolve all 27 stable-ID rows with both mapped and full source-native attributes')
        if len(psv)==27 and any(not r.get('membership_club') or not r.get('source_club') or not r.get('match_method') for r in psv): errors.append('PSV roster membership, source ability club, or match method is not explicit')
        if len(psv)==27 and any(len({r.get('source_player_id') for r in psv if r['requested_player']==name})!=1 for name in {r['requested_player'] for r in psv}): errors.append('PSV stable source ID changes across editions for a requested player')
        if len(psv)==27 and not all(any(r.get('source_player_id')=='27488' and str(r.get('edition_year'))==str(yr) and r.get('source_club')=='Celtic' and num(r.get('source_overall'))==81 for r in psv) for yr in (2007,)): errors.append('Jan Vennegoor 2007 transfer/source-club trace missing')
        if len(psv)==27 and not all(any(r.get('source_player_id')=='5736' and str(r.get('edition_year'))==str(yr) and r.get('validated_source_alias')=='Philip Cocu' for r in psv) for yr in (2005,2006,2007)): errors.append('validated Cocu source alias/stable-ID trace incomplete')
        if not fits or not any(int(r['train_n'] or 0)>0 and int(r['test_n'] or 0)>0 for r in fits): errors.append('position fit train/test rows missing')
        if not stab: errors.append('position coefficient stability missing')
        if len(playercov)==554 and any(not r.get('bb_position_mapping_precision') or not r.get('position_target_classification') or not r.get('native_bb_position_alignment') for r in playercov): errors.append('position-target source observation and BB alignment classification must be explicit')
        if len(fixture)!=300 or len(verification)!=300: errors.append('cross-source multi-era fixture should contain 300 rows')
        fixture_by_year=Counter(r['fixture_era'] for r in fixture)
        if any(fixture_by_year.get(y,0)!=100 for y in ('2010','2015','2020')): errors.append(f'cross-source fixture must have exactly 100 rows in each of 2010/2015/2020: {dict(fixture_by_year)}')
        if len(manifest.get('figures',[]))!=8: errors.append(f'expected 8 meaningful figures, got {len(manifest.get("figures",[]))}')
        for r in fits:
            for f in ('heldout_mae','heldout_rmse','heldout_r2'):
                v=num(r.get(f))
                if r.get(f) not in ('',None) and v is None: errors.append(f'non-finite fit metric {f}'); break
        for fig in manifest.get('figures',[]):
            p=OUT/fig
            if not p.exists() or p.stat().st_size==0: errors.append(f'figure missing or empty {fig}')
    except Exception as e: errors.append(f'output parse failed {type(e).__name__}: {e}')
    if errors: print('CHECK_FAILED',json.dumps(errors,ensure_ascii=False)); return 1
    print('CHECK_OK',json.dumps({'verified_derived_files':len(outputs),'required_csvs':len(required),'covered_team_seasons':62,
        'player_seasons':554,'entities':418,'psv_rows':27,'cross_source_fixture_rows':300,
        'position_fit_rows':len(fits),'position_stability_rows':len(stab),'figures':len(manifest.get('figures',[])),
        'mode':'read-only; no outputs rewritten'},ensure_ascii=False)); return 0

if __name__=='__main__':
    if '--check' in sys.argv: raise SystemExit(check_outputs())
    run_full()


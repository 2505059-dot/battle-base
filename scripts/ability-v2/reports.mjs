import { readCsvRows } from './csv.mjs';
const by = (items, keyFn) => { const map=new Map(); for(const item of items){const key=keyFn(item);const list=map.get(key)||[];list.push(item);map.set(key,list);} return map; };
const round3 = (value) => Math.round(value*1000)/1000;

export function buildCoverage(records, lineage, fieldNames) {
  const strategyCounts={y_plus_1:0,y_fallback:0,bounded_nearest:0,unavailable:0};
  const attrCoverage=Object.fromEntries(fieldNames.map((name)=>[name,{observed:0,missing:0,unmapped:0}]));
  const sourceSelected={}; const offsets={}; const years={}; const decades={};
  let identityUsable=0, selected=0, anyNatural=0, anyRating=0, ratingEntries=0, overrides=0, complete=0, partial=0, unavailable=0;
  for(const record of records){
    const seasonYear=record.snapshotSelection.targetEditionYear-1; const ys=String(seasonYear);
    years[ys] ||= {teamSeasons:0,selected:0,unavailable:0,strategies:{}}; years[ys].teamSeasons+=1;
    const decade=`${Math.floor(seasonYear/10)*10}-${Math.floor(seasonYear/10)*10+9}`;
    decades[decade] ||= {teamSeasons:0,selected:0,unavailable:0,sources:{}}; decades[decade].teamSeasons+=1;
    if(record.identityStatus==='resolved') identityUsable+=1;
    const selection=record.snapshotSelection; strategyCounts[selection.strategy]+=1;
    years[ys].strategies[selection.strategy]=(years[ys].strategies[selection.strategy]||0)+1;
    if(selection.selectionStatus==='selected'){
      selected+=1; years[ys].selected+=1; sourceSelected[record.observations.find(o=>o.observationId===selection.primaryObservationId)?.sourceId||'unknown']=(sourceSelected[record.observations.find(o=>o.observationId===selection.primaryObservationId)?.sourceId||'unknown']||0)+1;
      offsets[String(selection.yearOffset)]=(offsets[String(selection.yearOffset)]||0)+1;
      const sourceId=record.observations.find(o=>o.observationId===selection.primaryObservationId)?.sourceId||'unknown';
      decades[decade].sources[sourceId]=(decades[decade].sources[sourceId]||0)+1;
    } else { unavailable+=1; years[ys].unavailable+=1; decades[decade].unavailable+=1; }
    if(record.availability==='available') complete+=1; else if(record.availability==='partial') partial+=1;
    anyNatural+=record.positionModel.naturalPositions.length?1:0;
    const primary=record.observations.find(o=>o.observationId===selection.primaryObservationId);
    const rates=primary?.observedPositionRatings||[]; anyRating+=rates.length?1:0; ratingEntries+=rates.length;
    overrides+=record.overrides.length;
    for(const [name,cell] of Object.entries(record.canonical.attributes)){
      const count=attrCoverage[name]; if(!count) continue;
      if(cell.value!=null) count.observed+=1; else if(cell.status==='unmapped') count.unmapped+=1; else count.missing+=1;
    }
  }
  return {
    recordPlaceholders:{count:records.length,expected:554},
    identity:{canonicalResolvedPlayerSeasonRecords:identityUsable,total:records.length,uniqueCanonicalEntities:[...new Set(records.map(x=>x.canonicalPlayerId))].length,expectedEntities:418},
    reliableSourceSnapshots:{selected,total:records.length,coveragePercent:round3(selected/records.length*100)},
    availability:{available:complete,partial,unavailable,unavailableCount:unavailable},
    fieldLevelAttributeCoverage:Object.fromEntries(Object.entries(attrCoverage).map(([key,value])=>[key,{...value,total:records.length,coveragePercent:round3(value.observed/records.length*100)}])),
    sourceNativePositionCoverage:{selectedSnapshotRecordsWithNaturalPosition:anyNatural,total:records.length},
    observedPositionRatingsCoverage:{selectedSnapshotRecordsWithRatings:anyRating,ratingEntryCount:ratingEntries,total:records.length},
    snapshotSelection:{strategies:strategyCounts,yearOffsetsFromTargetEdition:offsets,selectedBySource:sourceSelected},
    manualFallbackUnavailable:{manualOverrides:overrides,manualEstimates:0,yFallback:strategyCounts.y_fallback,boundedNearestFallback:strategyCounts.bounded_nearest,unavailable,legacyFallbackOriginKnown:0,legacyFallbackOriginUnknown:records.length},
    bySeasonYear:years,byDecade:decades,
    sourceLineageSummary:lineage.map(({sourceId,sourcePath,payloadSha256,sourceVersion,licenseStatus,rowsScanned,targetObservations,stableIdObservations,nameOrAmbiguousCandidates})=>({sourceId,sourcePath,payloadSha256,sourceVersion,licenseStatus,rowsScanned,targetObservations,stableIdObservations,nameOrAmbiguousCandidates}))
  };
}

export function buildConflicts(records) {
  const conflicts=[];
  for(const record of records){
    const groups=by(record.observations.filter(o=>o.identityMatch.status==='stable_external_id'),o=>o.editionYear);
    for(const [editionYear,rows] of groups){
      if(rows.length<2) continue;
      const sources=by(rows,o=>o.sourceId); const duplicateSources=[...sources].filter(([,items])=>items.length>1).map(([id])=>id).sort();
      const valueSet=(field)=>[...new Set(rows.map(o=>o[field]==null?'':String(o[field])))].sort();
      const overall=valueSet('rawOverall'), potential=valueSet('rawPotential');
      conflicts.push({playerSeasonId:record.playerSeasonId,canonicalPlayerId:record.canonicalPlayerId,teamSeasonId:record.teamSeasonId,membershipClub:record.membershipClub,editionYear,
        conflictTypes:[...(duplicateSources.length?['duplicate_source_rows']:[]),...(sources.size>1?['multi_source_same_edition']:[])],sourceIds:[...sources.keys()].sort(),duplicateSourceIds:duplicateSources,
        rawOverallValues:overall,rawPotentialValues:potential,primaryObservationId:record.snapshotSelection.actualEditionYear===editionYear?record.snapshotSelection.primaryObservationId:null,
        candidates:rows.map(o=>({observationId:o.observationId,sourceId:o.sourceId,rowNumber:o.rowNumber,sourcePlayerId:o.sourcePlayerId,sourceName:o.sourceName,sourceClub:o.sourceClub,rawOverall:o.rawOverall,rawPotential:o.rawPotential,payloadSha256:o.payloadSha256})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.rowNumber-b.rowNumber)});
    }
  }
  return conflicts.sort((a,b)=>a.playerSeasonId.localeCompare(b.playerSeasonId)||a.editionYear-b.editionYear);
}

export function buildUnresolved(records, lineage, externalIdDuplicates) {
  const unavailable=records.filter(r=>r.snapshotSelection.selectionStatus!=='selected').map(r=>({playerSeasonId:r.playerSeasonId,canonicalPlayerId:r.canonicalPlayerId,teamSeasonId:r.teamSeasonId,membershipClub:r.membershipClub,reason:r.unavailableReason,rejected:r.snapshotSelection.rejected}));
  const candidates=[]; const positions=[]; const ratingParse=[];
  for(const record of records) for(const obs of record.observations){
    if(obs.identityMatch.status!=='stable_external_id') candidates.push({playerSeasonId:record.playerSeasonId,observationId:obs.observationId,sourceId:obs.sourceId,editionYear:obs.editionYear,sourcePlayerId:obs.sourcePlayerId,sourceName:obs.sourceName,match:obs.identityMatch});
    for(const position of obs.sourcePositions) if(['unresolved','legacy-special','roster-status'].includes(position.mappingStatus)) positions.push({playerSeasonId:record.playerSeasonId,observationId:obs.observationId,sourceId:obs.sourceId,editionYear:obs.editionYear,sourceField:position.sourceField,nativeCode:position.nativeCode,mappingStatus:position.mappingStatus});
    for(const rating of obs.observedPositionRatings) if(rating.parseStatus!=='valid') ratingParse.push({playerSeasonId:record.playerSeasonId,observationId:obs.observationId,sourceId:obs.sourceId,editionYear:obs.editionYear,sourceField:rating.sourceField,rawString:rating.rawString});
  }
  return {summary:{unavailablePlayerSeasons:unavailable.length,nameOrAmbiguousCandidates:candidates.length,unresolvedOrSpecialPositions:positions.length,unparsedPositionRatings:ratingParse.length,duplicateExternalIds:externalIdDuplicates.length},unavailablePlayerSeasons:unavailable,nameOrAmbiguousCandidates:candidates,positions,ratingParse,duplicateExternalIds:externalIdDuplicates,
    sourceLineageUnknown:lineage.filter(s=>!s.sourceVersion||!s.licenseStatus).map(s=>({sourceId:s.sourceId,sourceVersion:s.sourceVersion,sourceVersionReason:s.sourceVersionReason,licenseStatus:s.licenseStatus}))};
}

export function buildMigration(records) {
  const dimensions=['overall','attack','creation','defense','physical','goalkeeping']; const legacy={};
  for(const dimension of dimensions){const vals=records.map(r=>r.legacy.dimensions[dimension]).filter(Number.isFinite);legacy[dimension]={present:vals.length,total:records.length,min:vals.length?Math.min(...vals):null,max:vals.length?Math.max(...vals):null,mean:vals.length?round3(vals.reduce((a,b)=>a+b,0)/vals.length):null};}
  const detailedObserved=Object.fromEntries(Object.keys(records[0]?.canonical.attributes||{}).map(name=>[name,records.filter(r=>r.canonical.attributes[name].value!=null).length]));
  return {legacyBaseline:{source:'public/data/team-seasons.js',records:records.length,dimensions:legacy,isTrainingTruth:false,originStatus:'unknown_source_lineage'},v2:{selectedSnapshots:records.filter(r=>r.snapshotSelection.selectionStatus==='selected').length,unavailable:records.filter(r=>r.availability==='unavailable').length,canonicalDetailedAttributeObservedCounts:detailedObserved},migrationRule:'Legacy six dimensions are retained for comparison only; no formula converts them into source observations or canonical detailed attributes.'};
}

export async function buildPsv2005Case(records, auditPath) {
  const ids=new Map();
  for await(const row of readCsvRows(auditPath)) if(row.teamSeasonId==='psv-2005') ids.set(row.player_season_id,row.requested_player);
  if(ids.size!==9) throw new Error('PSV 2005 audit fixture expected nine players; found '+ids.size);
  const byId=new Map(records.map(r=>[r.playerSeasonId,r]));
  const players=[...ids].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,auditName])=>{
    const record=byId.get(id); if(!record) throw new Error('PSV audit PlayerSeason is absent from current identity map: '+id);
    const observations=record.observations.filter(o=>o.sourceId==='lbenz-fifaindex'&&[2005,2006,2007].includes(o.editionYear)).map(o=>({editionYear:o.editionYear,sourcePlayerId:o.sourcePlayerId,sourceName:o.sourceName,sourceClub:o.sourceClub,rawOverall:o.rawOverall,rowNumber:o.rowNumber,identityMatch:o.identityMatch}));
    return {playerSeasonId:id,canonicalPlayerId:record.canonicalPlayerId,auditName,membershipClub:record.membershipClub,selectedSnapshot:{strategy:record.snapshotSelection.strategy,actualEditionYear:record.snapshotSelection.actualEditionYear,observationId:record.snapshotSelection.primaryObservationId},sourceObservations:observations};
  });
  const farfan=players.find(p=>p.sourceObservations.some(o=>o.sourcePlayerId==='158133'));
  if(!farfan) throw new Error('PSV 2005 Farfán source ID 158133 is not present in v2 source observations.');
  const values=Object.fromEntries([2005,2006,2007].map(year=>[year,farfan.sourceObservations.filter(o=>o.editionYear===year&&o.identityMatch.status==='stable_external_id').map(o=>o.rawOverall)]));
  if(JSON.stringify(values)!==JSON.stringify({2005:['48'],2006:['69'],2007:['73']})) throw new Error('Farfán raw source check failed: '+JSON.stringify(values));
  if(farfan.selectedSnapshot.strategy!=='y_plus_1'||farfan.selectedSnapshot.actualEditionYear!==2006) throw new Error('Farfán PSV 2005 selection is not the Y+1 FIFA06 observation.');
  return {teamSeasonId:'psv-2005',teamSeasonYear:2005,targetEditionYear:2006,players,farfanCheck:{sourcePlayerId:'158133',rawOverallByEdition:values,selectedEdition:2006,selectedRawOverall:'69'},interpretation:'These are source-native edition observations. The change 48→69→73 is not assigned a causal explanation; the Y+1 policy selects the FIFA06 observation for PSV 2005 while membership remains PSV.'};
}

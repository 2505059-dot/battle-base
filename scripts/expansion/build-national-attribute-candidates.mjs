import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../lib/normalize.mjs';

const national = [
  {id:'spain-2010',country:'Spain',edition:'FIFA 10',file:'dataset_fifa_10.csv'},
  {id:'germany-2014',country:'Germany',edition:'FIFA 14',file:'dataset_fifa_14.csv'},
  {id:'france-2018',country:'France',edition:'FIFA 18',file:'dataset_fifa_18.csv'},
  {id:'russia-2018',country:'Russia',edition:'FIFA 18',file:'dataset_fifa_18.csv'},
  {id:'belgium-2018',country:'Belgium',edition:'FIFA 18',file:'dataset_fifa_18.csv'},
  {id:'mexico-2018',country:'Mexico',edition:'FIFA 18',file:'dataset_fifa_18.csv'}
];
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const missing = (v) => v === '' || v === 'NA' || v === 'N/A';
const countStatuses = (records) => Object.fromEntries([...new Set(records.map((r) => r.identityStatus))].map((s) => [s, records.filter((r) => r.identityStatus === s).length]));
function identitySummary(records) {
  const byId = new Map();
  for (const r of records) {
    if (r.sourcePlayerId === null || r.sourcePlayerId === undefined || r.sourcePlayerId === '') continue;
    const key = String(r.sourceSystem) + ':' + String(r.sourcePlayerId);
    if (!byId.has(key)) byId.set(key, new Set());
    byId.get(key).add(r.identityStatus);
  }
  const distinctSourceIdStatusCounts = {};
  for (const statuses of byId.values()) for (const status of statuses) distinctSourceIdStatusCounts[status] = (distinctSourceIdStatusCounts[status] ?? 0) + 1;
  return { recordCount: records.length, recordStatusCounts: countStatuses(records), sourceIdRecordRows: records.filter((r) => r.sourcePlayerId !== null && r.sourcePlayerId !== undefined && r.sourcePlayerId !== '').length, distinctSourceIdKeys: byId.size, distinctSourceIdStatusCounts, sourceIdsWithConflictingStatuses: [...byId.values()].filter((s) => s.size > 1).length, recordsWithoutSourceIds: records.filter((r) => r.sourcePlayerId === null || r.sourcePlayerId === undefined || r.sourcePlayerId === '').length };
}

export function buildNationalAttributeCandidates({root, out, cache, readAt}) {
  const seed = JSON.parse(fs.readFileSync(path.join(out,'sources/national-event-rosters.json'),'utf8'));
  const canonical = JSON.parse(fs.readFileSync(path.join(root,'data/entities/players.json'),'utf8'));
  const ids = new Map();
  const names = new Map();
  const addName=(name,id)=>{const k=norm(name);if(!k)return;if(!names.has(k))names.set(k,new Set());names.get(k).add(id);};
  for(const p of canonical.entities??[]){addName(p.canonicalName,p.id);for(const n of Object.values(p.localizedNames??{}))addName(n,p.id);for(const list of Object.values(p.aliases??{}))for(const n of list??[])addName(n,p.id);}
  const aliasIndex=JSON.parse(fs.readFileSync(path.join(root,'data/manual/player-aliases.json'),'utf8'));
  for(const [alias,targets] of Object.entries(aliasIndex)){for(const target of Array.isArray(targets)?targets:[targets])for(const id of names.get(norm(target))??[]){addName(alias,id);}}
  for (const p of canonical.entities ?? []) {
    const id = p.externalIds?.sofifa;
    if (id !== null && id !== undefined) {
      const k = String(id);
      if (!ids.has(k)) ids.set(k,[]);
      ids.get(k).push(p.id);
    }
  }
  const identity = JSON.parse(fs.readFileSync(path.join(out,'identity-matches.json'),'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(out,'coverage-report.json'),'utf8'));
  identity.records=identity.records.filter((r)=>r.recordKind!=='national-attribute-candidate');
  const totals = {records:0, rawAttributeSlots:0, rawAttributePresentValues:0, rawAttributeMissingValues:0, explicitRawZeroValues:0, linkedOfficialRosterNames:0, unmatchedOfficialRosterNames:0, ambiguousSourceRows:0, officialSnapshotEntries:0, uniqueNamesAcrossSnapshots:0, finalRosterEntries:0, uniqueFinalRosterNames:0, finalRosterNamesWithCandidates:0, finalRosterNamesWithoutCandidates:0};
  const perTeam = {};

  for (const t of national) {
    const input = path.join(cache,t.file);
    const bytes = fs.readFileSync(input);
    const rows = parseCsvRecords(bytes.toString('utf8'));
    const snapshots = seed[t.id]?.snapshots ?? [];
    const linksByName = new Map();
    for (const snapshot of snapshots) {
      for (const member of snapshot.members ?? []) {
        const k = norm(member.rawName);
        if (!linksByName.has(k)) linksByName.set(k,[]);
        linksByName.get(k).push({rawName:member.rawName,rosterType:snapshot.rosterType,sourceUrl:snapshot.source?.url});
      }
    }
    const allCountryRows = rows.filter((r) => r.nationality === t.country);
    const candidates = allCountryRows.filter((r) => linksByName.has(norm(r.long_name)));
    const attrNames = Object.keys(rows[0] ?? {}).filter((h) => /^(overall|pace|shooting|passing|dribbling|defending|physical|crossing|finishing|heading_accuracy|short_passing|volleys|dribbling_stat|curve|fk_accuracy|long_passing|ball_control|acceleration|sprint_speed|agility|reactions|balance|shot_power|jumping|stamina|strength|long_shots|aggression|interceptions|positioning|vision|penalties|composure|defensive_awareness|standing_tackle|sliding_tackle|gk_diving|gk_handling|gk_kicking|gk_positioning|gk_reflexes)$/.test(h));
    const records = candidates.map((raw) => {
      const links = linksByName.get(norm(raw.long_name)) ?? [];
      const candidatesForId = ids.get(String(raw.sofifa_id)) ?? [];
      const idConfirmed = candidatesForId.length === 1;
      const nameCandidates = [...(names.get(norm(raw.long_name))??[])].sort();
      const placeholderHeuristic = /^(player|unknown|generic)\s*\d*/i.test(String(raw.long_name ?? ''));
      const identityStatus = idConfirmed ? 'confirmed-existing-by-exact-source-id' : candidatesForId.length > 1 ? 'source-id-collision-needs-review' : placeholderHeuristic ? 'possible-placeholder-needs-review' : nameCandidates.length ? 'name-candidate-unconfirmed' : 'proposed-new-source-player-needs-review';
      const missingFields = Object.entries(raw).filter(([,v]) => missing(v)).map(([k]) => k);
      identity.records.push({
        candidateTeamSeason:t.id, recordKind:'national-attribute-candidate', sourceSystem:'sofifa', sourcePlayerId:raw.sofifa_id,
        rawName:raw.long_name, identityStatus, identityStatusNote:placeholderHeuristic ? 'name-pattern heuristic only; this does not prove that the record is fictional' : null,
        canonicalPlayerId:idConfirmed ? candidatesForId[0] : null,
        candidateCanonicalIds:idConfirmed ? [] : candidatesForId.length ? candidatesForId : nameCandidates,
        evidence:idConfirmed ? 'exact SoFIFA ID resolves to canonical identity; event-list link remains name+nationality candidate' : 'no unique canonical SoFIFA ID match',
        sourceRecordRole:'supplemental-attribute-candidate-only',
        eventRosterLinkStatus:'exact normalized long_name plus exact nationality; unconfirmed cross-source link',
        candidateEventRosterNames:links.map((x) => x.rawName),
        sourcePlayerPageUrl:raw.player_url ?? null
      });
      return {
        sourcePlayerId:raw.sofifa_id, rawName:raw.long_name, rawShortName:raw.short_name,
        sourceClubName:raw.club_name, sourceNationality:raw.nationality,
        rawPosition:raw.positions, rawOverall:raw.overall,
        candidateEventRosterNames:links.map((x) => ({name:x.rawName,rosterType:x.rosterType,sourceUrl:x.sourceUrl})),
        eventRosterLinkStatus:'exact normalized long_name plus exact nationality; review candidate only',
        identityStatus, identityStatusNote:placeholderHeuristic ? 'name-pattern heuristic only; this does not prove that the record is fictional' : null,
        recordKind:'national-attribute-candidate', canonicalPlayerId:idConfirmed ? candidatesForId[0] : null,
        missingFields, packageProcessedAt:readAt, gameVersion:t.edition,
        sourceDatasetUrl:'https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/'+t.file,
        sourcePlayerPageUrl:raw.player_url ?? null, rawSourceFields:raw
      };
    });
    const attributeValues=records.flatMap((r)=>attrNames.map((field)=>r.rawSourceFields[field]??''));
    const attributePresent=attributeValues.filter((v)=>!missing(v)).length;
    const attributeMissing=attributeValues.length-attributePresent;
    const attributeZeros=attributeValues.filter((v)=>v==='0').length;
    const multipleLinks = records.filter((r) => r.candidateEventRosterNames.length !== 1).length;
    const finalSnapshots=snapshots.filter((s)=>s.rosterType==='official-event-roster'||s.rosterType==='official-final-roster');
    const finalKeys=new Set(finalSnapshots.flatMap((s)=>(s.members??[]).map((p)=>norm(p.rawName))));
    const finalMatchedKeys=new Set(records.flatMap((r)=>r.candidateEventRosterNames.filter((x)=>x.rosterType==='official-event-roster'||x.rosterType==='official-final-roster').map((x)=>norm(x.name))));
    const snapshotEntries=snapshots.reduce((n,s)=>n+(s.members?.length??0),0);
    const finalEntries=finalSnapshots.reduce((n,s)=>n+(s.members?.length??0),0);
    const foundNames = new Set(records.flatMap((r) => r.candidateEventRosterNames.map((x) => norm(x.name))));
    const allNames = new Set([...linksByName.keys()]);
    const unmatched = [...allNames].filter((k) => !foundNames.has(k));
    totals.records += records.length;
    totals.rawAttributeSlots+=attributeValues.length;
    totals.rawAttributePresentValues+=attributePresent;
    totals.rawAttributeMissingValues+=attributeMissing;
    totals.explicitRawZeroValues+=attributeZeros;
    totals.linkedOfficialRosterNames += foundNames.size;
    totals.unmatchedOfficialRosterNames += unmatched.length;
    totals.ambiguousSourceRows += multipleLinks;
    totals.officialSnapshotEntries += snapshotEntries;
    totals.uniqueNamesAcrossSnapshots += allNames.size;
    totals.finalRosterEntries += finalEntries;
    totals.uniqueFinalRosterNames += finalKeys.size;
    totals.finalRosterNamesWithCandidates += finalMatchedKeys.size;
    totals.finalRosterNamesWithoutCandidates += Math.max(0,finalKeys.size-finalMatchedKeys.size);
    perTeam[t.id] = {records:records.length, rawAttributeFieldNames:attrNames, rawAttributeSlots:attributeValues.length, rawAttributePresentValues:attributePresent, rawAttributeMissingValues:attributeMissing, explicitRawZeroValues:attributeZeros, officialSnapshotEntries:snapshotEntries, uniqueNamesAcrossSnapshots:allNames.size, exactNameNationalityRosterNamesMatched:foundNames.size, rosterNamesWithoutCandidate:unmatched.length, finalRosterEntries:finalEntries, finalRosterNamesWithCandidates:finalMatchedKeys.size, finalRosterNamesWithoutCandidates:Math.max(0,finalKeys.size-finalMatchedKeys.size), rowsWithMultipleEventLinks:multipleLinks};

    const updateIds = [...new Set(candidates.map((r) => (r.player_url ?? '').split('/').filter(Boolean).at(-1)).filter(Boolean))];
    const sourceFile = path.join(out,'sources',t.id+'.event-attribute-candidates.sofifa.json');
    fs.writeFileSync(sourceFile,JSON.stringify({
      schemaVersion:'wave1-event-attribute-candidates/1',candidateTeamSeason:t.id,
      sourceMetadata:{
        sourcePlatform:'SoFIFA',datasetRepository:'mzafram2001/ea-fc (MIT dataset)',
        datasetUrl:'https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/'+t.file,
        datasetLocalCachePath:'data/raw/fifa/expansion-wave1/'+t.file,cacheSha256:sha(bytes),cacheReadAt:readAt,
        cacheAcquisitionTime:'unknown; the pre-existing ignored cache has no retrieval timestamp',
        sourceRetrievedAt:null,sourceRetrievedAtReason:'the pre-existing cache has no acquisition timestamp; packageProcessedAt/cacheReadAt are processing times only',packageProcessedAt:readAt,
        gameVersion:t.edition,observedUpdateIds:updateIds,
        sourceFilter:'exact nationality plus exact normalized full long_name against a separately sourced official-event roster name',
        rowsAreNotNationalTeamMembership:'true; raw source club_name remains the player club. Candidate links are not confirmed identity or roster membership.',
        rawAttributeFieldNames:attrNames,sourceRowsConsidered:allCountryRows.length,
        candidateRows:records.length,unmatchedEventRosterNames:unmatched
      },records
    },null,2)+'\n','utf8');

    const rosterPath=path.join(out,'rosters',t.id+'.json');
    const roster=JSON.parse(fs.readFileSync(rosterPath,'utf8'));
    roster.supplementalAttributeCandidates={
      sourceFile:path.basename(sourceFile),gameVersion:t.edition,
      count:records.length,matchRule:'exact normalized source long_name + exact source nationality; not proof of game national-team membership',
      unmatchedOfficialRosterNames:unmatched,records:records.map((r)=>({
        sourcePlayerId:r.sourcePlayerId,rawName:r.rawName,sourceNationality:r.sourceNationality,
        sourceClubName:r.sourceClubName,rawPosition:r.rawPosition,rawOverall:r.rawOverall,
        candidateEventRosterNames:r.candidateEventRosterNames,eventRosterLinkStatus:r.eventRosterLinkStatus,
        identityStatus:r.identityStatus,canonicalPlayerId:r.canonicalPlayerId,sourcePlayerPageUrl:r.sourcePlayerPageUrl
      }))
    };
    fs.writeFileSync(rosterPath,JSON.stringify(roster,null,2)+'\n','utf8');
    const m=manifest.teams.find((x)=>x.candidateId===t.id);
    m.supplementalAttributeCandidateRows=records.length;
    m.supplementalRawAttributeSlots=attributeValues.length;
    m.supplementalRawAttributePresentValues=attributePresent;
    m.supplementalRawAttributeMissingValues=attributeMissing;
    m.supplementalExplicitRawZeroValues=attributeZeros;
    m.eventRosterNamesWithExactNameNationalityCandidate=foundNames.size;
    m.eventRosterNamesWithoutCandidate=unmatched.length;
  }
  const kinds=['main-game','event-roster','national-attribute-candidate'];
  identity.totals=identitySummary(identity.records);
  identity.totals.records=identity.records.length;
  identity.totals.exactIdConfirmed=identity.records.filter((x)=>x.identityStatus==='confirmed-existing-by-exact-source-id').length;
  identity.totals.nameCandidateUnconfirmed=identity.records.filter((x)=>x.identityStatus==='name-candidate-unconfirmed').length;
  identity.totals.proposedNewSourcePlayers=identity.records.filter((x)=>x.identityStatus==='proposed-new-source-player-needs-review').length;
  identity.totals.identityUnconfirmedNoSourceId=identity.records.filter((x)=>x.identityStatus==='identity-unconfirmed-no-source-id').length;
  identity.totals.placeholderNeedsReview=identity.records.filter((x)=>x.identityStatus==='possible-placeholder-needs-review').length;
  identity.totals.sourceIdCollision=identity.records.filter((x)=>x.identityStatus==='source-id-collision-needs-review').length;
  identity.totals.recordCountsByKind=Object.fromEntries(kinds.map((k)=>[k,identity.records.filter((x)=>x.recordKind===k).length]));
  identity.totals.recordStatusCounts=identitySummary(identity.records).recordStatusCounts;
  for(const team of manifest.teams){
    const teamRecords=identity.records.filter((x)=>x.candidateTeamSeason===team.candidateId);
    const byKind=Object.fromEntries(kinds.map((k)=>{const rows=teamRecords.filter((x)=>x.recordKind===k);return[k,{recordCount:rows.length,identityStatusCounts:countStatuses(rows)}]}));
    const teamSummary=identitySummary(teamRecords);
    team.identityRecordCount=teamRecords.length;
    team.distinctSourceIdCount=teamSummary.distinctSourceIdKeys;
    team.identityRecordsByKind=byKind;
    team.mainGameRecordCount=byKind['main-game'].recordCount;
    team.eventRosterEntryCount=byKind['event-roster'].recordCount;
    team.nationalAttributeCandidateRecordCount=byKind['national-attribute-candidate'].recordCount;
  }
  report.totals.identityRecordCount=identity.totals.recordCount;
  report.totals.identityRecordCountsByKind=identity.totals.recordCountsByKind;
  report.totals.identityRecordStatusCounts=identity.totals.recordStatusCounts;
  report.totals.exactIdIdentityMatches=identity.totals.exactIdConfirmed;
  report.totals.nameOnlyIdentityCandidates=identity.totals.nameCandidateUnconfirmed;
  report.totals.proposedNewSourcePlayerRecords=identity.totals.proposedNewSourcePlayers;
  report.totals.eventNamesWithoutSourceIDs=identity.records.filter((r)=>r.recordKind==='event-roster'&&(r.sourcePlayerId===null||r.sourcePlayerId===undefined||r.sourcePlayerId==='')).length;
  report.totals.distinctSourceIdKeys=identity.totals.distinctSourceIdKeys;
  report.totals.sourceIdRecordRows=identity.totals.sourceIdRecordRows;
  report.totals.distinctSourceIdStatusCounts=identity.totals.distinctSourceIdStatusCounts;
  report.totals.sourceIdsWithConflictingStatuses=identity.totals.sourceIdsWithConflictingStatuses;
  report.totals.recordsWithoutSourceIds=identity.totals.recordsWithoutSourceIds;
  report.totals.eventRosterNamesWithExactNameNationalityCandidates=totals.linkedOfficialRosterNames;
  report.totals.eventRosterNamesWithoutExactCandidate=totals.unmatchedOfficialRosterNames;
  report.totals.officialEventSnapshotRosterEntries=totals.officialSnapshotEntries;
  report.totals.uniqueEventRosterNamesAcrossSnapshots=totals.uniqueNamesAcrossSnapshots;
  report.totals.finalEventRosterEntries=totals.finalRosterEntries;
  report.totals.uniqueFinalEventRosterNames=totals.uniqueFinalRosterNames;
  report.totals.finalEventRosterNamesWithCandidates=totals.finalRosterNamesWithCandidates;
  report.totals.finalEventRosterNamesWithoutCandidates=totals.finalRosterNamesWithoutCandidates;
  report.totals.finalNationalRosterCoverageDenominator={entries:totals.finalRosterEntries,uniqueNames:totals.uniqueFinalRosterNames,withAttributeCandidates:totals.finalRosterNamesWithCandidates,withoutAttributeCandidates:totals.finalRosterNamesWithoutCandidates};
  report.totals.allEventSnapshotCoverageDenominator={entries:totals.officialSnapshotEntries,uniqueNames:totals.uniqueNamesAcrossSnapshots,withAttributeCandidates:totals.linkedOfficialRosterNames,withoutAttributeCandidates:totals.unmatchedOfficialRosterNames};
  report.perTeam=manifest.teams.map((x)=>({candidateTeamSeason:x.candidateId,mainGameRecords:x.mainGameRecordCount,eventRosterEntries:x.eventRosterEntryCount,nationalAttributeCandidateRows:x.nationalAttributeCandidateRecordCount,identityRecordCount:x.identityRecordCount,distinctSourceIdCount:x.distinctSourceIdCount,identityRecordsByKind:x.identityRecordsByKind}));
  for(const note of [
    'Possible-placeholder labels use a name-pattern heuristic only and do not establish that a player is fictional.',
    'FIFAIndex edition pages do not disclose a verified patch/update date for the cited snapshots; unknown dates remain null.',
    'National final-list attribute coverage is 111/138 unique final-list names; the submitted/final snapshot union is 112/139 unique names because Mexico replaced Diego Reyes with Erick Gutiérrez.'
  ])if(!report.unresolved.includes(note))report.unresolved.push(note);
    fs.writeFileSync(path.join(out,'identity-matches.json'),JSON.stringify(identity,null,2)+'\n','utf8');
  manifest.supplementalAttributeCandidates={method:'exact normalized full name plus exact nationality; candidates do not prove country-team membership',totals,perTeam};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
  report.totals.supplementalNationalAttributeCandidateRows=totals.records;
  report.totals.supplementalNationalRawAttributeSlots=totals.rawAttributeSlots;
  report.totals.supplementalNationalRawAttributePresentValues=totals.rawAttributePresentValues;
  report.totals.supplementalNationalRawAttributeMissingValues=totals.rawAttributeMissingValues;
  report.totals.supplementalNationalExplicitRawZeroValues=totals.explicitRawZeroValues;
  report.totals.eventRosterNamesWithExactNameNationalityCandidates=totals.linkedOfficialRosterNames;
  report.totals.eventRosterNamesWithoutExactCandidate=totals.unmatchedOfficialRosterNames;
  report.totals.officialEventSnapshotRosterEntries=totals.officialSnapshotEntries;
  report.totals.uniqueEventRosterNamesAcrossSnapshots=totals.uniqueNamesAcrossSnapshots;
  report.totals.finalEventRosterEntries=totals.finalRosterEntries;
  report.totals.uniqueFinalEventRosterNames=totals.uniqueFinalRosterNames;
  report.totals.finalEventRosterNamesWithCandidates=totals.finalRosterNamesWithCandidates;
  report.totals.finalEventRosterNamesWithoutCandidates=totals.finalRosterNamesWithoutCandidates;
  report.totals.distinctSourceIdKeys=identity.totals.distinctSourceIdKeys;
  report.totals.sourceIdRecordRows=identity.totals.sourceIdRecordRows;
  report.totals.identityRecordStatusCounts=identity.totals.recordStatusCounts;
  report.totals.distinctSourceIdStatusCounts=identity.totals.distinctSourceIdStatusCounts;
  report.unresolved.push('National-team attribute candidates are SoFIFA club rows linked to event names by exact full name and nationality; they remain separate from official and game national-team rosters.');
  fs.writeFileSync(path.join(out,'coverage-report.json'),JSON.stringify(report,null,2)+'\n','utf8');
  return totals;
}
export function validateNationalAttributeCandidates({root,out}) {
  const errors=[];
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
  const identity=JSON.parse(fs.readFileSync(path.join(out,'identity-matches.json'),'utf8'));
  const report=JSON.parse(fs.readFileSync(path.join(out,'coverage-report.json'),'utf8'));
  for(const t of national){
    const sourcePath=path.join(out,'sources',t.id+'.event-attribute-candidates.sofifa.json');
    const rosterPath=path.join(out,'rosters',t.id+'.json');
    if(!fs.existsSync(sourcePath)){errors.push('missing national attribute source: '+t.id);continue;}
    if(!fs.existsSync(rosterPath)){errors.push('missing national roster: '+t.id);continue;}
    const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
    const roster=JSON.parse(fs.readFileSync(rosterPath,'utf8'));
    const team=manifest.teams.find((x)=>x.candidateId===t.id);
    if(!team){errors.push('missing national manifest team: '+t.id);continue;}
    if(!/^[a-f0-9]{64}$/.test(source.sourceMetadata.cacheSha256??''))errors.push('national source checksum missing: '+t.id);
    if(source.records.length!==team.supplementalAttributeCandidateRows||source.records.length!==roster.supplementalAttributeCandidates?.count)errors.push('national candidate row count mismatch: '+t.id);
    for(const row of source.records){
      if(!row.rawSourceFields||Object.values(row.rawSourceFields).some((v)=>typeof v!=='string'))errors.push('national raw source fields are not string-preserved: '+t.id);
      if(row.sourceClubName===undefined||row.sourceNationality!==t.country)errors.push('national candidate lost raw club/nationality context: '+t.id);
    }
  }
  const kinds=['main-game','event-roster','national-attribute-candidate'];
  for(const team of manifest.teams){
    const rows=identity.records.filter((r)=>r.candidateTeamSeason===team.candidateId);
    if(team.identityRecordCount!==rows.length)errors.push('team identity record count mismatch: '+team.candidateId);
    if(team.mainGameRecordCount!==team.localRawPlayerRows)errors.push('main-game record count mismatch: '+team.candidateId);
    for(const kind of kinds){
      const count=rows.filter((r)=>r.recordKind===kind).length;
      if(team.identityRecordsByKind?.[kind]?.recordCount!==count)errors.push('identity record-kind count mismatch: '+team.candidateId+' '+kind);
    }
  }
  if(report.totals.identityRecordCount!==identity.records.length)errors.push('coverage/identity total record count mismatch');
  if(report.totals.distinctSourceIdKeys!==identity.totals.distinctSourceIdKeys)errors.push('coverage/identity distinct source-ID count mismatch');
  const byKind=Object.fromEntries(kinds.map((kind)=>[kind,identity.records.filter((r)=>r.recordKind===kind).length]));
  for(const kind of kinds)if(report.totals.identityRecordCountsByKind?.[kind]!==byKind[kind])errors.push('coverage identity record-kind total mismatch: '+kind);
  if(report.totals.finalNationalRosterCoverageDenominator?.uniqueNames!==138||report.totals.finalNationalRosterCoverageDenominator?.withAttributeCandidates!==111)errors.push('final national roster candidate denominator must be 111/138');
  if(report.totals.allEventSnapshotCoverageDenominator?.uniqueNames!==139||report.totals.allEventSnapshotCoverageDenominator?.withAttributeCandidates!==112)errors.push('submitted/final event snapshot union candidate denominator must be 112/139');
  return errors;
}

const isMain=process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]);
if(isMain){
  const args=process.argv.slice(2);
  const checkOnly=args.includes('--check');
  const buildRequested=args.includes('--build');
  const unknown=args.filter((x)=>x!=='--check'&&x!=='--build');
  if(unknown.length||(checkOnly&&buildRequested)){
    console.error('Usage: node build-national-attribute-candidates.mjs [--check | --build]');
    process.exitCode=2;
  }else{
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const out=path.join(root,'data/expansion/wave1');
    if(checkOnly){
      const errors=validateNationalAttributeCandidates({root,out});
      if(errors.length){console.error('National attribute validation failed:\n- '+errors.join('\n- '));process.exitCode=1;}
      else console.log('National attribute candidate validation passed (read-only).');
    }else{
      const cache=path.join(root,'data/raw/fifa/expansion-wave1');
      const totals=buildNationalAttributeCandidates({root,out,cache,readAt:new Date().toISOString()});
      console.log('Built national attribute candidate rows: '+totals.records);
    }
  }
}

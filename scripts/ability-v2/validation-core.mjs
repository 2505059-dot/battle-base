import { selectSnapshot, verifySnapshotFixtures } from './snapshots.mjs';
import { parseSourcePositions, parseObservedPositionRatings } from './positions.mjs';
import { parseSourceRating, parseSourceUpdateDate } from './source-adapters.mjs';
import { validateDeclaredSchema } from './schema-validator.mjs';

const fail=(message)=>{throw new Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function verifyPositionFixtures(config){
  const row={preferred_positions:'LWB/RWB/SW/LCB/RCB/LCM/RCM/XYZ',club_position:'SUB'};
  const parsed=parseSourcePositions(row,'lbenz-fifaindex',config);
  const tokens=parsed.sourcePositions.map(x=>x.nativeCode);
  if(!same(tokens,['LWB','RWB','SW','LCB','RCB','LCM','RCM','XYZ','SUB'])) fail('Position order or roster-status fixture failed.');
  const get=(code)=>parsed.sourcePositions.find(x=>x.nativeCode===code);
  for(const code of ['LWB','RWB']) if(get(code).canonicalPosition!==code||get(code).mappingStatus!=='mapped') fail(code+' must remain a canonical position.');
  if(get('SW').mappingStatus!=='legacy-special'||get('SW').canonicalPosition!==null) fail('SW must remain legacy-special and unmapped.');
  for(const [code,side,family] of [['LCB','left','CB'],['RCB','right','CB'],['LCM','left','CM'],['RCM','right','CM']]) if(get(code).side!==side||get(code).canonicalPosition!==family) fail(code+' side mapping failed.');
  if(get('XYZ').mappingStatus!=='unresolved'||parsed.rosterPosition.mappingStatus!=='roster-status') fail('Unknown code or SUB status fixture failed.');
  const ratings=parseObservedPositionRatings({cam:'81+2',cb:'73-1'},'stefano-legacy',config);
  if(ratings.length!==2||ratings[0].rawString!=='81+2'||ratings[0].baseInteger!==81||ratings[0].signedModifier!==2||ratings[1].signedModifier!==-1) fail('Observed rating base/modifier fixture failed.');
  const demo=parseObservedPositionRatings({CAM:'89.0'},'fifa18-demo',config);
  if(demo.length!==1||demo[0].rawString!=='89.0'||demo[0].baseInteger!==89||demo[0].signedModifier!==null) fail('Decimal-form observed rating fixture failed.');
  const res=parseSourcePositions({preferred_positions:'ST',club_position:'RES'},'lbenz-fifaindex',config).rosterPosition;
  if(res.mappingStatus!=='roster-status') fail('RES status fixture failed.');
  return 7;
}

function normalizeExternalId(value){
  const raw=String(value??'').trim();
  return /^\d+\.0+$/.test(raw)?raw.replace(/\.0+$/,''):raw;
}

function expectedCanonicalCell(raw,sourceField,observation,mappingVersion,valueKind,noFieldReason=null){
  if(!observation) return {value:null,sourceField:sourceField||null,observationId:null,mappingVersion,status:'unavailable',missingReason:'no selected stable source observation'};
  if(!sourceField) return {value:null,sourceField:null,observationId:observation.observationId,mappingVersion,status:'unmapped',missingReason:noFieldReason||'no confirmed source-field mapping'};
  const parsed=parseSourceRating(raw,sourceField);
  return {value:parsed.value,sourceField,observationId:observation.observationId,mappingVersion,status:parsed.value==null?(parsed.raw?'invalid':'missing'):'observed',missingReason:parsed.reason,rawString:raw==null?null:String(raw),valueKind};
}

function assertCanonicalCell(actual,expected,label){
  for(const key of ['value','sourceField','observationId','mappingVersion','status','missingReason']){
    if(!Object.hasOwn(actual,key)||!same(actual[key],expected[key])) fail('Canonical provenance mismatch for '+label+' field '+key+'.');
  }
  for(const key of ['rawString','valueKind']){
    if(Object.hasOwn(expected,key)){
      if(!Object.hasOwn(actual,key)||!same(actual[key],expected[key])) fail('Canonical raw-value mismatch for '+label+' field '+key+'.');
    }else if(Object.hasOwn(actual,key)) fail('Canonical unmapped/unavailable cell has unexpected '+key+': '+label+'.');
  }
}

export function validateData(data,context){
  if(!context.schema) fail('The declared JSON Schema is required for validation.');
  validateDeclaredSchema(data,context.schema);
  if(data.schemaVersion!==context.schemaVersion) fail('Schema version mismatch.');
  const expectedVersions={source:context.sourceConfigs.version,field:context.fieldMappings.version,position:context.positionMappings.version,snapshot:context.snapshotPolicy.version};
  if(context.overrides?.version) expectedVersions.override=context.overrides.version;
  for(const [name,version] of Object.entries(expectedVersions)) if(data.mappingVersions[name]!==version) fail('Mapping version mismatch for '+name+'.');
  const expectedIds=new Set(context.expectedRecords.keys());
  if(data.records.length!==expectedIds.size) fail('PlayerSeason placeholder count mismatch.');
  const entityById=new Map(context.entities.map(entity=>[entity.id,entity]));
  const namespaces=[...new Set(Object.values(context.sourceConfigs.idFields).map(spec=>spec.externalIdNamespace))];
  const externalOwners=new Map();
  for(const entity of context.entities) for(const namespace of namespaces){
    const value=normalizeExternalId(entity.externalIds?.[namespace]);
    if(value==='') continue;
    const key=namespace+'\u0000'+value;const owners=externalOwners.get(key)||[];owners.push(entity.id);externalOwners.set(key,owners);
  }
  const sourceHashes=new Map(context.manifest.source_files.map(source=>[source.cache_path,source.sha256.toLowerCase()]));
  const sourceVersionHashes=new Map(Object.entries(context.sourceConfigs.sources).map(([sourceId,cfg])=>[sourceId,cfg.manifestPath?sourceHashes.get(cfg.manifestPath):null]));
  const seenRecords=new Set();
  for(const record of data.records){
    if(seenRecords.has(record.playerSeasonId)) fail('Duplicate PlayerSeason ID: '+record.playerSeasonId);seenRecords.add(record.playerSeasonId);
    const expected=context.expectedRecords.get(record.playerSeasonId);if(!expected) fail('Dangling PlayerSeason ID: '+record.playerSeasonId);
    const entity=entityById.get(record.canonicalPlayerId);
    if(record.canonicalPlayerId!==expected.canonicalPlayerId||!entity) fail('Canonical identity mismatch: '+record.playerSeasonId);
    if(record.teamSeasonId!==expected.teamSeasonId||record.membershipClub!==expected.membershipClub) fail('Historical membership changed: '+record.playerSeasonId);
    if(record.identityStatus!==expected.identityStatus) fail('Identity status drift: '+record.playerSeasonId);
    const observationIds=new Set();
    for(const observation of record.observations){
      if(observationIds.has(observation.observationId)) fail('Duplicate observation ID within PlayerSeason '+record.playerSeasonId+': '+observation.observationId);
      observationIds.add(observation.observationId);
    }
    const selected=selectSnapshot(record.observations,record.snapshotSelection.targetEditionYear-1,context.snapshotPolicy);
    if(selected.primaryObservationId!==record.snapshotSelection.primaryObservationId||selected.strategy!==record.snapshotSelection.strategy||selected.actualEditionYear!==record.snapshotSelection.actualEditionYear||selected.yearOffset!==record.snapshotSelection.yearOffset||selected.selectionStatus!==record.snapshotSelection.selectionStatus) fail('Snapshot selection is not reproducible: '+record.playerSeasonId);
    const primary=record.observations.find(observation=>observation.observationId===record.snapshotSelection.primaryObservationId)||null;
    if(record.snapshotSelection.selectionStatus==='selected'&&(!primary||primary.identityMatch.status!=='stable_external_id')) fail('Selected snapshot lacks a unique stable ID: '+record.playerSeasonId);
    if(record.snapshotSelection.selectionStatus==='unavailable'&&primary) fail('Unavailable record has a primary observation: '+record.playerSeasonId);
    if(record.snapshotSelection.targetEditionYear!==expected.seasonYear+1) fail('Snapshot target edition is not TeamSeason Y+1: '+record.playerSeasonId);
    for(const observation of record.observations){
      const cfg=context.sourceConfigs.sources[observation.sourceId];if(!cfg) fail('Unknown source ID: '+observation.sourceId);
      const idSpec=context.sourceConfigs.idFields[observation.sourceId];if(!idSpec) fail('Source ID namespace is not configured: '+observation.sourceId);
      const expectedHash=observation.sourceId==='stefano-legacy'?sourceVersionHashes.get(observation.sourceId):sourceHashes.get(observation.sourcePath);
      if(!expectedHash||observation.payloadSha256!==expectedHash) fail('Observation payload hash is not manifest-pinned: '+observation.observationId);
      const extraction=context.acquisition.extractedMembers.find(item=>item.path===observation.sourcePath)||null;
      if(extraction){if(observation.sourceMember!==extraction.member||observation.sourceMemberSha256!==extraction.sha256||observation.sourceArchiveSha256!==extraction.archiveSha256) fail('Extracted-member/archive provenance mismatch: '+observation.observationId);}
      else if(observation.sourceMember||observation.sourceMemberSha256||observation.sourceArchiveSha256) fail('Direct CSV observation has unexpected ZIP-member metadata: '+observation.observationId);
      if(observation.rowNumber<2) fail('Observation row number must refer to a data row.');
      for(const value of Object.values(observation.rawFields)) if(typeof value!=='string') fail('Raw CSV field is not preserved as a string: '+observation.observationId);
      const expectedDate=parseSourceUpdateDate(cfg.updateDateField?observation.rawFields[cfg.updateDateField]:null,cfg);
      if(observation.updateDate!==expectedDate.updateDate||observation.updateDateReason!==expectedDate.updateDateReason) fail('Source update-date provenance mismatch: '+observation.observationId);
      const idField=idSpec.field;const nameField=cfg.sourceNameField;const clubField=cfg.sourceClubField;
      if((observation.sourcePlayerId||null)!==(observation.rawFields[idField]||null)) fail('Source player ID differs from raw field.');
      if((observation.sourceName??null)!==(observation.rawFields[nameField]||null)) fail('Source name differs from raw field.');
      if((observation.sourceClub??null)!==(observation.rawFields[clubField]||null)) fail('Source club differs from raw field.');
      if(observation.identityMatch.status==='stable_external_id'){
        const namespace=idSpec.externalIdNamespace;const externalId=normalizeExternalId(observation.sourcePlayerId);
        const owners=externalOwners.get(namespace+'\u0000'+externalId)||[];
        if(observation.identityMatch.keyType!==namespace||observation.identityMatch.confidence!=='high'||externalId===''||owners.length!==1||owners[0]!==record.canonicalPlayerId||normalizeExternalId(entity.externalIds?.[namespace])!==externalId) fail('Stable source ID does not uniquely belong to canonical entity '+record.canonicalPlayerId+': '+observation.observationId);
      }
      const rawOverall=cfg.overallField&&observation.rawFields[cfg.overallField]!==''?observation.rawFields[cfg.overallField]:null;
      const rawPotential=cfg.potentialField&&observation.rawFields[cfg.potentialField]!==''?observation.rawFields[cfg.potentialField]:null;
      if(observation.rawOverall!==rawOverall||observation.rawPotential!==rawPotential) fail('Raw overall/potential differs from source fields.');
      const positions=parseSourcePositions(observation.rawFields,observation.sourceId,context.positionMappings);
      const ratings=parseObservedPositionRatings(observation.rawFields,observation.sourceId,context.positionMappings);
      if(!same(observation.sourcePositions,positions.sourcePositions)||!same(observation.rosterPosition,positions.rosterPosition)||!same(observation.observedPositionRatings,ratings)) fail('Source-native position values do not round-trip: '+observation.observationId);
    }
    if(!same(Object.keys(record.canonical.attributes).sort(),[...context.fieldMappings.canonicalAttributes].sort())) fail('Canonical attribute vocabulary mismatch: '+record.playerSeasonId);
    if(record.canonical.mappingVersion!==context.fieldMappings.version) fail('Canonical mapping version mismatch: '+record.playerSeasonId);
    const expectedNatural=primary?.sourcePositions.filter(position=>position.positionKind==='natural')||[];
    if(!same(record.positionModel.naturalPositions,expectedNatural)||!same(record.positionModel.rosterPosition,primary?.rosterPosition||null)) fail('Separate natural/roster position context changed: '+record.playerSeasonId);
    const selectedRule=primary?context.fieldMappings.rules.find(rule=>rule.sourceId===primary.sourceId):null;
    let observedAttributeCount=0;
    for(const name of context.fieldMappings.canonicalAttributes){
      const sourceField=selectedRule?.fields?.[name]||null;const raw=sourceField?primary?.rawFields[sourceField]:null;
      const expectedCell=expectedCanonicalCell(raw,sourceField,primary,context.fieldMappings.version,'attribute');
      assertCanonicalCell(record.canonical.attributes[name],expectedCell,record.playerSeasonId+' '+name);
      if(expectedCell.value!==null) observedAttributeCount+=1;
    }
    const sourceConfig=primary?context.sourceConfigs.sources[primary.sourceId]:null;
    const overallField=sourceConfig?.overallField||null;const potentialField=sourceConfig?.potentialField||null;
    assertCanonicalCell(record.canonical.overall,expectedCanonicalCell(primary?.rawOverall,overallField,primary,context.fieldMappings.version,'overall'),record.playerSeasonId+' overall');
    assertCanonicalCell(record.canonical.potential,expectedCanonicalCell(primary?.rawPotential,potentialField,primary,context.fieldMappings.version,'potential',sourceConfig?.potentialFieldReason||'source does not expose a potential field'),record.playerSeasonId+' potential');
    const expectedAvailability=!primary?'unavailable':observedAttributeCount?'available':'partial';
    if(record.availability!==expectedAvailability) fail('Availability does not match selected detailed-attribute coverage: '+record.playerSeasonId);
    const expectedUnavailableReason=primary?null:'No unique stable external-ID source observation in the configured edition window.';
    if(record.unavailableReason!==expectedUnavailableReason) fail('Unavailable reason does not match snapshot state: '+record.playerSeasonId);
    if(record.derived.status!=='not_implemented'||record.derived.positionRatings.length) fail('Unapproved derived position ratings are present.');
    if(record.legacy.isTrainingTruth!==false||record.legacy.originStatus!=='unknown_source_lineage') fail('Legacy runtime layer is mislabeled as truth.');
    if(record.positionModel.formationSlots.length||record.positionModel.tacticalRoles.length||record.positionModel.tactics.length) fail('This foundation must not add formation or tactical assignments.');
  }
  if(seenRecords.size!==expectedIds.size) fail('Some expected PlayerSeason IDs are missing.');
  return {records:seenRecords.size,observations:data.records.reduce((count,record)=>count+record.observations.length,0),selected:data.records.filter(record=>record.snapshotSelection.selectionStatus==='selected').length};
}

export function verifyRejectionCases(data,context){
  const expectReject=(label,mutate,base=data)=>{const copy=structuredClone(base);mutate(copy);try{validateData(copy,context);}catch{return;}fail('Invalid case was accepted: '+label);};
  const expectAccept=(label,candidate)=>{try{validateData(candidate,context);}catch(error){fail('Valid mutation fixture failed ('+label+'): '+error.message);}};
  expectReject('duplicate PlayerSeason ID',copy=>copy.records.push(structuredClone(copy.records[0])));
  expectReject('dangling canonical identity',copy=>{copy.records[0].canonicalPlayerId='missing-entity';});
  expectReject('out-of-range canonical value',copy=>{const key=Object.keys(copy.records[0].canonical.attributes)[0];copy.records[0].canonical.attributes[key].value=100;});
  expectReject('membership drift',copy=>{copy.records[0].membershipClub='wrong club';});
  expectReject('missing required mapping version',copy=>{delete copy.mappingVersions.source;});
  expectReject('wrong declared JSON type',copy=>{copy.records='not-an-array';});
  expectReject('wrong declared enum',copy=>{copy.records[0].availability='unknown';});
  expectReject('wrong declared constant',copy=>{copy.schemaVersion='player-season-abilities-v1.0.0';});
  expectReject('duplicate observation ID within one PlayerSeason',copy=>{const record=copy.records.find(item=>item.observations.length>1);record.observations[1].observationId=record.observations[0].observationId;});
  const stableRecord=data.records.find(record=>record.observations.some(item=>item.identityMatch.status==='stable_external_id'));
  const stableObservation=stableRecord.observations.find(item=>item.identityMatch.status==='stable_external_id');
  const namespace=context.sourceConfigs.idFields[stableObservation.sourceId].externalIdNamespace;
  const otherEntity=context.entities.find(item=>item.id!==stableRecord.canonicalPlayerId&&normalizeExternalId(item.externalIds?.[namespace])!==''&&normalizeExternalId(item.externalIds?.[namespace])!==normalizeExternalId(stableObservation.sourcePlayerId));
  if(!otherEntity) fail('Stable external-ID ownership fixture could not find another entity ID.');
  const reassignedId=String(otherEntity.externalIds[namespace]);const reassignedField=context.sourceConfigs.idFields[stableObservation.sourceId].field;
  expectReject('stable source ID reassigned to another canonical entity',copy=>{const record=copy.records.find(item=>item.playerSeasonId===stableRecord.playerSeasonId);const observation=record.observations.find(item=>item.observationId===stableObservation.observationId);observation.sourcePlayerId=reassignedId;observation.rawFields[reassignedField]=reassignedId;});
  expectReject('availability inconsistent with selected observations',copy=>{const record=copy.records.find(item=>item.snapshotSelection.selectionStatus==='selected');record.availability='unavailable';});

  function chooseMappedCell(candidate){
    for(const record of candidate.records){
      if(record.snapshotSelection.selectionStatus!=='selected') continue;
      const observation=record.observations.find(item=>item.observationId===record.snapshotSelection.primaryObservationId);
      const rule=context.fieldMappings.rules.find(item=>item.sourceId===observation.sourceId);
      const names=context.fieldMappings.canonicalAttributes.filter(name=>rule?.fields?.[name]&&record.canonical.attributes[name].value!==null);
      if(names.length>1) return {record,observation,name:names[0],field:rule.fields[names[0]]};
    }
    fail('Canonical status fixture could not find a selected record with two observed mapped attributes.');
  }
  const missingBase=structuredClone(data);const missing=chooseMappedCell(missingBase);missing.observation.rawFields[missing.field]='';missing.record.canonical.attributes[missing.name]=expectedCanonicalCell('',missing.field,missing.observation,context.fieldMappings.version,'attribute');expectAccept('consistent source-missing cell',missingBase);
  const missingMutation=(copy,change)=>{const record=copy.records.find(item=>item.playerSeasonId===missing.record.playerSeasonId);change(record.canonical.attributes[missing.name]);};
  expectReject('missing-cell status must reflect raw parse',copy=>missingMutation(copy,cell=>{cell.status='invalid';}),missingBase);
  expectReject('missing-cell rawString must reflect raw parse',copy=>missingMutation(copy,cell=>{cell.rawString='tampered';}),missingBase);
  expectReject('missing-cell missingReason must reflect raw parse',copy=>missingMutation(copy,cell=>{cell.missingReason='forged';}),missingBase);
  expectReject('canonical sourceField provenance must match mapping',copy=>missingMutation(copy,cell=>{cell.sourceField='other-field';}),missingBase);
  expectReject('canonical observation provenance must match snapshot',copy=>missingMutation(copy,cell=>{cell.observationId='other-observation';}),missingBase);
  expectReject('canonical mapping version must match config',copy=>missingMutation(copy,cell=>{cell.mappingVersion='0.0.0';}),missingBase);

  const invalidBase=structuredClone(data);const invalid=chooseMappedCell(invalidBase);invalid.observation.rawFields[invalid.field]='100';invalid.record.canonical.attributes[invalid.name]=expectedCanonicalCell('100',invalid.field,invalid.observation,context.fieldMappings.version,'attribute');expectAccept('consistent out-of-range source cell',invalidBase);
  const invalidMutation=(copy,change)=>{const record=copy.records.find(item=>item.playerSeasonId===invalid.record.playerSeasonId);change(record.canonical.attributes[invalid.name]);};
  expectReject('invalid-cell status must preserve invalid parse',copy=>invalidMutation(copy,cell=>{cell.status='missing';}),invalidBase);
  expectReject('invalid-cell rawString must preserve source value',copy=>invalidMutation(copy,cell=>{cell.rawString='99';}),invalidBase);
  expectReject('invalid-cell missingReason must preserve parse reason',copy=>invalidMutation(copy,cell=>{cell.missingReason='source value missing';}),invalidBase);
  return 20;
}

export function verifySourceDateFixtures(){
  const config={updateDateField:'fifa_update_date',updateDateFieldMissingReason:'Raw date retained but no valid date observed.'};
  const leap=parseSourceUpdateDate('2020-02-29',config);
  const blank=parseSourceUpdateDate('',config);
  const invalid=parseSourceUpdateDate('2020-02-30',config);
  const absent=parseSourceUpdateDate(null,{updateDate:null,updateDateReason:'No source date field.'});
  if(leap.updateDate!=='2020-02-29'||leap.updateDateReason!=='Observed as-is from source field fifa_update_date.') throw new Error('Valid source update-date fixture failed.');
  if(blank.updateDate!==null||blank.updateDateReason!=='Raw date retained but no valid date observed.') throw new Error('Blank source update-date fixture failed.');
  if(invalid.updateDate!==null||invalid.updateDateReason!=='Raw date retained but no valid date observed.') throw new Error('Invalid calendar-date fixture failed.');
  if(absent.updateDate!==null||absent.updateDateReason!=='No source date field.') throw new Error('Unavailable source update-date fixture failed.');
  return 4;
}

export function runFocusedFixtures(context){return {snapshotFixtures:verifySnapshotFixtures(context.snapshotPolicy),positionFixtures:verifyPositionFixtures(context.positionMappings),sourceDateFixtures:verifySourceDateFixtures()};}

#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyManifestInputs, scanSources, hashFile } from './source-adapters.mjs';
import { buildPlayerSeasonRecord } from './record-builder.mjs';
import { buildCoverage, buildConflicts, buildUnresolved, buildMigration, buildPsv2005Case } from './reports.mjs';
import { parseStrictJson } from './strict-json.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const readJson=async path=>parseStrictJson(await readFile(join(ROOT,path),'utf8'),path);
const writeJson=async(path,value)=>{const absolute=join(ROOT,path);await mkdir(dirname(absolute),{recursive:true});await writeFile(absolute,JSON.stringify(value,null,2)+'\n','utf8');};
const expected={teamSeasons:62,playerSeasons:554,entities:418};

async function main(){
  const identity=await readJson('data/entities/players.json');
  const seasonPool=await readJson('data/manual/season-pool.json');
  const teamModule=await import(pathToFileURL(join(ROOT,'public/data/team-seasons.js')).href);
  const teamSeasons=teamModule.TEAM_SEASONS;
  if(!Array.isArray(teamSeasons)) throw new Error('TEAM_SEASONS export is unavailable.');
  const entityById=new Map(identity.entities.map(e=>[e.id,e]));
  const playerSeasonMap=identity.playerSeasonMap;
  if(teamSeasons.length!==expected.teamSeasons||identity.entities.length!==expected.entities||Object.keys(playerSeasonMap).length!==expected.playerSeasons) throw new Error('Current identity/roster counts differ from the authorized baseline: '+JSON.stringify({teamSeasons:teamSeasons.length,entities:identity.entities.length,playerSeasons:Object.keys(playerSeasonMap).length}));
  if(seasonPool.length!==teamSeasons.length) throw new Error('Season pool and runtime TeamSeason counts disagree.');
  const poolIds=new Set(seasonPool.map(x=>x.id)); const seen=new Set(); const targets=[];
  for(const ts of teamSeasons){
    if(!poolIds.has(ts.id)) throw new Error('TeamSeason is absent from season pool: '+ts.id);
    for(const player of ts.players){
      const playerSeasonId=player.id; const canonicalPlayerId=playerSeasonMap[playerSeasonId];
      if(!canonicalPlayerId||!entityById.has(canonicalPlayerId)) throw new Error('Missing or dangling playerSeasonMap identity: '+playerSeasonId);
      if(seen.has(playerSeasonId)) throw new Error('Duplicate runtime PlayerSeason ID: '+playerSeasonId);
      seen.add(playerSeasonId);
      targets.push({playerSeasonId,canonicalPlayerId,teamSeasonId:ts.id,seasonYear:Number(ts.year),membershipClub:ts.club,identityStatus:entityById.get(canonicalPlayerId).identityStatus||'unknown',legacy:{overall:player.overall,attack:player.attack,creation:player.creation,defense:player.defense,physical:player.physical,goalkeeping:player.goalkeeping}});
    }
  }
  if(targets.length!==expected.playerSeasons) throw new Error('Runtime roster PlayerSeason count is '+targets.length+', expected 554.');
  for(const key of Object.keys(playerSeasonMap)) if(!seen.has(key)) throw new Error('Identity map contains PlayerSeason absent from runtime roster: '+key);
  const sourceConfig=await readJson('data/abilities/v2/sources.json');
  const fieldMappings=await readJson('data/abilities/v2/field-mappings.json');
  const positionMappings=await readJson('data/abilities/v2/position-mappings.json');
  const snapshotPolicy=await readJson('data/abilities/v2/snapshot-policy.json');
  const overrides=await readJson('data/abilities/v2/overrides.json');
  const schema=await readJson('data/abilities/v2/schema.json');
  const configs={sources:sourceConfig,fieldMappings,positionMappings,snapshotPolicy,overrides};
  const inputs=await verifyManifestInputs(ROOT,sourceConfig.manifestPath,'research/cache/fifa-rating-audit/player-ability-v2-acquisition-manifest.json');
  const scan=await scanSources(ROOT,sourceConfig,inputs,identity.entities,targets,positionMappings,snapshotPolicy);
  const records=targets.map(target=>buildPlayerSeasonRecord(target,scan.observations.get(target.playerSeasonId)||[],configs)).sort((a,b)=>a.playerSeasonId.localeCompare(b.playerSeasonId));
  const identityHash=await hashFile(join(ROOT,'data/entities/players.json'));
  const runtimeHash=await hashFile(join(ROOT,'public/data/team-seasons.js'));
  const poolHash=await hashFile(join(ROOT,'data/manual/season-pool.json'));
  const data={schemaVersion:schema.properties.schemaVersion.const,mappingVersions:{source:sourceConfig.version,field:fieldMappings.version,position:positionMappings.version,snapshot:snapshotPolicy.version,override:overrides.version},inputs:{sourceManifestPath:sourceConfig.manifestPath,sourceManifestSha256:inputs.manifestHash,identityIndexPath:'data/entities/players.json',identityIndexSha256:identityHash.sha256,teamSeasonPath:'public/data/team-seasons.js',teamSeasonSha256:runtimeHash.sha256,seasonPoolPath:'data/manual/season-pool.json',seasonPoolSha256:poolHash.sha256,sourceFileCount:inputs.manifest.source_files.length,teamSeasonCount:teamSeasons.length,playerSeasonCount:targets.length,canonicalEntityCount:entityById.size},records};
  const coverage=buildCoverage(records,scan.lineage,fieldMappings.canonicalAttributes);
  const conflicts=buildConflicts(records);
  const unresolved=buildUnresolved(records,scan.lineage,scan.externalIdDuplicates);
  const migration=buildMigration(records);
  const psv=await buildPsv2005Case(records,join(ROOT,'research/fifa-rating-audit/outputs/psv-2005-case.csv'));
  const sourceLineage={sourceManifestPath:sourceConfig.manifestPath,sourceManifestSha256:inputs.manifestHash,manifestBaseline:inputs.manifest.baseline||null,sourceFiles:inputs.manifest.source_files.map(s=>({cachePath:s.cache_path,url:s.url,bytes:s.bytes,sha256:s.sha256})).sort((a,b)=>a.cachePath.localeCompare(b.cachePath)),extractedMembers:inputs.acquisition.extractedMembers.map(x=>({path:x.path,member:x.member,bytes:x.bytes,sha256:x.sha256,archiveSha256:x.archiveSha256})).sort((a,b)=>a.path.localeCompare(b.path)),scans:scan.lineage.sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.sourcePath.localeCompare(b.sourcePath)),limits:['The manifest pins downloaded bytes; it does not resolve underlying FIFA/SoFIFA rights.','lbenz upstream revision is mutable; exact retrieved payload is hash-pinned.','Source edition is not an update date; updateDate remains null with a reason.','Name matches are retained only as low-confidence candidates and never selected.']};
  await writeJson('data/abilities/player-season-abilities-v2.json',data);
  await writeJson('data/reports/ability-v2/coverage.json',coverage);
  await writeJson('data/reports/ability-v2/source-lineage.json',sourceLineage);
  await writeJson('data/reports/ability-v2/source-conflicts.json',{count:conflicts.length,conflicts});
  await writeJson('data/reports/ability-v2/unresolved.json',unresolved);
  await writeJson('data/reports/ability-v2/psv-2005-case.json',psv);
  await writeJson('data/reports/ability-v2/legacy-migration.json',migration);
  console.log(JSON.stringify({status:'built',records:records.length,selected:coverage.reliableSourceSnapshots.selected,unavailable:coverage.availability.unavailable,conflicts:conflicts.length,psvPlayers:psv.players.length,sourceManifestSha256:inputs.manifestHash}));
}
main().catch(error=>{console.error('[ability-v2-build] '+error.message);process.exitCode=1;});

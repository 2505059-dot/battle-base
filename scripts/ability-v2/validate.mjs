#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashFile, verifyManifestInputs } from './source-adapters.mjs';
import { validateData, verifyRejectionCases, runFocusedFixtures } from './validation-core.mjs';
import { parseStrictJson, verifyStrictJsonFixtures } from './strict-json.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const readJson=async path=>parseStrictJson(await readFile(join(ROOT,path),'utf8'),path);
async function main(){
  const data=await readJson('data/abilities/player-season-abilities-v2.json');
  const identity=await readJson('data/entities/players.json');
  const sourceConfigs=await readJson('data/abilities/v2/sources.json');
  const fieldMappings=await readJson('data/abilities/v2/field-mappings.json');
  const positionMappings=await readJson('data/abilities/v2/position-mappings.json');
  const snapshotPolicy=await readJson('data/abilities/v2/snapshot-policy.json');
  const schema=await readJson('data/abilities/v2/schema.json');
  const overrides=await readJson('data/abilities/v2/overrides.json');
  const team=await import(pathToFileURL(join(ROOT,'public/data/team-seasons.js')).href);
  const manifestInputs=await verifyManifestInputs(ROOT,sourceConfigs.manifestPath,'research/cache/fifa-rating-audit/player-ability-v2-acquisition-manifest.json');
  const identityHash=await hashFile(join(ROOT,'data/entities/players.json'));
  const runtimeHash=await hashFile(join(ROOT,'public/data/team-seasons.js'));
  const poolHash=await hashFile(join(ROOT,'data/manual/season-pool.json'));
  if(data.inputs.sourceManifestSha256!==manifestInputs.manifestHash||data.inputs.identityIndexSha256!==identityHash.sha256||data.inputs.teamSeasonSha256!==runtimeHash.sha256||data.inputs.seasonPoolSha256!==poolHash.sha256) throw new Error('Generated dataset is stale relative to an identity, roster, or manifest input.');
  const expectedRecords=new Map();
  for(const ts of team.TEAM_SEASONS) for(const player of ts.players){const canonicalPlayerId=identity.playerSeasonMap[player.id];const entity=identity.entities.find(x=>x.id===canonicalPlayerId);if(!entity)throw new Error('Dangling current identity mapping: '+player.id);expectedRecords.set(player.id,{canonicalPlayerId,teamSeasonId:ts.id,membershipClub:ts.club,identityStatus:entity.identityStatus||'unknown',seasonYear:Number(ts.year)});}
  if(team.TEAM_SEASONS.length!==62||expectedRecords.size!==554||identity.entities.length!==418) throw new Error('Current baseline counts differ from 62/554/418.');
  const context={expectedRecords,entities:identity.entities,manifest:manifestInputs.manifest,acquisition:manifestInputs.acquisition,sourceConfigs,fieldMappings,positionMappings,snapshotPolicy,overrides,schema,schemaVersion:schema.properties.schemaVersion.const};
  const strictJsonFixtures=verifyStrictJsonFixtures();
  const result=validateData(data,context); const rejectionCases=verifyRejectionCases(data,context); const fixtures=runFocusedFixtures(context);
  const coverage=await readJson('data/reports/ability-v2/coverage.json');
  const lineage=await readJson('data/reports/ability-v2/source-lineage.json');
  const psv=await readJson('data/reports/ability-v2/psv-2005-case.json');
  if(coverage.recordPlaceholders.count!==554||coverage.recordPlaceholders.expected!==554) throw new Error('Coverage report does not account for 554 placeholders.');
  if(lineage.sourceManifestSha256!==data.inputs.sourceManifestSha256) throw new Error('Lineage report manifest hash differs from dataset.');
  if(psv.players.length!==9||psv.farfanCheck.selectedRawOverall!=='69'||psv.farfanCheck.rawOverallByEdition['2005'][0]!=='48'||psv.farfanCheck.rawOverallByEdition['2007'][0]!=='73') throw new Error('PSV 2005/Farfán acceptance report failed.');
  console.log(JSON.stringify({status:'passed',...result,rejectionCases,strictJsonFixtures,fixtures,manifestSourcesVerified:manifestInputs.manifest.source_files.length,psvPlayers:psv.players.length,farfan:psv.farfanCheck.rawOverallByEdition}));
}
main().catch(error=>{console.error('[ability-v2-validate] '+error.message);process.exitCode=1;});

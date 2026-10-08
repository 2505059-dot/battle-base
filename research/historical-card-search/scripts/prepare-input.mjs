import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUniqueSearchEntityKeys, searchEntityKeyFor } from './search-entity-key.mjs';
import { RAW_TEAM_SEASONS } from '../../../public/data/team-seasons.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TARGET_TEAM_IDS = new Set([
  'manchester-united-1999', 'arsenal-2004', 'real-madrid-2002',
  'valencia-2004', 'deportivo-la-coruna-2000', 'juventus-2003',
  'roma-2001', 'lazio-2000', 'parma-1999', 'bayern-munich-2001',
  'porto-2004',
]);

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}
function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const trimmed = String(value ?? '').trim();
    const key = normalize(trimmed);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value) => String(value).trim());
}

const [entitiesDoc, manualAliases, v2Audit] = await Promise.all([
  json('data/entities/players.json'),
  json('data/manual/player-aliases.json'),
  json('data/reports/ability-v2/unresolved.json'),
]);
const teams = RAW_TEAM_SEASONS.filter((team) => TARGET_TEAM_IDS.has(team.id));
if (teams.length !== TARGET_TEAM_IDS.size) throw new Error(`Expected ${TARGET_TEAM_IDS.size} source teams, found ${teams.length}`);

const entityBySeason = new Map();
for (const entity of entitiesDoc.entities) {
  for (const playerSeasonId of entity.playerSeasonIds ?? []) entityBySeason.set(playerSeasonId, entity);
}
const targetRows = teams.flatMap((team) => team.players.map((player, index) => {
  const playerSeasonId = `${team.id}-${index}`;
  return {
    playerSeasonId, teamSeasonId: team.id, league: team.league, club: team.club,
    year: team.year, rosterName: player.name, positions: player.positions,
    canonicalPlayerId: entityBySeason.get(playerSeasonId)?.id ?? null,
  };
}));
if (targetRows.length !== 99) throw new Error(`Expected 99 PlayerSeason rows, found ${targetRows.length}`);

const targetIds = new Set(targetRows.map((row) => row.playerSeasonId));
const unavailableIds = new Set((v2Audit.unavailablePlayerSeasons ?? [])
  .filter((row) => targetIds.has(row.playerSeasonId)).map((row) => row.playerSeasonId));
const playerMap = new Map();
for (const row of targetRows) {
  const entity = entityBySeason.get(row.playerSeasonId);
  const key = entity?.id ?? `name:${normalize(row.rosterName)}`;
  let player = playerMap.get(key);
  if (!player) {
    player = {
      playerId: entity?.id ?? null,
      identitySource: entity ? 'data/entities/players.json' : 'unresolved-roster-name',
      canonicalName: entity?.canonicalName ?? row.rosterName,
      rosterNames: [],
      searchTerms: [],
      existingExternalIds: entity?.externalIds ?? {},
      playerSeasonIds: [],
      targetTeamSeasons: [],
      identityConfidence: 'unverified',
    };
    playerMap.set(key, player);
  }
  player.rosterNames.push(row.rosterName);
  player.searchTerms.push(row.rosterName, ...(manualAliases[row.rosterName] ?? []),
    entity?.canonicalName, ...Object.values(entity?.localizedNames ?? {}),
    ...Object.values(entity?.aliases ?? {}).flatMap((values) => Array.isArray(values) ? values : [values]));
  player.playerSeasonIds.push(row.playerSeasonId);
  player.targetTeamSeasons.push({
    playerSeasonId: row.playerSeasonId, teamSeasonId: row.teamSeasonId,
    league: row.league, club: row.club, year: row.year, positions: row.positions,
    abilityV2BaselineUnavailable: unavailableIds.has(row.playerSeasonId),
  });
}
const players = [...playerMap.values()].map((player) => ({
  ...player,
  rosterNames: unique(player.rosterNames),
  searchTerms: unique(player.searchTerms),
  playerSeasonIds: unique(player.playerSeasonIds),
  targetTeamSeasons: player.targetTeamSeasons.sort((a, b) => a.year - b.year || a.teamSeasonId.localeCompare(b.teamSeasonId)),
})).sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
for (const player of players) player.searchEntityKey = searchEntityKeyFor(player);
assertUniqueSearchEntityKeys(players);

function auditCount(key) {
  return (v2Audit[key] ?? []).filter((row) => targetIds.has(row.playerSeasonId ?? row.id)).length;
}
const baseline = {
  schemaVersion: 'historical-card-search-inputs/1',
  sourcePaths: ['public/data/team-seasons.js', 'data/entities/players.json', 'data/manual/player-aliases.json', 'data/reports/ability-v2/unresolved.json'],
  targetTeamSeasonIds: [...TARGET_TEAM_IDS],
  counts: {
    teamSeasons: teams.length, playerSeasons: targetRows.length,
    distinctRosterNames: new Set(targetRows.map((row) => normalize(row.rosterName))).size,
    uniqueSearchEntities: players.length,
    uniqueSearchEntityKeys: new Set(players.map((player) => player.searchEntityKey)).size,
    abilityV2UnavailablePlayerSeasons: unavailableIds.size,
    abilityV2NameOrAmbiguousFindings: auditCount('nameOrAmbiguousCandidates'),
    abilityV2PositionFindings: auditCount('positions'),
  },
  auditInterpretation: 'Counts come from the checked-in ability-v2 unresolved report; they are not card-search results or identity confirmations.',
};

async function write(relativePath, value) {
  const path = resolve(ROOT, 'research/historical-card-search', relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
await Promise.all([
  write('inputs/players.json', { schemaVersion: 'historical-card-search-players/1', players }),
  write('inputs/player-seasons.json', {
    schemaVersion: 'historical-card-search-player-seasons/1',
    playerSeasons: targetRows.map((row) => ({
      ...row,
      abilityV2BaselineUnavailable: unavailableIds.has(row.playerSeasonId),
      abilityV2NameOrAmbiguousFindings: (v2Audit.nameOrAmbiguousCandidates ?? [])
        .filter((finding) => (finding.playerSeasonId ?? finding.id) === row.playerSeasonId).length,
      abilityV2PositionFindings: (v2Audit.positions ?? [])
        .filter((finding) => (finding.playerSeasonId ?? finding.id) === row.playerSeasonId).length,
    })),
  }),
  write('inputs/source-summary.json', baseline),
]);
console.log(JSON.stringify(baseline, null, 2));

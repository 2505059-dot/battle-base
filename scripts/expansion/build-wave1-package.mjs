#!/usr/bin/env node
// Builds only data/expansion/wave1. Requires the ignored local CSV cache under data/raw/fifa/expansion-wave1.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../lib/normalize.mjs';
import { buildNationalAttributeCandidates, validateNationalAttributeCandidates } from './build-national-attribute-candidates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'data/expansion/wave1');
const CACHE = path.join(ROOT, 'data/raw/fifa/expansion-wave1');
const eventSeedPath = path.join(OUT, 'sources/national-event-rosters.json');
const teams = [
  ['ac-milan-2018',2018,'story-club','club','AC Milan','Serie A','FIFA 18','dataset_fifa_18.csv','AC Milan',47,36,'https://fifaindex.com/teams/47-milan/fifa18','2017/18','r180040 is target; cache r180084 is later supplement'],
  ['manchester-united-2014',2014,'story-club','club','Manchester United','Premier League','FIFA 14','dataset_fifa_14.csv','Manchester United',11,41,'https://fifaindex.com/teams/11-manchester-utd/fifa14','2013/14','cached r140052; target page r140002; update date unconfirmed'],
  ['liverpool-2014',2014,'story-club','club','Liverpool FC','Premier League','FIFA 14','dataset_fifa_14.csv','Liverpool FC',9,41,'https://fifaindex.com/teams/9-liverpool/fifa14','2013/14','r140052 dated 2014-09-19; snapshot still lists Suárez at Liverpool'],
  ['real-madrid-2009',2009,'story-club','club','Real Madrid','La Liga','FIFA 09','dataset_fifa_09.csv','Real Madrid',243,24,'https://fifaindex.com/es-mx/equipos/243-real-madrid-c-f/fifa09','2008/09','FIFAIndex list excludes Cristiano Ronaldo; SoFIFA date evidence is a community squad page'],
  ['arsenal-2019',2019,'story-club','club','Arsenal FC','Premier League','FIFA 19','dataset_fifa_19.csv','Arsenal FC',1,39,'https://fifaindex.com/teams/1-arsenal/fifa19','2018/19','r190075 dated 2019-09-11; late game update'],
  ['porto-2011',2011,'story-club','club','FC Porto','Primeira Liga','FIFA 11','dataset_fifa_11.csv','FC Porto',236,26,'https://fifaindex.com/teams/236-fc-porto/fifa11','2010/11','cache r110002; r110001 date 2010-08-30 is a different revision'],
  ['paris-saint-germain-2018',2018,'club-league','club','Paris Saint-Germain','Ligue 1','FIFA 18','dataset_fifa_18.csv','Paris Saint-Germain',73,41,'https://fifaindex.com/teams/73-paris-saint-germain/fifa18','2017/18','FIFAIndex edition page has no verified patch date'],
  ['lyon-2010',2010,'club-league','club','Olympique Lyonnais','Ligue 1','FIFA 10','dataset_fifa_10.csv','Olympique Lyonnais',66,34,'https://fifaindex.com/teams/66-olympique-lyonnais/fifa10','2009/10','SoFIFA r100002 dated 2010-02-22'],
  ['feyenoord-2017',2017,'club-league','club','Feyenoord','Eredivisie','FIFA 17','dataset_fifa_17.csv','Feyenoord',246,32,'https://fifaindex.com/teams/246-feyenoord/fifa17','2016/17','FIFAIndex edition page has no verified patch date'],
  ['sporting-cp-2017',2017,'club-league','club','Sporting CP','Primeira Liga','FIFA 17','dataset_fifa_17.csv','Sporting CP',237,46,'https://fifaindex.com/teams/237-sporting-cp/fifa17','2016/17','FIFAIndex edition page has no verified patch date'],
  ['benfica-2010',2010,'club-league','club','SL Benfica','Primeira Liga','FIFA 10','dataset_fifa_10.csv','SL Benfica',234,30,'https://fifaindex.com/teams/234-sport-lisboa-benfica/fifa10','2009/10','FIFAIndex edition page has no verified patch date'],
  ['bayer-leverkusen-2011',2011,'club-league','club','Bayer 04 Leverkusen','Bundesliga','FIFA 11','dataset_fifa_11.csv','Bayer 04 Leverkusen',32,24,'https://fifaindex.com/teams/32-bayer-04-leverkusen/fifa11','2010/11','FIFAIndex edition page has no verified patch date'],
  ['spain-2010',2010,'national-team','national-team','Spain','National team','FIFA 10','dataset_fifa_10.csv','Spain',1362,30,'https://fifaindex.com/teams/1362-spain/fifa10','2010 World Cup','event roster is separate from FIFAIndex game roster'],
  ['germany-2014',2014,'national-team','national-team','Germany','National team','FIFA 14','dataset_fifa_14.csv','Germany',1337,30,'https://fifaindex.com/teams/1337-germany/fifa14','2014 World Cup','event roster is separate from FIFAIndex game roster'],
  ['france-2018',2018,'national-team','national-team','France','National team','FIFA 18','dataset_fifa_18.csv','France',1335,33,'https://fifaindex.com/teams/1335-france/fifa18','2018 World Cup','event roster is separate from FIFAIndex game roster'],
  ['russia-2018',2018,'national-team','national-team','Russia','National team','FIFA 18','dataset_fifa_18.csv','Russia',1357,31,'https://fifaindex.com/teams/1357-russia/fifa18','2018 World Cup','event roster is separate from FIFAIndex game roster'],
  ['belgium-2018',2018,'national-team','national-team','Belgium','National team','FIFA 18','dataset_fifa_18.csv','Belgium',1325,30,'https://fifaindex.com/teams/1325-belgium/fifa18','2018 World Cup','event roster is separate from FIFAIndex game roster'],
  ['mexico-2018',2018,'national-team','national-team','Mexico','National team','FIFA 18','dataset_fifa_18.csv','Mexico',1386,36,'https://fifaindex.com/teams/1386-mexico/fifa18','2018 World Cup','submitted list and final roster change are distinct'],
  ['inter-miami-2024',2024,'Americas Wildcard','club','Inter Miami','MLS','EA FC 24','dataset_ea_fc_24.csv','Inter Miami',null,null,null,'2023/24','edition roster candidate; exact target season alignment pending'],
  ['la-galaxy-2019',2019,'Americas Wildcard','club','LA Galaxy','MLS','FIFA 19','dataset_fifa_19.csv','LA Galaxy',null,null,null,'2018/19','edition roster candidate; exact target season alignment pending'],
  ['sao-paulo-2005',2005,'Americas Wildcard','club','São Paulo','Campeonato Brasileiro Série A','FIFA 05','player_stats_2005.csv','São Paulo',null,null,null,'2004/05 ID convention; calendar-year club season needs confirmation','FIFAIndex player dataset; raw rating/attributes may have NA fields'],
  ['santos-2011',2011,'Americas Wildcard','club','Santos','Campeonato Brasileiro Série A','FIFA 11','dataset_fifa_11.csv','Santos',null,null,null,'2010/11','edition roster candidate; exact target season alignment pending'],
  ['river-plate-2018',2018,'Americas Wildcard','club','River Plate','Primera División','FIFA 18','dataset_fifa_18.csv','River Plate',null,null,null,'2017/18','edition roster candidate; exact target season alignment pending'],
  ['kashima-antlers-2016',2016,'World Wildcard','club','Kashima Antlers','J1 League','FIFA 17','dataset_fifa_17.csv','Kashima Antlers',101147,38,'https://fifaindex.com/teams/101147-kashima-antlers/fifa17','2016; FIFA Club World Cup','official source is match-day 23, not registration list'],
  ['guangzhou-rf-2019',2019,'World Wildcard','club','Guangzhou R&F','Chinese Super League','FIFA 19','dataset_fifa_19.csv','Guangzhou R&F',null,null,null,'2018/19','FIFA19 cache has no exact Guangzhou R&F; Guangzhou City is not substituted because the team-name mapping is unverified'],
  ['anzhi-2013',2013,'World Wildcard','club','FC Anzhi Makhachkala','Russian Premier League','FIFA 13','dataset_fifa_13.csv','FC Anzhi Makhachkala',100766,34,'https://fifaindex.com/teams/100766-anzhi-makhachkala/fifa13','2012/13','FIFAIndex page supports Eto’o, Willian, Boussoufa and Zhirkov combination'],
  ['zenit-2015',2015,'World Wildcard','club','Zenit','Russian Premier League','FIFA 15','dataset_fifa_15.csv','Zenit',null,null,null,'2014/15','edition roster candidate; exact source team ID needs capture'],
  ['galatasaray-2013',2013,'World Wildcard','club','Galatasaray SK','Süper Lig','FIFA 13','dataset_fifa_13.csv','Galatasaray SK',null,null,null,'2012/13','edition roster candidate; exact source team ID needs capture'],
  ['al-nassr-2024',2024,'World Wildcard','club','Al Nassr','Saudi Pro League','EA FC 24','dataset_ea_fc_24.csv','Al Nassr',null,null,null,'2023/24','edition roster candidate; exact target season alignment pending']
].map(([id,year,group,kind,team,league,edition,file,sourceClubName,fifaIndexTeamId,fifaIndexRosterCount,fifaIndexPage,reference,notes]) =>
  ({id,year,group,kind,team,league,edition,file,sourceClubName,fifaIndexTeamId,fifaIndexRosterCount,fifaIndexPage,reference,notes}));


const targetRevisionReferences = {
  'real-madrid-2009': { platform: 'SoFIFA', updateId: '090002', referenceDate: '2009-02-22', pageUrl: 'https://sofifa.com/squad/2600297', referenceType: 'community squad page', officialTeamRevisionConfirmed: false, note: 'squad page confirms edition/date context only' },
  'ac-milan-2018': { platform: 'SoFIFA', updateId: '180040', referenceDate: '2018-02-05', pageUrl: 'https://sofifa.com/team/47/milan/180040', officialTeamRevisionConfirmed: true, note: 'target; local cache is later r180084' },
  'manchester-united-2014': { platform: 'SoFIFA', updateId: '140002', referenceDate: null, pageUrl: 'https://sofifa.com/team/11/manchester-united/140002/', officialTeamRevisionConfirmed: true, note: 'page read; update date not firmly established' },
  'liverpool-2014': { platform: 'SoFIFA', updateId: '140052', referenceDate: '2014-09-19', pageUrl: 'https://sofifa.com/team/9/liverpool/140052', officialTeamRevisionConfirmed: true, note: 'snapshot still lists Suárez at Liverpool' },
  'arsenal-2019': { platform: 'SoFIFA', updateId: '190075', referenceDate: '2019-09-11', pageUrl: 'https://sofifa.com/team/1/arsenal/190075', officialTeamRevisionConfirmed: true, note: 'late FIFA19 update' },
  'porto-2011': { platform: 'SoFIFA', updateId: '110001', referenceDate: '2010-08-30', pageUrl: 'https://sofifa.com/team/236/fc-porto/110001/', officialTeamRevisionConfirmed: true, note: 'local cache records r110002, a different revision' },
  'lyon-2010': { platform: 'SoFIFA', updateId: '100002', referenceDate: '2010-02-22', pageUrl: 'https://sofifa.com/team/66/olympique-lyonnais/100002', officialTeamRevisionConfirmed: true }
};
const nationalGameComparisons = {
  'spain-2010': { gameRosterSize:30, officialRosterSize:23, overlap:19, officialNamesAbsentFromGame:['Víctor Valdés','Javi Martínez','Jesús Navas','Pedro Rodríguez'] },
  'germany-2014': { gameRosterSize:30, officialRosterSize:23, overlap:22, officialNamesAbsentFromGame:['Shkodran Mustafi'] },
  'france-2018': { gameRosterSize:33, officialRosterSize:23, overlap:23, gameOnlyCount:10, gameOnlyNamesTranscribed:false },
  'russia-2018': { gameRosterSize:31, officialRosterSize:23, overlap:16, officialNamesAbsentFromGame:['Sergey Ignashevich','Andrey Semenov','Denis Cheryshev','Roman Zobnin','Vladimir Granat','Anton Miranchuk','Artem Dzyuba'] },
  'belgium-2018': { gameRosterSize:30, officialRosterSize:23, overlap:23, gameOnlyCount:7, gameOnlyNamesTranscribed:false },
  'mexico-2018': { gameRosterSize:36, submittedRosterSize:23, submittedRosterOverlap:23, finalRosterSize:23, finalRosterOverlap:22, finalNamesAbsentFromGame:['Rafael Márquez'], gameContainsBothReplacementNames:['Diego Reyes','Erick Gutiérrez'] }
};
const fifaSourceUrl = (file) => file === 'dataset_ea_fc_24.csv'
  ? 'https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/dataset_ea_fc_24.csv'
  : file === 'player_stats_2005.csv'
    ? 'https://raw.githubusercontent.com/lbenz730/fifa_model/master/stats/player_stats_2005.csv'
    : 'https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/' + file;
const sourceType = (t) => t.file === 'player_stats_2005.csv' ? 'fifaIndex' : 'sofifa';
const csvKey = (t) => sourceType(t) === 'fifaIndex' ? 'club' : 'club_name';
const playerIdField = (t) => sourceType(t) === 'fifaIndex' ? 'player_id' : 'sofifa_id';
const nameField = (t) => sourceType(t) === 'fifaIndex' ? 'name' : 'long_name';
const positionField = (t) => sourceType(t) === 'fifaIndex' ? 'preferred_positions' : 'positions';
const overallField = (t) => sourceType(t) === 'fifaIndex' ? 'rating' : 'overall';
const readAt = new Date().toISOString();
const normalizeName = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isMissing = (v) => v === '' || v === 'NA' || v === 'N/A';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/entities/players.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manual/player-aliases.json'), 'utf8'));
const bySourceId = new Map();
const byName = new Map();
function addName(name, id) {
  const key = normalizeName(name);
  if (!key) return;
  if (!byName.has(key)) byName.set(key, new Set());
  byName.get(key).add(id);
}
for (const entity of canonical.entities ?? []) {
  for (const [system, value] of Object.entries(entity.externalIds ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    const key = system + ':' + String(value);
    if (!bySourceId.has(key)) bySourceId.set(key, []);
    bySourceId.get(key).push(entity);
  }
  addName(entity.canonicalName, entity.id);
  for (const value of Object.values(entity.localizedNames ?? {})) addName(value, entity.id);
  for (const values of Object.values(entity.aliases ?? {})) for (const value of values ?? []) addName(value, entity.id);
}
for (const [alias, names] of Object.entries(aliases)) {
  const ids = (Array.isArray(names) ? names : [names]).flatMap((name) => [...(byName.get(normalizeName(name)) ?? [])]);
  const key = normalizeName(alias);
  if (key && ids.length) {
    if (!byName.has(key)) byName.set(key, new Set());
    for (const id of ids) byName.get(key).add(id);
  }
}
function identityFor(system, sourceId, rawName) {
  const matches = sourceId ? bySourceId.get(system + ':' + String(sourceId)) ?? [] : [];
  if (matches.length === 1) return { status: 'confirmed-existing-by-exact-source-id', canonicalPlayerId: matches[0].id, candidates: [] };
  if (matches.length > 1) return { status: 'source-id-collision-needs-review', canonicalPlayerId: null, candidates: matches.map((p) => p.id) };
  const candidates = [...(byName.get(normalizeName(rawName)) ?? [])].sort();
  if (/^(player|unknown|generic)\s*\d*/i.test(String(rawName ?? ''))) {
    return { status: 'possible-placeholder-needs-review', identityStatusNote: 'name-pattern heuristic only; this does not prove that the record is fictional', canonicalPlayerId: null, candidates };
  }
  return { status: candidates.length ? 'name-candidate-unconfirmed' : sourceId ? 'proposed-new-source-player-needs-review' : 'identity-unconfirmed-no-source-id', canonicalPlayerId: null, candidates };
}
function attributeFields(headers, type) {
  if (type === 'sofifa') {
    return headers.filter((h) => /^(overall|pace|shooting|passing|dribbling|defending|physical|crossing|finishing|heading_accuracy|short_passing|volleys|dribbling_stat|curve|fk_accuracy|long_passing|ball_control|acceleration|sprint_speed|agility|reactions|balance|shot_power|jumping|stamina|strength|long_shots|aggression|interceptions|positioning|vision|penalties|composure|defensive_awareness|standing_tackle|sliding_tackle|gk_diving|gk_handling|gk_kicking|gk_positioning|gk_reflexes)$/.test(h));
  }
  const metadata = new Set(['player_id','name','season','year','page_url','headshot_url','club','nationality','height','weight','age','birthdate','loaned_from','preferred_foot','preferred_positions','player_work_rate_off','player_work_rate_def','weak_foot','skill_moves','value','wage','country_kit_number','country_position','club_kit_number','club_position','joined_club','contract_length']);
  return headers.filter((h) => h === 'rating' || !metadata.has(h));
}
function readEventSeed() {
  if (!fs.existsSync(eventSeedPath)) return {};
  return JSON.parse(fs.readFileSync(eventSeedPath, 'utf8'));
}


function build() {
  fs.mkdirSync(path.join(OUT, 'rosters'), { recursive: true });
  const eventSeed = readEventSeed();
  const manifest = [];
  const identityMatches = [];
  const duplicateSummary = [];
  let totalRows = 0, totalAttrPresent = 0, totalAttrSlots = 0, totalAttrMissing = 0, totalExplicitZero = 0;

  for (const t of teams) {
    const cachePath = path.join(CACHE, t.file);
    const bytes = fs.readFileSync(cachePath);
    const rows = parseCsvRecords(bytes.toString('utf8'));
    const key = csvKey(t), type = sourceType(t), pidField = playerIdField(t);
    const rawNameField = nameField(t), posField = positionField(t), ovrField = overallField(t);
    const exactRows = rows.filter((r) => r[key] === t.sourceClubName);
    const attrs = attributeFields(Object.keys(rows[0] ?? {}), type);
    const sourceIds = exactRows.map((r) => r[pidField]).filter(Boolean);
    const duplicates = [...new Set(sourceIds.filter((id, i) => sourceIds.indexOf(id) !== i))];
    const updateIds = type === 'sofifa'
      ? [...new Set(exactRows.map((r) => (r.player_url ?? '').split('/').filter(Boolean).at(-1)).filter(Boolean))]
      : [...new Set(exactRows.map((r) => r.season).filter(Boolean))];
    const knownDate = t.id === 'ac-milan-2018' && updateIds.includes('180084') ? '2018-09-12'
      : t.id === 'liverpool-2014' && updateIds.includes('140052') ? '2014-09-19'
      : t.id === 'arsenal-2019' && updateIds.includes('190075') ? '2019-09-11'
      : t.id === 'lyon-2010' && updateIds.includes('100002') ? '2010-02-22'
      : null;
    const dateEvidence = knownDate ? 'directly-read SoFIFA revision page cited in source audit'
      : t.id === 'real-madrid-2009' ? '2009-02-22 belongs to a user-created SoFIFA squad page, not a verified official team revision'
      : 'unknown; never inferred from edition or adjacent revision';
    const targetRevision = targetRevisionReferences[t.id] ?? null;
    const targetUpdatePresent = targetRevision ? updateIds.includes(targetRevision.updateId) : false;
    const versionConsistencyStatus = t.id === 'ac-milan-2018' && exactRows.length ? 'later supplemental snapshot r180084 does not match target r180040' : t.id === 'arsenal-2019' && knownDate === '2019-09-11' ? 'late FIFA19 update; season alignment needs review' : t.id === 'real-madrid-2009' ? 'FIFAIndex FIFA09 list excludes Cristiano Ronaldo; SoFIFA date is a community squad page, not a confirmed official team revision' : t.id === 'liverpool-2014' && knownDate === '2014-09-19' ? '2014-09-19 snapshot still lists Luis Suárez; story-season content needs review' : t.id === 'lyon-2010' ? 'SoFIFA target r100002 dated 2010-02-22 matches observed cached revision r100002' : t.id === 'porto-2011' ? 'SoFIFA target r110001 dated 2010-08-30 differs from cached r110002; cache is supplemental' : t.id === 'manchester-united-2014' ? 'SoFIFA target r140002 (date unconfirmed) differs from cached r140052; cached revision is supplemental' : t.fifaIndexPage ? 'FIFAIndex edition page identifies game version but does not disclose patch/update date' : type === 'fifaIndex' ? 'FIFAIndex-derived player dataset; no team-edition page or update date captured' : !targetRevision ? 'edition only; exact target update not audited' : targetUpdatePresent ? 'target update present in cache; content/story alignment still needs review' : 'target update not present in cache; cached edition rows are supplemental';
    const sourceCoverageStatus = exactRows.length ? 'local-cache rows captured; does not establish complete authoritative squad coverage' : 'no exact team-name match in local cache; source data absence is not established';
    const auditStatus = t.id === 'guangzhou-rf-2019' ? 'incomplete source-team mapping; Guangzhou R&F alias/page not verified' : t.kind === 'national-team' ? 'event roster source audited; game-edition comparison partial because game names are not transcribed' : t.fifaIndexPage ? 'edition-page metadata reviewed; mirror row coverage audited' : exactRows.length ? 'mirror rows extracted; direct source-page/version audit incomplete' : 'source-page/team mapping audit incomplete';
    const records = exactRows.map((raw) => {
      const sourcePlayerId = raw[pidField] || null;
      const rawName = raw[rawNameField] || raw.short_name || null;
      const idSystem = type === 'sofifa' ? 'sofifa' : 'fifaIndex';
      const identity = identityFor(idSystem, sourcePlayerId, rawName);
      const missingFields = Object.entries(raw).filter((entry) => isMissing(entry[1])).map((entry) => entry[0]);
      identityMatches.push({
        candidateTeamSeason: t.id, recordKind: 'main-game', sourceSystem: idSystem, sourcePlayerId, rawName,
        identityStatus: identity.status, identityStatusNote: identity.identityStatusNote ?? null, canonicalPlayerId: identity.canonicalPlayerId,
        candidateCanonicalIds: identity.candidates,
        evidence: identity.status === 'confirmed-existing-by-exact-source-id' ? 'exact ' + idSystem + ' ID match'
          : 'name and aliases are review clues only; no automatic identity confirmation',
        membershipEvidence: 'source row ' + key + '=' + raw[key] + ' in ' + t.edition + ' edition dataset',
        sourcePlayerPageUrl: raw.player_url ?? raw.page_url ?? null
      });
      return {
        recordKind: 'main-game', sourcePlayerId, rawName, rawShortName: raw.short_name ?? null,
        gameVersion: t.edition, sourceUpdateId: type === 'sofifa' ? (raw.player_url ?? '').split('/').filter(Boolean).at(-1) : raw.season ?? raw.year,
        sourceDatasetUrl: fifaSourceUrl(t.file), packageProcessedAt: readAt,
        sourceClubOrCountry: raw[key], rawPosition: raw[posField] ?? null,
        rawOverall: raw[ovrField] ?? null, missingFields,
        identityStatus: identity.status, canonicalPlayerId: identity.canonicalPlayerId,
        candidateCanonicalIds: identity.candidates,
        sourcePlayerPageUrl: raw.player_url ?? raw.page_url ?? null,
        rawSourceFields: raw
      };
    });
    const attrValues = exactRows.flatMap((r) => attrs.map((field) => r[field] ?? ''));
    const present = attrValues.filter((v) => !isMissing(v)).length;
    const missing = attrValues.length - present;
    const zeros = attrValues.filter((v) => v === '0').length;
    totalRows += exactRows.length;
    totalAttrPresent += present;
    totalAttrSlots += attrValues.length;
    totalAttrMissing += missing;
    totalExplicitZero += zeros;
    duplicateSummary.push({ candidateId: t.id, duplicateSourceIds: duplicates });

    const sourceMetadata = {
      sourcePlatform: type === 'sofifa' ? 'SoFIFA' : 'FIFAIndex',
      datasetRepository: type === 'sofifa' ? 'mzafram2001/ea-fc (MIT dataset)' : 'lbenz730/fifa_model (FIFAIndex-derived dataset)',
      datasetUrl: fifaSourceUrl(t.file),
      datasetLicenseAsDocumented: type === 'sofifa' ? 'MIT' : 'public academic repository; no SPDX license recorded in data/SOURCES.md',
      sourceTeamId: t.fifaIndexTeamId ?? null, sourceTeamIdSystem: t.fifaIndexTeamId ? 'FIFAIndex' : null,
      fifaIndexReference: t.fifaIndexTeamId ? {
        teamId: t.fifaIndexTeamId, edition: t.edition, pageUrl: t.fifaIndexPage,
        listedPlayerCount: t.fifaIndexRosterCount, pageReadInSourceAudit: true, revisionDate: null, revisionDateStatus: 'not disclosed on cited FIFAIndex edition page; unknown', eventRosterComparison: nationalGameComparisons[t.id] ?? null
      } : null,
      sourceTeamName: t.sourceClubName, sourceTeamField: key, gameVersion: t.edition,
targetRevisionReference: targetRevisionReferences[t.id] ?? null,
      candidateReference: t.reference, datasetLocalCachePath: path.relative(ROOT, cachePath).replaceAll(path.sep, '/'),
      cacheSha256: sha256(bytes), cacheReadAt: readAt,
      cacheAcquisitionTime: 'unknown; the pre-existing ignored cache has no retrieval timestamp',
      sourceRetrievedAt: null, sourceRetrievedAtReason: 'the pre-existing cache has no acquisition timestamp; packageProcessedAt/cacheReadAt are processing times only',
      packageProcessedAt: readAt,
      observedUpdateIds: updateIds, observedUpdateDate: knownDate, updateDateEvidence: dateEvidence,
      versionConsistencyStatus,
      sourceCoverageStatus,
      auditStatus,
      auditCompleteness: 'partial; available evidence recorded, not a complete source audit',
      sourceUpdateIdField: type === 'sofifa' ? 'player_url edition code' : 'season',
      sourceAttribution: type === 'sofifa' ? 'SoFIFA-derived mirror dataset; upstream repository commit not captured' : 'FIFAIndex-derived mirror dataset; upstream repository commit not captured',
      rawAttributeFieldNames: attrs, extractedRows: exactRows.length,
      sourceRowsWereFilteredByExactTeamText: true, notes: t.notes,
unresolvedSourceTeamNameMatches: t.id === 'guangzhou-rf-2019' ? [...new Set(rows.map((r) => r[key]).filter((name) => /^Guangzhou/i.test(name)))].map((name) => ({ sourceClubName: name, rowCount: rows.filter((r) => r[key] === name).length, assignedToCandidate: false })) : []
    };
    const suffix = type === 'sofifa' ? 'sofifa' : 'fifaindex';
    fs.writeFileSync(path.join(OUT, 'sources', t.id + '.' + suffix + '.json'), JSON.stringify({
      schemaVersion: 'wave1-source-records/1', candidateTeamSeason: t.id, sourceMetadata, records
    }, null, 2) + '\n', 'utf8');

    const event = eventSeed[t.id] ?? null;
    const eventSnapshots = [];
    if (event) {
      for (const snap of event.snapshots ?? []) {
        const eventRecords = (snap.members ?? []).map((member) => {
          const identity = identityFor('', null, member.rawName);
          identityMatches.push({
            candidateTeamSeason: t.id, recordKind: 'event-roster', sourceSystem: snap.source?.sourceName ?? 'tournament roster',
            sourcePlayerId: member.sourcePlayerId ?? null, rawName: member.rawName,
            identityStatus: identity.status, identityStatusNote: identity.identityStatusNote ?? null, canonicalPlayerId: null,
            candidateCanonicalIds: identity.candidates,
            evidence: 'official roster membership; name candidate is not identity confirmation',
            membershipEvidence: snap.rosterType + ' listed in ' + (snap.source?.title ?? snap.source?.sourceName),
            sourcePlayerPageUrl: null
          });
          return {
            recordKind: 'event-roster', sourcePlayerId: member.sourcePlayerId ?? null, rawName: member.rawName,
            rawShortName: null, sourceClubOrCountry: t.team, rawPosition: null, rawOverall: null,
            missingFields: ['sourcePlayerId','rawPosition','rawOverall','technicalAttributes'],
            identityStatus: identity.status, canonicalPlayerId: null,
            candidateCanonicalIds: identity.candidates, sourcePlayerPageUrl: null,
            membershipEvidence: snap.rosterType + ' list at ' + snap.source?.url,
            rawSourceFields: { playerName: member.rawName }, packageProcessedAt: readAt, sourceVersion: snap.source?.competition ?? null, sourceUrl: snap.source?.url ?? null
          };
        });
        eventSnapshots.push({ rosterType: snap.rosterType, source: snap.source, records: eventRecords, replacements: snap.replacements ?? [] });
        fs.writeFileSync(path.join(OUT, 'sources', t.id + '.' + snap.rosterType + '.json'), JSON.stringify({
          schemaVersion: 'wave1-event-roster-source/1', candidateTeamSeason: t.id,
          rosterType: snap.rosterType, source: snap.source, records: snap.members ?? [],
          replacements: snap.replacements ?? [],
          fieldsNotProvidedBySource: ['player source ID','position','overall','technical attributes'], sourceRetrievedAt: null, sourceRetrievedAtReason: 'original page retrieval time is not recorded in the source audit', packageProcessedAt: readAt, sourceAcquisitionTime: 'original page retrieval time unknown'
        }, null, 2) + '\n', 'utf8');
      }
    }

    const gameRosterAudit = t.fifaIndexPage ? {
      sourceName: 'FIFAIndex team edition page', pageUrl: t.fifaIndexPage,
      teamId: t.fifaIndexTeamId, gameVersion: t.edition, listedPlayerCount: t.fifaIndexRosterCount,
      revisionDate: null, revisionDateStatus: 'not disclosed on cited FIFAIndex edition page; unknown', namesTranscribed: false, pageReadInSourceAudit: true,
      eventRosterComparison: nationalGameComparisons[t.id] ?? null
    } : null;
    const snapshotStatus = exactRows.length ? 'captured-game-edition-snapshot' : 'no-exact-team-name-match-in-local-cache-source-coverage-unknown';
    const roster = {
      candidateTeamSeason: t.id, actualTeamOrCountry: t.team, actualLeagueOrType: t.league,
      plannedGroup: t.group, referenceSeasonOrEvent: t.reference,
      gameSnapshot: {
        gameVersion: t.edition, targetRevisionReference: targetRevisionReferences[t.id] ?? null, versionConsistencyStatus, sourceCoverageStatus, sourceTeamName: t.sourceClubName, snapshotStatus,
        observedUpdateIds: updateIds, observedUpdateDate: knownDate,
        membershipEvidence: 'source row ' + key + '=' + t.sourceClubName + ' in ' + t.edition + ' edition dataset',
        capturedRowCount: records.length, expectedSourcePageCount: t.fifaIndexRosterCount,
        fifaIndexGameRosterAudit: gameRosterAudit, members: records.map((r) => ({
          sourcePlayerId: r.sourcePlayerId, rawName: r.rawName, rawPosition: r.rawPosition,
          rawOverall: r.rawOverall, membershipEvidence: 'source row ' + key + '=' + t.sourceClubName,
          identityStatus: r.identityStatus, canonicalPlayerId: r.canonicalPlayerId,
          candidateCanonicalIds: r.candidateCanonicalIds, sourcePlayerPageUrl: r.sourcePlayerPageUrl
        }))
      },
      officialEventSnapshots: eventSnapshots
    };
    fs.writeFileSync(path.join(OUT, 'rosters', t.id + '.json'), JSON.stringify(roster, null, 2) + '\n', 'utf8');
    const exactIds = records.filter((r) => r.identityStatus === 'confirmed-existing-by-exact-source-id').length;
    const nameCandidates = records.filter((r) => r.identityStatus === 'name-candidate-unconfirmed').length;
    const status = event ? 'official-event-roster-captured; game snapshot separately audited'
      : exactRows.length ? 'game-snapshot-records-captured; target-season alignment varies'
      : 'source mapping/coverage incomplete; no exact local-cache rows (source data existence unknown)';
    manifest.push({
      candidateId: t.id, candidateYear: t.year, actualSeasonOrEvent: t.reference,
      actualTeam: t.team, actualLeagueOrType: t.league, plannedGroup: t.group,
      gameVersion: t.edition, targetRevisionReference: targetRevisionReferences[t.id] ?? null, sourceTeamName: t.sourceClubName,
      sourceTeamId: t.fifaIndexTeamId ?? null, sourceTeamIdSystem: t.fifaIndexTeamId ? 'FIFAIndex reference page' : null,
      sourceSnapshotUpdateIds: updateIds, sourceSnapshotUpdateDate: knownDate, versionConsistencyStatus, sourceCoverageStatus, auditStatus, auditCompleteness: 'partial; available evidence recorded, not a complete source audit', targetRevisionReference: targetRevisionReferences[t.id] ?? null,
      fifaIndexReference: gameRosterAudit, localRawPlayerRows: exactRows.length,
      rosterCaptureDenominator: 'rows matching exact source club/country text in the cached edition CSV; not the authoritative full squad',
      attributeFields: attrs, rawAttributePresentValues: present, rawAttributeMissingValues: missing,
      explicitRawZeroValues: zeros, identityExactIdMatches: exactIds,
      identityNameCandidatesUnconfirmed: nameCandidates, status,
      dataCanBeHandedToV2ForReview: exactRows.length > 0 || eventSnapshots.length > 0,
      v2IntegrationReady: false,
      unresolvedIssues: [t.notes, ...(exactRows.length ? [] : ['No exact team-name rows in local cache; this does not establish source data absence.']), ...(duplicates.length ? ['duplicate source IDs: ' + duplicates.join(', ')] : [])]
    });
  }


  const manifestDoc = {
    schemaVersion: 'wave1-manifest/1', generatedAt: readAt,
    baselineCommit: '89df44ce08a863a7f2351ea98c9eb193e1b8efe0',
    branch: 'feature/team-expansion-wave1-prep', teamCount: teams.length,
    versionConvention: 'For club TeamSeason IDs, project year is the season-end year (e.g. 2013/14 is 2014); national team IDs use the named tournament calendar year. A FIFA edition is a separate game snapshot and does not establish season membership.',
    teams: manifest
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifestDoc, null, 2) + '\n', 'utf8');
  const identityTotals = {
    records: identityMatches.length,
    exactIdConfirmed: identityMatches.filter((x) => x.identityStatus === 'confirmed-existing-by-exact-source-id').length,
    nameCandidateUnconfirmed: identityMatches.filter((x) => x.identityStatus === 'name-candidate-unconfirmed').length,
    proposedNewSourcePlayers: identityMatches.filter((x) => x.identityStatus === 'proposed-new-source-player-needs-review').length,
    identityUnconfirmedNoSourceId: identityMatches.filter((x) => x.identityStatus === 'identity-unconfirmed-no-source-id').length,
    placeholderNeedsReview: identityMatches.filter((x) => x.identityStatus === 'possible-placeholder-needs-review').length,
    sourceIdCollision: identityMatches.filter((x) => x.identityStatus === 'source-id-collision-needs-review').length
  };
  fs.writeFileSync(path.join(OUT, 'identity-matches.json'), JSON.stringify({
    schemaVersion: 'wave1-identity-matches/1', generatedAt: readAt,
    canonicalIndexReadOnly: 'data/entities/players.json and data/manual/player-aliases.json',
    matchingPolicy: 'Only exact external source ID matches are confirmed. Names and aliases produce review candidates only.',
    totals: identityTotals, records: identityMatches
  }, null, 2) + '\n', 'utf8');

  const report = {
    schemaVersion: 'wave1-coverage/1', generatedAt: readAt,
    denominators: {
      teams: '29 candidate TeamSeason IDs',
      rosterExtraction: 'per-team raw player rows matching exact source team text in one locally cached game edition; this does not measure authoritative full squad coverage',
      rawAttributeCoverage: 'non-empty and non-NA source cells divided by raw source attribute cells present in extracted rows; literal source 0 remains a value and is separately counted',
      identityCoverage: 'extracted player records with exact external source-ID match divided by records having source IDs; name-only matches remain unconfirmed',
      eventRosterCoverage: 'players printed in a cited formal competition roster source; event roster snapshots remain separate from game roster snapshots'
    },
    totals: {
      candidateTeams: teams.length,
      teamsWithRawPlayerRows: manifest.filter((m) => m.localRawPlayerRows > 0).length,
      teamsWithOfficialEventRoster: manifest.filter((m) => m.status.startsWith('official-event-roster-captured')).length,
      capturedRawPlayerRows: totalRows, rawAttributeSlots: totalAttrSlots,
      rawAttributePresentValues: totalAttrPresent, rawAttributeMissingValues: totalAttrMissing,
      explicitRawZeroValues: totalExplicitZero,
      exactIdIdentityMatches: identityTotals.exactIdConfirmed,
      nameOnlyIdentityCandidates: identityTotals.nameCandidateUnconfirmed,
      proposedNewSourcePlayerRecords: identityTotals.proposedNewSourcePlayers,
      eventNamesWithoutSourceIDs: identityTotals.identityUnconfirmedNoSourceId,
      teamsReadyForV2Integration: 0
    },
    duplicates: duplicateSummary,
    unresolved: [
      'Data v2 source-field and handoff contract is not yet defined; integration readiness is false for every team.',
      'FIFAIndex edition-page counts and mirrored SoFIFA CSV row counts are separate observations and are not forced to match.',
      'Most cache acquisition timestamps and most game revision dates are unavailable; see per-source metadata.',
      'FIFAIndex game roster names are not transcribed for the six national teams; only edition, page URL, count and reviewed event-list comparison are available.'
    ]
  };
  fs.writeFileSync(path.join(OUT, 'coverage-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
buildNationalAttributeCandidates({ root: ROOT, out: OUT, cache: CACHE, readAt });
  const finalManifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  const finalReport = JSON.parse(fs.readFileSync(path.join(OUT, 'coverage-report.json'), 'utf8'));
  fs.writeFileSync(path.join(OUT, 'coverage-report.md'), renderCoverage(finalReport, finalManifest.teams), 'utf8');
  console.log('Built ' + teams.length + ' candidates; ' + totalRows + ' raw cache rows; ' + identityMatches.length + ' base identity records.');
}

function renderCoverage(report, manifest) {
  const lines = [
    '# Wave 1 coverage report', '',
    'Generated: ' + report.generatedAt, '',
    '## Denominators', '',
    '- Candidates: ' + report.denominators.teams + '.',
    '- Roster extraction: ' + report.denominators.rosterExtraction + '.',
    '- Raw attributes: ' + report.denominators.rawAttributeCoverage + '.',
    '- Identity: ' + report.denominators.identityCoverage + '.',
    '- Formal event lists: ' + report.denominators.eventRosterCoverage + '.', '',
    '## Counts', '',
    '- Candidate IDs recorded: ' + report.totals.candidateTeams + '/29.',
    '- Teams with game-edition raw player rows: ' + report.totals.teamsWithRawPlayerRows + '/29.',
    '- Teams with formal event roster source rows: ' + report.totals.teamsWithOfficialEventRoster + '/29.',
    '- Raw player rows extracted: ' + report.totals.capturedRawPlayerRows + '.',
    '- Raw attribute cells present: ' + report.totals.rawAttributePresentValues + '/' + report.totals.rawAttributeSlots + '.',
    '- Raw attribute cells blank/NA: ' + report.totals.rawAttributeMissingValues + '.',
    '- Literal source zero cells: ' + report.totals.explicitRawZeroValues + '.',
    '- Separate national attribute-candidate cells present: ' + report.totals.supplementalNationalRawAttributePresentValues + '/' + report.totals.supplementalNationalRawAttributeSlots + '; blank/NA: ' + report.totals.supplementalNationalRawAttributeMissingValues + '; literal zero: ' + report.totals.supplementalNationalExplicitRawZeroValues + '.',
    '- Main game-edition player records: ' + report.totals.identityRecordCountsByKind['main-game'] + '.',
    '- Formal event-roster entries (separate snapshots): ' + report.totals.identityRecordCountsByKind['event-roster'] + '.',
    '- National attribute-candidate records (not roster membership): ' + report.totals.identityRecordCountsByKind['national-attribute-candidate'] + '.',
    '- Identity record rows across those categories: ' + report.totals.identityRecordCount + '.',
    '- Rows with source IDs: ' + report.totals.sourceIdRecordRows + '; distinct source-system/ID keys: ' + report.totals.distinctSourceIdKeys + '.',
    '- Rows without source IDs (mostly official event lists): ' + report.totals.recordsWithoutSourceIds + '.',
    '- Record-level exact-ID identity matches: ' + report.totals.identityRecordStatusCounts['confirmed-existing-by-exact-source-id'] + '.',
    '- Final tournament roster attribute-name candidates: ' + report.totals.finalNationalRosterCoverageDenominator.withAttributeCandidates + '/' + report.totals.finalNationalRosterCoverageDenominator.uniqueNames + ' unique names.',
    '- Submitted/final snapshot union candidates: ' + report.totals.allEventSnapshotCoverageDenominator.withAttributeCandidates + '/' + report.totals.allEventSnapshotCoverageDenominator.uniqueNames + ' unique names.',
    '- Data v2 integration-ready teams: 0/29.', '',
    '## Per-team status', '',
    '| Candidate | Season/event | Main rows | Main attribute cells P/M | Event entries | National attribute rows | National attribute cells P/M | Identity records | Source IDs | Group | Audit | Version | V2 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|',
    ...manifest.map((m) => '| ' + m.candidateId + ' | ' + m.actualSeasonOrEvent + ' | ' + m.mainGameRecordCount + ' | ' + m.rawAttributePresentValues + '/' + m.rawAttributeMissingValues + ' | ' + m.eventRosterEntryCount + ' | ' + m.nationalAttributeCandidateRecordCount + ' | ' + (m.supplementalRawAttributePresentValues ?? 0) + '/' + (m.supplementalRawAttributeMissingValues ?? 0) + ' | ' + m.identityRecordCount + ' | ' + m.distinctSourceIdCount + ' | ' + m.plannedGroup + ' | ' + m.auditStatus + ' | ' + m.versionConsistencyStatus + ' | pending interface |'),
    '', '## Known limits', '',
    ...report.unresolved.map((x) => '- ' + x), ''
  ];
  return lines.join('\n');
}

function validate() {
  const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  const ids = teams.map((t) => t.id);
  const errors = [];
  if (!fs.existsSync(path.join(OUT, 'README.md'))) errors.push('missing README.md');
  if (doc.teamCount !== 29 || doc.teams.length !== 29 || new Set(doc.teams.map((t) => t.candidateId)).size !== 29) errors.push('manifest does not contain 29 unique candidates');
  for (const id of ids) {
    if (!fs.existsSync(path.join(OUT, 'rosters', id + '.json'))) errors.push('missing roster: ' + id);
    const teamManifest = doc.teams.find((t) => t.candidateId === id);
    if (!teamManifest) { errors.push('missing manifest entry: ' + id); continue; }
    if (teamManifest.v2IntegrationReady !== false) errors.push('v2 readiness must remain false: ' + id);
    const roster = JSON.parse(fs.readFileSync(path.join(OUT, 'rosters', id + '.json'), 'utf8'));
    if (roster.gameSnapshot.capturedRowCount !== teamManifest.localRawPlayerRows) errors.push('roster count mismatch: ' + id);
  }
  for (const file of fs.readdirSync(path.join(OUT, 'sources')).filter((x) => x.endsWith('.sofifa.json') || x.endsWith('.fifaindex.json') || x.endsWith('.event-attribute-candidates.sofifa.json'))) {
    const source = JSON.parse(fs.readFileSync(path.join(OUT, 'sources', file), 'utf8'));
    if (!source.sourceMetadata.datasetUrl || !/^[a-f0-9]{64}$/.test(source.sourceMetadata.cacheSha256)) errors.push('missing source URL/checksum: ' + file);
    const seen = new Set();
    for (const record of source.records) {
      if (!record.sourcePlayerId || !record.sourcePlayerPageUrl) errors.push('source ID or player page URL missing: ' + file);
      if (!record.rawSourceFields || Object.values(record.rawSourceFields).some((v) => typeof v !== 'string')) errors.push('raw field values were not preserved as source strings: ' + file);
      if (seen.has(record.sourcePlayerId)) errors.push('duplicate source ID in snapshot: ' + file + ' ' + record.sourcePlayerId);
      seen.add(record.sourcePlayerId);
      if (record.missingFields.some((field) => record.rawSourceFields[field] === '0')) errors.push('explicit zero misclassified as missing: ' + file);
    }
  }
  errors.push(...validateNationalAttributeCandidates({ root: ROOT, out: OUT }));
  const matchDoc = JSON.parse(fs.readFileSync(path.join(OUT, 'identity-matches.json'), 'utf8'));
  for (const match of matchDoc.records.filter((x) => x.identityStatus === 'confirmed-existing-by-exact-source-id')) {
    const expected = bySourceId.get(match.sourceSystem + ':' + String(match.sourcePlayerId)) ?? [];
    if (expected.length !== 1 || expected[0].id !== match.canonicalPlayerId) errors.push('identity confirmed without unique exact ID evidence');
  }
  if (errors.length) {
    console.error('Wave1 validation failed:');
    for (const error of errors) console.error('- ' + error);
    process.exitCode = 1;
  } else {
    console.log('Wave1 package validation passed: 29 candidates, source provenance/checksums, raw scalar preservation, no duplicate source IDs, exact-ID identity confirmation.');
  }
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const buildRequested = args.includes('--build');
const unknownArgs = args.filter((arg) => arg !== '--check' && arg !== '--build');
if (unknownArgs.length || (checkOnly && buildRequested)) {
  console.error('Usage: node build-wave1-package.mjs [--check | --build]');
  process.exitCode = 2;
} else if (checkOnly) {
  validate();
} else {
  build();
}

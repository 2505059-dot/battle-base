import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { parseStrictJson } from './strict-json.mjs';
import { verifyManifestInputs } from './source-adapters.mjs';
import { validateData } from './validation-core.mjs';
import { verifyObservationSources } from './source-verification.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async (path) => parseStrictJson(await readFile(join(ROOT, path), 'utf8'), path);

async function loadProductionFixture() {
  const data = await readJson('data/abilities/player-season-abilities-v2.json');
  const identity = await readJson('data/entities/players.json');
  const sourceConfigs = await readJson('data/abilities/v2/sources.json');
  const fieldMappings = await readJson('data/abilities/v2/field-mappings.json');
  const positionMappings = await readJson('data/abilities/v2/position-mappings.json');
  const snapshotPolicy = await readJson('data/abilities/v2/snapshot-policy.json');
  const schema = await readJson('data/abilities/v2/schema.json');
  const overrides = await readJson('data/abilities/v2/overrides.json');
  const manifestInputs = await verifyManifestInputs(
    ROOT,
    sourceConfigs.manifestPath,
    'research/cache/fifa-rating-audit/player-ability-v2-acquisition-manifest.json'
  );
  const team = await import(pathToFileURL(join(ROOT, 'public/data/team-seasons.js')).href);
  const targetId = 'psv-2005-7';
  const teamSeason = team.TEAM_SEASONS.find((season) => season.players.some((player) => player.id === targetId));
  const player = teamSeason?.players.find((item) => item.id === targetId);
  const canonicalPlayerId = identity.playerSeasonMap[targetId];
  const entity = identity.entities.find((item) => item.id === canonicalPlayerId);
  assert.ok(teamSeason && player && entity, 'production 70-to-99 fixture identity is present');
  const expectedRecords = new Map([[targetId, {
    canonicalPlayerId,
    teamSeasonId: teamSeason.id,
    membershipClub: teamSeason.club,
    identityStatus: entity.identityStatus || 'unknown',
    seasonYear: Number(teamSeason.year)
  }]]);
  const context = {
    expectedRecords,
    entities: identity.entities,
    manifest: manifestInputs.manifest,
    acquisition: manifestInputs.acquisition,
    manifestInputs,
    sourceConfigs,
    fieldMappings,
    positionMappings,
    snapshotPolicy,
    overrides,
    schema,
    schemaVersion: schema.properties.schemaVersion.const
  };
  return { data, context, targetId };
}

function fixtureContext(sourcePath, absolutePath, csv) {
  const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
  const sourceRecord = {
    cache_path: sourcePath,
    bytes: Buffer.byteLength(csv, 'utf8'),
    sha256,
    url: 'https://fixture.invalid/players.csv'
  };
  const archiveSha256 = createHash('sha256').update('fixture archive bytes').digest('hex');
  const archiveRecord = { cache_path: 'fixtures/archive.zip', bytes: 21, sha256: archiveSha256, url: 'https://fixture.invalid/archive.zip' };
  const extraction = { path: sourcePath, member: 'players.csv', bytes: sourceRecord.bytes, sha256, archiveSha256 };
  const sourceConfig = {
    manifestPath: sourcePath,
    revision: 'fixture-revision-1',
    revisionReason: 'Fixture source revision is pinned for verification.',
    editionField: 'year',
    sourceNameField: 'name',
    sourceClubField: 'club',
    overallField: 'rating',
    potentialField: 'potential',
    updateDateField: 'updated_at',
    updateDateFieldMissingReason: 'Fixture date is blank or invalid.'
  };
  return {
    manifest: { source_files: [sourceRecord, archiveRecord] },
    acquisition: {
      sources: [{ path: sourcePath, bytes: sourceRecord.bytes, sha256, status: 'verified' }],
      extractedMembers: [extraction]
    },
    manifestInputs: {
      verified: new Map([[sourcePath, { ...sourceRecord, absolutePath }]]),
      legacyMember: null
    },
    sourceConfigs: {
      version: '1.0.0',
      idFields: { 'fixture-source': { field: 'player_id', externalIdNamespace: 'fixtureId' } },
      sources: { 'fixture-source': sourceConfig }
    }
  };
}

function makeObservation(row, rowNumber, context) {
  const config = context.sourceConfigs.sources['fixture-source'];
  const source = context.manifest.source_files[0];
  const updateDate = row.updated_at === '2020-02-29' ? '2020-02-29' : null;
  const updateDateReason = updateDate
    ? 'Observed as-is from source field updated_at.'
    : 'Fixture date is blank or invalid.';
  return {
    observationId: 'fixture-source:' + row.year + ':' + rowNumber + ':season-fixture',
    sourceId: 'fixture-source',
    sourceVersion: config.revision,
    sourceVersionReason: config.revisionReason,
    editionYear: Number(row.year),
    updateDate,
    updateDateReason,
    sourcePath: source.cache_path,
    sourceUrl: source.url,
    sourceMember: context.acquisition.extractedMembers[0].member,
    sourceMemberSha256: context.acquisition.extractedMembers[0].sha256,
    sourceArchiveSha256: context.acquisition.extractedMembers[0].archiveSha256,
    payloadSha256: source.sha256,
    rowNumber,
    sourcePlayerId: row.player_id,
    sourceName: row.name || null,
    sourceClub: row.club || null,
    rawOverall: row.rating === '' ? null : row.rating,
    rawPotential: row.potential === '' ? null : row.potential,
    rawFields: structuredClone(row)
  };
}

function makeFixtureData(context) {
  const first = {
    player_id: '158133',
    name: 'Player, One',
    club: 'PSV, Eindhoven',
    year: '2006',
    rating: '70',
    potential: '80',
    updated_at: '2020-02-29',
    dribbling: '70',
    raw_only: 'alpha',
    quoted: 'line one\r\nline "two"'
  };
  const second = {
    player_id: '199999',
    name: 'Player Two',
    club: 'Other',
    year: '2007',
    rating: '60',
    potential: '',
    updated_at: '2020-02-30',
    dribbling: '42',
    raw_only: 'beta',
    quoted: ''
  };
  const primary = makeObservation(first, 2, context);
  const nonPrimary = makeObservation(second, 3, context);
  return {
    records: [{
      playerSeasonId: 'season-fixture',
      snapshotSelection: { primaryObservationId: primary.observationId },
      canonical: { attributes: { skill_dribbling: { value: 70, rawString: '70' } } },
      observations: [primary, nonPrimary]
    }]
  };
}

async function assertSourceRejects(data, context, root, fragments) {
  let failure;
  try {
    await verifyObservationSources(data, context, root);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'source verifier must reject mutated fixture');
  for (const fragment of fragments) assert.ok(failure.message.includes(fragment), failure.message);
}

test('manifest-pinned 70-to-99 raw/canonical mutation passes internal validation and fails disk-source verification', async () => {
  const { data, context, targetId } = await loadProductionFixture();
  const originalRecord = data.records.find((record) => record.playerSeasonId === targetId);
  const originalObservation = originalRecord.observations.find((observation) =>
    observation.sourceId === 'lbenz-fifaindex' &&
    observation.observationId === originalRecord.snapshotSelection.primaryObservationId &&
    observation.rawFields.dribbling === '70'
  );
  assert.ok(originalObservation, 'primary observation has raw dribbling 70');

  const validSourceData = {
    records: [{ playerSeasonId: targetId, observations: [structuredClone(originalObservation)] }]
  };
  const validSourceResult = await verifyObservationSources(validSourceData, context, ROOT);
  assert.equal(validSourceResult.observationsVerified, 1);

  const internallyConsistent = structuredClone(data);
  internallyConsistent.records = [internallyConsistent.records.find((record) => record.playerSeasonId === targetId)];
  const record = internallyConsistent.records[0];
  const observation = record.observations.find((item) => item.observationId === record.snapshotSelection.primaryObservationId);
  observation.rawFields.dribbling = '99';
  const cell = record.canonical.attributes.skill_dribbling;
  cell.value = 99;
  cell.rawString = '99';
  cell.status = 'observed';
  cell.missingReason = null;
  assert.equal(observation.rawFields.dribbling, '99');
  assert.equal(cell.value, 99);
  assert.doesNotThrow(() => validateData(internallyConsistent, context));

  await assertSourceRejects(
    { records: [{ playerSeasonId: targetId, observations: [observation] }] },
    context,
    ROOT,
    ['PlayerSeason ' + targetId, 'observation ' + observation.observationId, 'source row ' + observation.rowNumber, 'rawFields.dribbling']
  );
});

test('disk CSV source verification checks raw-only and non-primary fields, row ordinal, edition, location, metadata and CSV decoding', async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'ability-v2-source-verification-test-'));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = 'fixtures/players.csv';
  const absolutePath = join(temporaryRoot, sourcePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const csv = [
    'player_id,name,club,year,rating,potential,updated_at,dribbling,raw_only,quoted\r\n',
    '158133,"Player, One","PSV, Eindhoven",2006,70,80,2020-02-29,70,alpha,"line one\r\nline ""two"""\r\n',
    '199999,Player Two,Other,2007,60,,2020-02-30,42,beta,\r\n'
  ].join('');
  await writeFile(absolutePath, csv, 'utf8');
  const context = fixtureContext(sourcePath, absolutePath, csv);
  const good = makeFixtureData(context);
  const positive = await verifyObservationSources(good, context, temporaryRoot);
  assert.equal(positive.observationsVerified, 2);
  assert.equal(positive.physicalCsvFilesScanned, 1);
  assert.equal(good.records[0].observations[0].rawFields.quoted, 'line one\r\nline "two"');
  assert.equal(good.records[0].observations[1].rawFields.potential, '');
  assert.equal(good.records[0].observations[1].rawFields.quoted, '');

  await t.test('raw-only CSV field change is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].rawFields.raw_only = 'changed';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'rawFields.raw_only']);
  });

  await t.test('non-primary observation raw field change is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[1].rawFields.raw_only = 'changed';
    await assertSourceRejects(changed, context, temporaryRoot, ['observation fixture-source:2007:3:season-fixture', 'source row 3', 'rawFields.raw_only']);
  });

  await t.test('changing to another existing CSV record ordinal is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].rowNumber = 3;
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 3', 'rawFields.player_id']);
  });

  await t.test('edition year differing from the source row is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].editionYear = 2008;
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'editionYear']);
  });

  await t.test('source location differing from the configured verified file is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourcePath = 'fixtures/other.csv';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourcePath']);
  });

  await t.test('source metadata differing from the manifest is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourceUrl = 'https://fixture.invalid/other.csv';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourceUrl']);
  });
  await t.test('source ID mutation reports the sourceId field', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourceId = 'wrong-source';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourceId']);
  });

  await t.test('source update date differing from the CSV is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].updateDate = '2020-02-28';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'updateDate']);
  });

  await t.test('source update date reason differing from the CSV is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].updateDateReason = 'forged date provenance';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'updateDateReason']);
  });

  await t.test('ZIP member name differing from acquisition metadata is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourceMember = 'other.csv';
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourceMember']);
  });

  await t.test('ZIP member hash differing from acquisition metadata is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourceMemberSha256 = '0'.repeat(64);
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourceMemberSha256']);
  });

  await t.test('ZIP archive hash differing from acquisition metadata is rejected', async () => {
    const changed = structuredClone(good);
    changed.records[0].observations[0].sourceArchiveSha256 = 'f'.repeat(64);
    await assertSourceRejects(changed, context, temporaryRoot, ['source row 2', 'sourceArchiveSha256']);
  });
});
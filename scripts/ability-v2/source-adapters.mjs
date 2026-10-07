import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { readCsvRows } from './csv.mjs';
import { parseSourcePositions, parseObservedPositionRatings } from './positions.mjs';
import { hashZipEntry } from './zip.mjs';
import { parseStrictJson } from './strict-json.mjs';

export async function hashFile(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

export async function verifyManifestInputs(root, manifestPath, acquisitionPath) {
  const manifestAbs = join(root, manifestPath);
  const manifest = parseStrictJson(await readFile(manifestAbs, 'utf8'), manifestPath);
  const manifestHash = await hashFile(manifestAbs);
  const acquisition = parseStrictJson(await readFile(join(root, acquisitionPath), 'utf8'), acquisitionPath);
  if (acquisition.sourceManifestSha256 !== manifestHash.sha256) throw new Error('Local acquisition record points to a different source manifest.');
  const sourceResults = new Map((acquisition.sources || []).map((x) => [x.path, x]));
  const extractedResults = new Map((acquisition.extractedMembers || []).map((x) => [x.path, x]));
  const verified = new Map();
  for (const source of manifest.source_files) {
    const abs = join(root, source.cache_path);
    try { await access(abs); } catch { throw new Error('Required source cache is unavailable: ' + source.cache_path); }
    const actual = await hashFile(abs);
    if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256.toLowerCase()) throw new Error('Required source fails manifest checksum: ' + source.cache_path);
    if (source.cache_path.endsWith('kaggle_fifa18_CompleteDataset.csv')) {
      const record = extractedResults.get(source.cache_path);
      if (!record || record.bytes !== actual.bytes || record.sha256 !== actual.sha256) throw new Error('FIFA18 demo extraction is not recorded as verified.');
      const archive = manifest.source_files.find((x) => x.cache_path.endsWith('kaggle_fifa18_demo.zip'));
      if (record.archiveSha256 !== archive.sha256) throw new Error('FIFA18 demo extraction is not tied to the pinned archive.');
    } else {
      const record = sourceResults.get(source.cache_path);
      if (!record || !['verified','downloaded'].includes(record.status) || record.bytes !== actual.bytes || record.sha256 !== actual.sha256) throw new Error('Source is not recorded as verified by acquisition: ' + source.cache_path);
    }
    verified.set(source.cache_path, { ...source, absolutePath: abs });
  }
  const legacy = extractedResults.get('research/cache/fifa-rating-audit/stefanoleone_legacy_member.csv');
  const legacyArchive = manifest.source_files.find((x) => x.cache_path.endsWith('stefanoleone_fifa23_complete.zip'));
  if (!legacy || legacy.archiveSha256 !== legacyArchive.sha256) throw new Error('Stefano legacy CSV is not recorded as extracted from the pinned archive.');
  const memberPath = join(root, legacy.path);
  const memberHash = await hashFile(memberPath);
  if (memberHash.bytes !== legacy.bytes || memberHash.sha256 !== legacy.sha256) throw new Error('Stefano legacy extracted member checksum mismatch.');
  const sourceConfig = parseStrictJson(await readFile(join(root, 'data/abilities/v2/sources.json'), 'utf8'), 'data/abilities/v2/sources.json');
  if (legacy.member !== sourceConfig.sources['stefano-legacy'].member) throw new Error('Stefano extracted ZIP member differs from the versioned source config.');
  const legacyArchiveHash = await hashZipEntry(join(root, legacyArchive.cache_path), legacy.member);
  if (legacyArchiveHash.bytes !== legacy.bytes || legacyArchiveHash.sha256 !== legacy.sha256) throw new Error('Stefano member does not match bytes extracted from the pinned ZIP.');
  const demoCsv = manifest.source_files.find((x) => x.cache_path.endsWith('kaggle_fifa18_CompleteDataset.csv'));
  const demoArchive = manifest.source_files.find((x) => x.cache_path.endsWith('kaggle_fifa18_demo.zip'));
  const demoExtraction = extractedResults.get(demoCsv.cache_path);
  if (!demoExtraction || !/CompleteDataset\.csv$/i.test(demoExtraction.member)) throw new Error('FIFA18 demo member path is not the configured CSV.');
  const demoArchiveHash = await hashZipEntry(join(root, demoArchive.cache_path), demoExtraction.member);
  if (demoArchiveHash.bytes !== demoCsv.bytes || demoArchiveHash.sha256 !== demoCsv.sha256) throw new Error('FIFA18 demo CSV does not match bytes extracted from the pinned ZIP.');
  return { manifest, manifestHash: manifestHash.sha256, acquisition, verified, legacyMember: { ...legacy, absolutePath: memberPath } };
}

const normalizedId = (value) => {
  const raw = String(value ?? '').trim();
  return /^\d+\.0+$/.test(raw) ? raw.replace(/\.0+$/, '') : raw;
};
const normalizedName = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().replace(/\s+/g, ' ');
function editionFromFilename(path) {
  const match = path.match(/(?:FIFA|FC)(\d{2})/i);
  return match ? 2000 + Number(match[1]) : null;
}
function editionFromRow(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100) return numeric;
  if (Number.isInteger(numeric) && numeric >= 5 && numeric <= 99) return 2000 + numeric;
  const match = raw.match(/(?:FIFA|FC)\s*(\d{1,2})/i);
  return match ? 2000 + Number(match[1]) : null;
}

export async function scanSources(root, configs, manifestInputs, entities, targets, positionConfig, snapshotPolicy) {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const external = new Map();
  for (const namespace of ['fifaIndex','sofifa']) external.set(namespace, new Map());
  const names = new Map();
  for (const entity of entities) {
    const name = normalizedName(entity.canonicalName);
    if (name) { const group = names.get(name) || []; group.push(entity.id); names.set(name, group); }
    for (const namespace of external.keys()) {
      const raw = entity.externalIds?.[namespace];
      if (raw == null || raw === '') continue;
      const key = normalizedId(raw); const index = external.get(namespace); const group = index.get(key) || [];
      group.push(entity.id); index.set(key, group);
    }
  }
  const targetsByEntity = new Map();
  for (const target of targets) { const group = targetsByEntity.get(target.canonicalPlayerId) || []; group.push(target); targetsByEntity.set(target.canonicalPlayerId, group); }
  const observations = new Map(targets.map((target) => [target.playerSeasonId, []]));
  const lineage = [];
  const sourceIds = Object.keys(configs.sources);
  const manifestByPath = new Map(manifestInputs.manifest.source_files.map((x) => [x.cache_path,x]));
  for (const sourceId of sourceIds) {
    const cfg = configs.sources[sourceId];
    const idSpec = configs.idFields[sourceId];
    let files = [];
    if (sourceId === 'mzafram-sofifa') files = [...manifestByPath.values()].filter((x) => /\/mzafram_.*\.csv$/i.test(x.cache_path));
    else if (sourceId === 'stefano-legacy') files = [{ cache_path: cfg.extractedPath, absolutePath: manifestInputs.legacyMember.absolutePath, sourceArchive: cfg.manifestPath }];
    else files = [manifestByPath.get(cfg.manifestPath)];
    for (const file of files) {
      if (!file) throw new Error('Source configuration points to a missing manifest file: ' + sourceId);
      const sourcePath = file.absolutePath || join(root, file.cache_path);
      const sourceRecord = sourceId === 'stefano-legacy' ? manifestByPath.get(cfg.manifestPath) : file;
      const payloadSha256 = sourceRecord.sha256.toLowerCase();
      const payload = manifestInputs.acquisition.extractedMembers?.find((x) => x.path === file.cache_path);
      const archiveRecord = sourceId === 'stefano-legacy' ? sourceRecord : sourceId === 'fifa18-demo' ? [...manifestByPath.values()].find(x => x.cache_path.endsWith('kaggle_fifa18_demo.zip')) : null;
      const fixedYear = sourceId === 'fifa18-demo' ? cfg.editionYear : null;
      const fileYear = sourceId === 'mzafram-sofifa' ? editionFromFilename(file.cache_path) : null;
      let rowsScanned = 0; let observationsAdded = 0; let stableAdded = 0; let nameCandidates = 0;
      for await (const row of readCsvRows(sourcePath)) {
        rowsScanned += 1;
        const editionYear = fixedYear || fileYear || editionFromRow(row[cfg.editionField]);
        if (!editionYear) continue;
        const sourcePlayerId = row[idSpec.field] == null ? null : String(row[idSpec.field]);
        const externalKey = normalizedId(sourcePlayerId);
        const stableGroup = external.get(idSpec.externalIdNamespace)?.get(externalKey) || [];
        let entityIds = stableGroup;
        let matchStatus = stableGroup.length === 1 ? 'stable_external_id' : stableGroup.length > 1 ? 'ambiguous' : null;
        let keyType = idSpec.externalIdNamespace;
        let confidence = matchStatus === 'stable_external_id' ? 'high' : 'none';
        if (!stableGroup.length) {
          entityIds = names.get(normalizedName(row[cfg.sourceNameField])) || [];
          if (!entityIds.length) continue;
          matchStatus = entityIds.length === 1 ? 'name_candidate' : 'ambiguous';
          keyType = 'name'; confidence = matchStatus === 'name_candidate' ? 'low' : 'none';
        }
        const pos = parseSourcePositions(row, sourceId, positionConfig);
        const ratings = parseObservedPositionRatings(row, sourceId, positionConfig);
        for (const entityId of entityIds) {
          for (const target of targetsByEntity.get(entityId) || []) {
            if (Math.abs(editionYear - (target.seasonYear + 1)) > snapshotPolicy.boundedNearest.maxAbsoluteOffsetFromTargetEdition) continue;
            const observationId = `${sourceId}:${editionYear}:${row.__rowNumber}:${target.playerSeasonId}`;
            const rawFields = Object.fromEntries(Object.entries(row));
            const missingReasons = [];
            if (!row[cfg.overallField]) missingReasons.push('source overall field is blank');
            if (!cfg.potentialField || !row[cfg.potentialField]) missingReasons.push(cfg.potentialFieldReason || 'source potential value is unavailable');
            if (!pos.sourcePositions.length) missingReasons.push('source position fields are unavailable');
            if (!ratings.length) missingReasons.push('source contains no observed position rating fields');
            const observation = {
              observationId, sourceId, sourceVersion: cfg.revision || null, sourceVersionReason: cfg.revisionReason || null,
              editionYear, ...parseSourceUpdateDate(cfg.updateDateField ? row[cfg.updateDateField] : null, cfg),
              sourcePath: file.cache_path, sourceUrl: sourceRecord.url || null, sourceMember: payload?.member || (sourceId === 'stefano-legacy' ? cfg.member : null),
              sourceMemberSha256: payload?.sha256 || null, sourceArchiveSha256: archiveRecord?.sha256 || null,
              payloadSha256, rowNumber: row.__rowNumber, sourcePlayerId, sourceName: row[cfg.sourceNameField] || null,
              sourceClub: row[cfg.sourceClubField] || null,
              rawOverall: cfg.overallField && row[cfg.overallField] !== '' ? row[cfg.overallField] : null,
              rawPotential: cfg.potentialField && row[cfg.potentialField] !== '' ? row[cfg.potentialField] : null,
              rawFields, sourcePositions: pos.sourcePositions, rosterPosition: pos.rosterPosition,
              observedPositionRatings: ratings,
              identityMatch: { status: matchStatus, keyType, confidence }, missingReasons
            };
            observations.get(target.playerSeasonId).push(observation); observationsAdded += 1;
            if (matchStatus === 'stable_external_id') stableAdded += 1; else nameCandidates += 1;
          }
        }
      }
      lineage.push({ sourceId, sourcePath: file.cache_path, sourceMember: payload?.member || (sourceId === 'stefano-legacy' ? cfg.member : null), sourceMemberSha256: payload?.sha256 || null, sourceArchiveSha256: archiveRecord?.sha256 || null,
        sourceUrl: sourceRecord.url || null, sourceVersion: cfg.revision || null, sourceVersionReason: cfg.revisionReason || null,
        payloadSha256, licenseStatus: cfg.licenseStatus || null, rowsScanned, targetObservations: observationsAdded,
        stableIdObservations: stableAdded, nameOrAmbiguousCandidates: nameCandidates });
    }
  }
  for (const list of observations.values()) list.sort((a,b) => a.editionYear-b.editionYear || a.sourceId.localeCompare(b.sourceId) || a.rowNumber-b.rowNumber || a.observationId.localeCompare(b.observationId));
  return { observations, lineage, externalIdCoverage: entities.filter((e) => ['fifaIndex','sofifa'].some((n) => e.externalIds?.[n] != null)).length,
    entityById, externalIdDuplicates: [...external].flatMap(([namespace,index]) => [...index].filter(([,ids]) => ids.length>1).map(([id,ids]) => ({namespace,id,entityIds:ids}))) };
}

export function parseSourceUpdateDate(raw, config) {
  if (!config.updateDateField) return {
    updateDate: config.updateDate || null,
    updateDateReason: config.updateDateReason || 'No source update-date evidence is available.'
  };
  const value = raw == null ? '' : String(raw);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? new Date(value + 'T00:00:00.000Z') : null;
  if (!match || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return {
    updateDate: null,
    updateDateReason: config.updateDateFieldMissingReason || 'Source update-date field is blank or invalid; raw value is retained.'
  };
  return { updateDate: value, updateDateReason: 'Observed as-is from source field ' + config.updateDateField + '.' };
}

export function parseSourceRating(raw, fieldName) {
  if (raw == null || String(raw).trim() === '' || /^(?:NA|N\/A|null|-)$/i.test(String(raw).trim())) return { value: null, reason: 'source value missing' };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 99) return { value: null, reason: 'source value is outside the declared 0-99 range', raw: String(raw), fieldName };
  return { value, reason: null };
}

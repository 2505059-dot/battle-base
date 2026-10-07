import { relative, resolve, sep, isAbsolute } from 'node:path';
import { parseSourceUpdateDate } from './source-adapters.mjs';
import { readCsvRows } from './csv.mjs';

const locatorKey = (sourceId, sourcePath) => sourceId + '\u0000' + sourcePath;
const display = (value) => {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized.length > 220 ? serialized.slice(0, 217) + '...' : serialized;
};

function mismatch(record, observation, field, actual, expected) {
  throw new Error(
    'Independent source verification failed: PlayerSeason ' + record.playerSeasonId +
    ' observation ' + observation.observationId +
    ' source row ' + observation.rowNumber + ': ' + field +
    ' differs (output ' + display(actual) + ', verified source ' + display(expected) + ').'
  );
}

function sourceLocationFailure(record, observation, field, actual, expected) {
  mismatch(record, observation, field, actual, expected);
}

function ensureInsideRoot(root, relativePath) {
  const absolutePath = resolve(root, relativePath);
  const rel = relative(resolve(root), absolutePath);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error('Configured CSV source path escapes the repository root: ' + relativePath);
  }
  return absolutePath;
}

function matchesManifestPattern(cachePath, pattern) {
  const marker = '{edition}';
  const index = pattern.indexOf(marker);
  if (index < 0) return cachePath === pattern;
  if (pattern.indexOf(marker, index + marker.length) >= 0) return false;
  const prefix = pattern.slice(0, index);
  const suffix = pattern.slice(index + marker.length);
  if (!cachePath.startsWith(prefix) || !cachePath.endsWith(suffix)) return false;
  const edition = cachePath.slice(prefix.length, cachePath.length - suffix.length);
  return edition.length > 0 && !edition.includes('/');
}

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

function editionFromVerifiedRow(sourceId, sourcePath, row, config) {
  const fixedYear = sourceId === 'fifa18-demo' ? config.editionYear : null;
  const fileYear = sourceId === 'mzafram-sofifa' ? editionFromFilename(sourcePath) : null;
  return fixedYear || fileYear || editionFromRow(config.editionField ? row[config.editionField] : null);
}

function buildSourceDescriptors(root, context) {
  const manifestInputs = context.manifestInputs;
  if (!manifestInputs?.verified || !context.manifest || !context.acquisition) {
    throw new Error('Independent source verification requires manifest-verified inputs.');
  }

  const manifestByPath = new Map(context.manifest.source_files.map((item) => [item.cache_path, item]));
  const extractedByPath = new Map((context.acquisition.extractedMembers || []).map((item) => [item.path, item]));
  const descriptorsByLocator = new Map();

  for (const [sourceId, config] of Object.entries(context.sourceConfigs.sources)) {
    const idSpec = context.sourceConfigs.idFields[sourceId];
    if (!idSpec) throw new Error('Source verification has no ID-field config for ' + sourceId + '.');

    let sourceFiles;
    if (config.extractedPath) {
      sourceFiles = [{ cache_path: config.extractedPath, extractedPath: true }];
    } else if (config.manifestPathPattern) {
      sourceFiles = context.manifest.source_files.filter((item) =>
        matchesManifestPattern(item.cache_path, config.manifestPathPattern)
      );
    } else {
      const item = manifestByPath.get(config.manifestPath);
      sourceFiles = item ? [item] : [];
    }
    if (!sourceFiles.length) throw new Error('No manifest-pinned CSV source matches configured source ' + sourceId + '.');

    for (const file of sourceFiles) {
      const sourcePath = file.cache_path;
      const sourceRecord = file.extractedPath ? manifestByPath.get(config.manifestPath) : file;
      if (!sourceRecord) throw new Error('Source verification cannot locate the pinned source metadata for ' + sourceId + '.');

      const extraction = extractedByPath.get(sourcePath) || null;
      let absolutePath;
      if (file.extractedPath) {
        if (!extraction) throw new Error('Verified extracted CSV member is unavailable for ' + sourceId + ': ' + sourcePath);
        const legacyMember = manifestInputs.legacyMember;
        absolutePath = legacyMember?.path === sourcePath
          ? legacyMember.absolutePath
          : ensureInsideRoot(root, sourcePath);
        if (!absolutePath) throw new Error('Verified extracted CSV path is unavailable for ' + sourceId + '.');
        if (legacyMember?.path === sourcePath &&
            (legacyMember.bytes !== extraction.bytes || legacyMember.sha256 !== extraction.sha256)) {
          throw new Error('Verified extracted CSV metadata differs from the local acquisition record for ' + sourceId + '.');
        }
      } else {
        const verified = manifestInputs.verified.get(file.cache_path);
        if (!verified?.absolutePath) throw new Error('CSV source is not present in the manifest-verified input set: ' + file.cache_path);
        if (verified.bytes !== file.bytes || verified.sha256 !== file.sha256.toLowerCase()) {
          throw new Error('CSV source verification metadata no longer matches the manifest: ' + file.cache_path);
        }
        absolutePath = verified.absolutePath;
      }

      if (extraction?.archiveSha256 &&
          !context.manifest.source_files.some((item) => item.sha256.toLowerCase() === extraction.archiveSha256.toLowerCase())) {
        throw new Error('Extracted CSV member is not tied to a manifest-pinned archive: ' + sourcePath);
      }
      if (file.extractedPath &&
          sourceRecord.sha256.toLowerCase() !== String(extraction.archiveSha256 || '').toLowerCase()) {
        throw new Error('Extracted CSV member archive hash differs from its configured source archive: ' + sourcePath);
      }

      const descriptor = {
        sourceId,
        sourcePath,
        absolutePath,
        idField: idSpec.field,
        sourceConfig: config,
        metadata: {
          sourcePath,
          sourceUrl: sourceRecord.url || null,
          sourceMember: extraction?.member || null,
          sourceMemberSha256: extraction?.sha256 || null,
          sourceArchiveSha256: file.extractedPath
            ? sourceRecord.sha256.toLowerCase()
            : extraction?.archiveSha256 || null,
          payloadSha256: sourceRecord.sha256.toLowerCase(),
          sourceVersion: config.revision || null,
          sourceVersionReason: config.revisionReason || null
        }
      };
      const key = locatorKey(sourceId, sourcePath);
      if (descriptorsByLocator.has(key)) throw new Error('Duplicate configured source locator: ' + sourceId + ' ' + sourcePath);
      descriptorsByLocator.set(key, descriptor);
    }
  }
  return descriptorsByLocator;
}

function compareMetadata(record, observation, descriptor) {
  for (const field of [
    'sourcePath',
    'sourceUrl',
    'sourceMember',
    'sourceMemberSha256',
    'sourceArchiveSha256',
    'payloadSha256',
    'sourceVersion',
    'sourceVersionReason'
  ]) {
    if (observation[field] !== descriptor.metadata[field]) {
      mismatch(record, observation, field, observation[field], descriptor.metadata[field]);
    }
  }
}

function compareRawFields(record, observation, row) {
  const actualFields = observation.rawFields;
  if (!actualFields || typeof actualFields !== 'object' || Array.isArray(actualFields)) {
    mismatch(record, observation, 'rawFields', actualFields, 'object with every decoded CSV column');
  }
  const expectedKeys = Object.keys(row);
  const actualKeys = Object.keys(actualFields);
  const missing = expectedKeys.filter((key) => !Object.hasOwn(actualFields, key));
  const extra = actualKeys.filter((key) => !Object.hasOwn(row, key));
  if (missing.length || extra.length) {
    mismatch(record, observation, 'rawFields key set', { missing, extra }, expectedKeys);
  }
  for (const field of expectedKeys) {
    if (typeof actualFields[field] !== 'string' || actualFields[field] !== row[field]) {
      mismatch(record, observation, 'rawFields.' + field, actualFields[field], row[field]);
    }
  }
}

function compareObservationRow(record, observation, descriptor, row) {
  compareRawFields(record, observation, row);
  const config = descriptor.sourceConfig;
  const sourcePlayerId = row[descriptor.idField] == null ? null : String(row[descriptor.idField]);
  const sourceName = row[config.sourceNameField] || null;
  const sourceClub = row[config.sourceClubField] || null;
  const rawOverall = config.overallField && row[config.overallField] !== '' ? row[config.overallField] : null;
  const rawPotential = config.potentialField && row[config.potentialField] !== '' ? row[config.potentialField] : null;
  const editionYear = editionFromVerifiedRow(descriptor.sourceId, descriptor.sourcePath, row, config);
  const update = parseSourceUpdateDate(config.updateDateField ? row[config.updateDateField] : null, config);

  for (const [field, expected] of [
    ['sourcePlayerId', sourcePlayerId],
    ['sourceName', sourceName],
    ['sourceClub', sourceClub],
    ['rawOverall', rawOverall],
    ['rawPotential', rawPotential],
    ['editionYear', editionYear],
    ['updateDate', update.updateDate],
    ['updateDateReason', update.updateDateReason]
  ]) {
    if (observation[field] !== expected) mismatch(record, observation, field, observation[field], expected);
  }

  const expectedObservationId = descriptor.sourceId + ':' + editionYear + ':' +
    row.__rowNumber + ':' + record.playerSeasonId;
  if (observation.observationId !== expectedObservationId) {
    mismatch(record, observation, 'observationId', observation.observationId, expectedObservationId);
  }
}

export async function verifyObservationSources(data, context, root) {
  const descriptorsByLocator = buildSourceDescriptors(root, context);
  const physicalFiles = new Map();
  let observationsQueued = 0;

  for (const record of data.records) {
    for (const observation of record.observations) {
      const key = locatorKey(observation.sourceId, observation.sourcePath);
      const descriptor = descriptorsByLocator.get(key);
      if (!descriptor) {
        const descriptors = [...descriptorsByLocator.values()];
        const matchingPath = descriptors.find((item) => item.sourcePath === observation.sourcePath);
        if (matchingPath && matchingPath.sourceId !== observation.sourceId) {
          mismatch(record, observation, 'sourceId', observation.sourceId, matchingPath.sourceId);
        }
        const expectedPaths = descriptors.filter((item) => item.sourceId === observation.sourceId).map((item) => item.sourcePath);
        if (!expectedPaths.length) mismatch(record, observation, 'sourceId', observation.sourceId, [...new Set(descriptors.map((item) => item.sourceId))]);
        sourceLocationFailure(record, observation, 'sourcePath', observation.sourcePath, expectedPaths);
      }
      compareMetadata(record, observation, descriptor);

      const physicalKey = process.platform === 'win32'
        ? descriptor.absolutePath.toLowerCase()
        : descriptor.absolutePath;
      let physical = physicalFiles.get(physicalKey);
      if (!physical) {
        physical = { absolutePath: descriptor.absolutePath, descriptors: new Map() };
        physicalFiles.set(physicalKey, physical);
      }
      let state = physical.descriptors.get(key);
      if (!state) {
        state = { descriptor, expectedByRow: new Map(), foundRows: new Set() };
        physical.descriptors.set(key, state);
      }
      const rowNumber = observation.rowNumber;
      const expected = state.expectedByRow.get(rowNumber) || [];
      expected.push({ record, observation });
      state.expectedByRow.set(rowNumber, expected);
      observationsQueued += 1;
    }
  }

  let csvDataRowsScanned = 0;
  for (const physical of physicalFiles.values()) {
    try {
      for await (const row of readCsvRows(physical.absolutePath)) {
        csvDataRowsScanned += 1;
        for (const state of physical.descriptors.values()) {
          const expected = state.expectedByRow.get(row.__rowNumber);
          if (!expected) continue;
          state.foundRows.add(row.__rowNumber);
          for (const item of expected) {
            compareObservationRow(item.record, item.observation, state.descriptor, row);
          }
        }
      }
    } catch (error) {
      if (error.message.startsWith('Independent source verification failed:')) throw error;
      const first = [...physical.descriptors.values()][0];
      const item = [...first.expectedByRow.values()][0][0];
      throw new Error(
        'Independent source verification failed: PlayerSeason ' + item.record.playerSeasonId +
        ' observation ' + item.observation.observationId +
        ' source row ' + item.observation.rowNumber + ': cannot read verified CSV ' +
        first.descriptor.sourcePath + ': ' + error.message
      );
    }

    for (const state of physical.descriptors.values()) {
      for (const [rowNumber, expected] of state.expectedByRow) {
        if (state.foundRows.has(rowNumber)) continue;
        const item = expected[0];
        mismatch(item.record, item.observation, 'rowNumber/source row location', rowNumber, 'existing CSV record ordinal');
      }
    }
  }

  return {
    observationsVerified: observationsQueued,
    physicalCsvFilesScanned: physicalFiles.size,
    csvDataRowsScanned
  };
}


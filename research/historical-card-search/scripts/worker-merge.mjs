import { assertUniqueSearchEntityKeys, searchEntityKeyFor } from './search-entity-key.mjs';
import { applySourceLocalCardIdentity } from './source-card-identity.mjs';
import { refreshCandidateIdentity } from './identity-evidence.mjs';
import { normalizeNexonAttributeEntries } from './nexon-attributes.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fifa14HeaderNames = [
  'PAC','SHO','PAS','DRI','DEF','HEA','Acceleration','Agility','Balance','Jumping','Reactions','Sprint Speed','Stamina','Strength','Aggression','Interceptions','Positioning','Vision','Potential','Ball Control','Crossing','Curve','Dribbling','Finishing','Freekick Acc.','Heading Acc.','Long Pass','Long Shots','Marking','Penalties','Short Pass','Shot Power','Slide Tackle','Stand. Tackle','Volleys','DIV','HAN','KIC','REF','SPE','POS','WF','Skill','AW','DW',
];
const fifa14Headers = Array(74).fill('');
fifa14Headers[8] = 'Pos'; fifa14Headers[12] = 'Nationality'; fifa14Headers[67] = 'Min'; fifa14Headers[68] = 'Max';
fifa14HeaderNames.forEach((label, offset) => { fifa14Headers[offset + 13] = label; });

const summaryHeaderKeys = new Map([['pac','PAC'],['sho','SHO'],['pas','PAS'],['dri','DRI'],['def','DEF'],['hea','HEA'],['phy','PHY']]);
const skillMetaHeaderKeys = new Map([['wf','WF'],['skill','Skill'],['aw','AW'],['dw','DW']]);
const potentialMetaHeaderKeys = new Map([['potential','Potential']]);
const modernExpectedDetailedKeys = [
  'Acceleration','Agility','Balance','Jumping','Reactions','SprintSpeed','Stamina','Strength','Aggression','Interceptions','Positioning','Vision',
  'BallControl','Crossing','Curve','Dribbling','Finishing','FreeKickAccuracy','HeadingAccuracy','LongPassing','LongShots','Marking','Penalties',
  'ShortPassing','ShotPower','SlidingTackle','StandingTackle','Volleys','GK_Diving','GK_Handling','GK_Kicking','GK_Reflexes','GK_Speed','GK_Positioning','Composure',
];
const detailedHeaderKeys = new Map([
  ['acceleration','Acceleration'],['agility','Agility'],['balance','Balance'],['jumping','Jumping'],['reactions','Reactions'],['sprint speed','SprintSpeed'],['sprintspeed','SprintSpeed'],['stamina','Stamina'],['strength','Strength'],['aggression','Aggression'],['interceptions','Interceptions'],['positioning','Positioning'],['vision','Vision'],['composure','Composure'],['ball control','BallControl'],['ballcontrol','BallControl'],['crossing','Crossing'],['curve','Curve'],['dribbling','Dribbling'],['finishing','Finishing'],['freekick acc.','FreeKickAccuracy'],['free kick acc.','FreeKickAccuracy'],['free kick accuracy','FreeKickAccuracy'],['freekick accuracy','FreeKickAccuracy'],['heading acc.','HeadingAccuracy'],['heading accuracy','HeadingAccuracy'],['long pass','LongPassing'],['long passing','LongPassing'],['long shots','LongShots'],['longshot','LongShots'],['marking','Marking'],['penalties','Penalties'],['short pass','ShortPassing'],['short passing','ShortPassing'],['shot power','ShotPower'],['slide tackle','SlidingTackle'],['sliding tackle','SlidingTackle'],['stand. tackle','StandingTackle'],['standing tackle','StandingTackle'],['volleys','Volleys'],['div','GK_Diving'],['han','GK_Handling'],['kic','GK_Kicking'],['ref','GK_Reflexes'],['spe','GK_Speed'],['pos','GK_Positioning'],
]);
function cleanHeader(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}
function makeWefutHeaderEvidence(headers, edition, sourceUrl, evidence = 'public_playerTable_header', frontendContract = null) {
  const columns = [];
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  const cleanedHeaders = headers.map(cleanHeader);
  const tokens = cleanedHeaders.map((header) => header.toLowerCase().replace(/\s+/g, ' '));
  const isKnownAttributeToken = (token) => summaryHeaderKeys.has(token) || skillMetaHeaderKeys.has(token) || potentialMetaHeaderKeys.has(token) || detailedHeaderKeys.has(token);
  const knownAttributeIndexes = tokens.map((token, index) => isKnownAttributeToken(token) ? index : -1).filter((index) => index >= 0);
  const nationalityIndexes = tokens.map((token, index) => ['nationality', 'nation'].includes(token) ? index : -1).filter((index) => index >= 0);
  const minIndexes = tokens.map((token, index) => token === 'min' ? index : -1).filter((index) => index >= 0);
  const maxIndexes = tokens.map((token, index) => token === 'max' ? index : -1).filter((index) => index >= 0);
  const nationalityIndex = nationalityIndexes.length === 1 ? nationalityIndexes[0] : null;
  const attributeStart = nationalityIndex == null ? headers.length : nationalityIndex + 1;
  const legacyBoundaryVerified = nationalityIndexes.length === 1 && minIndexes.length === 1 && maxIndexes.length === 1
    && minIndexes[0] > attributeStart && maxIndexes[0] > minIndexes[0];
  const modernMetadataVerified = Number(edition) >= 22 && headers.length === 75
    && tokens[4] && ['rtg', 'rating'].includes(tokens[4])
    && tokens[8] && ['pos', 'position(s)', 'positions'].includes(tokens[8])
    && nationalityIndex === 12
    && frontendContract?.verified === true;
  const boundaryEvidence = legacyBoundaryVerified || modernMetadataVerified;
  const mappingStrategy = legacyBoundaryVerified ? 'nation_min_max' : modernMetadataVerified ? 'modern_labeled_75_column_server_side_table' : 'unverified';
  const attributeEndExclusive = legacyBoundaryVerified ? minIndexes[0] : modernMetadataVerified ? headers.length : (nationalityIndex != null && knownAttributeIndexes.length ? Math.max(...knownAttributeIndexes.filter((index) => index >= attributeStart), attributeStart - 1) + 1 : headers.length);
  const unclassifiedHeaderColumns = [];
  for (let index = attributeStart; nationalityIndex != null && index < attributeEndExclusive; index++) {
    const sourceLabel = cleanedHeaders[index];
    if (!sourceLabel) continue;
    const token = tokens[index];
    const summaryKey = summaryHeaderKeys.get(token);
    const skillKey = skillMetaHeaderKeys.get(token);
    const potentialKey = potentialMetaHeaderKeys.get(token);
    const detailKey = detailedHeaderKeys.get(token);
    const group = summaryKey ? 'summaryRatings' : skillKey ? 'skillMetaAttributes' : potentialKey ? 'potentialMetaAttributes' : detailKey ? 'detailedAttributes' : null;
    const key = summaryKey ?? skillKey ?? potentialKey ?? detailKey;
    if (group) {
      if (group === 'detailedAttributes' && seenKeys.has(key)) duplicateKeys.add(key);
      if (group === 'detailedAttributes') seenKeys.add(key);
      columns.push({ index, sourceLabel, group, key });
    } else unclassifiedHeaderColumns.push({ index, sourceLabel });
  }
  const detailedColumns = columns.filter((column) => column.group === 'detailedAttributes');
  const modernFieldCounts = new Map();
  for (const column of detailedColumns) modernFieldCounts.set(column.key, (modernFieldCounts.get(column.key) ?? 0) + 1);
  const modernFieldSetVerified = modernMetadataVerified
    && modernExpectedDetailedKeys.every((key) => modernFieldCounts.get(key) === 1)
    && detailedColumns.every((column) => modernExpectedDetailedKeys.includes(column.key));
  const headerHash = createHash('sha256').update(headers.map(cleanHeader).join('\n')).digest('hex');
  return {
    edition: Number(edition), sourceUrl: sourceUrl ?? null, tableId: 'playerTable', evidence,
    headerColumnCount: headers.length, headerSha256: headerHash, attributeHeaderRange: { start: attributeStart, endExclusive: attributeEndExclusive },
    headerMappingStrategy: mappingStrategy, rowAlignmentRequired: modernMetadataVerified,
    frontendSourceContract: frontendContract,
    headerBoundaryEvidence: { nationalityHeaderCount: nationalityIndexes.length, minHeaderCount: minIndexes.length, maxHeaderCount: maxIndexes.length, nationalityIndex, minIndex: minIndexes.length === 1 ? minIndexes[0] : null, maxIndex: maxIndexes.length === 1 ? maxIndexes[0] : null, verified: boundaryEvidence, strategy: mappingStrategy },
    columns, expectedDetailedAttributeKeys: modernMetadataVerified ? modernExpectedDetailedKeys : [...new Set(detailedColumns.map((column) => column.key))],
    unclassifiedHeaderColumns, duplicateDetailedKeys: [...duplicateKeys],
    completeHeaderEvidence: boundaryEvidence && detailedColumns.length > 0 && unclassifiedHeaderColumns.length === 0 && duplicateKeys.size === 0
      && (!modernMetadataVerified || modernFieldSetVerified),
  };
}

export function extractWefutHeaderEvidence(html, edition, sourceUrl) {
  const table = String(html ?? '').match(/<table\b[^>]*id\s*=\s*(["'])playerTable\1[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return null;
  const headers = [...table[2].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => cleanHeader(match[1]));
  if (headers.length < 19 || !headers.some((header) => summaryHeaderKeys.has(header.toLowerCase()))) return null;
  const ajaxEndpoint = String(html).match(/"sAjaxSource"\s*:\s*"([^"]+)"/i)?.[1] ?? null;
  const serverSide = /"bServerSide"\s*:\s*true/i.test(String(html));
  const expectedEndpoint = `/ajax/getPlayers/${Number(edition)}`;
  const frontendContract = {
    tableId: 'playerTable', serverSide, ajaxEndpoint,
    verified: serverSide && ajaxEndpoint === expectedEndpoint,
  };
  return makeWefutHeaderEvidence(headers, edition, sourceUrl, 'public_playerTable_header', frontendContract);
}

const fifa14HeaderEvidence = makeWefutHeaderEvidence(fifa14Headers, 14, 'https://wefut.com/player-database/14/', 'cached_public_header');
export function parseWefutAttributes(rawFields, edition, schema = null) {
  const evidence = schema ?? rawFields?.wefutHeaderEvidence ?? (Number(edition) === 14 ? fifa14HeaderEvidence : null);
  const numericRowIndexes = Object.keys(rawFields ?? {}).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
  const rowAlignmentVerified = !evidence?.rowAlignmentRequired || (
    numericRowIndexes.length === evidence.headerColumnCount && numericRowIndexes.every((index, position) => index === position)
  );
  if (!evidence?.columns || evidence.headerBoundaryEvidence?.verified !== true || !rowAlignmentVerified) return {
    attributes: {}, detailedAttributes: {}, summaryAttributes: {}, summaryRatings: {}, skillMetaAttributes: {}, potentialMetaAttributes: {},
    attributes_found: false, attributes_complete: null, attribute_completeness_status: 'unknown', attribute_field_count: 0,
    attributeSourceEvidence: evidence?.columns ? {
      source: 'WeFUT public playerTable header', edition: Number(edition), sourceUrl: evidence.sourceUrl,
      tableId: evidence.tableId, headerSha256: evidence.headerSha256, headerBoundaryEvidence: evidence.headerBoundaryEvidence ?? null,
      expectedDetailedFieldCount: null, observedDetailedFieldCount: 0, observedSummaryFieldCount: 0,
      observedPotentialMetaFieldCount: 0, observedSkillMetaFieldCount: 0, completeHeaderEvidence: false,
      headerMappingStrategy: evidence.headerMappingStrategy ?? 'unverified', rowAlignmentRequired: Boolean(evidence.rowAlignmentRequired),
      observedNumericRowFieldCount: numericRowIndexes.length, rowAlignmentVerified,
      frontendSourceContract: evidence.frontendSourceContract ?? null,
      unclassifiedHeaderColumns: evidence.unclassifiedHeaderColumns ?? [], presentSourceColumns: [],
    } : null,
  };
  const detailedAttributes = {}; const summaryAttributes = {}; const skillMetaAttributes = {}; const potentialMetaAttributes = {};
  const presentRawFields = [];
  for (const column of evidence.columns) {
    const rawValue = rawFields?.[String(column.index)];
    if (rawValue == null || String(rawValue).trim() === '') continue;
    const sourceValue = cleanHeader(rawValue);
    const numeric = /^-?\d+(?:\.\d+)?$/.test(sourceValue) ? Number(sourceValue) : null;
    if (column.group === 'detailedAttributes' && evidence.duplicateDetailedKeys?.includes(column.key)) {
      // Keep both source cells in presentRawFields, but do not choose either
      // occurrence as the normalized value for an ambiguous source label.
    } else if (column.group === 'detailedAttributes' && numeric != null) detailedAttributes[column.key] = numeric;
    else if (column.group === 'summaryRatings' && numeric != null) summaryAttributes[column.key] = numeric;
    else if (column.group === 'potentialMetaAttributes' && numeric != null) potentialMetaAttributes[column.key] = numeric;
    else if (column.group === 'skillMetaAttributes') skillMetaAttributes[column.key] = numeric ?? sourceValue;
    presentRawFields.push({ index: column.index, sourceLabel: column.sourceLabel, group: column.group, value: numeric ?? sourceValue });
  }
  const fieldCount = Object.keys(detailedAttributes).length;
  const expectedKeys = evidence.expectedDetailedAttributeKeys ?? [];
  const complete = evidence.duplicateDetailedKeys?.length || evidence.unclassifiedHeaderColumns?.length
    || (evidence.headerBoundaryEvidence?.verified === true && evidence.completeHeaderEvidence !== true)
    ? false
    : evidence.completeHeaderEvidence && expectedKeys.length > 0
      ? expectedKeys.every((key) => Object.hasOwn(detailedAttributes, key)) && fieldCount === expectedKeys.length
      : null;
  return {
    attributes: detailedAttributes, detailedAttributes, summaryAttributes, summaryRatings: summaryAttributes, skillMetaAttributes, potentialMetaAttributes,
    attributes_found: fieldCount >= 20,
    attributes_complete: complete,
    attribute_completeness_status: complete === true ? 'complete' : complete === false ? (fieldCount ? 'partial' : 'unavailable') : 'unknown',
    attribute_field_count: fieldCount,
    attributeSourceEvidence: {
      source: 'WeFUT public playerTable header', edition: Number(edition), sourceUrl: evidence.sourceUrl,
      tableId: evidence.tableId, headerSha256: evidence.headerSha256,
      headerBoundaryEvidence: evidence.headerBoundaryEvidence ?? null,
      expectedDetailedFieldCount: expectedKeys.length, observedDetailedFieldCount: fieldCount,
      observedSummaryFieldCount: Object.keys(summaryAttributes).length,
      observedPotentialMetaFieldCount: Object.keys(potentialMetaAttributes).length,
      observedSkillMetaFieldCount: Object.keys(skillMetaAttributes).length,
      completeHeaderEvidence: Boolean(evidence.completeHeaderEvidence),
      excludedDuplicateDetailedKeys: evidence.duplicateDetailedKeys ?? [],
      headerMappingStrategy: evidence.headerMappingStrategy ?? 'unverified',
      rowAlignmentRequired: Boolean(evidence.rowAlignmentRequired), observedNumericRowFieldCount: numericRowIndexes.length,
      rowAlignmentVerified, frontendSourceContract: evidence.frontendSourceContract ?? null,
      unclassifiedHeaderColumns: evidence.unclassifiedHeaderColumns ?? [],
      presentSourceColumns: presentRawFields,
    },
  };
}

export function normalizeCandidateAttributeCompleteness(candidate, wefutSchemas = {}) {
  if (candidate.site === 'wefut') {
    const schema = wefutSchemas?.[candidate.edition] ?? null;
    const parsed = parseWefutAttributes(candidate.rawFields ?? {}, candidate.edition, schema);
    const previousHeader = candidate.rawFields?.wefutHeaderEvidence;
    const rawFields = {
      ...(candidate.rawFields ?? {}),
      ...(schema ? {
        ...(previousHeader?.headerSha256 && previousHeader.headerSha256 !== schema.headerSha256 ? { wefutHeaderEvidenceAtAcquisition: previousHeader } : {}),
        wefutHeaderEvidence: schema,
      } : {}),
      attributeSourceEvidence: parsed.attributeSourceEvidence,
    };
    return { ...candidate, ...parsed, rawFields };
  }
  const attributes = candidate.detailedAttributes ?? candidate.attributes ?? {};
  const fieldCount = Object.keys(attributes).length;
  if (candidate.site === 'nexon-fco') {
    const raw = candidate.rawFields ?? {};
    const nativeParsed = Array.isArray(raw.abilityAttributesRaw) ? normalizeNexonAttributeEntries(raw.abilityAttributesRaw) : null;
    const sourceAttributes = nativeParsed?.attributes ?? candidate.detailedAttributes ?? candidate.attributes ?? {};
    const numericAttributes = Object.fromEntries(Object.entries(sourceAttributes).flatMap(([key, value]) => {
      const number = typeof value === 'number' ? value : /^-?\d+(?:\.\d+)?$/.test(String(value ?? '').trim()) ? Number(value) : null;
      return number != null && Number.isFinite(number) ? [[key, number]] : [];
    }));
    const numericValues = Object.values(numericAttributes);
    const nonzeroCount = numericValues.filter((value) => value !== 0).length;
    const allZeroPlaceholderPattern = numericValues.length > 0 && nonzeroCount === 0;
    const loadedNumericEvidence = numericValues.length > 0 && nonzeroCount > 0;
    const activeAttributes = allZeroPlaceholderPattern ? {} : numericAttributes;
    const activeFieldCount = Object.keys(activeAttributes).length;
    const detailedEntryCount = nativeParsed?.detailedAttributeEntryCount ?? Number(raw.detailedAttributeEntryCount);
    const summaryCount = nativeParsed?.summaryRatingCount ?? Number(raw.nativeSummaryRatingCount);
    const nativeCount = nativeParsed ? raw.abilityAttributesRaw.length : Number(raw.nativeAbilityEntryCount);
    const detailedFieldCount = nativeParsed?.detailedAttributeCount ?? Number(raw.detailedAttributeCount);
    const unclassifiedCount = nativeParsed?.unclassifiedEntryCount ?? Number(raw.unclassifiedAttributeEntryCount ?? 0);
    const attributesAmbiguous = nativeParsed?.attributes_ambiguous ?? Boolean(candidate.attributes_ambiguous);
    const expectedSetObserved = nativeCount === 40 && summaryCount === 6 && detailedEntryCount === 34;
    const complete = expectedSetObserved && detailedFieldCount === 34 && activeFieldCount === 34 && loadedNumericEvidence && !attributesAmbiguous && unclassifiedCount === 0;
    const knownPartial = [nativeCount, summaryCount, detailedEntryCount, detailedFieldCount].some(Number.isFinite);
    const usableAttributesFound = activeFieldCount >= 20 && loadedNumericEvidence && !attributesAmbiguous && unclassifiedCount === 0;
    const summaryRatings = nativeParsed?.summaryRatings ?? candidate.summaryRatings ?? candidate.summaryAttributes ?? {};
    return {
      ...candidate, attributes: activeAttributes, detailedAttributes: activeAttributes, summaryRatings, attribute_field_count: activeFieldCount,
      attributes_found: usableAttributesFound,
      attributes_complete: complete ? true : knownPartial ? false : null,
      attributes_ambiguous: attributesAmbiguous,
      attribute_completeness_status: complete ? 'complete' : allZeroPlaceholderPattern || !activeFieldCount ? 'unavailable' : knownPartial ? 'partial' : 'unknown',
      attributeSourceEvidence: { source: 'Nexon PlayerAbility section audit', expectedNativeEntries: 40, expectedSummaryRatings: 6, expectedDetailedAttributes: 34, observedNativeEntries: Number.isFinite(nativeCount) ? nativeCount : null, observedSummaryRatings: Number.isFinite(summaryCount) ? summaryCount : null, observedDetailedEntries: Number.isFinite(detailedEntryCount) ? detailedEntryCount : null, observedDetailedFieldCount: activeFieldCount, observedNumericDetailedValues: numericValues.length, nonzeroDetailedValues: nonzeroCount, allZeroPlaceholderPattern, loadedNumericEvidence, rawOrderedEntriesRetained: Array.isArray(raw.abilityAttributesRaw) },
    };
  }
  const complete = fieldCount === 0 ? false : null;
  return {
    ...candidate, attributes, detailedAttributes: attributes, summaryRatings: candidate.summaryRatings ?? candidate.summaryAttributes ?? {}, attribute_field_count: fieldCount,
    attributes_found: Boolean(candidate.attributes_found || fieldCount >= 20),
    attributes_complete: complete,
    attribute_completeness_status: fieldCount === 0 ? 'unavailable' : 'unknown',
    attributeSourceEvidence: { source: candidate.site === 'fo4' || candidate.site === 'fo3' ? 'FIFA Addict profile extraction' : null, expectedDetailedFieldCount: null, observedDetailedFieldCount: fieldCount, expectedSetVerified: false },
  };
}

export async function loadWefutHeaderSchemasFromCache(cacheDirectories, editions = Array.from({ length: 14 }, (_, index) => index + 14)) {
  const schemas = {};
  for (const edition of editions) {
    const url = `https://wefut.com/player-database/${edition}/`;
    const key = createHash('sha256').update(`GET ${url}`).digest('hex');
    for (const directory of cacheDirectories) {
      try {
        const response = JSON.parse(await readFile(`${directory}/${key}.json`, 'utf8'));
        if (Number(response.status) < 200 || Number(response.status) >= 300 || typeof response.text !== 'string') continue;
        const schema = extractWefutHeaderEvidence(response.text, edition, response.url || url);
        if (schema) { schemas[edition] = schema; break; }
      } catch { /* This edition has no saved successful public-page header in this cache. */ }
    }
  }
  if (!schemas[14]) schemas[14] = fifa14HeaderEvidence;
  return schemas;
}

function entityKey(record) {
  try { return searchEntityKeyFor(record); } catch { return null; }
}

export function mergeWorkerProgress(players, workerProgressBySite, sites = Object.keys(workerProgressBySite), options = {}) {
  const playerKeys = assertUniqueSearchEntityKeys(players);
  const playerKeySet = new Set(playerKeys);
  const playerByKey = new Map(players.map((player, index) => [playerKeys[index], player]));
  const merged = { schemaVersion: 'historical-card-search-progress/1', generatedAt: new Date().toISOString(), completed: {}, candidates: [], observations: [], errors: [], haltedSites: {}, sourceAccounting: {} };

  for (const site of sites) {
    const source = workerProgressBySite[site];
    if (!source || typeof source !== 'object') throw new Error(`Missing worker checkpoint for ${site}.`);
    const prefix = `${site}:`;
    const allSiteJobs = Object.entries(source.completed ?? {}).filter(([key]) => key.startsWith(prefix));
    const ownJobs = allSiteJobs.filter(([key]) => playerKeySet.has(key.slice(prefix.length)));
    const ownJobKeys = new Set(ownJobs.map(([key]) => key.slice(prefix.length)));
    const missing = playerKeys.filter((key) => !ownJobKeys.has(key));
    if (missing.length) throw new Error(`${site} checkpoint is missing ${missing.length}/${players.length} input jobs; first missing key: ${missing[0]}`);
    for (const [key, state] of ownJobs) merged.completed[key] = state;

    const ownCandidates = (source.candidates ?? []).filter((candidate) => candidate.site === site && playerKeySet.has(entityKey(candidate)));
    const ownObservations = (source.observations ?? []).filter((observation) => observation.site === site && playerKeySet.has(entityKey(observation)));
    const latestObservationByJob = new Map();
    for (const observation of ownObservations) latestObservationByJob.set(`${site}:${entityKey(observation)}`, observation);
    let missingObservationCount = 0;
    for (const key of playerKeys) {
      const jobKey = `${site}:${key}`;
      if (latestObservationByJob.has(jobKey)) continue;
      missingObservationCount++;
      const player = playerByKey.get(key);
      const error = { site, playerId: player.playerId ?? null, searchEntityKey: key, canonicalName: player.canonicalName, kind: 'merge_missing_job_observation', reason: 'The worker recorded an attempted job but no search observation; result is unknown, not an empty search.' };
      merged.errors.push(error);
      latestObservationByJob.set(jobKey, {
        site, playerId: player.playerId ?? null, searchEntityKey: key, canonicalName: player.canonicalName,
        observations: [{ status: 'failed', requestSucceeded: false, searchCompleteness: 'unknown', possiblyTruncated: true, reason: error.reason }],
        cardCandidates: 0, searchSucceeded: false, searchCompleteness: 'unknown', truncated: true, blocked_or_unavailable: false, missingObservation: true,
      });
    }
    merged.observations.push(...playerKeys.map((key) => latestObservationByJob.get(`${site}:${key}`)));

    const refreshedCandidates = ownCandidates.map((candidate) => {
      const player = playerByKey.get(entityKey(candidate));
      if (!player) return candidate;
      return refreshCandidateIdentity(player, normalizeCandidateAttributeCompleteness(applySourceLocalCardIdentity(candidate), options?.wefutSchemas));
    });
    merged.candidates.push(...refreshedCandidates);
    const ownErrors = (source.errors ?? []).filter((error) => error.site === site && playerKeySet.has(entityKey(error)));
    merged.errors.push(...ownErrors);
    if (source.haltedSites?.[site]) merged.haltedSites[site] = source.haltedSites[site];
    const confidenceCounts = { high: 0, low: 0, none: 0, unverified: 0 };
    for (const candidate of refreshedCandidates) confidenceCounts[candidate.identity_confidence] = (confidenceCounts[candidate.identity_confidence] ?? 0) + 1;
    merged.sourceAccounting[site] = {
      attemptedInputJobs: ownJobs.length,
      jobsPendingRetry: ownJobs.filter(([, state]) => state?.failed === true).length,
      candidatesIncluded: refreshedCandidates.length,
      observationsIncluded: latestObservationByJob.size,
      missingObservationsRecorded: missingObservationCount,
      errorsIncluded: ownErrors.length + missingObservationCount,
      foreignOrOutOfScopeJobKeysExcluded: Object.keys(source.completed ?? {}).length - ownJobs.length,
      foreignOrOutOfScopeCandidatesExcluded: (source.candidates ?? []).length - ownCandidates.length,
      foreignOrOutOfScopeObservationsExcluded: (source.observations ?? []).length - ownObservations.length,
      foreignOrOutOfScopeErrorsExcluded: (source.errors ?? []).length - ownErrors.length,
      identityConfidenceCounts: confidenceCounts,
      offlineNexonAttributeReparse: site === 'nexon-fco' ? source.offlineNexonAttributeReparse ?? null : null,
    };
  }
  return merged;
}

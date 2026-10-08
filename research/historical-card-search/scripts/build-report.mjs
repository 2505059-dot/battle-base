import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageAtRosterYear, ageConflictAtRosterYear, identityLinkedForSeason } from './age-evidence.mjs';
import { searchCompletenessOf } from './search-completeness.mjs';
import { searchEntityKeyFor } from './search-entity-key.mjs';
const DIR = fileURLToPath(new URL('../', import.meta.url));
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function save(file, value) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
const checkpointPath = resolve(DIR, '.cache/full-progress.json');
try {
  await access(checkpointPath);
} catch {
  throw new Error('[build-report] UNAVAILABLE: the full progress checkpoint is absent; baseline v2 excludes raw candidates and does not rebuild coverage from an empty dataset.');
}
const [playersDoc, seasonsDoc, sourceSummary, progress] = await Promise.all([
  json(resolve(DIR, 'inputs/players.json')),
  json(resolve(DIR, 'inputs/player-seasons.json')),
  json(resolve(DIR, 'inputs/source-summary.json')),
  json(resolve(DIR, '.cache/full-progress.json')),
]);
let wefutHeaderAuditInput = null;
try { wefutHeaderAuditInput = await json(resolve(DIR, 'results/wefut-edition-headers.json')); } catch { /* Header collection may not have run yet. */ }
const candidates = progress.candidates ?? [];
const sites = ['wefut', 'fo4', 'fo3', 'nexon-fco'];
const primarySites = ['wefut', 'fo4', 'fo3'];
const entityKeyInProgress = searchEntityKeyFor;
const jobKeyFor = (site, record) => `${site}:${entityKeyInProgress(record) ?? 'missing-entity-key'}`;
const responseReceived = (observation) => (observation?.observations ?? []).some((item) => item.requestSucceeded === true);
const nameFilterVerified = (observation) => (observation?.observations ?? []).some((item) => item.filterVerified === true || item.searchFilterVerified === true);
const errorsByJob = new Map();
for (const error of progress.errors ?? []) {
  const key = jobKeyFor(error.site, error);
  if (!errorsByJob.has(key)) errorsByJob.set(key, []);
  errorsByJob.get(key).push(error);
}
const observationsByJob = new Map((progress.observations ?? []).map((o) => [jobKeyFor(o.site, o), o]));
const perSite = {};
for (const site of sites) {
  const siteCandidates = candidates.filter((c) => c.site === site);
  const siteObs = (progress.observations ?? []).filter((o) => o.site === site);
  const siteJobs = Object.entries(progress.completed ?? {}).filter(([key]) => key.startsWith(`${site}:`));
  const pendingRetryJobs = siteJobs.filter(([, state]) => state?.failed === true).length;
  const completeJobs = siteJobs.length - pendingRetryJobs;
  const observedPlayers = new Set(siteCandidates.map(entityKeyInProgress).filter(Boolean));
  const candidatePlayers = new Set(siteCandidates.filter((candidate) => candidate.identity_confidence !== 'none').map(entityKeyInProgress).filter(Boolean));
  const identityLinked = siteCandidates.filter((c) => ['high', 'low'].includes(c.identity_confidence));
  const linkedPlayers = new Set(identityLinked.map(entityKeyInProgress).filter(Boolean));
  const unverifiedPlayers = new Set(siteCandidates.filter((c) => c.identity_confidence === 'unverified').map(entityKeyInProgress).filter(Boolean));
  const confirmedPlayers = new Set(siteCandidates.filter((c) => c.identity_confidence === 'high').map(entityKeyInProgress).filter(Boolean));
  const attrPlayers = new Set(identityLinked.filter((c) => c.attributes_found).map(entityKeyInProgress).filter(Boolean));
  const completeAttrPlayers = new Set(identityLinked.filter((c) => c.attributes_complete === true).map(entityKeyInProgress).filter(Boolean));
  const unverifiedAttrPlayers = new Set(siteCandidates.filter((c) => c.identity_confidence === 'unverified' && c.attributes_found).map(entityKeyInProgress).filter(Boolean));
  const detailedFieldCounts = siteCandidates.map((candidate) => Number(candidate.attribute_field_count ?? Object.keys(candidate.detailedAttributes ?? candidate.attributes ?? {}).length)).filter(Number.isFinite);
  const attributeCompletenessCounts = Object.fromEntries(['complete', 'partial', 'unknown', 'unavailable'].map((status) => [status, siteCandidates.filter((candidate) => candidate.attribute_completeness_status === status).length]));
  const wefutEditionAttributeSummary = site === 'wefut' ? Object.fromEntries([...new Set(siteCandidates.map((candidate) => Number(candidate.edition)).filter(Number.isFinite))].sort((a, b) => a - b).map((edition) => {
    const editionCandidates = siteCandidates.filter((candidate) => Number(candidate.edition) === edition);
    const counts = editionCandidates.map((candidate) => Number(candidate.attribute_field_count ?? 0)).filter(Number.isFinite);
    return [edition, {
      candidateRecords: editionCandidates.length,
      usableDetailedAttributeCandidates: editionCandidates.filter((candidate) => candidate.attributes_found).length,
      completeDetailedAttributeCandidates: editionCandidates.filter((candidate) => candidate.attributes_complete === true).length,
      completeness: Object.fromEntries(['complete', 'partial', 'unknown', 'unavailable'].map((status) => [status, editionCandidates.filter((candidate) => candidate.attribute_completeness_status === status).length])),
      observedDetailedFieldCountRange: counts.length ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
      sourceHeaderEvidence: editionCandidates.find((candidate) => candidate.attributeSourceEvidence)?.attributeSourceEvidence ?? null,
    }];
  })) : null;
  const nativeEntryCounts = {};
  for (const candidate of siteCandidates) {
    const count = Number(candidate.rawFields?.nativeAbilityEntryCount);
    if (Number.isFinite(count)) nativeEntryCounts[count] = (nativeEntryCounts[count] ?? 0) + 1;
  }
  const errorCounts = {};
  for (const e of (progress.errors ?? []).filter((e) => e.site === site)) {
    const kind = e.status === 0 ? 'transport_error' : e.status ? `http_${e.status}` : e.kind ?? 'parse_or_adapter_error';
    errorCounts[kind] = (errorCounts[kind] ?? 0) + 1;
  }
  perSite[site] = {
    role: site === 'nexon-fco' ? 'optional_fallback' : 'primary',
    searchedEntities: playersDoc.players.length,
    attemptedPlayerJobs: siteJobs.length,
    completedPlayerJobs: completeJobs,
    jobsPendingRetry: pendingRetryJobs,
    jobsWithSuccessfulHttpResponse: siteObs.filter(responseReceived).length,
    httpResponseRate: playersDoc.players.length ? siteObs.filter(responseReceived).length / playersDoc.players.length : 0,
    jobsWithVerifiedSearchFilter: siteObs.filter(nameFilterVerified).length,
    jobsWithCompleteSearchCoverage: siteObs.filter((o) => o.searchCompleteness === 'complete').length,
    jobsWithPartialOrUnknownSearchCoverage: Math.max(0, playersDoc.players.length - siteObs.filter((o) => o.searchCompleteness === 'complete').length),
    searchCompletenessDenominator: playersDoc.players.length,
    searchCompletenessCoverageRate: siteObs.filter((o) => o.searchCompleteness === 'complete').length / playersDoc.players.length,
    jobsWithCompleteStaticNameGroups: siteObs.filter((o) => (o.observations ?? []).some((x) => x.staticNameFamilyCompleteness === 'complete_for_exact_normalized_name_group_in_official_static_index')).length,
    playersWithAnyCandidateRows: observedPlayers.size,
    playersWithCandidateCard: candidatePlayers.size,
    playersWithIdentityQualifiedCandidates: linkedPlayers.size,
    playersWithUnverifiedCandidates: unverifiedPlayers.size,
    playersWithConfirmedLinkedIdentity: confirmedPlayers.size,
    candidateRecords: siteCandidates.length,
    candidateRecordsWithOverall: siteCandidates.filter((c) => c.overall_found).length,
    candidateRecordsWithUsableDetailedAttributes: siteCandidates.filter((c) => c.attributes_found).length,
    candidateRecordsWithCompleteDetailedAttributes: siteCandidates.filter((c) => c.attributes_complete === true).length,
    candidateRecordsWithPartialDetailedAttributes: attributeCompletenessCounts.partial,
    candidateRecordsWithUnknownDetailedAttributeCompleteness: attributeCompletenessCounts.unknown,
    candidateRecordsWithUnavailableDetailedAttributes: attributeCompletenessCounts.unavailable,
    observedDetailedFieldCountRange: detailedFieldCounts.length ? { min: Math.min(...detailedFieldCounts), max: Math.max(...detailedFieldCounts) } : null,
    wefutAttributeCompletenessByEdition: wefutEditionAttributeSummary,
    candidateRecordsWithSummaryRatings: siteCandidates.filter((c) => Object.keys(c.summaryAttributes ?? {}).length > 0).length,
    candidateRecordsWithPotentialMetadata: siteCandidates.filter((c) => Object.keys(c.potentialMetaAttributes ?? {}).length > 0).length,
    candidateRecordsWithCompleteNexonDetailedFieldSet: site === 'nexon-fco' ? siteCandidates.filter((c) => c.attributes_complete === true).length : null,
    candidateRecordsWith40NativeEntries: site === 'nexon-fco' ? siteCandidates.filter((c) => Number(c.rawFields?.nativeAbilityEntryCount) === 40).length : null,
    candidateRecordsWithAmbiguousAttributes: siteCandidates.filter((c) => c.attributes_ambiguous === true).length,
    nativeAttributeEntryCountDistribution: site === 'nexon-fco' ? nativeEntryCounts : null,
    playersWithIdentityQualifiedUsableAttributes: attrPlayers.size,
    playersWithIdentityQualifiedCompleteAttributes: completeAttrPlayers.size,
    identityQualifiedAttributeRate: attrPlayers.size / playersDoc.players.length,
    playersWithUnverifiedDetailedAttributeCandidates: unverifiedAttrPlayers.size,
    candidatesByIdentityConfidence: Object.fromEntries(['high','low','none','unverified'].map((level) => [level, siteCandidates.filter((c) => c.identity_confidence === level).length])),
    possibleTruncationObservations: siteObs.reduce((n, o) => n + Number(o.truncated || false), 0),
    failureReasons: errorCounts,
  };
}
const perPlayerSeason = seasonsDoc.playerSeasons.map((season) => {
  const player = playersDoc.players.find((p) => p.playerSeasonIds.includes(season.playerSeasonId));
  const bySite = {};
  for (const site of sites) {
    const currentJobKey = jobKeyFor(site, player);
    const obs = observationsByJob.get(currentJobKey);
    const completeness = searchCompletenessOf(obs?.observations ?? []);
    const matches = candidates.filter((c) => c.site === site && entityKeyInProgress(c) === player.searchEntityKey);
    const ageConflicts = matches.filter((c) => ageConflictAtRosterYear(c, season));
    const linked = matches.filter((c) => identityLinkedForSeason(c, season));
    const errors = errorsByJob.get(currentJobKey) ?? [];
    const httpResponseSucceeded = responseReceived(obs);
    const filterVerified = nameFilterVerified(obs);
    const high = linked.some((c) => c.identity_confidence === 'high');
    const low = linked.some((c) => c.identity_confidence === 'low');
    const unverified = linked.some((c) => c.identity_confidence === 'unverified');
    bySite[site] = {
      http_response_succeeded: httpResponseSucceeded,
      search_completeness: obs?.searchCompleteness ?? completeness.state,
      possibly_truncated: Boolean(obs?.truncated || completeness.possiblyTruncated),
      search_filter_verified: obs ? filterVerified : null,
      candidate_observed: matches.length > 0,
      query_matched_candidate: matches.some((candidate) => candidate.identity_confidence !== 'none'),
      card_found: linked.length > 0,
      confirmed_linked_identity: high,
      overall_found: linked.some((c) => c.overall_found),
      attributes_found: linked.some((c) => c.attributes_found),
      attributes_complete: linked.some((c) => c.attributes_complete === true),
      attribute_completeness_status: linked.some((c) => c.attributes_complete === true) ? 'complete' : linked.some((c) => c.attribute_completeness_status === 'partial') ? 'partial' : linked.some((c) => c.attribute_completeness_status === 'unknown') ? 'unknown' : linked.length ? 'unavailable' : 'not_observed',
      observedDetailedAttributeFields: linked.map((candidate) => ({ cardId: candidate.cardId ?? null, sourceCardId: candidate.sourceCardId ?? null, sourceIdNamespace: candidate.sourceIdNamespace ?? null, edition: candidate.edition ?? null, fieldCount: candidate.attribute_field_count ?? Object.keys(candidate.detailedAttributes ?? candidate.attributes ?? {}).length, completeness: candidate.attribute_completeness_status ?? 'unknown' })),
      identity_confidence: high ? 'high' : low ? 'low' : unverified ? 'unverified' : 'none',
      identity_conflict: ageConflicts.length > 0,
      identity_conflict_reason: ageConflicts.length ? `Profile DOB implies age ${ageAtRosterYear(ageConflicts[0], season)} under 14 at roster year ${season.year}.` : null,
      historical_relevance: linked.some((c) => c.historical_relevance === 'confirmed') ? 'confirmed' : linked.some((c) => c.historical_relevance === 'possible') ? 'possible' : 'unverified',
      blocked_or_unavailable: errors.some((e) => [0, 401, 403, 429].includes(Number(e.status))),
      candidateCount: matches.length,
      rejectedNameRows: matches.filter((c) => c.identity_confidence === 'none').length,
      ageConflictingCandidateCount: ageConflicts.length,
      candidateRefs: matches.map((c) => c.detailUrl || c.sourceUrl),
      failureReasons: errors.map((e) => ({ status: e.status ?? null, kind: e.kind ?? null, reason: e.error ?? e.reason ?? null, url: e.url ?? e.detailUrl ?? null })),
      noResultMeaning: !matches.some((candidate) => candidate.identity_confidence !== 'none') && httpResponseSucceeded ? 'no_query_matched_candidate_observed_not_global_absence' : null,
    };
  }
  return {
    playerSeasonId: season.playerSeasonId, searchEntityKey: player.searchEntityKey, teamSeasonId: season.teamSeasonId,
    rosterName: season.rosterName, canonicalPlayerId: season.canonicalPlayerId,
    canonicalName: player.canonicalName, club: season.club, year: season.year,
    abilityV2BaselineUnavailable: season.abilityV2BaselineUnavailable,
    abilityV2NameOrAmbiguousFindings: season.abilityV2NameOrAmbiguousFindings,
    abilityV2PositionFindings: season.abilityV2PositionFindings,
    sites: bySite,
  };
});
const fo4GapRows = perPlayerSeason.filter((row) => !row.sites.fo4.attributes_found);
const potentialNexonRows = fo4GapRows.filter((row) => row.sites['nexon-fco'].attributes_found && row.sites['nexon-fco'].identity_confidence === 'unverified');
const identityQualifiedNexonRows = fo4GapRows.filter((row) => row.sites['nexon-fco'].attributes_found && ['high','low'].includes(row.sites['nexon-fco'].identity_confidence));
const nexonCandidates = candidates.filter((candidate) => candidate.site === 'nexon-fco');
const nexonCompleteDetailCandidates = nexonCandidates.filter((candidate) => candidate.attributes_complete === true);
const nexonPotentialGapRows = potentialNexonRows;
const priorityClubs = ['Valencia', 'Deportivo La Coruna', 'Lazio', 'Porto'];
const priorityClubFocus = priorityClubs.map((club) => {
  const rows = perPlayerSeason.filter((row) => row.club === club);
  return {
    club,
    playerSeasonRows: rows.length,
    uniqueSearchEntities: new Set(rows.map((row) => row.searchEntityKey)).size,
    bySite: Object.fromEntries(sites.map((site) => {
      const siteRows = rows.map((row) => row.sites[site]);
      return [site, {
        rowsWithCandidates: siteRows.filter((row) => row.candidate_observed).length,
        rowsWithIdentityQualifiedCards: siteRows.filter((row) => ['high', 'low'].includes(row.identity_confidence)).length,
        rowsWithUnverifiedCandidates: siteRows.filter((row) => row.identity_confidence === 'unverified').length,
        rowsWithIdentityQualifiedOverall: siteRows.filter((row) => ['high', 'low'].includes(row.identity_confidence) && row.overall_found).length,
        rowsWithIdentityQualifiedAttributes: siteRows.filter((row) => ['high', 'low'].includes(row.identity_confidence) && row.attributes_found).length,
        rowsWithUnverifiedAttributes: siteRows.filter((row) => row.identity_confidence === 'unverified' && row.attributes_found).length,
        completeSearchRows: siteRows.filter((row) => row.search_completeness === 'complete').length,
        partialOrUnknownSearchRows: siteRows.filter((row) => row.search_completeness !== 'complete').length,
      }];
    })),
  };
});
const report = {
  schemaVersion: 'historical-card-search-coverage/1', generatedAt: new Date().toISOString(),
  inputCounts: sourceSummary.counts,
  wefutHeaderAudit: wefutHeaderAuditInput ? {
    source: wefutHeaderAuditInput.source ?? null,
    generatedAt: wefutHeaderAuditInput.generatedAt ?? null,
    rateLimitMs: wefutHeaderAuditInput.rateLimitMs ?? null,
    editions: (wefutHeaderAuditInput.entries ?? []).map((entry) => ({
      edition: entry.edition, status: entry.status, httpStatus: entry.httpStatus ?? null,
      url: entry.url ?? null, headerColumnCount: entry.headerEvidence?.headerColumnCount ?? null,
      headerSha256: entry.headerEvidence?.headerSha256 ?? null,
      headerMappingStrategy: entry.headerEvidence?.headerMappingStrategy ?? 'unverified',
      rowAlignmentRequired: entry.headerEvidence?.rowAlignmentRequired ?? false,
      frontendSourceContract: entry.headerEvidence?.frontendSourceContract ?? null,
      expectedDetailedFieldCount: entry.headerEvidence?.expectedDetailedAttributeKeys?.length ?? null,
      expectedDetailedAttributeKeys: entry.headerEvidence?.expectedDetailedAttributeKeys ?? [],
      potentialMetadataColumns: entry.headerEvidence?.columns?.filter((column) => column.group === 'potentialMetaAttributes') ?? [],
      unclassifiedHeaderColumns: entry.headerEvidence?.unclassifiedHeaderColumns ?? [],
      headerBoundaryEvidence: entry.headerEvidence?.headerBoundaryEvidence ?? null,
      completeHeaderEvidence: entry.headerEvidence?.completeHeaderEvidence ?? null,
    })),
  } : { status: 'not_collected', editions: [] },
  primarySites, fallbackSites: ['nexon-fco'],
  auditNote: 'The checked-in ability-v2 audit has overlapping categories; its 92 unavailable rows, 89 name/ambiguity findings, and 41 position findings do not define a 42-row cohort.',
  siteSummary: perSite,
  priorityClubFocus: {
    playerSeasonRows: priorityClubFocus.reduce((sum, club) => sum + club.playerSeasonRows, 0),
    uniqueSearchEntities: new Set(perPlayerSeason.filter((row) => priorityClubs.includes(row.club)).map((row) => row.searchEntityKey)).size,
    auditNote: 'The source audit does not identify a disjoint, exact 42-row unresolved cohort. This section reports all roster rows for the four requested clubs without inferring one.',
    clubs: priorityClubFocus,
  },
  potentialFallbackCoverage: {
    fo4RowsWithoutDetailedAttributes: fo4GapRows.length,
    fo4GapRowsWithUnverifiedNexonAttributeCandidates: potentialNexonRows.length,
    fo4GapRowsWithIdentityQualifiedNexonAttributes: identityQualifiedNexonRows.length,
    verifiedSameCardAttributeFills: 0,
    note: 'Nexon search uses Korean display names and exact normalized same-name static-index groups. Its 40 native entries are separated into 6 card summary ratings and 34 detailed attributes. Without independent DOB/nationality/player-ID crosswalk, these remain unverified candidates and no FO4 same-card attribute fill is verified.',
  },
  failureSemantics: 'blocked_or_unavailable is reserved for transport errors and explicit auth/rate-limit statuses (401/403/429); transient server responses such as HTTP 5xx remain in failureReasons and pending-retry counts, not labeled as access blocks.',
  nexonOfficialConclusion: {
    source: 'Official FC Online (Nexon) public static SPID/season metadata and DataCenter PlayerList/PlayerAbility pages.',
    candidateRecords: nexonCandidates.length,
    distinctInputEntitiesWithCompleteDetailedAttributes: new Set(nexonCompleteDetailCandidates.map(entityKeyInProgress).filter(Boolean)).size,
    candidatePlayerSeasonsWithCompleteDetailedAttributes: perPlayerSeason.filter((row) => row.sites['nexon-fco'].attributes_complete && row.sites['nexon-fco'].identity_confidence === 'unverified').length,
    completeDetailedAttributeCandidateRecords: nexonCompleteDetailCandidates.length,
    detailedAttributesPerCompleteCandidate: 34,
    summaryRatingsPerCompleteCandidate: 6,
    sourceEntriesPerCompleteCandidate: 40,
    selectedAbilityState: { n1Strong: 1, n1Grow: 0, teamColorAndOtherModifiers: 0, baseStateVerified: false },
    fo4CandidateRecordsWithUsableDetailedAttributes: candidates.filter((candidate) => candidate.site === 'fo4' && candidate.attributes_found).length,
    fo4CandidateRecordsWithCompleteDetailedAttributes: candidates.filter((candidate) => candidate.site === 'fo4' && candidate.attributes_complete === true).length,
    fo4RowsWithoutDetailedAttributes: fo4GapRows.length,
    possibleInputRowGapCandidatesFromNexon: nexonPotentialGapRows.length,
    possibleDistinctInputEntitiesWithNexonGapCandidates: new Set(nexonPotentialGapRows.map((row) => row.searchEntityKey)).size,
    verifiedSameCardAttributeFills: 0,
    identityLinkStatus: 'Nexon SPIDs and names remain source-local; no reliable same-card cross-source link is established in the inspected records.',
    interpretation: 'Only records with the audited 40 native entries (6 summary ratings plus 34 detailed attributes), all 34 distinct detailed fields, no ambiguity, and no unclassified entries are marked complete. Its selected n1Strong=1 ability state is preserved; base values are unverified. Nexon candidates that overlap FO4 attribute gaps are possible input-level candidates only, not verified same-card fills.',
  },
  playerSeasonCoverage: perPlayerSeason,
  sourceLimitations: {
    wefut: 'The recorded acquisition batch used a 74-column DataTables POST with its page-set CSRF cookie. Cached successful responses for editions 22 and 27 contain 75 contiguous numeric row fields matching their 75 public playerTable headers. The reusable adapter now derives request width from each successfully parsed playerTable and does not send a search POST when that width is unknown. Editions 14–17 and 19 have unique Nation/Nationality/Min/Max header boundaries; editions 20–21 expose 75 labeled columns but lack the Min/Max boundary required by the legacy mapper and remain unknown. Edition 18 page GET returned HTTP 500, so its header is unavailable. Editions 22–27 use a separate strategy requiring the same page’s server-side /ajax/getPlayers/{edition} contract plus unique Rating/Rtg, Position(s)/Pos, and Nation labels at the checked metadata columns; every candidate row must align to the 75-column vector. Modern completeness requires a fixed 35-field detail set, including labeled Composure; a missing expected field cannot shrink that set. Only labeled values are mapped: Potential is development metadata and blank work-rate columns are never inferred. Duplicate detail labels are retained raw but excluded from active values. Raw numeric row cells are preserved. An edition without an aligned verified header remains unknown and yields no active normalized attributes. Rows are accepted only when their names lexically align with the searched identity; unrelated rows stop that query and mark search filtering unverified. Editions FIFA14–FC27 are configurable; FC27 was observed populated.',
    fo4: 'Public search page and SSR detail pages only. Search-page pagination is unverified; the one-page search is reported as partial/possibly truncated. Server-rendered detailed-attribute zeros are placeholders; the separate hydrated API returned HTTP 401 to ordinary retrieval and was not bypassed. Six summary attributes are retained separately from detailed attributes. Opaque profile route IDs remain source-local; no reliable same-card cross-source link has been established in the inspected records, which does not establish that such an ID is absent elsewhere.',
    fo3: 'Public all-season search uses the observed 500-row UI limit; rows at the cap may be truncated and lower counts still have unknown one-page completeness. Detail SSR returned blank stat fields in the checked sample, recorded as placeholders rather than values. Related-card sections may be partial.',
    'nexon-fco': 'Optional FC Online fallback. Uses public SPID and seasonid static JSON, PlayerList page 1 name search, and PlayerAbility. Full name-search completeness is unknown/partial; exact normalized Korean-name groups from the static index can be enumerated completely for returned seed names, separately from full search coverage. The 40 source li.ab entries are preserved in order and split by DOM section into 6 card summary ratings and 34 detailed attributes. PlayerAbility uses page-default n1Strong=1/n1Grow=0 and zero team modifiers. The selected state is retained and base_state_verified=false; no subtraction or cross-game conversion is performed. Same Korean-name static groups are candidates only; identity stays unverified without an independent crosswalk.',
    identity: 'Exact names alone remain low confidence; high confidence requires an explicitly verified same-namespace ID or documented crosswalk to an input external-ID namespace. Current site-local IDs have no verified crosswalk to the checked-in SoFIFA/FIFAIndex IDs. Rows with identity_confidence=none remain in candidate files for audit but do not set per-PlayerSeason card/OVR/attribute coverage.',
    history: 'Historical relevance remains unverified unless direct card evidence establishes the target club-season; no rating conversion or top-OVR selection is performed.',
  },
};
await save(resolve(DIR, 'results/coverage-report.json'), report);
console.log(JSON.stringify({ output: 'results/coverage-report.json', playerSeasons: perPlayerSeason.length, sites: perSite, potentialFallbackCoverage: report.potentialFallbackCoverage }, null, 2));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertUniqueSearchEntityKeys, searchEntityKeyFor } from './search-entity-key.mjs';
import { createHttpTransport } from './http-transport.mjs';
import { shouldRetryJob } from './job-retry.mjs';
import { searchCompletenessOf } from './search-completeness.mjs';
import { wefutPaginationCompleteness } from './wefut-pagination.mjs';
import { buildWefutPostBody, wefutRequestColumnCount } from './wefut-request.mjs';
import { normalizeNexonAttributeEntries, parseNexonAttributeEntries } from './nexon-attributes.mjs';
import { applySourceLocalCardIdentity } from './source-card-identity.mjs';
import { classifyIdentity, refreshCandidateIdentity } from './identity-evidence.mjs';
import { extractWefutHeaderEvidence, mergeWorkerProgress, normalizeCandidateAttributeCompleteness, parseWefutAttributes } from './worker-merge.mjs';
import { candidateDataProjection, compactCandidateEvidence, preservedCandidateBaseline } from './compact-candidates.mjs';
const DIR = fileURLToPath(new URL('../', import.meta.url));
const cacheRoot = resolve(DIR, '.cache');
await mkdir(cacheRoot, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); checks++; }
function response(status, url) {
  return { status, url, headers: { get: () => 'text/plain', getSetCookie: () => [] }, text: async () => `status-${status}` };
}
const compactFixture = {
  site: 'wefut', edition: 14, searchEntityKey: 'player:1', cardId: 91,
  sourceUrl: 'https://wefut.com/player/14/91/example', detailUrl: 'https://wefut.com/player/14/91/example',
  attributes: { Acceleration: 82 }, detailedAttributes: { Acceleration: 82 }, rawCardMarkup: '<div class="card">91</div>',
  rawFields: {
    '0': '91', '19': '82', player_card: '<div class="card">91</div>', player_url: 'player/14/91/example',
    wefutHeaderEvidence: { edition: 14, headerSha256: 'a'.repeat(64), columns: [{ index: 19, sourceLabel: 'Acceleration' }] },
    attributeSourceEvidence: { headerSha256: 'a'.repeat(64), expectedDetailedFieldCount: 34, observedDetailedFieldCount: 1 },
  },
  attributeSourceEvidence: { headerSha256: 'a'.repeat(64), expectedDetailedFieldCount: 34, observedDetailedFieldCount: 1, presentSourceColumns: [{ index: 19, sourceLabel: 'Acceleration' }] },
};
const compactFixtureHeaders = { entries: [{ edition: 14, headerEvidence: { headerSha256: 'a'.repeat(64) } }] };
const compactedFixture = compactCandidateEvidence(compactFixture, compactFixtureHeaders);
equal(compactedFixture.rawFields.wefutHeaderEvidenceRef.path, 'results/wefut-edition-headers.json', 'WeFUT compact candidate references the shared header audit');
equal(compactedFixture.rawFields.wefutHeaderEvidenceRef.sha256, 'a'.repeat(64), 'WeFUT compact candidate carries the exact verified header hash');
equal(compactedFixture.rawFields.wefutHeaderEvidenceRef.edition, 14, 'WeFUT compact candidate reference retains its edition');
check(!('wefutHeaderEvidence' in compactedFixture.rawFields), 'per-candidate full header schema is removed after sharing');
check(!('attributeSourceEvidence' in compactedFixture.rawFields), 'duplicated nested source evidence is removed');
equal(compactedFixture.attributeSourceEvidence.expectedDetailedFieldCount, 34, 'candidate-level completeness evidence remains independently readable');
check(!('presentSourceColumns' in compactedFixture.attributeSourceEvidence), 'duplicated present-column listing is represented by the shared header ref');
equal(JSON.stringify(candidateDataProjection(compactedFixture)), JSON.stringify(candidateDataProjection(compactFixture)), 'compaction preserves IDs, raw numeric cells, markup, URLs, and normalized attributes');
equal(compactedFixture.rawFields['19'], '82', 'raw numeric source cells remain intact');
equal(compactedFixture.rawCardMarkup, compactFixture.rawCardMarkup, 'card markup remains intact');
equal(JSON.stringify(compactCandidateEvidence(compactedFixture, compactFixtureHeaders).rawFields.wefutHeaderEvidenceRef), JSON.stringify(compactedFixture.rawFields.wefutHeaderEvidenceRef), 'shared header compaction is idempotent');
equal(compactCandidateEvidence({ site: 'fo4', rawFields: { raw: 'kept' } }, compactFixtureHeaders).rawFields.raw, 'kept', 'non-WeFUT candidates are not altered');
const missingHeaderClaim = { site: 'wefut', edition: 14, rawFields: { '19': '82', wefutHeaderEvidence: { edition: 14, columns: [{ index: 19, sourceLabel: 'Acceleration' }] }, attributeSourceEvidence: { expectedDetailedFieldCount: 34 } }, attributeSourceEvidence: { expectedDetailedFieldCount: 34, presentSourceColumns: [{ index: 19, sourceLabel: 'Acceleration' }] } };
equal(compactCandidateEvidence(missingHeaderClaim, compactFixtureHeaders), missingHeaderClaim, 'WeFUT rows without a trusted header hash are not compacted');
check(!missingHeaderClaim.rawFields.wefutHeaderEvidenceRef && missingHeaderClaim.rawFields.wefutHeaderEvidence.columns.length === 1 && missingHeaderClaim.rawFields.attributeSourceEvidence.expectedDetailedFieldCount === 34, 'missing-claim rows keep inline evidence and receive no fabricated shared reference');
check((() => { try { compactCandidateEvidence(compactFixture, { entries: [{ edition: 14, headerEvidence: { headerSha256: 'b'.repeat(64) } }] }); return false; } catch { return true; } })(), 'header hash mismatch is rejected before compaction');
checks++;
equal(preservedCandidateBaseline({ candidateDataProjectionSha256: 'data', candidateIdProjectionSha256: 'ids', originalBytes: 790 }, 506, 'data', 'ids'), 790, 'repeat compaction retains the original-size baseline');
equal(preservedCandidateBaseline({ candidateDataProjectionSha256: 'data', candidateIdProjectionSha256: 'ids' }, 506, 'data', 'ids', '压缩前 790 字节'), 790, 'legacy repeat compaction recovers the documented original-size baseline');
equal(preservedCandidateBaseline({ candidateDataProjectionSha256: 'old', candidateIdProjectionSha256: 'ids', originalBytes: 790 }, 506, 'data', 'ids', '压缩前 790 字节'), 506, 'changed candidate data starts a new compaction baseline');
const nullA = { playerId: null, canonicalName: 'Same Name', playerSeasonIds: ['club-b-1', 'club-a-0'] };
const nullB = { playerId: null, canonicalName: 'Same Name', playerSeasonIds: ['club-c-2'] };
const keyA = searchEntityKeyFor(nullA); const keyB = searchEntityKeyFor(nullB);
equal(keyA, searchEntityKeyFor({ ...nullA, playerSeasonIds: [...nullA.playerSeasonIds].reverse() }), 'unresolved key is stable across season input order');
check(keyA !== keyB, 'same-name unresolved entities with different PlayerSeason membership stay distinct');
equal(assertUniqueSearchEntityKeys([nullA, nullB]).length, 2, 'null IDs still have unique keys');
const joins = new Map([[searchEntityKeyFor(nullA), { value: 'A' }], [searchEntityKeyFor(nullB), { value: 'B' }]]);
equal(joins.get(searchEntityKeyFor(nullA)).value, 'A', 'report-style entity join preserves first null-ID entity');
equal(joins.get(searchEntityKeyFor(nullB)).value, 'B', 'report-style entity join preserves second null-ID entity');
const incomplete = searchCompletenessOf([{ status: 'partial', requestSucceeded: true, searchCompleteness: 'unknown', possiblyTruncated: true, staticNameFamilyCompleteness: 'complete_for_exact_normalized_name_group_in_official_static_index' }]);
equal(incomplete.state, 'partial', 'complete static name family does not imply exhaustive server search');
equal(incomplete.possiblyTruncated, true, 'unknown one-page completeness is retained as possible truncation');
equal(searchCompletenessOf([{ status: 'ok', requestSucceeded: true, searchCompleteness: 'complete' }]).state, 'complete', 'verified paginated search can be complete');
equal(wefutPaginationCompleteness([{ reported: 2, rows: 1 }], 1).complete, false, 'short WeFUT page is partial when reported count exceeds raw unique IDs');
equal(wefutPaginationCompleteness([{ reported: 1, rows: 1 }], 1).complete, true, 'one-row WeFUT result is complete when count agrees');
equal(wefutPaginationCompleteness([{ reported: 200, rows: 100 }, { reported: 200, rows: 50 }], 150).complete, false, 'short final page remains partial when total count exceeds accumulated raw rows');
equal(wefutPaginationCompleteness([{ reported: 100, rows: 100 }, { reported: 100, rows: 0 }], 100).complete, true, 'empty terminal page verifies exact page-multiple result counts');
equal(wefutPaginationCompleteness([{ reported: 100, rows: 50 }, { reported: 110, rows: 10 }], 60).reason, 'reported_count_changed', 'changing/sentinel count values remain uncertain');
equal(wefutPaginationCompleteness([{ rows: 1 }], 1).complete, false, 'unknown WeFUT count cannot be complete');
const oldTableColumnCount = wefutRequestColumnCount({ tableId: 'playerTable', headerColumnCount: 74 });
const modernTableColumnCount = wefutRequestColumnCount({ tableId: 'playerTable', headerColumnCount: 75 });
equal(oldTableColumnCount, 74, 'WeFUT request shape uses the observed legacy playerTable header length');
equal(modernTableColumnCount, 75, 'WeFUT request shape uses the observed modern playerTable header length');
equal(wefutRequestColumnCount(null), null, 'missing verified WeFUT header length does not fall back to a hard-coded request width');
assert.throws(() => buildWefutPostBody('Pelé', 0, 'page-cookie', wefutRequestColumnCount(null)), /verified playerTable header column count/);
checks++;
for (const count of [oldTableColumnCount, modernTableColumnCount]) {
  const body = new URLSearchParams(buildWefutPostBody('Pelé', 100, 'page-cookie', count));
  equal(Number(body.get('iColumns')), count, `WeFUT DataTables iColumns follows the verified ${count}-column header`);
  equal(body.getAll('mDataProp_0').length, 1, `WeFUT ${count}-column request has a unique first column mapping`);
  equal(body.get(`mDataProp_${count - 1}`), String(count - 1), `WeFUT ${count}-column request maps the last observed index`);
  equal(body.get(`mDataProp_${count}`), null, `WeFUT ${count}-column request does not invent an extra column`);
  equal(body.get('sColumns').split(',').length, count, `WeFUT ${count}-column request serializes matching sColumns length`);
}
const li = (label, value) => `<li class="ab"><div class="txt">${label}</div><div class="value">${value}</div></li>`;
const twentyFields = Array.from({ length: 20 }, (_, i) => li(`field-${i}`, i + 1)).join('');
const splitSectionFragment = `<div class="content_middle"><ul>${li('드리블', 124)}</ul></div><div class="content_bottom"><ul class="data_wrap data_wrap_playerinfo">${twentyFields}${li('드리블', 120)}</ul></div>`;
const splitEntries = parseNexonAttributeEntries(splitSectionFragment);
const splitParsed = normalizeNexonAttributeEntries(splitEntries);
equal(splitEntries.length, 22, 'Nexon preserves every ordered summary and detailed li.ab entry');
equal(splitEntries[0].section, 'summary_ratings', 'Nexon identifies card summary section structurally');
equal(splitEntries.at(-1).section, 'detailed_attributes', 'Nexon identifies detailed attributes section structurally');
equal(splitParsed.summaryRatings['드리블'], 124, 'Nexon summary rating remains separate from detail value');
equal(splitParsed.attributes['드리블'], 120, 'Nexon detailed value survives same-label summary rating');
equal(splitParsed.attributes_found, true, 'Nexon reports detailed fields found after section separation');
equal(splitParsed.attributes_ambiguous, false, 'cross-section duplicate label is not a data collision');
const equalDuplicate = normalizeNexonAttributeEntries(parseNexonAttributeEntries(`<ul class="data_wrap data_wrap_playerinfo">${twentyFields}${li('repeat', 42)}${li('repeat', 42)}</ul>`));
equal(equalDuplicate.attributes_found, true, 'equal repeated detailed values remain complete');
equal(equalDuplicate.duplicateAttributeLabels[0].equal, true, 'equal same-section duplicate is explicitly recorded');
const conflictingDuplicate = normalizeNexonAttributeEntries(parseNexonAttributeEntries(`<ul class="data_wrap data_wrap_playerinfo">${twentyFields}${li('repeat', 42)}${li('repeat', 43)}</ul>`));
equal(conflictingDuplicate.attributes_found, false, 'conflicting same-section duplicate prevents unambiguous attribute success');
equal(conflictingDuplicate.attributes_ambiguous, true, 'conflicting same-section duplicate is flagged');
equal(conflictingDuplicate.attributes['repeat#2'], 43, 'conflicting duplicate is occurrence-qualified rather than discarded');
const fo3LocalId = applySourceLocalCardIdentity({ site: 'fo3', detailUrl: 'https://en.fifaaddict.com/fo3player.php?id=93001075', rawFields: { playerId: '93001075' } });
equal(fo3LocalId.cardId, 93001075, 'FO3 cardId is sourced from its profile route');
equal(fo3LocalId.sourceIdNamespace, 'fifaaddict:fo3-card', 'FO3 card ID carries its source namespace');
equal(fo3LocalId.sourcePlayerId, null, 'FO3 profile-card route ID is not labeled as a person ID');
equal(fo3LocalId.numericIdentityEvidence, null, 'source-local ID is not promoted to cross-source identity evidence');
const wefutBaseId = applySourceLocalCardIdentity({ site: 'wefut', detailUrl: 'https://wefut.com/player/14/991/target-player', rawFields: { basePersonId: 158023 } });
equal(wefutBaseId.sourcePlayerId, '158023', 'explicit WeFUT base-player ID remains available as source-local person evidence');
equal(applySourceLocalCardIdentity({ site: 'wefut', detailUrl: 'https://wefut.com/player/14/991/target-player', rawFields: { basePersonId: '' } }).sourcePlayerId, null, 'empty base-person ID is normalized to null');
equal(applySourceLocalCardIdentity({ site: 'wefut', detailUrl: 'https://wefut.com/player/14/991/target-player', rawFields: { basePersonId: '   ' } }).sourcePlayerId, null, 'whitespace-only base-person ID is normalized to null');
const hiddenWeFutCell = applySourceLocalCardIdentity({ site: 'wefut', detailUrl: 'https://wefut.com/player/14/991/target-player', rawFields: { '66': '158023', basePlayerId: '158023' } });
equal(hiddenWeFutCell.sourcePlayerId, null, 'unverified WeFUT cell 66/basePlayerId aliases do not become person IDs');
const fo4LocalId = applySourceLocalCardIdentity({ site: 'fo4', detailUrl: 'https://cn.fifaaddict.com/fo4db/pidnwlyvvqm', rawFields: {} });
equal(fo4LocalId.cardId, 'pidnwlyvvqm', 'FO4 opaque profile ID is retained as the card ID');
equal(fo4LocalId.sourceIdNamespace, 'fifaaddict:fo4-pid', 'FO4 opaque card ID carries its source namespace');
equal(fo4LocalId.sourcePlayerId, null, 'FO4 opaque card route does not imply a person ID');
const nexonLocalId = applySourceLocalCardIdentity({ site: 'nexon-fco', detailUrl: 'https://fconline.nexon.com/DataCenter/PlayerInfo?spid=100190043&n1Strong=1', rawFields: { spid: 100190043 } });
equal(nexonLocalId.cardId, 100190043, 'Nexon SPID remains the source-local card ID');
equal(nexonLocalId.sourcePlayerId, null, 'Nexon season-specific SPID is not mislabeled as a base person ID');
const staleNexonPlayerId = applySourceLocalCardIdentity({ site: 'nexon-fco', detailUrl: 'https://fconline.nexon.com/DataCenter/PlayerInfo?spid=100190043', sourcePlayerId: '100190043', rawFields: { spid: 100190043 } });
equal(staleNexonPlayerId.sourcePlayerId, null, 'offline source-local refresh clears a prior SPID-to-person mislabel');
const identityFixture = { canonicalName: 'Alessandro Del Piero', rosterNames: ['Alessandro Del Piero'], searchTerms: [], existingExternalIds: { sofifa: 1075, fifaIndex: 1075 } };
equal(classifyIdentity(identityFixture, 'Alessandro Del Piero').level, 'low', 'exact names without a verified numeric link remain low confidence');
equal(classifyIdentity(identityFixture, 'Alessandro Del Piero', { value: 1075, sourceNamespace: 'fifaaddict:fo3-card', targetNamespace: 'fifaIndex', verified: false }).level, 'low', 'an equal FO3 route ID cannot match a different external-ID namespace');
equal(classifyIdentity(identityFixture, 'Alessandro Del Piero', { value: 1075, sourceNamespace: 'wefut:base-player-id', targetNamespace: 'fifaIndex', verified: false }).level, 'low', 'an equal WeFUT base ID without a documented crosswalk cannot promote identity');
equal(classifyIdentity(identityFixture, 'Alessandro Del Piero', { value: 1075, sourceNamespace: 'fifaIndex', targetNamespace: 'fifaIndex', verified: true, relationship: 'same_namespace', reference: 'fixture source contract' }).level, 'high', 'a verified same-namespace external ID can support high confidence');
equal(classifyIdentity(identityFixture, 'Alessandro Del Piero', { value: 1075, sourceNamespace: 'wefut:base-player-id', targetNamespace: 'fifaIndex', verified: true, relationship: 'documented_crosswalk', reference: 'fixture crosswalk', crosswalk: { sourceNamespace: 'wefut:base-player-id', targetNamespace: 'fifaIndex', reference: 'fixture crosswalk specification' } }).level, 'high', 'an explicitly documented crosswalk can support high confidence');
const staleIdHigh = refreshCandidateIdentity(identityFixture, { site: 'wefut', name: 'Alessandro Del Piero', identity_confidence: 'high', identity_evidence: 'external_id_match', numericIdentityEvidence: null, overall: 88, overall_found: true, attributes_found: true, card_found: true, cardId: 27, sourceIdNamespace: 'wefut:card', sourcePlayerId: '1075', rawFields: { basePersonId: '1075' } });
equal(staleIdHigh.identity_confidence, 'low', 'offline identity refresh downgrades unproven equal numeric IDs to name evidence');
equal(staleIdHigh.identityConfidenceRefresh.priorEvidence, 'external_id_match', 'offline refresh retains the superseded confidence reason for audit');
equal(staleIdHigh.sourcePlayerId, '1075', 'identity refresh preserves source-local player IDs');
const wrongName = refreshCandidateIdentity(identityFixture, { site: 'fo3', name: 'Yohann Pelé', identity_confidence: 'high', identity_evidence: 'external_id_match', numericIdentityEvidence: null, overall: 94, overall_found: true, attributes_found: true, card_found: true, rawFields: { playerId: '1075' } });
equal(wrongName.identity_confidence, 'none', 'a numeric collision cannot preserve a wrong-name identity');
equal(wrongName.card_found, false, 'a wrong-name collision does not count as target-player card coverage');
const nexonUnverified = refreshCandidateIdentity(identityFixture, { site: 'nexon-fco', name: 'デル・ピエロ', identity_confidence: 'unverified', identity_evidence: 'exact_spid_static_metadata_match', card_found: true, overall: 127, overall_found: true, attributes_found: true });
equal(nexonUnverified.identity_confidence, 'unverified', 'Nexon Korean-name SPID candidates remain explicitly unverified');
equal(nexonUnverified.attributes_found, true, 'unverified Nexon candidates retain observed native attributes without becoming identity-linked coverage');
const fifa14Labels = ['PAC','SHO','PAS','DRI','DEF','HEA','Acceleration','Agility','Balance','Jumping','Reactions','Sprint Speed','Stamina','Strength','Aggression','Interceptions','Positioning','Vision','Potential','Ball Control','Crossing','Curve','Dribbling','Finishing','Freekick Acc.','Heading Acc.','Long Pass','Long Shots','Marking','Penalties','Short Pass','Shot Power','Slide Tackle','Stand. Tackle','Volleys','DIV','HAN','KIC','REF','SPE','POS','WF','Skill','AW','DW'];
const fifa14HeaderCells = Array(74).fill(''); fifa14Labels.forEach((label, offset) => { fifa14HeaderCells[offset + 13] = label; });
fifa14HeaderCells[8] = 'Pos'; fifa14HeaderCells[12] = 'Nationality'; fifa14HeaderCells[67] = 'Min'; fifa14HeaderCells[68] = 'Max';
const fifa14HeaderFixture = `<table id="playerTable"><thead><tr>${fifa14HeaderCells.map((label) => `<th>${label}</th>`).join('')}</tr></thead></table>`;
const fifa14Schema = extractWefutHeaderEvidence(fifa14HeaderFixture, 14, 'https://wefut.com/player-database/14/');
equal(fifa14Schema.expectedDetailedAttributeKeys.length, 34, 'WeFUT FIFA14 public-header schema identifies 34 source-native detailed ability fields');
equal(fifa14Schema.columns.filter((column) => column.group === 'summaryRatings').length, 6, 'WeFUT FIFA14 summary columns come from the table header');
equal(fifa14Schema.columns.filter((column) => column.group === 'skillMetaAttributes').length, 4, 'WeFUT FIFA14 work-rate and skill columns are separate metadata');
equal(fifa14Schema.completeHeaderEvidence, true, 'known FIFA14 field header is structurally complete');
equal(fifa14Schema.duplicateDetailedKeys.length, 0, 'the identity position column is outside the nationality-to-filter attribute block');
equal(fifa14Schema.headerBoundaryEvidence.verified, true, 'unique Nationality/Min/Max headers delimit the FIFA14 attribute block');
const fifa14FullRow = Object.fromEntries(fifa14Labels.map((_, offset) => [String(offset + 13), String(offset + 20)]));
fifa14FullRow['54'] = '3'; fifa14FullRow['55'] = '2'; fifa14FullRow['56'] = '<label>M</label>'; fifa14FullRow['57'] = '<label>H</label>';
const fifa14FullStats = parseWefutAttributes(fifa14FullRow, 14, fifa14Schema);
equal(fifa14FullStats.attribute_field_count, 34, 'WeFUT observed detailed-field count excludes six summary, Potential, and four skill/work metadata cells');
equal(fifa14FullStats.attributes_complete, true, 'all FIFA14 expected detailed fields are complete');
check(!Object.hasOwn(fifa14FullStats.detailedAttributes, 'PAC') && fifa14FullStats.summaryRatings.PAC === 20, 'summary PAC is not counted as a detailed attribute');
check(!Object.hasOwn(fifa14FullStats.detailedAttributes, 'Potential') && fifa14FullStats.potentialMetaAttributes.Potential === 38, 'Potential is preserved separately from detailed abilities');
check(fifa14FullStats.skillMetaAttributes.AW === 'M' && fifa14FullStats.skillMetaAttributes.DW === 'H', 'work-rate values remain separate metadata');
const duplicateDetailHeaders = [...fifa14HeaderCells]; duplicateDetailHeaders[60] = 'Agility';
const duplicateDetailSchema = extractWefutHeaderEvidence(`<table id="playerTable"><tr>${duplicateDetailHeaders.map((label) => `<th>${label}</th>`).join('')}</tr></table>`, 14, 'https://wefut.com/player-database/14/');
equal(duplicateDetailSchema.completeHeaderEvidence, false, 'duplicate detailed labels make WeFUT header completeness false');
const duplicateDetailEqualRow = { ...fifa14FullRow, 60: fifa14FullRow['20'] };
const duplicateDetailEqualStats = parseWefutAttributes(duplicateDetailEqualRow, 14, duplicateDetailSchema);
equal(Object.hasOwn(duplicateDetailEqualStats.detailedAttributes, 'Agility'), false, 'equal duplicate WeFUT detail columns are both excluded from normalized attributes');
equal(duplicateDetailEqualStats.attribute_field_count, 33, 'duplicate WeFUT detail columns do not inflate the unique field count');
equal(duplicateDetailEqualStats.attributes_complete, false, 'duplicate WeFUT fields cannot be reported complete');
equal(duplicateDetailEqualStats.attributeSourceEvidence.presentSourceColumns.filter((column) => column.sourceLabel === 'Agility').length, 2, 'both equal duplicate WeFUT source cells remain recorded');
const duplicateDetailConflictStats = parseWefutAttributes({ ...fifa14FullRow, 60: '99' }, 14, duplicateDetailSchema);
equal(Object.hasOwn(duplicateDetailConflictStats.detailedAttributes, 'Agility'), false, 'conflicting duplicate WeFUT detail columns are both excluded');
equal(duplicateDetailConflictStats.attributeSourceEvidence.presentSourceColumns.filter((column) => column.sourceLabel === 'Agility').length, 2, 'both conflicting duplicate WeFUT cells remain recorded for audit');
const fifa14PartialRow = { ...fifa14FullRow }; for (const column of fifa14Schema.columns.filter((item) => item.group === 'detailedAttributes').slice(20)) delete fifa14PartialRow[String(column.index)];
const fifa14PartialStats = parseWefutAttributes(fifa14PartialRow, 14, fifa14Schema);
equal(fifa14PartialStats.attributes_found, true, '20 usable WeFUT detailed fields remain discoverable');
equal(fifa14PartialStats.attributes_complete, false, '20 usable fields do not imply a complete source field set');
equal(fifa14PartialStats.attribute_completeness_status, 'partial', 'partial source details are labeled partial');
equal(fifa14PartialStats.attribute_field_count, 20, 'WeFUT reports the observed detailed-field count');
const fifa14SummaryOnly = parseWefutAttributes(Object.fromEntries(fifa14Schema.columns.filter((column) => column.group === 'summaryRatings').map((column) => [String(column.index), '88'])), 14, fifa14Schema);
equal(fifa14SummaryOnly.attributes_found, false, 'summary ratings alone do not count as detailed attributes');
equal(fifa14SummaryOnly.attributes_complete, false, 'summary-only FIFA14 card is not a complete detailed field set');
const unknownEditionStats = parseWefutAttributes(fifa14FullRow, 27);
equal(unknownEditionStats.attribute_completeness_status, 'unknown', 'an edition without observed header metadata remains unknown');
equal(unknownEditionStats.attributes_complete, null, 'unknown edition field sets are not marked complete or partial');
equal(unknownEditionStats.attribute_field_count, 0, 'unmapped raw WeFUT columns are not misrepresented as detailed attributes');
const shiftedHeaderCells = Array(74).fill(''); shiftedHeaderCells[12] = 'Nationality'; shiftedHeaderCells[13] = 'PAC'; shiftedHeaderCells[19] = 'Agility'; shiftedHeaderCells[42] = 'Acceleration'; shiftedHeaderCells[54] = 'AW'; shiftedHeaderCells[67] = 'Min'; shiftedHeaderCells[68] = 'Max';
const shiftedSchema = extractWefutHeaderEvidence(`<table id="playerTable"><tr>${shiftedHeaderCells.map((label) => `<th>${label}</th>`).join('')}</tr></table>`, 15, 'https://wefut.com/player-database/15/');
const shiftedStats = parseWefutAttributes({ 13: '90', 19: '<span>77</span>', 42: '101', 54: '<b>M</b>' }, 15, shiftedSchema);
equal(shiftedStats.detailedAttributes.Agility, 77, 'edition-specific header order maps source cells by observed labels');
equal(shiftedStats.detailedAttributes.Acceleration, 101, 'reordered detail cells retain the correct source label');
equal(shiftedStats.summaryRatings.PAC, 90, 'header-shifted summary cells remain separate');
equal(shiftedStats.skillMetaAttributes.AW, 'M', 'HTML-wrapped work-rate metadata is normalized without changing raw cells');
const refreshedHeaderCandidate = normalizeCandidateAttributeCompleteness({ site: 'wefut', edition: 14, rawFields: { ...fifa14FullRow, wefutHeaderEvidence: shiftedSchema } }, { 14: fifa14Schema });
equal(refreshedHeaderCandidate.attribute_field_count, 34, 'offline edition header evidence takes precedence over a saved conflicting map');
equal(refreshedHeaderCandidate.rawFields.wefutHeaderEvidence.headerSha256, fifa14Schema.headerSha256, 'the selected edition header evidence is retained with the candidate');
equal(refreshedHeaderCandidate.rawFields.wefutHeaderEvidenceAtAcquisition.headerSha256, shiftedSchema.headerSha256, 'a conflicting acquisition header hash remains available for audit');
const missingBoundaryHeaders = [...shiftedHeaderCells]; missingBoundaryHeaders[67] = ''; missingBoundaryHeaders[68] = '';
const missingBoundarySchema = extractWefutHeaderEvidence(`<table id="playerTable"><tr>${missingBoundaryHeaders.map((label) => `<th>${label}</th>`).join('')}</tr></table>`, 15, 'https://wefut.com/player-database/15/');
equal(missingBoundarySchema.completeHeaderEvidence, false, 'missing edition boundary labels fail closed for completeness');
equal(missingBoundarySchema.headerBoundaryEvidence.verified, false, 'header range is unverified when Min/Max markers are absent');
const missingBoundaryStats = parseWefutAttributes({ 13: '90', 19: '77', 42: '101', 54: 'M' }, 15, missingBoundarySchema);
equal(missingBoundaryStats.attributes_complete, null, 'unverified header boundaries stay completeness-unknown');
equal(missingBoundaryStats.attributes_found, false, 'unverified header boundaries emit no active detailed attributes');
equal(missingBoundaryStats.attribute_field_count, 0, 'unverified header boundaries report no normalized ability fields');
const duplicateBoundaryHeaders = [...shiftedHeaderCells]; duplicateBoundaryHeaders[66] = 'Min';
const duplicateBoundarySchema = extractWefutHeaderEvidence(`<table id="playerTable"><tr>${duplicateBoundaryHeaders.map((label) => `<th>${label}</th>`).join('')}</tr></table>`, 15, 'https://wefut.com/player-database/15/');
equal(duplicateBoundarySchema.headerBoundaryEvidence.verified, false, 'duplicate edition boundary labels fail closed');
equal(parseWefutAttributes({ 13: '90', 19: '77', 42: '101', 54: 'M' }, 15, duplicateBoundarySchema).attribute_field_count, 0, 'duplicate boundaries do not emit active field mappings');
const headerWithUnknown = [...fifa14HeaderCells]; headerWithUnknown[60] = 'New Field'; headerWithUnknown[67] = 'Min'; headerWithUnknown[68] = 'Max';
const unclassifiedSchema = extractWefutHeaderEvidence(`<table id="playerTable"><tr>${headerWithUnknown.map((label) => `<th>${label}</th>`).join('')}</tr></table>`, 15, 'https://wefut.com/player-database/15/');
equal(unclassifiedSchema.unclassifiedHeaderColumns[0]?.index, 60, 'unknown fields anywhere in the source attribute block are recorded');
equal(unclassifiedSchema.completeHeaderEvidence, false, 'an unclassified public header column prevents a completeness claim');
function modernWefutPage(edition, includeWorkRates, ajaxEdition = edition) {
  const headers = Array(75).fill('');
  Object.assign(headers, { 1: 'First Name', 2: 'Last Name', 3: 'Name', 4: 'Rating', 5: 'DoB (Age)', 6: 'Height', 7: 'Weight', 8: 'Position(s)', 9: 'Preferred Foot', 10: 'Club', 11: 'League', 12: 'Nation' });
  ['PAC','SHO','PAS','DRI','DEF','HEA'].forEach((label, offset) => { headers[offset + 13] = label; });
  ['Acceleration','Agility','Balance','Jumping','Reactions','Sprint Speed','Stamina','Strength','Aggression','Interceptions','Positioning','Vision'].forEach((label, offset) => { headers[offset + 19] = label; });
  headers[31] = 'Potential';
  ['Ball Control','Crossing','Curve','Dribbling','Finishing','Free Kick Acc.','Heading Acc.','Long Pass','Long Shots','Marking','Penalties','Short Pass','Shot Power','Slide Tackle','Stand. Tackle','Volleys','DIV','HAN','KIC','REF','SPE','POS'].forEach((label, offset) => { headers[offset + 32] = label; });
  headers[54] = 'WF'; headers[55] = 'Skill';
  if (includeWorkRates) { headers[56] = 'AW'; headers[57] = 'DW'; }
  headers[67] = 'Composure';
  const table = `<table id="playerTable"><thead><tr>${headers.map((label) => `<th>${label}</th>`).join('')}</tr></thead></table>`;
  const config = `<script>var tableConfig={"bServerSide":true,"sAjaxSource":"/ajax/getPlayers/${ajaxEdition}"};</script>`;
  return { html: `${table}${config}`, headers };
}
const modern27Page = modernWefutPage(27, false);
const modern27Schema = extractWefutHeaderEvidence(modern27Page.html, 27, 'https://wefut.com/player-database/27/');
equal(modern27Schema.headerMappingStrategy, 'modern_labeled_75_column_server_side_table', 'modern WeFUT edition requires the observed 75-column public server-side table contract');
equal(modern27Schema.headerColumnCount, 75, 'modern WeFUT source header evidence counts exactly 75 aligned columns');
equal(modern27Schema.headerBoundaryEvidence.verified, true, 'modern Nation/Rating/Position labels and matching endpoint provide an evidence-backed boundary');
equal(modern27Schema.frontendSourceContract.verified, true, 'modern schema records the public page Ajax route contract');
equal(modern27Schema.expectedDetailedAttributeKeys.length, 35, 'modern WeFUT maps 34 familiar details plus labeled Composure');
equal(modern27Schema.completeHeaderEvidence, true, 'fully labeled modern header has no guessed blank fields');
equal(modern27Schema.expectedDetailedAttributeKeys.length, 35, 'the modern completeness contract uses a fixed 35-key source field set');
const modern27Row = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [String(index), '80']));
modern27Row['4'] = '95'; modern27Row['8'] = 'CAM, ST'; modern27Row['12'] = 'Brazil'; modern27Row['31'] = '0';
modern27Row['54'] = '4'; modern27Row['55'] = '5'; modern27Row['56'] = ''; modern27Row['57'] = '';
const modern27Stats = parseWefutAttributes(modern27Row, 27, modern27Schema);
equal(modern27Stats.attribute_field_count, 35, 'modern aligned rows map all 35 labeled detailed fields including Composure');
equal(modern27Stats.detailedAttributes.Composure, 80, 'modern Composure is mapped by its observed header label');
equal(modern27Stats.potentialMetaAttributes.Potential, 0, 'zero Potential remains separate development metadata');
equal(modern27Stats.summaryRatings.PAC, 80, 'modern summary ratings are separated from detailed abilities');
equal(Object.hasOwn(modern27Stats.skillMetaAttributes, 'AW'), false, 'blank modern columns do not synthesize an attack work rate');
equal(Object.hasOwn(modern27Stats.skillMetaAttributes, 'DW'), false, 'blank modern columns do not synthesize a defense work rate');
equal(modern27Stats.attributeSourceEvidence.rowAlignmentVerified, true, 'modern row mapping requires exactly 75 contiguous numeric cells');
const misalignedModernRow = { ...modern27Row }; delete misalignedModernRow['74'];
const misalignedModernStats = parseWefutAttributes(misalignedModernRow, 27, modern27Schema);
equal(misalignedModernStats.attribute_field_count, 0, 'modern rows with a missing numeric column emit no active mapped attributes');
equal(misalignedModernStats.attributeSourceEvidence.rowAlignmentVerified, false, 'modern row/header length mismatch is explicitly recorded');
const wrongEndpointPage = modernWefutPage(27, false, 26);
const wrongEndpointSchema = extractWefutHeaderEvidence(wrongEndpointPage.html, 27, 'https://wefut.com/player-database/27/');
equal(wrongEndpointSchema.headerBoundaryEvidence.verified, false, 'modern headers without their edition-matched server-side endpoint fail closed');
const missingComposurePage = modernWefutPage(27, false);
missingComposurePage.headers[67] = '';
missingComposurePage.html = `<table id="playerTable"><thead><tr>${missingComposurePage.headers.map((label) => `<th>${label}</th>`).join('')}</tr></thead></table><script>var tableConfig={"bServerSide":true,"sAjaxSource":"/ajax/getPlayers/27"};</script>`;
const missingComposureSchema = extractWefutHeaderEvidence(missingComposurePage.html, 27, 'https://wefut.com/player-database/27/');
equal(missingComposureSchema.expectedDetailedAttributeKeys.length, 35, 'missing modern labels do not shrink the expected field set');
equal(missingComposureSchema.expectedDetailedAttributeKeys.includes('Composure'), true, 'Composure is required by the fixed modern field set');
equal(missingComposureSchema.completeHeaderEvidence, false, 'modern headers missing required Composure cannot be complete');
const missingComposureStats = parseWefutAttributes(modern27Row, 27, missingComposureSchema);
equal(missingComposureStats.attribute_field_count, 34, 'modern parsed field count reflects the missing Composure label');
equal(missingComposureStats.attributes_complete, false, '34 of 35 modern detailed fields are not complete');
const modern22Page = modernWefutPage(22, true);
const modern22Schema = extractWefutHeaderEvidence(modern22Page.html, 22, 'https://wefut.com/player-database/22/');
const modern22Row = { ...modern27Row, '56': '<label>H</label>', '57': '<label>M</label>' };
const modern22Stats = parseWefutAttributes(modern22Row, 22, modern22Schema);
equal(modern22Stats.skillMetaAttributes.AW, 'H', 'AW is mapped only for editions whose header explicitly labels the column');
equal(modern22Stats.skillMetaAttributes.DW, 'M', 'DW is mapped only for editions whose header explicitly labels the column');
const nexonComplete = normalizeCandidateAttributeCompleteness({ site: 'nexon-fco', attributes_found: true, attributes: Object.fromEntries(Array.from({ length: 34 }, (_, index) => [`detail-${index}`, index + 1])), rawFields: { nativeAbilityEntryCount: 40, nativeSummaryRatingCount: 6, detailedAttributeEntryCount: 34, detailedAttributeCount: 34, unclassifiedAttributeEntryCount: 0 } });
equal(nexonComplete.attributes_complete, true, 'Nexon native 40-entry evidence with 6 summary plus 34 detailed fields is complete');
equal(nexonComplete.attribute_field_count, 34, 'Nexon detailed count excludes the six summary ratings');
const nativeNexonEntries = (values) => [
  ...Array.from({ length: 6 }, (_, index) => ({ section: 'summary_ratings', label: `summary-${index}`, value: 70 + index })),
  ...values.map((value, index) => ({ section: 'detailed_attributes', label: `detail-${index}`, value })),
];
const nexonZeroRaw = { abilityAttributesRaw: nativeNexonEntries(Array(34).fill(0)) };
const nexonAllZero = normalizeCandidateAttributeCompleteness({ site: 'nexon-fco', attributes_found: true, attributes_complete: true, attributes: Object.fromEntries(Array.from({ length: 34 }, (_, index) => [`detail-${index}`, index + 1])), rawFields: nexonZeroRaw });
equal(nexonAllZero.attributes_found, false, 'all-zero Nexon detail placeholders override a stale found flag');
equal(nexonAllZero.attributes_complete, false, 'all-zero Nexon detail placeholders are not complete');
equal(nexonAllZero.attribute_completeness_status, 'unavailable', 'all-zero Nexon details are marked unavailable');
equal(nexonAllZero.attribute_field_count, 0, 'all-zero Nexon placeholders are excluded from active fields');
equal(nexonZeroRaw.abilityAttributesRaw.length, 40, 'all ordered Nexon summary and detail entries remain preserved in raw fields');
const nexonWithValidZero = normalizeCandidateAttributeCompleteness({ site: 'nexon-fco', attributes_found: false, attributes: {}, rawFields: { abilityAttributesRaw: nativeNexonEntries(Array.from({ length: 34 }, (_, index) => index === 7 ? 0 : index + 1)) } });
equal(nexonWithValidZero.attributes_found, true, 'one legitimate zero does not invalidate otherwise loaded Nexon details');
equal(nexonWithValidZero.attributes_complete, true, 'a fully loaded Nexon vector with an individual zero remains complete');
equal(nexonWithValidZero.detailedAttributes['detail-7'], 0, 'a legitimate zero-valued Nexon detail is retained');
const nexonPartial = normalizeCandidateAttributeCompleteness({ site: 'nexon-fco', attributes_found: true, attributes: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`detail-${index}`, index + 1])), summaryAttributes: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`summary-${index}`, index + 80])), rawFields: { nativeAbilityEntryCount: 27, nativeSummaryRatingCount: 6, detailedAttributeEntryCount: 21, detailedAttributeCount: 21, unclassifiedAttributeEntryCount: 0 } });
equal(nexonPartial.attributes_complete, false, 'a Nexon candidate missing native detail fields is not complete');
equal(nexonPartial.attribute_completeness_status, 'partial', 'a Nexon 21-field candidate is partial');
equal(nexonPartial.attribute_field_count, 21, 'Nexon six summary ratings are excluded from the detailed-field count');
const fo4NoDetail = normalizeCandidateAttributeCompleteness({ site: 'fo4', attributes_found: false, attributes: {}, placeholderFields: ['acceleration', 'speed'] });
equal(fo4NoDetail.attributes_complete, false, 'FO4 placeholder-only stats are never a complete detailed set');
equal(fo4NoDetail.attribute_completeness_status, 'unavailable', 'FO4 placeholder-only stats remain unavailable');
const mergePlayers = [
  { playerId: 'fixture-a', searchEntityKey: 'entity:fixture-a', canonicalName: 'Target Player', rosterNames: ['Target Player'], playerSeasonIds: ['team-a-1'], existingExternalIds: { fifaIndex: 1075 } },
  { playerId: null, searchEntityKey: 'unresolved:target:team-b-1', canonicalName: 'Unresolved Target', rosterNames: ['Unresolved Target'], playerSeasonIds: ['team-b-1'], existingExternalIds: {} },
];
const makeFo3Candidate = (key, searchedPlayerId, cardId, edition = null) => ({
  site: 'fo3', searchEntityKey: key, searchedPlayerId, searchedCanonicalName: key === 'entity:fixture-a' ? 'Target Player' : 'Unresolved Target', name: key === 'entity:fixture-a' ? 'Target Player' : 'Unresolved Target',
  card_found: true, overall: 88, overall_found: true, attributes_found: false, identity_confidence: 'high', identity_evidence: 'external_id_match', numericIdentityEvidence: null,
  detailUrl: `https://en.fifaaddict.com/fo3player.php?id=${cardId}`, rawFields: { playerId: String(cardId) }, ...(edition == null ? {} : { edition }),
});
const mergedFixture = mergeWorkerProgress(mergePlayers, { fo3: {
  completed: { 'fo3:entity:fixture-a': { failed: true }, 'fo3:unresolved:target:team-b-1': { failed: false }, 'fo4:entity:fixture-a': { failed: false }, 'fo3:unresolved:foreign:team-c': { failed: false } },
  candidates: [makeFo3Candidate('entity:fixture-a', 'fixture-a', 1075, 14), makeFo3Candidate('entity:fixture-a', 'fixture-a', 2075, 15), makeFo3Candidate('unresolved:target:team-b-1', null, 3075), { ...makeFo3Candidate('entity:fixture-a', 'fixture-a', 1075), site: 'fo4' }, makeFo3Candidate('unresolved:foreign:team-c', null, 4075)],
  observations: [{ site: 'fo3', playerId: 'fixture-a', searchEntityKey: 'entity:fixture-a', canonicalName: 'Target Player', searchSucceeded: true, searchCompleteness: 'partial', observations: [] }],
  errors: [{ site: 'fo3', playerId: 'fixture-a', searchEntityKey: 'entity:fixture-a', status: 500, kind: 'detail' }, { site: 'fo4', playerId: 'fixture-a', searchEntityKey: 'entity:fixture-a', status: 500, kind: 'foreign' }],
} }, ['fo3']);
equal(Object.keys(mergedFixture.completed).length, 2, 'offline merge includes only the source and 95-input-key job namespace');
equal(mergedFixture.completed['fo3:entity:fixture-a'].failed, true, 'offline merge preserves pending retry state');
equal(mergedFixture.candidates.length, 3, 'offline merge excludes foreign source/entity seeds but retains card variants');
equal(mergedFixture.candidates.filter((candidate) => candidate.searchEntityKey === 'entity:fixture-a').length, 2, 'multiple card editions for one input identity are not collapsed');
equal(mergedFixture.candidates[0].identity_confidence, 'low', 'offline merge refreshes stale numeric-only confidence');
equal(mergedFixture.candidates[0].cardId, 1075, 'offline merge fills a missing FO3 route card ID');
equal(mergedFixture.candidates[0].sourceIdNamespace, 'fifaaddict:fo3-card', 'offline merge namespaces source-local route IDs');
equal(mergedFixture.observations.length, 2, 'offline merge emits one observation row per attempted source job');
equal(mergedFixture.sourceAccounting.fo3.missingObservationsRecorded, 1, 'offline merge records an absent observation as unknown instead of an empty search');
equal(mergedFixture.sourceAccounting.fo3.foreignOrOutOfScopeCandidatesExcluded, 2, 'offline merge reports excluded foreign and out-of-scope candidate seeds');
assert.throws(() => mergeWorkerProgress(mergePlayers, { fo3: { completed: { 'fo3:entity:fixture-a': { failed: false } } } }, ['fo3']), /missing 1\/2 input jobs/, 'offline merge rejects a checkpoint that did not attempt every input key');
checks++;
check(shouldRetryJob({ observations: [{ requestSucceeded: true }], errors: [{ kind: 'detail', status: 503 }] }), 'successful search plus transient detail failure retries the job');
check(!shouldRetryJob({ observations: [{ requestSucceeded: true }], errors: [{ kind: 'detail', status: 401 }] }), 'explicit authorization failure does not retry');
check(shouldRetryJob({ observations: [{ requestSucceeded: false, status: 'failed' }], errors: [{ status: 0 }] }), 'network-failed search checkpoint remains retryable');
check(!shouldRetryJob({ observations: [{ requestSucceeded: false, status: 'failed' }], errors: [{ status: 401 }] }), 'explicit search authorization failure does not retry');
const temp = await mkdtemp(resolve(cacheRoot, 'transport-resume-'));
if (!temp.startsWith(cacheRoot + sep)) throw new Error('Transport test cache escaped ignored research cache.');
try {
  const url = 'https://test.invalid/public'; let firstRunCalls = 0;
  const firstRun = createHttpTransport({ cacheDir: temp, rateMs: 0, sleepFn: async () => {}, fetchImpl: async () => { firstRunCalls++; throw new Error('offline'); } });
  equal((await firstRun.request(url)).status, 0, 'network failure remains visible after bounded retries');
  equal(firstRunCalls, 2, 'transport retries a network failure once per process');
  let resumedCalls = 0;
  const resumed = createHttpTransport({ cacheDir: temp, rateMs: 0, sleepFn: async () => {}, fetchImpl: async (target) => { resumedCalls++; return response(200, target); } });
  equal((await resumed.request(url)).status, 200, 'new run retries cached transient response');
  equal(resumedCalls, 1, 'resume performs a fresh request instead of returning cached failure');
  equal((await resumed.request(url)).status, 200, 'successful response is then cached');
  equal(resumedCalls, 1, 'successful cache avoids duplicate request');
  let deniedCalls = 0;
  const denied = createHttpTransport({ cacheDir: temp, rateMs: 0, sleepFn: async () => {}, fetchImpl: async (target) => { deniedCalls++; return response(401, target); } });
  equal((await denied.request(`${url}/denied`)).status, 401, 'authorization response is preserved');
  equal(deniedCalls, 1, '401 is not automatically retried');
  const after401 = await denied.request(`${url}/other-player`);
  equal(after401.halted, true, '401 halts later requests to the same origin');
  equal(deniedCalls, 1, 'same-origin request after 401 never reaches fetch');
  let resumedDeniedCalls = 0;
  const deniedResume = createHttpTransport({ cacheDir: temp, rateMs: 0, sleepFn: async () => {}, fetchImpl: async (target) => { resumedDeniedCalls++; return response(200, target); } });
  equal((await deniedResume.request(`${url}/denied`)).status, 401, 'cached 401 remains visible after resume');
  equal((await deniedResume.request(`${url}/later-resume`)).halted, true, 'cached 401 also halts the origin after resume');
  equal(resumedDeniedCalls, 0, 'resume does not contact a halted origin');
  for (const status of [403, 429]) {
    let calls = 0;
    const terminal = createHttpTransport({ cacheDir: temp, rateMs: 0, sleepFn: async () => {}, fetchImpl: async (target) => { calls++; return response(status, target); } });
    equal((await terminal.request(`${url}/${status}`)).status, status, `${status} response remains visible`);
    equal(calls, 1, `${status} is not automatically retried`);
    const afterRefusal = await terminal.request(`${url}/later-${status}`);
    equal(afterRefusal.halted, true, `${status} halts later requests to the same origin`);
    equal(calls, 1, `same-origin request after ${status} never reaches fetch`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
const reparseTemp = await mkdtemp(resolve(cacheRoot, 'nexon-reparse-'));
if (!reparseTemp.startsWith(cacheRoot + sep)) throw new Error('Nexon reparse fixture escaped ignored research cache.');
try {
  const httpCache = resolve(reparseTemp, 'http');
  const progressFile = resolve(reparseTemp, 'full-progress.json');
  await mkdir(httpCache, { recursive: true });
  const params = { spid: '100000001', n1Strong: 1, n1Grow: 0, n4TeamColorId: 0, n4TeamColorLv: 0, n4TeamColorId_Enhance: 0, n4TeamColorLv_Enhance: 0, n4TeamColorId_Feature: 0, n1Change: 0, strPlayerImg: 0, rd: 0 };
  const abilityUrl = 'https://fconline.nexon.com/datacenter/PlayerAbility';
  const body = new URLSearchParams(params).toString();
  const cacheKey = createHash('sha256').update(`POST ${abilityUrl}\n${body}`).digest('hex');
  await writeFile(resolve(httpCache, `${cacheKey}.json`), `${JSON.stringify({ status: 200, url: abilityUrl, contentType: 'text/html', text: splitSectionFragment })}\n`, 'utf8');
  const candidate = (spid) => ({ site: 'nexon-fco', card_found: true, attributes_found: false, rawFields: { spid, abilityRequestParameters: { ...params, spid }, abilitySourceUrl: abilityUrl } });
  await writeFile(progressFile, `${JSON.stringify({ completed: {}, candidates: [candidate('100000001'), candidate('100000002')], observations: [], errors: [] })}\n`, 'utf8');
  const rebuilt = spawnSync(process.execPath, [resolve(DIR, 'scripts/reparse-nexon-cache.mjs'), `--progress=${progressFile}`, `--http-cache=${httpCache}`], { encoding: 'utf8', timeout: 30000 });
  equal(rebuilt.status, 0, `offline Nexon reparser uses saved responses only${rebuilt.stderr ? `: ${rebuilt.stderr}` : ''}`);
  const progress = JSON.parse(await readFile(progressFile, 'utf8'));
  equal(progress.offlineNexonAttributeReparse.parsedCandidates, 1, 'offline reparser reconstructs candidates with saved responses');
  equal(progress.offlineNexonAttributeReparse.missingOrFailedCache, 1, 'missing ability cache remains an explicit reparse failure');
  equal(progress.candidates[0].attributes['field-0'], 1, 'offline reparser stores only detailed fields in attributes');
  equal(progress.candidates[0].summaryAttributes['드리블'], 124, 'offline reparser stores card summary ratings separately');
  equal(progress.candidates[0].rawFields.nativeAbilityEntryCount, 22, 'offline reparser preserves all source entries');
  equal(progress.candidates[0].rawFields.detailedAttributeEntryCount, 21, 'offline reparser records the detailed entry count');
  equal(progress.candidates[1].attributes_found, false, 'missing cached response never fabricates attributes');
  equal(progress.candidates[1].rawFields.offlineAttributeReparse, 'missing_cached_response', 'missing response has explicit reason');
} finally {
  await rm(reparseTemp, { recursive: true, force: true });
}
const reportTemp = await mkdtemp(resolve(cacheRoot, 'report-generation-'));
if (!reportTemp.startsWith(cacheRoot + sep)) throw new Error('Report regression fixture escaped ignored research cache.');
try {
  const fixtureScripts = resolve(reportTemp, 'scripts');
  const fixtureInputs = resolve(reportTemp, 'inputs');
  await mkdir(fixtureScripts, { recursive: true });
  await mkdir(fixtureInputs, { recursive: true });
  for (const name of ['build-report.mjs', 'age-evidence.mjs', 'search-completeness.mjs', 'search-entity-key.mjs']) {
    await copyFile(resolve(DIR, 'scripts', name), resolve(fixtureScripts, name));
  }
  for (const name of ['players.json', 'player-seasons.json', 'source-summary.json']) {
    await copyFile(resolve(DIR, 'inputs', name), resolve(fixtureInputs, name));
  }
  const playersDoc = JSON.parse(await readFile(resolve(DIR, 'inputs/players.json'), 'utf8'));
  const playerSeasonsDoc = JSON.parse(await readFile(resolve(DIR, 'inputs/player-seasons.json'), 'utf8'));
  const completed = Object.fromEntries(playersDoc.players.map((player, index) => [`fo3:${player.searchEntityKey}`, { failed: index === 0 }]));
  const observations = playersDoc.players.map((player) => ({
    site: 'fo3', playerId: player.playerId, searchEntityKey: player.searchEntityKey,
    canonicalName: player.canonicalName, searchSucceeded: true, searchCompleteness: 'partial', truncated: true,
    observations: [{ status: 'partial', requestSucceeded: true, searchCompleteness: 'unknown', possiblyTruncated: true }],
  }));
  observations.push(
    { site: 'wefut', playerId: playersDoc.players[0].playerId, searchEntityKey: playersDoc.players[0].searchEntityKey, canonicalName: playersDoc.players[0].canonicalName, searchSucceeded: true, cardCandidates: 1, searchCompleteness: 'unknown', observations: [{ status: 'unverified', requestSucceeded: true, filterVerified: false, searchCompleteness: 'unknown' }] },
    { site: 'wefut', playerId: playersDoc.players[1].playerId, searchEntityKey: playersDoc.players[1].searchEntityKey, canonicalName: playersDoc.players[1].canonicalName, searchSucceeded: true, cardCandidates: 1, searchCompleteness: 'unknown', observations: [{ status: 'unverified', requestSucceeded: true, filterVerified: false, searchCompleteness: 'unknown' }] },
  );
  const candidates = [
    { site: 'wefut', searchEntityKey: playersDoc.players[0].searchEntityKey, name: 'unrelated page row', identity_confidence: 'none', overall_found: true, attributes_found: false },
    { site: 'wefut', searchEntityKey: playersDoc.players[1].searchEntityKey, name: playersDoc.players[1].canonicalName, identity_confidence: 'low', overall_found: true, attributes_found: false, potentialMetaAttributes: { Potential: 38 } },
    { site: 'nexon-fco', searchEntityKey: playersDoc.players[0].searchEntityKey, name: 'Korean display name', identity_confidence: 'unverified', identity_evidence: 'fixture_unverified_crosswalk', overall_found: true, attributes_found: true, attributes_complete: true, attribute_completeness_status: 'complete', attribute_field_count: 34, attributes: Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`detail_${i}`, i])), detailedAttributes: Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`detail_${i}`, i])), summaryAttributes: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`summary_${i}`, i])), rawFields: { nativeAbilityEntryCount: 40, nativeSummaryRatingCount: 6, detailedAttributeEntryCount: 34, detailedAttributeCount: 34, unclassifiedAttributeEntryCount: 0, base_state_verified: false } },
  ];
  await mkdir(resolve(reportTemp, '.cache'), { recursive: true });
  await writeFile(resolve(reportTemp, '.cache/full-progress.json'), `${JSON.stringify({ completed, candidates, observations, errors: [] })}\n`, 'utf8');
  await mkdir(resolve(reportTemp, 'results'), { recursive: true });
  await writeFile(resolve(reportTemp, 'results/wefut-edition-headers.json'), `${JSON.stringify({ source: 'public fixture page', generatedAt: '2026-10-08T00:00:00Z', rateLimitMs: 900, entries: [{ edition: 15, status: 'header_observed', httpStatus: 200, url: 'https://wefut.com/player-database/15/', headerEvidence: { headerColumnCount: 74, headerSha256: 'fixture-hash', expectedDetailedAttributeKeys: ['Agility', 'Acceleration'], columns: [{ index: 30, sourceLabel: 'Potential', group: 'potentialMetaAttributes', key: 'Potential' }], unclassifiedHeaderColumns: [], completeHeaderEvidence: true } }] })}\n`, 'utf8');
  const built = spawnSync(process.execPath, [resolve(fixtureScripts, 'build-report.mjs')], { encoding: 'utf8', timeout: 30000 });
  equal(built.status, 0, `report builder runs on a 95-player fixture${built.stderr ? `: ${built.stderr}` : ''}`);
  const report = JSON.parse(await readFile(resolve(reportTemp, 'results/coverage-report.json'), 'utf8'));
  equal(report.siteSummary.fo3.searchCompletenessDenominator, 95, 'report preserves the 95-entity search denominator');
  equal(report.playerSeasonCoverage.length, playerSeasonsDoc.playerSeasons.length, 'report emits all 99 PlayerSeason rows');
  equal(report.siteSummary.fo3.completedPlayerJobs, 94, 'successful completed-job count excludes retry-pending job');
  equal(report.siteSummary.fo3.jobsPendingRetry, 1, 'report derives pending retries from site-scoped job state');
  equal(report.siteSummary.wefut.jobsWithSuccessfulHttpResponse, 2, 'HTTP 200 is reported separately from name-filter success');
  equal(report.siteSummary.wefut.jobsWithVerifiedSearchFilter, 0, 'unverified global rows do not count as verified name searches');
  equal(report.siteSummary.wefut.playersWithAnyCandidateRows, 2, 'raw candidate rows are reported even when one fails identity matching');
  equal(report.priorityClubFocus.playerSeasonRows, 36, 'report includes all 36 PlayerSeason rows for the four requested clubs');
  equal(report.wefutHeaderAudit.editions[0].headerSha256, 'fixture-hash', 'final report preserves version-specific public header hash evidence');
  equal(report.wefutHeaderAudit.editions[0].expectedDetailedFieldCount, 2, 'final report lists the edition-specific expected field set size');
  equal(report.wefutHeaderAudit.editions[0].potentialMetadataColumns[0].key, 'Potential', 'edition header report keeps Potential outside detailed ability fields');
  equal(report.siteSummary.wefut.candidateRecordsWithPotentialMetadata, 1, 'report counts Potential metadata separately from attributes found');
  equal(report.priorityClubFocus.clubs.length, 4, 'report keeps the requested club focus explicit');
  check(report.priorityClubFocus.clubs.every((club) => club.playerSeasonRows === 9), 'each requested club summary uses its nine source PlayerSeason rows');
  check(report.priorityClubFocus.auditNote.includes('does not identify'), 'priority focus does not invent a disjoint 42-row unresolved cohort');
  const unrelatedRow = report.playerSeasonCoverage.find((row) => row.searchEntityKey === playersDoc.players[0].searchEntityKey).sites.wefut;
  check(unrelatedRow.http_response_succeeded && !unrelatedRow.search_filter_verified, 'HTTP response does not imply a verified search filter');
  check(unrelatedRow.candidate_observed && !unrelatedRow.query_matched_candidate && !unrelatedRow.card_found, 'unrelated HTTP 200 rows remain raw candidates, not a found card');
  check(unrelatedRow.noResultMeaning?.includes('not_global_absence'), 'unmatched response is explicitly not treated as global absence');
  const lowNameRow = report.playerSeasonCoverage.find((row) => row.searchEntityKey === playersDoc.players[1].searchEntityKey).sites.wefut;
  check(lowNameRow.card_found && !lowNameRow.confirmed_linked_identity && lowNameRow.identity_confidence === 'low', 'name-only candidate is distinguishable from a confirmed linked identity');
  equal(report.nexonOfficialConclusion.detailedAttributesPerCompleteCandidate, 34, 'Nexon conclusion distinguishes 34 detailed fields from summary ratings');
  equal(report.nexonOfficialConclusion.summaryRatingsPerCompleteCandidate, 6, 'Nexon conclusion reports six separate summary ratings');
  equal(report.nexonOfficialConclusion.candidateRecords, 1, 'Nexon conclusion counts its official fallback candidate');
  equal(report.nexonOfficialConclusion.completeDetailedAttributeCandidateRecords, 1, 'Nexon completeness reporting counts only fully audited detailed fields');
  equal(report.nexonOfficialConclusion.selectedAbilityState.n1Strong, 1, 'Nexon conclusion preserves the page-selected strength setting');
  equal(report.nexonOfficialConclusion.selectedAbilityState.baseStateVerified, false, 'Nexon conclusion does not claim the selected state is an unboosted base');
  equal(report.nexonOfficialConclusion.verifiedSameCardAttributeFills, 0, 'possible Nexon gap candidates are not counted as verified cross-source fills');
} finally {
  await rm(reportTemp, { recursive: true, force: true });
}
const mergeTemp = await mkdtemp(resolve(cacheRoot, 'worker-merge-cli-'));
if (!mergeTemp.startsWith(cacheRoot + sep)) throw new Error('Worker-merge fixture escaped ignored research cache.');
try {
  const fixtureScripts = resolve(mergeTemp, 'scripts');
  const fixtureInputs = resolve(mergeTemp, 'inputs');
  await mkdir(fixtureScripts, { recursive: true });
  await mkdir(fixtureInputs, { recursive: true });
  const mergeCodeFiles = ['merge-workers.mjs', 'worker-merge.mjs', 'identity-evidence.mjs', 'source-card-identity.mjs', 'search-entity-key.mjs', 'search.mjs', 'http-transport.mjs', 'job-retry.mjs', 'nexon-attributes.mjs', 'reparse-nexon-cache.mjs', 'build-report.mjs'];
  for (const name of mergeCodeFiles) await copyFile(resolve(DIR, 'scripts', name), resolve(fixtureScripts, name));
  for (const name of ['players.json', 'player-seasons.json', 'source-summary.json']) await copyFile(resolve(DIR, 'inputs', name), resolve(fixtureInputs, name));
  const mergePlayersDoc = JSON.parse(await readFile(resolve(fixtureInputs, 'players.json'), 'utf8'));
  const mergeSites = ['wefut', 'fo4', 'fo3', 'nexon-fco'];
  let firstWorkerSnapshot;
  for (const site of mergeSites) {
    const workerRoot = resolve(mergeTemp, '.cache/full-run-workers', site);
    const workerScripts = resolve(workerRoot, 'scripts');
    const workerCache = resolve(workerRoot, '.cache');
    await mkdir(workerScripts, { recursive: true });
    await mkdir(workerCache, { recursive: true });
    for (const name of ['search.mjs', 'http-transport.mjs', 'job-retry.mjs', 'search-entity-key.mjs']) await copyFile(resolve(DIR, 'scripts', name), resolve(workerScripts, name));
    const completed = Object.fromEntries(mergePlayersDoc.players.map((player) => [`${site}:${player.searchEntityKey}`, { failed: site === 'fo3' && player === mergePlayersDoc.players[0] }]));
    completed[`${site}:unresolved:foreign-seed:foreign-ps`] = { failed: false };
    const observations = mergePlayersDoc.players.map((player) => ({ site, playerId: player.playerId, searchEntityKey: player.searchEntityKey, canonicalName: player.canonicalName, observations: [], searchSucceeded: true, searchCompleteness: 'partial' }));
    const player = mergePlayersDoc.players[0];
    const numeric = player.existingExternalIds?.fifaIndex ?? 1075;
    const urls = {
      wefut: `https://wefut.com/player/14/991/${encodeURIComponent(player.canonicalName.toLowerCase().replaceAll(' ', '-'))}`,
      fo4: 'https://cn.fifaaddict.com/fo4db/pidfixture',
      fo3: `https://en.fifaaddict.com/fo3player.php?id=${numeric}`,
      'nexon-fco': 'https://fconline.nexon.com/DataCenter/PlayerInfo?spid=100000001&n1Strong=1',
    };
    const rawFields = site === 'wefut' ? { basePersonId: String(numeric) } : site === 'fo3' ? { playerId: String(numeric) } : site === 'nexon-fco' ? { spid: 100000001 } : {};
    const candidate = { site, searchEntityKey: player.searchEntityKey, searchedPlayerId: player.playerId, searchedCanonicalName: player.canonicalName, name: player.canonicalName, detailUrl: urls[site], card_found: true, overall: 87, overall_found: true, attributes_found: site === 'nexon-fco', attributes: {}, identity_confidence: site === 'nexon-fco' ? 'unverified' : 'high', identity_evidence: site === 'nexon-fco' ? 'static_name_group' : 'external_id_match', numericIdentityEvidence: null, rawFields };
    const source = { completed, candidates: [candidate, { ...candidate, site: site === 'fo4' ? 'fo3' : 'fo4', searchEntityKey: player.searchEntityKey }, { ...candidate, searchEntityKey: 'unresolved:foreign-seed:foreign-ps' }], observations, errors: [], haltedSites: {} };
    const sourcePath = resolve(workerCache, 'full-progress.json');
    await writeFile(sourcePath, `${JSON.stringify(source)}\n`, 'utf8');
    if (site === 'wefut') firstWorkerSnapshot = sourcePath;
    if (site === 'nexon-fco') {
      source.offlineNexonAttributeReparse = { parsedCandidates: 1, missingOrFailedCache: 0, nativeEntryCounts: { 40: 1 } };
      await writeFile(resolve(mergeTemp, '.cache/nexon-reparse-progress.json'), `${JSON.stringify(source)}\n`, 'utf8');
      await writeFile(sourcePath, `${JSON.stringify(source)}\n`, 'utf8');
    }
  }
  const mergedRun = spawnSync(process.execPath, [resolve(fixtureScripts, 'merge-workers.mjs')], { encoding: 'utf8', timeout: 30000, cwd: mergeTemp });
  equal(mergedRun.status, 0, `offline worker merge builds from exact checkpoints${mergedRun.stderr ? `: ${mergedRun.stderr}` : ''}`);
  const mergedProgress = JSON.parse(await readFile(resolve(mergeTemp, '.cache/full-progress.json'), 'utf8'));
  const mergedCandidates = JSON.parse(await readFile(resolve(mergeTemp, 'results/candidates.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(mergeTemp, 'results/run-manifest.json'), 'utf8'));
  equal(Object.keys(mergedProgress.completed).length, 380, 'offline merge produces 380 attempted source/entity jobs for 95 inputs');
  equal(mergedProgress.observations.length, 380, 'offline merge retains one search outcome for every attempted job');
  equal(mergedProgress.candidates.length, 4, 'offline merge filters foreign seeds while keeping one candidate per source');
  equal(mergedProgress.candidates[0].identity_confidence, 'low', 'merged WeFUT numeric collision is downgraded to name-only evidence');
  equal(mergedProgress.candidates[0].sourceIdNamespace, 'wefut:card', 'merged WeFUT route ID is source-namespaced');
  equal(mergedProgress.sourceAccounting.fo3.jobsPendingRetry, 1, 'merge preserves failed jobs as pending retries');
  equal(mergedProgress.sourceAccounting.wefut.foreignOrOutOfScopeCandidatesExcluded, 2, 'merge records source/entity seeds it excludes');
  equal(mergedCandidates.playerSeasonCount, 99, 'merged candidate artifact retains all 99 PlayerSeason denominator');
  check(manifest.acquisition.sites.wefut.acquisitionCodeSha256['scripts/search.mjs'].length === 64, 'manifest records frozen worker search-code hash');
  check(manifest.postprocessingCodeSha256['scripts/identity-evidence.mjs'].length === 64, 'manifest records current offline identity-enrichment hash');
  check(manifest.acquisition.sites['nexon-fco'].originalAcquisitionCheckpointSha256.length === 64, 'manifest records original Nexon acquisition checkpoint separately from its amended merge snapshot');
  equal(manifest.runtime.defaultPerOriginDelayMs, 900, 'manifest records the adapter default request delay');
  equal(manifest.runtime.acquisitionPerOriginDelayMs, null, 'manifest does not claim an unrecorded acquisition environment override');
  check(manifest.runtime.acquisitionRateNote.includes('HISTORICAL_CARD_RATE_MS'), 'manifest explains why the effective acquisition delay is unknown');
  const original = JSON.parse(await readFile(firstWorkerSnapshot, 'utf8'));
  check(!original.sourceAccounting, 'merge never modifies source worker snapshots');
  const nexonInputPath = resolve(mergeTemp, '.cache/nexon-reparse-progress.json');
  const safeCandidatesPath = resolve(mergeTemp, 'results/candidates.json');
  const safeManifestPath = resolve(mergeTemp, 'results/run-manifest.json');
  const beforeUnsafeRuns = {
    worker: await readFile(firstWorkerSnapshot, 'utf8'), nexon: await readFile(nexonInputPath, 'utf8'),
    candidates: await readFile(safeCandidatesPath, 'utf8'), manifest: await readFile(safeManifestPath, 'utf8'),
  };
  const mergeScript = resolve(fixtureScripts, 'merge-workers.mjs');
  async function assertRejectedWithoutWrites(options, label, expectedError) {
    const attempt = spawnSync(process.execPath, [mergeScript, ...options], { encoding: 'utf8', timeout: 30000, cwd: mergeTemp });
    check(attempt.status !== 0 && attempt.stderr.includes(expectedError), `${label} is rejected before writing`);
    equal(await readFile(firstWorkerSnapshot, 'utf8'), beforeUnsafeRuns.worker, `${label} leaves worker input unchanged`);
    equal(await readFile(nexonInputPath, 'utf8'), beforeUnsafeRuns.nexon, `${label} leaves amended Nexon input unchanged`);
    equal(await readFile(safeCandidatesPath, 'utf8'), beforeUnsafeRuns.candidates, `${label} leaves candidate output unchanged`);
    equal(await readFile(safeManifestPath, 'utf8'), beforeUnsafeRuns.manifest, `${label} leaves manifest output unchanged`);
  }
  await assertRejectedWithoutWrites(
    ['--out-progress=.cache/full-run-workers/wefut/.cache/full-progress.json'],
    'worker-checkpoint output collision', 'approved generated-output directory',
  );
  await assertRejectedWithoutWrites(
    ['--out-manifest=.cache/FULL-RUN-WORKERS/WEFUT/nested/manifest.json'],
    'case-insensitive worker-root subpath output', 'approved generated-output directory',
  );
  await assertRejectedWithoutWrites(
    ['--out-progress=.cache/nexon-reparse-progress.json'],
    'amended Nexon checkpoint output collision', 'approved generated-output directory',
  );
  await assertRejectedWithoutWrites(
    ['--out-candidates=results/run-manifest.json'],
    'pairwise output collision', 'Output paths overlap',
  );
  await assertRejectedWithoutWrites(
    ['--out-manifest=scripts/merge-workers.mjs'],
    'script-source output collision', 'approved generated-output directory',
  );
  await assertRejectedWithoutWrites(
    ['--out-candidates=.cache/http/primary-response.json'],
    'raw HTTP cache output collision', 'approved generated-output directory',
  );
  await assertRejectedWithoutWrites(
    ['--out-manifest=README.md'],
    'documentation output collision', 'approved generated-output directory',
  );
} finally {
  await rm(mergeTemp, { recursive: true, force: true });
}
console.log(JSON.stringify({ result: 'PASS', regressionChecks: checks }, null, 2));

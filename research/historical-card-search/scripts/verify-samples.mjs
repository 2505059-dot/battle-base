import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageAtRosterYear, ageConflictAtRosterYear, identityLinkedForSeason } from './age-evidence.mjs';
import { assertUniqueSearchEntityKeys } from './search-entity-key.mjs';
const DIR = fileURLToPath(new URL('../', import.meta.url));
const excludedSamples = [
  'results/sample-wefut-candidates.json',
  'results/sample-fo4-candidates.json',
  'results/sample-fo3-candidates.json',
  'results/sample-nexon-fco-candidates.json',
];
const missingSamples = [];
for (const samplePath of excludedSamples) {
  try { await access(resolve(DIR, samplePath)); } catch { missingSamples.push(samplePath); }
}
if (missingSamples.length) {
  console.error(`[verify-samples] UNAVAILABLE: baseline v2 intentionally excludes ${missingSamples.join(', ')}. Restore only after source redistribution rights are resolved.`);
  process.exitCode = 2;
} else {
async function json(path) { return JSON.parse(await readFile(resolve(DIR, path), 'utf8')); }
const [playersDoc, seasonsDoc, wefut, fo4, fo3, nexon, schema, searchSource] = await Promise.all([
  json('inputs/players.json'), json('inputs/player-seasons.json'),
  json('results/sample-wefut-candidates.json'), json('results/sample-fo4-candidates.json'),
  json('results/sample-fo3-candidates.json'), json('results/sample-nexon-fco-candidates.json'),
  json('candidate-schema.json'), readFile(resolve(DIR, 'scripts/search.mjs'), 'utf8'),
]);
assert.equal(playersDoc.players.length, 95, 'canonical input entity count');
assert.equal(seasonsDoc.playerSeasons.length, 99, 'PlayerSeason input row count');
assert.equal(new Set(seasonsDoc.playerSeasons.map((s) => s.teamSeasonId)).size, 11, 'early-team count');
assert.equal(new Set(playersDoc.players.map((p) => p.searchEntityKey)).size, 95, 'stable searchEntityKey count');
assert.deepEqual(assertUniqueSearchEntityKeys(playersDoc.players), playersDoc.players.map((p) => p.searchEntityKey), 'input search keys are stable and unique');
for (const [site, sample] of [['WeFUT', wefut], ['FO4', fo4], ['FO3', fo3], ['Nexon', nexon]]) {
  assert.equal(sample.samplePlayerIds.length, 8, `${site} sample entity count`);
  assert.equal(new Set(sample.samplePlayerIds).size, 8, `${site} sample distinct IDs`);
  assert.equal(sample.observations.length, 8, `${site} has one observation per sample player`);
}
for (const sample of [wefut, fo4, fo3, nexon]) {
  const entityKeys = new Set(playersDoc.players.map((p) => p.searchEntityKey));
  assert(sample.observations.every((o) => entityKeys.has(o.searchEntityKey)), 'sample jobs use stable searchEntityKey');
  assert(sample.candidates.every((c) => entityKeys.has(c.searchEntityKey)), 'sample candidates use stable searchEntityKey');
}
assert.equal(wefut.candidates.length, 8, 'WeFUT sample retains only lexical candidate rows');
assert(wefut.candidates.every((c) => c.edition === 14 && Number.isInteger(c.cardId)), 'WeFUT edition/card-instance IDs');
assert(wefut.candidates.every((c) => c.cardType && !String(c.cardType).includes('<')), 'WeFUT card version is text, not builder markup');
assert(wefut.candidates.every((c) => c.rawFields.basePlayerId && c.rawFields.teamId && c.rawFields.countryId), 'WeFUT keeps distinct raw player/team/country IDs');
assert(wefut.errors.some((e) => e.kind === 'search_filter_unverified'), 'WeFUT records unfiltered first-page probes');
assert(wefut.errors.filter((e) => e.kind === 'search_filter_unverified').every((e) => e.returned <= 100), 'WeFUT query guard stops at first page');
assert(wefut.candidates.some((c) => c.searchedCanonicalName === 'Zinedine Zidane' && c.identity_confidence === 'none'), 'WeFUT false-name result is retained as unlinked evidence');
assert(!wefut.candidates.some((c) => c.searchedCanonicalName === 'Costinha'), 'WeFUT unverified global rows do not become Costinha cards');
assert(fo4.candidates.length > 0 && fo4.candidates.every((c) => c.attributes_found === false), 'FO4 SSR zeros are not detailed attributes');
assert(fo4.observations.every((o) => o.searchCompleteness === 'partial' && o.truncated), 'FO4 one-page search remains partial in the full denominator');
assert(fo4.observations.every((o) => o.observations.every((x) => x.searchCompleteness === 'unknown' && x.possiblyTruncated)), 'FO4 per-query pagination uncertainty is explicit');
assert(fo4.candidates.some((c) => Object.keys(c.summaryAttributes ?? {}).length >= 4), 'FO4 summary stats remain separate');
assert(fo4.candidates.some((c) => c.placeholderFields.length > 0), 'FO4 zero placeholders are recorded');
assert(fo4.candidates.every((c) => Object.values(c.attributes ?? {}).every((n) => n > 0)), 'FO4 zero values are excluded from real attributes');
assert(fo3.candidates.length === 25, 'FO3 sample preserves all source rows');
const linkedFo3 = fo3.candidates.filter((c) => c.identity_confidence !== 'none');
assert(linkedFo3.length > 0 && linkedFo3.every((c) => c.card_found && c.overall_found), 'FO3 identity-linked candidate OVR');
assert(fo3.candidates.filter((c) => c.identity_confidence === 'none').every((c) => !c.card_found && !c.overall_found && !c.attributes_found), 'FO3 wrong-name rows remain raw but do not set coverage');
assert(fo3.candidates.every((c) => c.attributes_found === false), 'FO3 blank SSR stats are not detailed attributes');
assert(fo3.candidates.some((c) => c.searchedCanonicalName === 'Zinedine Zidane' && c.identity_confidence === 'none'), 'FO3 name-substring false positives stay unlinked');
assert(fo3.candidates.filter((c) => c.identity_confidence === 'none').every((c) => !c.card_found), 'FO3 false matches are excluded from card coverage');
assert(nexon.candidates.length === 58, 'Nexon sample preserves every returned variant');
assert(nexon.candidates.every((c) => c.sourceRole === 'optional_fallback' && c.identity_confidence === 'unverified'), 'Nexon remains isolated and unverified');
assert(nexon.candidates.every((c) => c.attributes_found && Object.keys(c.attributes).length >= 20), 'Nexon attribute fragments parse at least 20 named values');
assert(nexon.candidates.every((c) => c.cardState.n1Strong === 1 && c.cardState.n1Grow === 0 && c.base_state_verified === false), 'Nexon default ability state is explicit, never called base');
assert(nexon.candidates.every((c) => c.card_found && c.attributes_found), 'Nexon candidate evidence remains available despite unverified cross-source identity');
assert(nexon.observations.every((o) => o.searchCompleteness === 'partial' && o.truncated), 'Nexon single-page search is partial, not exhaustive');
assert(nexon.observations.some((o) => o.observations.some((x) => x.staticNameFamilyCompleteness === 'complete_for_exact_normalized_name_group_in_official_static_index')), 'Nexon static name-family enumeration is reported separately');
assert(nexon.candidates.every((c) => c.rawFields.spid === c.cardId && c.rawFields.spidStatic?.id === c.cardId), 'Nexon full SPID is cross-checked against official static metadata');
assert(nexon.candidates.every((c) => !('abilityHtmlFragment' in c.rawFields) && !('resultRow' in c.rawFields)), 'Nexon structured candidates omit duplicated raw HTML; cached responses retain it');
assert(ageAtRosterYear({ dateOfBirth: '出生于1989年3月19日' }, { year: 2000 }) === 11, 'Chinese DOB age calculation');
assert(ageAtRosterYear({ dateOfBirth: '19.3.1976' }, { year: 2000 }) === 24, 'FO3 day.month.year DOB age calculation');
assert(ageConflictAtRosterYear({ dateOfBirth: '2000-01-01' }, { year: 2010 }), 'under-14 roster-year conflict');
assert(!identityLinkedForSeason({ identity_confidence: 'low', dateOfBirth: '2000-01-01' }, { year: 2010 }), 'age-conflicting name match is excluded');
assert(!identityLinkedForSeason({ identity_confidence: 'none' }, { year: 2010 }), 'name mismatch is excluded');
assert(identityLinkedForSeason({ identity_confidence: 'low', dateOfBirth: '1976-01-01' }, { year: 2000 }), 'plausible low-confidence identity remains a candidate');
assert.deepEqual(schema.properties.site.enum, ['wefut', 'fo4', 'fo3', 'nexon-fco']);
assert.deepEqual(schema.properties.searchedPlayerId.type, ['string', 'null']);
assert.equal(schema.properties.searchEntityKey.type, 'string');
assert(searchSource.includes('if (mode === \'all\' && active.completed[key] && !active.completed[key].failed) continue;'), 'full run resumes successful jobs but retries failed checkpoints');
assert(searchSource.includes('failed: shouldRetryJob(result)'), 'transient detail failures mark checkpoints for retry');
assert(searchSource.includes('RATE_MS = Number(process.env.HISTORICAL_CARD_RATE_MS || 900)'), 'uncached requests are rate limited');
console.log(JSON.stringify({ result: 'PASS', inputs: { players: playersDoc.players.length, playerSeasons: seasonsDoc.playerSeasons.length, teams: 11 }, samples: { wefut: wefut.candidates.length, fo4: fo4.candidates.length, fo3: fo3.candidates.length, nexonFco: nexon.candidates.length }, sampleSourcesVerified: 4 }, null, 2));
}

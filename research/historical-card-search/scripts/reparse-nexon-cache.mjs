import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNexonAttributeEntries, parseNexonAttributeEntries } from './nexon-attributes.mjs';
import { applySourceLocalCardIdentity } from './source-card-identity.mjs';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}
const progressFile = resolve(option('progress', resolve(DIR, '.cache/full-progress.json')));
const httpCache = resolve(option('http-cache', resolve(DIR, '.cache/http')));
const progress = JSON.parse(await readFile(progressFile, 'utf8'));
progress.candidates ??= [];
const errors = [];
let parsedCount = 0;
let missingCount = 0;
let detailedAttributeCandidates = 0;
let nativeEntryCounts = {};
for (const candidate of progress.candidates) {
  Object.assign(candidate, applySourceLocalCardIdentity(candidate));
  if (candidate.site !== 'nexon-fco') continue;
  const params = candidate.rawFields?.abilityRequestParameters;
  const url = candidate.rawFields?.abilitySourceUrl ?? 'https://fconline.nexon.com/datacenter/PlayerAbility';
  if (!params || !candidate.rawFields?.spid) {
    missingCount++;
    candidate.attributes_found = false;
    candidate.rawFields = { ...candidate.rawFields, offlineAttributeReparse: 'missing_request_parameters' };
    errors.push({ kind: 'offline_attribute_reparse_missing_parameters', sourceCardId: candidate.sourceCardId ?? null });
    continue;
  }
  const body = new URLSearchParams(params).toString();
  const key = createHash('sha256').update(`POST ${url}\n${body}`).digest('hex');
  const cacheFile = resolve(httpCache, `${key}.json`);
  let response;
  try { response = JSON.parse(await readFile(cacheFile, 'utf8')); }
  catch {
    missingCount++;
    candidate.attributes_found = false;
    candidate.rawFields = { ...candidate.rawFields, offlineAttributeReparse: 'missing_cached_response', abilityResponseCacheKey: key };
    errors.push({ kind: 'offline_attribute_reparse_cache_missing', sourceCardId: candidate.sourceCardId ?? null, cacheKey: key });
    continue;
  }
  if (response.status < 200 || response.status >= 300 || typeof response.text !== 'string') {
    missingCount++;
    candidate.attributes_found = false;
    candidate.blocked_or_unavailable = [401, 403, 429].includes(Number(response.status)) || Boolean(response.halted);
    candidate.unavailableReason = candidate.blocked_or_unavailable ? `ability_http_${response.status}` : 'ability_cached_response_unavailable';
    candidate.rawFields = { ...candidate.rawFields, offlineAttributeReparse: 'cached_response_not_successful', abilityResponseCacheKey: key };
    errors.push({ kind: 'offline_attribute_reparse_cached_response_failed', status: response.status ?? null, sourceCardId: candidate.sourceCardId ?? null, cacheKey: key });
    continue;
  }
  const entries = parseNexonAttributeEntries(response.text);
  const parsed = normalizeNexonAttributeEntries(entries);
  candidate.attributes = parsed.attributes;
  candidate.summaryAttributes = parsed.summaryRatings;
  candidate.attributes_found = parsed.attributes_found;
  candidate.attributes_ambiguous = parsed.attributes_ambiguous;
  candidate.attributeAmbiguities = parsed.attributeAmbiguities;
  candidate.sourceCardId = String(candidate.rawFields.spid);
  candidate.sourceIdNamespace = 'nexon-fco:spid';
  candidate.sourcePlayerId = null;
  candidate.numericIdentityEvidence = null;
  candidate.rawFields = {
    ...candidate.rawFields,
    abilityAttributesRaw: entries,
    nativeAbilityEntryCount: entries.length,
    nativeSummaryRatingCount: parsed.summaryRatingCount,
    detailedAttributeEntryCount: parsed.detailedAttributeEntryCount,
    detailedAttributeCount: parsed.detailedAttributeCount,
    duplicateAttributeLabels: parsed.duplicateAttributeLabels,
    attributeAmbiguities: parsed.attributeAmbiguities,
    unclassifiedAttributeEntryCount: parsed.unclassifiedEntryCount,
    abilityResponseCacheKey: key,
    offlineAttributeReparse: 'reparsed_from_saved_public_post_response_no_network',
  };
  nativeEntryCounts[entries.length] = (nativeEntryCounts[entries.length] ?? 0) + 1;
  parsedCount++;
  if (candidate.attributes_found) detailedAttributeCandidates++;
}
progress.offlineNexonAttributeReparse = {
  source: 'saved HTTP cache only; this utility never makes requests',
  parsedCandidates: parsedCount,
  missingOrFailedCache: missingCount,
  detailedAttributeCandidates,
  nativeEntryCounts,
  errors,
};
await writeFile(progressFile, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(progress.offlineNexonAttributeReparse, null, 2));

import { createHttpTransport } from './http-transport.mjs';
import { searchEntityKeyFor } from './search-entity-key.mjs';
import { requestWorked, shouldRetryJob } from './job-retry.mjs';
import { searchCompletenessOf } from './search-completeness.mjs';
import { wefutPaginationCompleteness } from './wefut-pagination.mjs';
import { normalizeNexonAttributeEntries, parseNexonAttributeEntries } from './nexon-attributes.mjs';
import { sourceLocalCardIdentity } from './source-card-identity.mjs';
import { classifyIdentity } from './identity-evidence.mjs';
import { extractWefutHeaderEvidence, normalizeCandidateAttributeCompleteness, parseWefutAttributes } from './worker-merge.mjs';
import { buildWefutPostBody, wefutRequestColumnCount } from './wefut-request.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const INPUT = resolve(DIR, 'inputs');
const CACHE = resolve(DIR, '.cache');
const OUT = resolve(DIR, 'results');
const RATE_MS = Number(process.env.HISTORICAL_CARD_RATE_MS || 900);
const SAMPLE_IDS = new Set(['peter-schmeichel', 'thierry-henry', 'zinedine-zidane', 'roberto-ayala', 'djalminha', 'alessandro-nesta', 'pavel-nedved', 'costinha']);
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const int = (v) => { const m = String(v ?? '').match(/-?\d+/); return m ? Number(m[0]) : null; };
const safe = (v) => String(v ?? '').trim();
const strip = (s) => decode(String(s ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function decode(s) {
  return String(s).replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attr(tag, key) {
  const re = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  return tag.match(re)?.[2] ?? '';
}
async function json(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }
async function save(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
const playersDoc = JSON.parse(await readFile(resolve(INPUT, 'players.json'), 'utf8'));
const seasonsDoc = JSON.parse(await readFile(resolve(INPUT, 'player-seasons.json'), 'utf8'));
const players = playersDoc.players;
const playerSeasons = seasonsDoc.playerSeasons;
const teamNames = new Map(playerSeasons.map((s) => [s.teamSeasonId, s.club]));
const { request } = createHttpTransport({ cacheDir: CACHE, rateMs: RATE_MS });
const ACCESS_STOP_STATUSES = new Set([401, 403, 429]);
function accessStopFailure(result) {
  const nested = (result.observations ?? []).flatMap((item) => item.observations ?? [item]);
  return [...(result.errors ?? []), ...nested].find((item) => ACCESS_STOP_STATUSES.has(Number(item.status ?? item.httpStatus))) ?? null;
}
function requestOk(result) { return result.status >= 200 && result.status < 300; }
function identity(player, cardName, numericIdentityEvidence = null) {
  return classifyIdentity(player, cardName, numericIdentityEvidence);
}
function attributeResult(attrs, placeholders = []) {
  const filtered = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const numeric = int(value);
    if (numeric != null && numeric > 0) filtered[key] = numeric;
  }
  const placeholderFields = [...new Set(placeholders)];
  return { attributes: filtered, placeholderFields, attributes_found: Object.keys(filtered).length >= 20 };
}
function baseCandidate(site, player, name, searchTerm, searchUrl, detailUrl, data) {
  const id = identity(player, name, data.numericIdentityEvidence ?? null);
  const localId = sourceLocalCardIdentity(site, detailUrl, data.rawFields ?? {});
  return {
    schemaVersion: 'historical-card-search-candidate/1', site,
    searchedPlayerId: player.playerId, searchEntityKey: searchEntityKeyFor(player), searchedCanonicalName: player.canonicalName,
    name: name || null, identity_confidence: id.level, identity_evidence: id.evidence,
    card_found: id.level !== 'none', overall: data.overall ?? null, overall_found: id.level !== 'none' && Number.isFinite(data.overall),
    attributes_found: id.level !== 'none' && Boolean(data.attributes_found),
    attributes: id.level !== 'none' ? (data.attributes ?? {}) : {}, placeholderFields: data.placeholderFields ?? [],
    detailedAttributes: id.level !== 'none' ? (data.detailedAttributes ?? data.attributes ?? {}) : {},
    summaryAttributes: data.summaryAttributes ?? data.summaryRatings ?? {}, summaryRatings: data.summaryRatings ?? data.summaryAttributes ?? {}, skillMetaAttributes: data.skillMetaAttributes ?? {},
    potentialMetaAttributes: data.potentialMetaAttributes ?? {},
    attributes_complete: data.attributes_complete ?? (['fo3', 'fo4'].includes(site) && !data.attributes_found ? false : null),
    attribute_completeness_status: data.attribute_completeness_status ?? (['fo3', 'fo4'].includes(site) && !data.attributes_found ? 'unavailable' : 'unknown'),
    attribute_field_count: data.attribute_field_count ?? Object.keys(data.detailedAttributes ?? data.attributes ?? {}).length,
    attributeSourceEvidence: data.attributeSourceEvidence ?? null,
    cardId: data.cardId ?? localId.cardId,
    sourceCardId: localId.sourceCardId, sourceIdNamespace: localId.sourceIdNamespace,
    sourcePlayerId: localId.sourcePlayerId, numericIdentityEvidence: data.numericIdentityEvidence ?? null,
    cardType: data.cardType ?? null, version: data.version ?? null,
    positions: data.positions ?? [], nationality: data.nationality ?? null,
    club: data.club ?? null, dateOfBirth: data.dateOfBirth ?? null,
    historical_relevance: 'unverified',
    historical_relevance_reason: 'Card-era or identity evidence does not independently establish the target club-season association.',
    blocked_or_unavailable: false, unavailableReason: null,
    searchTerm, searchUrl, sourceUrl: searchUrl, detailUrl: detailUrl || null,
    rawFields: data.rawFields ?? {}, matchedSearchTerms: [searchTerm],
  };
}
let wefutCsrfPromise;
async function wefutCsrf() {
  if (!wefutCsrfPromise) wefutCsrfPromise = (async () => {
    const pageUrl = 'https://wefut.com/player-database/14/';
    const page = await request(pageUrl, { refresh: true });
    if (!requestOk(page)) return { token: null, pageUrl, status: page.status, pageHtml: page.text ?? '', error: page.error ?? null };
    const cookies = page.setCookie ?? [];
    const cookie = cookies.map((value) => value.match(/(?:^|;\s*)wf_csrf_c=([^;]+)/i)?.[1]).find(Boolean) ?? null;
    const token = cookie ? decodeURIComponent(cookie) : null;
    const cookieHeader = cookies.map((value) => value.split(';', 1)[0].trim()).filter(Boolean).join('; ');
    return { token, cookie: token ? cookieHeader : null, pageUrl, status: page.status, pageHtml: page.text ?? '' };
  })();
  return wefutCsrfPromise;
}
const wefutHeaderSchemaPromises = new Map();
async function wefutHeaderSchemaFor(edition, csrfState) {
  if (wefutHeaderSchemaPromises.has(edition)) return wefutHeaderSchemaPromises.get(edition);
  const pending = (async () => {
    const pageUrl = `https://wefut.com/player-database/${edition}/`;
    const page = edition === 14
      ? { status: csrfState.status, url: csrfState.pageUrl, text: csrfState.pageHtml ?? '' }
      : await request(pageUrl, { refresh: true });
    if (!requestOk(page)) return { schema: null, status: page.status, url: page.url ?? pageUrl, reason: 'edition_header_page_request_failed' };
    const schema = extractWefutHeaderEvidence(page.text, edition, page.url ?? pageUrl);
    return schema ? { schema, status: page.status, url: page.url ?? pageUrl, reason: null } : { schema: null, status: page.status, url: page.url ?? pageUrl, reason: 'playerTable_header_not_found_or_unclassified' };
  })();
  wefutHeaderSchemaPromises.set(edition, pending);
  return pending;
}
function wefutRows(result) {
  try { const data = JSON.parse(result.text); const count = data.iTotalDisplayRecords ?? data.iTotalRecords; return { rows: data.aaData ?? [], count: count == null || count === '' ? null : Number(count), parseError: null, echo: data.sEcho }; }
  catch (e) { return { rows: [], count: 0, parseError: String(e.message) }; }
}
function wefutQueryMatch(player, term, name) {
  const query = norm(term), value = norm(name);
  return Boolean(query && value.includes(query)) || identity(player, name).level !== 'none';
}
async function searchWeFut(player) {
  const candidates = new Map(), observations = [], errors = [];
  const terms = [...new Set([player.canonicalName, ...(player.rosterNames ?? []), ...(player.searchTerms ?? [])].filter(Boolean))].slice(0, 2);
  const cliEditions = process.argv.find((a) => a.startsWith('--editions='))?.slice('--editions='.length).split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 14 && n <= 27);
  const defaultEditions = process.argv.includes('--all') || process.argv.includes('--resume') ? Array.from({length: 14}, (_, i) => i + 14) : [14, 26, 27];
  const editions = cliEditions?.length ? [...new Set(cliEditions)] : defaultEditions;
  const csrfState = await wefutCsrf();
  if (!csrfState.token) {
    const reason = csrfState.status >= 200 && csrfState.status < 300 ? 'public_page_did_not_set_wf_csrf_c_cookie' : `public_page_http_${csrfState.status}`;
    errors.push({ kind: 'csrf_cookie_unavailable', status: csrfState.status, url: csrfState.pageUrl, error: csrfState.error ?? reason });
    return { candidates: [], observations: editions.flatMap((edition) => terms.map((term) => ({ term, edition, status: 'failed', searchSucceeded: false, filterVerified: false, reason, url: csrfState.pageUrl }))), errors };
  }
  const endpoint = (edition) => `https://wefut.com/ajax/getPlayers/${edition}`;
  for (const term of terms) {
    for (const edition of editions) {
      const headerResult = await wefutHeaderSchemaFor(edition, csrfState);
      if (!headerResult.schema && headerResult.reason) errors.push({ term, edition, kind: 'attribute_header_unavailable', status: headerResult.status, url: headerResult.url, reason: headerResult.reason });
      const requestColumnCount = wefutRequestColumnCount(headerResult.schema);
      if (requestColumnCount == null) {
        observations.push({ term, edition, status: 'failed', requestSucceeded: false, searchSucceeded: false, filterVerified: false, searchCompleteness: 'unknown', possiblyTruncated: true, requestShape: 'unknown_playerTable_header_column_count', reason: headerResult.reason ?? 'playerTable_header_column_count_unavailable', httpStatus: headerResult.status ?? null, url: headerResult.url ?? endpoint(edition) });
        continue;
      }
      let start = 0, returned = 0, candidateRows = 0, firstReported = null, truncated = false, status = 'ok', filterVerified = true;
      let searchUrl = endpoint(edition); const seenPageIds = new Set(), seenRawIds = new Set(), pageCounts = []; let noiseExamples = [];
      do {
        const body = buildWefutPostBody(term, start, csrfState.token, requestColumnCount);
        const response = await request(searchUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: csrfState.cookie, Referer: `https://wefut.com/player-database/${edition}/`, Origin: 'https://wefut.com', 'X-Requested-With': 'XMLHttpRequest' } });
        if (!requestOk(response)) { errors.push({ term, edition, status: response.status, url: searchUrl, error: response.error ?? null }); status = 'failed'; filterVerified = false; break; }
        const parsed = wefutRows(response);
        if (parsed.parseError) { errors.push({ term, edition, status: response.status, kind: 'parse_error', url: searchUrl, error: parsed.parseError }); status = 'failed'; filterVerified = false; break; }
        if (firstReported === null) firstReported = parsed.count;
        pageCounts.push({ reported: parsed.count, rows: parsed.rows.length });
        if (!parsed.rows.length) break;
        const pageCandidates = parsed.rows.map((row) => {
          const name = `${safe(row['1'])} ${safe(row['2'])}`.trim() || safe(row.name);
          const detailPath = safe(row.player_url); const detailUrl = detailPath ? new URL(detailPath, 'https://wefut.com/').href : null;
          const routeCardId = detailUrl ? (new URL(detailUrl).pathname.split('/')[3] ?? null) : null;
          const raw = { ...row };
          const parsedAttrs = parseWefutAttributes(row, edition, headerResult.schema);
          const candidate = baseCandidate('wefut', player, name, term, searchUrl, detailUrl, {
            overall: int(row['4']), attributes: parsedAttrs.attributes, detailedAttributes: parsedAttrs.detailedAttributes,
            summaryAttributes: parsedAttrs.summaryAttributes, skillMetaAttributes: parsedAttrs.skillMetaAttributes, potentialMetaAttributes: parsedAttrs.potentialMetaAttributes,
            attributes_found: parsedAttrs.attributes_found, attributes_complete: parsedAttrs.attributes_complete,
            attribute_completeness_status: parsedAttrs.attribute_completeness_status, attribute_field_count: parsedAttrs.attribute_field_count,
            attributeSourceEvidence: parsedAttrs.attributeSourceEvidence, placeholderFields: [],
            cardType: safe(row['72']) || null, version: safe(row['70']) || safe(row['71']) || null,
            positions: safe(row['8']).split(/[\s,/]+/).filter(Boolean), nationality: safe(row['12']) || null,
            club: safe(row['10']) || null, dateOfBirth: safe(row['5']) || null,
            rawFields: { ...raw, ...(headerResult.schema ? { wefutHeaderEvidence: headerResult.schema } : {}) },
          });
          candidate.edition = edition; candidate.cardId = routeCardId ? Number(routeCardId) : detailUrl; candidate.rawCardMarkup = safe(row.player_card) || null;
          candidate.searchProtocol = 'public_page_datatables_post';
          return candidate;
        });
        for (const candidate of pageCandidates) {
          const rawKey = `${edition}:${candidate.detailUrl ?? JSON.stringify(candidate.rawFields)}`;
          seenRawIds.add(rawKey);
        }
        const matchedPage = pageCandidates.filter((candidate) => wefutQueryMatch(player, term, candidate.name));
        const hasUnrelatedRows = matchedPage.length !== pageCandidates.length;
        if (!matchedPage.length) {
          status = 'unverified'; truncated = true;
          filterVerified = false;
          noiseExamples = pageCandidates.slice(0, 3).map((c) => ({ name: c.name, detailUrl: c.detailUrl }));
          errors.push({ term, edition, kind: 'search_filter_unverified', reported: parsed.count, returned: parsed.rows.length, noiseExamples, url: searchUrl });
          break;
        }
        let newRows = 0;
        for (const candidate of matchedPage) {
          const key = `${edition}:${candidate.detailUrl ?? JSON.stringify(candidate.rawFields)}`;
          if (seenPageIds.has(key)) continue;
          seenPageIds.add(key); newRows++;
          const existing = candidates.get(key);
          if (existing) existing.matchedSearchTerms.push(term); else candidates.set(key, candidate);
          candidateRows++;
        }
        returned += parsed.rows.length;
        start += parsed.rows.length;
        if (hasUnrelatedRows) {
          status = 'partial'; truncated = true;
          filterVerified = false;
          noiseExamples = pageCandidates.filter((c) => !wefutQueryMatch(player, term, c.name)).slice(0, 3).map((c) => ({ name: c.name, detailUrl: c.detailUrl }));
          errors.push({ term, edition, kind: 'search_filter_partially_unverified', reported: parsed.count, returned: parsed.rows.length, matched: matchedPage.length, noiseExamples, url: searchUrl });
          break;
        }
        if (parsed.rows.length < 100) break;
        if (newRows === 0) { truncated = true; errors.push({ term, edition, kind: 'pagination_repeated_page', offset: start, reported: parsed.count, url: searchUrl }); break; }
        if (start >= 1000) { truncated = true; break; }
      } while (true);
      const pagination = wefutPaginationCompleteness(pageCounts, seenRawIds.size);
      if (!pagination.complete) {
        truncated = true;
        if (status === 'ok') status = 'partial';
        errors.push({ term, edition, kind: 'pagination_count_unverified', reason: pagination.reason, reportedCounts: pagination.reportedCounts, rawUniqueRows: seenRawIds.size, pages: pageCounts, url: searchUrl });
      }
      observations.push({ term, edition, status, requestSucceeded: status !== 'failed', searchSucceeded: status !== 'failed' && status !== 'unverified', filterVerified, searchCompleteness: status === 'ok' && pagination.complete && !truncated ? 'complete' : 'unknown', possiblyTruncated: truncated, returned, rawUniqueRows: seenRawIds.size, candidateRows, reported: firstReported, reportedCounts: pagination.reportedCounts, countSemantics: 'iTotalDisplayRecords is retained for every page; completion requires stable counts matching raw unique returned card IDs and a terminal short/empty page.', attributeSchemaStatus: headerResult.schema ? 'verified' : 'unknown', attributeSchemaSourceUrl: headerResult.url, requestColumnCount, truncated, pagination: `${requestColumnCount} playerTable columns; public-page DataTables POST`, url: searchUrl, cookieProvenance: csrfState.pageUrl, noiseExamples });
    }
  }
  return { candidates: [...candidates.values()], observations, errors };
}function htmlRows(html) { return [...String(html).matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((m) => m[0]); }
function rowCells(row) { return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1])); }
function hrefs(html, pattern) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[2]); if (pattern.test(href)) out.push({ href, text: strip(m[3]), html: m[0] });
  }
  return out;
}
function pairsFromHtml(html) {
  const pairs = {};
  for (const row of htmlRows(html)) {
    const cells = rowCells(row);
    if (cells.length >= 2 && cells[0] && cells[0].length < 80) pairs[cells[0].replace(/:$/, '')] = cells[1];
  }
  for (const m of String(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) pairs[strip(m[1]).replace(/:$/, '')] = strip(m[2]);
  const stats = {};
  for (const tag of String(html).matchAll(/<[^>]+>/g)) {
    const key = attr(tag[0], 'data-attribute'); const value = attr(tag[0], 'data-value');
    if (key && value !== '') stats[key] = value;
  }
  for (const li of String(html).matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    if (!/foflex\s+attr/i.test(attr(`<li ${li[1]}>`, 'class'))) continue;
    const nameTag = li[2].match(/<span\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const valueTag = li[2].match(/<span\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const name = strip(nameTag?.[1] ?? ''); const value = strip(valueTag?.[1] ?? '');
    if (name && value) stats[name] = value;
  }
  for (const statBlock of String(html).matchAll(/<div\b[^>]*class=["'][^"']*\bstat_list\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const name = statBlock[1].match(/<span\b[^>]*class=["'][^"']*\bstat_name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const value = statBlock[1].match(/<span\b[^>]*class=["'][^"']*\bstat_value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const key = strip(name?.[1] ?? ''); const val = strip(value?.[1] ?? '');
    if (key) stats[key] = val;
  }
  return { pairs, stats };
}
function findPair(pairs, keys) { const entries = Object.entries(pairs); const want = keys.map(norm); return entries.find(([k]) => want.includes(norm(k)))?.[1] ?? null; }
function getMeta(html, key) {
  for (const tag of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const name = attr(tag[0], 'name') || attr(tag[0], 'property');
    if (name.toLowerCase() === key.toLowerCase()) return decode(attr(tag[0], 'content'));
  }
  return '';
}
async function searchFo4(player) {
  const terms = [...new Set([player.canonicalName, ...player.rosterNames, ...player.searchTerms].filter(Boolean))].slice(0, 4);
  const byUrl = new Map(), observations = [], errors = [];
  let hadExact = false;
  for (const term of terms) {
    const url = `https://cn.fifaaddict.com/fo4db?playername=${encodeURIComponent(term)}`;
    const response = await request(url);
    if (!requestOk(response)) { errors.push({ term, status: response.status, url, error: response.error ?? null }); observations.push({ term, status: 'failed', requestSucceeded: false, searchCompleteness: 'unknown', httpStatus: response.status, url }); continue; }
    const rows = htmlRows(response.text); let rowCount = 0;
    for (const row of rows) {
      const match = row.match(/href\s*=\s*(["'])(\/fo4db\/pid[^"']+)\1/i);
      if (!match) continue;
      const detailUrl = new URL(decode(match[2]), 'https://cn.fifaaddict.com').href;
      const cells = rowCells(row); const text = strip(row);
      const link = hrefs(row, /\/fo4db\/pid/i)[0];
      const name = link?.text || attr(row, 'title') || cells.find((v) => /[A-Za-z\p{L}]/u.test(v) && v.length > 2) || '';
      const nums = text.match(/\b\d{2,3}\b/g)?.map(Number) ?? [];
      const posRating = text.match(/\b(?:ST|CF|LW|RW|CAM|CM|CDM|LM|RM|LB|RB|CB|LWB|RWB|GK)\s+(\d{2,3})\b/i);
      const overall = posRating ? Number(posRating[1]) : (nums.find((n) => n >= 40 && n <= 200) ?? null);
      const cardType = cells.find((c) => /\b(ICON|World Legend|Legend|EL|TOTY|MOMENTS|LIVE|C?N|BWC|UTOTY|GRU|CAP)\b/i.test(c)) || null;
      const rawFields = { cells, rowText: text, rowHtml: row };
      const candidate = baseCandidate('fo4', player, name, term, url, detailUrl, {
        overall, attributes: {}, placeholderFields: [], attributes_found: false,
        cardType, version: cardType, positions: cells.filter((c) => /\b(ST|CF|LW|RW|CAM|CM|CDM|LM|RM|LB|RB|CB|LWB|RWB|GK)\b/i.test(c)).flatMap((c) => c.split(/[\s,/]+/)).filter((c) => /^(ST|CF|LW|RW|CAM|CM|CDM|LM|RM|LB|RB|CB|LWB|RWB|GK)$/i.test(c)),
        rawFields,
      });
      const prev = byUrl.get(detailUrl);
      if (prev) prev.matchedSearchTerms.push(term); else byUrl.set(detailUrl, candidate);
      if (candidate.identity_confidence !== 'none') hadExact = true;
      rowCount++;
    }
    observations.push({ term, status: 'partial', requestSucceeded: true, searchCompleteness: 'unknown', possiblyTruncated: true, returned: rowCount, pagination: 'not_observed_in_public_search_page', url });
    if (hadExact) break;
  }
  const candidates = [];
  for (const candidate of byUrl.values()) {
    if (candidate.identity_confidence === 'none') { candidate.detailSkippedReason = 'identity_name_unconfirmed'; candidates.push(candidate); continue; }
    const response = await request(candidate.detailUrl);
    if (!requestOk(response)) {
      candidate.blocked_or_unavailable = true;
      candidate.unavailableReason = `detail_http_${response.status}`;
      errors.push({ detailUrl: candidate.detailUrl, status: response.status, kind: 'detail', error: response.error ?? null });
      candidates.push(candidate); continue;
    }
    const html = response.text; const { pairs, stats } = pairsFromHtml(html);
    const title = getMeta(html, 'og:title') || getMeta(html, 'twitter:title');
    const desc = getMeta(html, 'description') || getMeta(html, 'og:description');
    const profileName = title.replace(/\s*[-|].*$/, '').trim() || candidate.name;
    if (candidate.name && norm(profileName) === norm(player.canonicalName)) candidate.name = profileName;
    candidate.dateOfBirth = findPair(pairs, ['birth', 'birthday', 'date of birth']) || (desc.match(/出生于(\d{4})年(\d{1,2})月(\d{1,2})日/)?.[0] ?? null);
    candidate.nationality = findPair(pairs, ['nation', 'nationality', 'country']) || (desc.match(/是一名(.+?)职业足球运动员/)?.[1] ?? null);
    candidate.club = findPair(pairs, ['club', 'team']) || (desc.match(/效力于\s*(.+?)\s*俱乐部/)?.[1] ?? null);
    const seasonFromDescription = desc.match(/[（(]([^（）)]+)[）)]/)?.[1] ?? null;
    candidate.cardType = findPair(pairs, ['season', 'season name', 'card season']) || seasonFromDescription || candidate.cardType;
    candidate.version = candidate.cardType;
    const summaryPart = desc.match(/主要能力值包括[：:]([^。]+)/)?.[1] ?? '';
    const summaryAttributes = Object.fromEntries([...summaryPart.matchAll(/([\p{L}]+)\s*(\d{2,3})/gu)].map((m) => [m[1], Number(m[2])]));
    candidate.summaryAttributes = summaryAttributes;
    const zeroStats = Object.entries(stats).filter(([, v]) => Number(v) === 0).map(([k]) => k);
    const zeroPairs = Object.entries(pairs).filter(([k, v]) => Number(v) === 0 && /pace|shoot|pass|drib|defen|phys|accel|speed|finish|shot|vision|cross|agil|react|balance|jump|stamina|strength|tackle|mark|heading|composure|goalkeep|overall|ovr/i.test(k)).map(([k]) => k);
    const zeros = [...new Set([...zeroStats, ...zeroPairs])];
    candidate.placeholderFields = zeros;
    const attrs = attributeResult(stats, zeros);
    candidate.attributes = attrs.attributes; candidate.detailedAttributes = attrs.attributes;
    candidate.attributes_found = candidate.card_found && attrs.attributes_found;
    Object.assign(candidate, normalizeCandidateAttributeCompleteness(candidate));
    candidate.overall = candidate.overall ?? int(findPair(pairs, ['overall', 'ovr', 'rating']) || desc.match(/\bOVR\s*[:：]?\s*(\d{2,3})/i)?.[1]);
    candidate.overall_found = candidate.card_found && Number.isFinite(candidate.overall);
    candidate.rawFields = { ...candidate.rawFields, profileTitle: title, profileDescription: desc, profilePairs: pairs, profileStatNodes: stats, placeholderNote: 'Server-rendered zero values are placeholders and excluded from attributes.' };
    candidate.sourceUrl = response.url;
    candidates.push(candidate);
  }
  return { candidates, observations, errors };
}
async function searchFo3(player) {
  const terms = [...new Set([player.canonicalName, ...player.rosterNames, ...player.searchTerms].filter(Boolean))].slice(0, 4);
  const byUrl = new Map(), observations = [], errors = [];
  let hadExact = false;
  for (const term of terms) {
    const url = `https://en.fifaaddict.com/fo3db.php?q=player&name=${encodeURIComponent(term)}&limit=500`;
    const response = await request(url);
    if (!requestOk(response)) { errors.push({ term, status: response.status, url, error: response.error ?? null }); observations.push({ term, status: 'failed', requestSucceeded: false, searchCompleteness: 'unknown', httpStatus: response.status, url }); continue; }
    let returned = 0; let reported = 0;
    for (const row of htmlRows(response.text)) {
      const idMatch = row.match(/id\s*=\s*(["'])player_id(\d+)\1/i);
      if (!idMatch) continue;
      const cells = rowCells(row); const nameLink = hrefs(row, /fo3player\.php\?id=/i)[0];
      const name = nameLink?.text || cells.find((c) => /[A-Za-z\p{L}]/u.test(c) && c.length > 2) || '';
      const detailUrl = `https://en.fifaaddict.com/fo3player.php?id=${idMatch[2]}`;
      const overall = cells.map(int).find((n) => n != null && n >= 40 && n <= 200) ?? null;
      const positions = [...new Set((row.match(/\b(ST|CF|LW|RW|CAM|CM|CDM|LM|RM|LB|RB|CB|LWB|RWB|GK)\b/gi) ?? []).map((x) => x.toUpperCase()))];
      const cardType = cells.find((c) => /\b(ICON|World Legend|Legend|EL|TOTY|Limited|Hidden|Classic|Best)\b/i.test(c)) || null;
      const candidate = baseCandidate('fo3', player, name, term, url, detailUrl, {
        overall, attributes: {}, attributes_found: false, cardType, version: null, positions, rawFields: { playerId: idMatch[2], cells, rowHtml: row },
      });
      const prev = byUrl.get(detailUrl); if (prev) prev.matchedSearchTerms.push(term); else byUrl.set(detailUrl, candidate);
      if (candidate.identity_confidence !== 'none') hadExact = true;
      returned++;
    }
    const text = strip(response.text);
    const countMatch = text.match(/(?:Players?|cards?)\s*(?:\(|:)?\s*(\d{1,4})\s*(?:results?|rows?)/i);
    if (countMatch) reported = Number(countMatch[1]);
    observations.push({ term, status: 'partial', requestSucceeded: true, searchCompleteness: 'unknown', possiblyTruncated: true, returned, reported: reported || null, allSeasons: true, pagination: 'single search response; completeness not established', url });
    if (hadExact) break;
  }
  const candidates = [];
  for (const candidate of byUrl.values()) {
    if (candidate.identity_confidence === 'none') { candidate.detailSkippedReason = 'identity_name_unconfirmed'; candidates.push(candidate); continue; }
    const response = await request(candidate.detailUrl);
    if (!requestOk(response)) {
      candidate.blocked_or_unavailable = true;
      candidate.unavailableReason = `detail_http_${response.status}`;
      errors.push({ detailUrl: candidate.detailUrl, status: response.status, kind: 'detail', error: response.error ?? null });
      candidates.push(candidate); continue;
    }
    const html = response.text; const { pairs, stats } = pairsFromHtml(html);
    const title = getMeta(html, 'og:title') || getMeta(html, 'twitter:title');
    const desc = getMeta(html, 'description') || getMeta(html, 'og:description');
    const detailIdentity = desc.match(/Player Information (.+?) \((.*?)\) Season (.+?) Date of Birth ([0-9.]+) Nationality ([^ ]+) Club (.+?) League (.+?) Position (.+?)(?:\s*$)/);
    const detailName = detailIdentity?.[1] ?? null;
    if (detailName) { candidate.searchResultName = candidate.name; candidate.name = detailName; const evidence = identity(player, detailName); if (evidence.level !== 'none') { candidate.identity_confidence = evidence.level; candidate.identity_evidence = evidence.evidence; candidate.card_found = true; } }
    candidate.dateOfBirth = findPair(pairs, ['birth', 'birthday', 'date of birth']) || detailIdentity?.[4] || null;
    candidate.nationality = findPair(pairs, ['nation', 'nationality', 'country']) || detailIdentity?.[5] || null;
    candidate.club = findPair(pairs, ['club', 'current league', 'team']) || detailIdentity?.[6] || null;
    const season = findPair(pairs, ['season', 'season name', 'year']) || detailIdentity?.[3] || title.match(/\bSeason\s+(.+?)(?:\s+Traits|\s+Potential|\s+Player Information|$)/)?.[1] || null;
    candidate.cardType = season || candidate.cardType; candidate.version = season;
    const attrs = attributeResult(stats);
    candidate.placeholderFields = Object.entries(stats).filter(([, value]) => value === '').map(([key]) => key);
    candidate.attributes = attrs.attributes; candidate.detailedAttributes = attrs.attributes;
    candidate.attributes_found = candidate.card_found && attrs.attributes_found;
    Object.assign(candidate, normalizeCandidateAttributeCompleteness(candidate));
    candidate.overall = candidate.overall ?? int(findPair(pairs, ['overall', 'ovr', 'rating']) || desc.match(/\bOVR\s*[:：]?\s*(\d{2,3})/i)?.[1]);
    candidate.overall_found = candidate.card_found && Number.isFinite(candidate.overall);
    candidate.rawFields = { ...candidate.rawFields, profileTitle: title, profileDescription: desc, profilePairs: pairs, profileStatNodes: stats };
    candidate.sourceUrl = response.url;
    candidates.push(candidate);
  }
  return { candidates, observations, errors };
}
let nexonMetadataPromise;
async function nexonMetadata() {
  if (!nexonMetadataPromise) nexonMetadataPromise = (async () => {
    const spidUrl = 'https://open.api.nexon.com/static/fconline/meta/spid.json';
    const seasonUrl = 'https://open.api.nexon.com/static/fconline/meta/seasonid.json';
    const spidResponse = await request(spidUrl);
    const seasonResponse = await request(seasonUrl);
    const errors = [];
    let spid = [], seasons = [];
    try { if (requestOk(spidResponse)) spid = JSON.parse(spidResponse.text); else errors.push({ url: spidUrl, status: spidResponse.status, error: spidResponse.error ?? null }); }
    catch (e) { errors.push({ url: spidUrl, status: spidResponse.status, error: `parse:${e.message}` }); }
    try { if (requestOk(seasonResponse)) seasons = JSON.parse(seasonResponse.text); else errors.push({ url: seasonUrl, status: seasonResponse.status, error: seasonResponse.error ?? null }); }
    catch (e) { errors.push({ url: seasonUrl, status: seasonResponse.status, error: `parse:${e.message}` }); }
    const spidById = new Map(spid.map((row) => [String(row.id), row]));
    const seasonById = new Map(seasons.map((row) => [String(row.seasonId), row]));
    const spidGroupsByNormalizedName = new Map();
    for (const row of spid) {
      const key = norm(row.name);
      if (!key) continue;
      if (!spidGroupsByNormalizedName.has(key)) spidGroupsByNormalizedName.set(key, []);
      spidGroupsByNormalizedName.get(key).push(row);
    }
    return {
      spidById, seasonById, spidGroupsByNormalizedName,
      provenance: { spidUrl, spidCount: spid.length, seasonUrl, seasonCount: seasons.length, spidFields: Object.keys(spid[0] ?? {}), seasonFields: Object.keys(seasons[0] ?? {}), errors },
    };
  })();
  return nexonMetadataPromise;
}
function nexonRowName(block) {
  const m = block.match(/<div\b[^>]*class=["'][^"']*\binfo_top\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  return strip(m?.[1] ?? '');
}
function nexonRows(html) {
  const matches = [...String(html).matchAll(/<div\b[^>]*id=["']area_playerunit_(\d+)["'][^>]*>/gi)];
  return matches.map((m, i) => {
    const start = m.index;
    const end = matches[i + 1]?.index ?? Math.min(String(html).length, start + 9000);
    return { spid: m[1], html: String(html).slice(start, end) };
  });
}
function nexonSeasonImage(html) { return html.match(/\/season\/([^/"']+?)(?:\.png|\.jpg)/i)?.[1] ?? null; }
async function searchNexonFco(player) {
  const meta = await nexonMetadata();
  const terms = [...new Set([player.canonicalName, ...(player.rosterNames ?? []), ...(player.searchTerms ?? [])].filter(Boolean))].slice(0, 2);
  const byCard = new Map(), observations = [], errors = [];
  for (const term of terms) {
    const searchUrl = 'https://fconline.nexon.com/datacenter/PlayerList';
    const body = new URLSearchParams({ strPlayerName: term, n4PageNo: '1' }).toString();
    const response = await request(searchUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
    if (!requestOk(response)) { errors.push({ term, status: response.status, url: searchUrl, kind: 'search', error: response.error ?? null }); observations.push({ term, status: 'failed', requestSucceeded: false, searchCompleteness: 'unknown', httpStatus: response.status, url: searchUrl }); continue; }
    const rows = nexonRows(response.text); let plausibleAny = false;
    for (const row of rows) {
      const id = String(row.spid); const staticMeta = meta.spidById.get(id) ?? null;
      const displayName = nexonRowName(row.html) || staticMeta?.name || '';
      const detailUrl = `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${encodeURIComponent(id)}&n1Strong=1`;
      const seasonPrefix = id.length >= 9 ? id.slice(0, 3) : null;
      const seasonMeta = seasonPrefix ? meta.seasonById.get(seasonPrefix) ?? null : null;
      const seasonIcon = nexonSeasonImage(row.html);
      const positionMatches = [...row.html.matchAll(/class=["'][^"']*\bposition\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\btxt\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map((m) => strip(m[1])).filter(Boolean);
      const rawOverall = row.html.match(/class=["'][^"']*skillData_\d+[^"']*["'][^>]*>\s*(\d{2,3})\s*</i)?.[1];
      const idEvidence = staticMeta ? 'exact_spid_static_metadata_match' : 'search_result_spid_only';
      const candidate = baseCandidate('nexon-fco', player, displayName, term, searchUrl, detailUrl, {
        overall: int(rawOverall), attributes: {}, attributes_found: false, cardType: seasonMeta?.className || seasonIcon,
        version: seasonMeta?.className || seasonIcon, positions: [...new Set(positionMatches)], identityIds: [],
        rawFields: {
          resultName: displayName, rawOverall: rawOverall ?? null, spid: Number(id), spidStatic: staticMeta,
          seasonIdObservedFromLeadingThreeDigits: seasonPrefix,
          seasonStatic: seasonMeta,
          metadataEvidence: 'Exact full SPID lookup is verified. The first-three-digit season prefix is observed on sample IDs but is not a documented Nexon identifier contract.',
          seasonImageCode: seasonIcon,
        },
      });
      candidate.sourceRole = 'optional_fallback';
      candidate.gameFamily = 'FC Online';
      candidate.identity_confidence = 'unverified';
      candidate.identity_evidence = idEvidence;
      candidate.card_found = true;
      candidate.base_state_verified = false;
      candidate.cardState = { n1Strong: 1, n1Grow: 0, n4TeamColorId: 0, n4TeamColorLv: 0, n4TeamColorId_Enhance: 0, n4TeamColorLv_Enhance: 0, n4TeamColorId_Feature: 0, n1Change: 0, strPlayerImg: 0, rd: 0, stateMeaning: 'Normal public page defaults; these selected values are not claimed to be raw base stats.' };
      candidate.cardId = Number(id);
      candidate.seasonId = seasonPrefix ? Number(seasonPrefix) : null;
      if (staticMeta) candidate.name = staticMeta.name;
      const cardKey = `${id}:1:0`;
      const prev = byCard.get(cardKey); if (prev) prev.matchedSearchTerms.push(term); else byCard.set(cardKey, candidate);
      if (displayName && norm(displayName) === norm(player.canonicalName)) plausibleAny = true;
    }
    observations.push({ term, status: 'partial', requestSucceeded: true, searchCompleteness: 'unknown', possiblyTruncated: true, returned: rows.length, page: 1, pagination: 'only public page 1 observed; no exhaustive page-count contract found', staticNameFamilyCompleteness: rows.some((row) => meta.spidById.has(String(row.spid))) && meta.provenance.errors.length === 0 ? 'complete_for_exact_normalized_name_group_in_official_static_index' : rows.length ? 'unknown_static_index_unavailable' : 'not_applicable', url: searchUrl, postBodyFields: ['strPlayerName', 'n4PageNo'] });
    if (rows.length > 0 || plausibleAny) break;
  }
  const expandedCards = new Map(byCard);
  for (const seed of byCard.values()) {
    const seedMeta = seed.rawFields.spidStatic;
    if (!seedMeta?.name) continue;
    const sameNameEntries = meta.spidGroupsByNormalizedName.get(norm(seedMeta.name)) ?? [];
    for (const entry of sameNameEntries) {
      const id = String(entry.id); const key = `${id}:1:0`;
      if (expandedCards.has(key)) continue;
      const seasonPrefix = id.length >= 9 ? id.slice(0, 3) : null;
      const seasonMeta = seasonPrefix ? meta.seasonById.get(seasonPrefix) ?? null : null;
      const detailUrl = `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${encodeURIComponent(id)}&n1Strong=1`;
      expandedCards.set(key, {
        ...seed, name: entry.name, cardId: Number(id), detailUrl, sourceUrl: detailUrl,
        overall: null, overall_found: false, positions: [], cardType: seasonMeta?.className ?? null,
        version: seasonMeta?.className ?? null,
        rawFields: { ...seed.rawFields, spid: Number(id), spidStatic: entry, seasonIdObservedFromLeadingThreeDigits: seasonPrefix ? Number(seasonPrefix) : null, seasonStatic: seasonMeta, staticNameGroupSize: sameNameEntries.length, staticNameGroupCompleteness: 'complete_for_exact_normalized_name_group_in_official_static_index', expandedFromExactKoreanStaticName: true, identityWarning: 'Same Korean static display name is a candidate grouping only; homonyms are not resolved.' },
      });
    }
    seed.rawFields.staticNameGroupSize = sameNameEntries.length;
    seed.rawFields.staticNameGroupExpansion = 'Exact normalized Korean name in official static metadata; not an identity proof.';
  }
  const candidates = [];
  for (const candidate of expandedCards.values()) {
    const id = String(candidate.cardId);
    const params = { spid: id, n1Strong: 1, n1Grow: 0, n4TeamColorId: 0, n4TeamColorLv: 0, n4TeamColorId_Enhance: 0, n4TeamColorLv_Enhance: 0, n4TeamColorId_Feature: 0, n1Change: 0, strPlayerImg: 0, rd: 0 };
    const abilityUrl = 'https://fconline.nexon.com/datacenter/PlayerAbility';
    const response = await request(abilityUrl, { method: 'POST', body: new URLSearchParams(params).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
    if (!requestOk(response)) {
      candidate.blocked_or_unavailable = true; candidate.unavailableReason = `ability_http_${response.status}`;
      errors.push({ detailUrl: candidate.detailUrl, status: response.status, kind: 'attributes', error: response.error ?? null });
      candidates.push(candidate); continue;
    }
    const fragment = response.text;
    const attrs = parseNexonAttributeEntries(fragment);
    const parsed = normalizeNexonAttributeEntries(attrs);
    candidate.attributes = parsed.attributes; candidate.detailedAttributes = parsed.attributes; candidate.attributes_found = parsed.attributes_found;
    candidate.attributes_ambiguous = parsed.attributes_ambiguous;
    candidate.attributeAmbiguities = parsed.attributeAmbiguities;
    candidate.summaryAttributes = parsed.summaryRatings;
    candidate.sourceCardId = String(candidate.rawFields.spid);
    candidate.sourceIdNamespace = 'nexon-fco:spid';
    candidate.sourcePlayerId = null;
    candidate.numericIdentityEvidence = null;
    candidate.overall = int(fragment.match(/class=["'][^"']*\bovr\b[^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1]) ?? candidate.overall;
    candidate.overall_found = candidate.card_found && Number.isFinite(candidate.overall);
    candidate.positions = [...new Set([...(candidate.positions ?? []), ...(fragment.match(/class=["'][^"']*\bposition\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ? [strip(fragment.match(/class=["'][^"']*\bposition\b[^"']*["'][^>]*>([\s\S]*?)<\//i)[1])] : [])])];
    const nameMatch = fragment.match(/class=["'][^"']*\bplayerCardInfoBottom\b[^"']*["'][^>]*>[\s\S]*?class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    const detailName = strip(nameMatch?.[1] ?? '');
    const flagCode = fragment.match(/\/countries\/smallflags\/(\d+)\.png/i)?.[1] ?? null;
    const seasonCode = nexonSeasonImage(fragment);
    candidate.nationalityCode = flagCode ? Number(flagCode) : null;
    candidate.cardType = candidate.rawFields.seasonStatic?.className || seasonCode || candidate.cardType;
    candidate.version = candidate.cardType;
    if (detailName) candidate.detailDisplayName = detailName;
    candidate.rawFields = {
      ...candidate.rawFields, abilityAttributesRaw: attrs, detailDisplayName: detailName,
      nationalityFlagCode: flagCode, seasonImageCode: seasonCode,
      abilityRequestParameters: params, abilitySourceUrl: response.url,
      nativeAbilityEntryCount: attrs.length, nativeSummaryRatingCount: parsed.summaryRatingCount,
      detailedAttributeEntryCount: parsed.detailedAttributeEntryCount,
      detailedAttributeCount: parsed.detailedAttributeCount,
      duplicateAttributeLabels: parsed.duplicateAttributeLabels,
      attributeAmbiguities: parsed.attributeAmbiguities,
      unclassifiedAttributeEntryCount: parsed.unclassifiedEntryCount,
    };
    Object.assign(candidate, normalizeCandidateAttributeCompleteness(candidate));
    candidate.sourceUrl = response.url;
    candidates.push(candidate);
  }
  if (meta.provenance.errors.length) errors.push(...meta.provenance.errors.map((e) => ({ ...e, kind: 'static_metadata' })));
  return { candidates, observations, errors, metadata: meta.provenance };
}
const adapters = { wefut: searchWeFut, fo4: searchFo4, fo3: searchFo3, 'nexon-fco': searchNexonFco };
const args = process.argv.slice(2);
const mode = args.includes('--all') || args.includes('--resume') ? 'all' : 'sample';
const siteArg = args.find((a) => a.startsWith('--site='))?.split('=')[1];
const sites = siteArg ? [siteArg] : Object.keys(adapters);
for (const site of sites) if (!adapters[site]) throw new Error(`Unknown site: ${site}`);
const chosen = mode === 'sample' ? players.filter((p) => SAMPLE_IDS.has(p.playerId)) : players;
const progressFile = resolve(CACHE, 'full-progress.json');
const progress = await json(progressFile, { completed: {}, candidates: [], observations: [], errors: [], haltedSites: {} });
const freshResults = { completed: {}, candidates: [], observations: [], errors: [], haltedSites: {} };
const active = mode === 'all' ? progress : freshResults;
active.haltedSites ??= {};
let done = 0;
for (const player of chosen) {
  for (const site of sites) {
    const entityKey = searchEntityKeyFor(player);
    const key = `${site}:${entityKey}`;
    if (mode === 'all' && active.completed[key] && !active.completed[key].failed) continue;
    const inheritedHalt = active.haltedSites[site];
    if (inheritedHalt) {
      const priorCandidates = active.candidates.filter((candidate) => candidate.site === site && searchEntityKeyFor(candidate) === entityKey);
      active.observations = active.observations.filter((o) => !(o.site === site && searchEntityKeyFor(o) === entityKey));
      active.observations.push({ site, playerId: player.playerId, searchEntityKey: entityKey, canonicalName: player.canonicalName, observations: [{ status: 'failed', requestSucceeded: false, searchCompleteness: 'unknown', httpStatus: inheritedHalt.status, halted: true, url: inheritedHalt.url, reason: 'No further requests were made after an access or rate-limit response.' }], cardCandidates: priorCandidates.length, searchSucceeded: false, searchCompleteness: 'unknown', truncated: false, blocked_or_unavailable: true, halted: true });
      active.errors = active.errors.filter((error) => !(error.site === site && searchEntityKeyFor(error) === entityKey));
      active.errors.push({ site, playerId: player.playerId, searchEntityKey: entityKey, canonicalName: player.canonicalName, kind: 'site_halted_after_access_response', status: inheritedHalt.status, url: inheritedHalt.url, reason: 'Inherited site halt; no further requests were made.' });
      active.completed[key] = { at: new Date().toISOString(), candidates: priorCandidates.length, failed: false, blocked: true };
      console.log(`${mode}/${site}: ${player.canonicalName} -> SKIPPED after HTTP ${inheritedHalt.status}`);
      if (mode === 'all') await save(progressFile, active);
      done++;
      continue;
    }
    try {
      const result = await adapters[site](player);
      const refusal = accessStopFailure(result);
      if (refusal && !active.haltedSites[site]) active.haltedSites[site] = { status: Number(refusal.status ?? refusal.httpStatus), url: refusal.url ?? refusal.detailUrl ?? null, firstPlayerId: player.playerId, firstSearchEntityKey: entityKey, at: new Date().toISOString() };
      const worked = requestWorked(result.observations);
      if (worked) {
        active.candidates = active.candidates.filter((candidate) => !(candidate.site === site && searchEntityKeyFor(candidate) === entityKey));
        active.candidates.push(...result.candidates);
      }
      active.observations = active.observations.filter((o) => !(o.site === site && (o.searchEntityKey ?? (o.playerId == null ? null : `entity:${o.playerId}`)) === entityKey));
      const completeness = searchCompletenessOf(result.observations);
      const allFailuresAreBlocks = result.observations.length > 0 && result.observations.every((observation) => [0, 401, 403, 429].includes(Number(observation.httpStatus ?? observation.statusCode)));
      active.observations.push({ site, playerId: player.playerId, searchEntityKey: entityKey, canonicalName: player.canonicalName, observations: result.observations, cardCandidates: result.candidates.length, searchSucceeded: worked, searchCompleteness: completeness.state, truncated: completeness.possiblyTruncated, blocked_or_unavailable: Boolean(refusal) || allFailuresAreBlocks });
      active.errors = active.errors.filter((error) => !(error.site === site && (error.searchEntityKey ?? (error.playerId == null ? null : `entity:${error.playerId}`)) === entityKey));
      active.errors.push(...result.errors.map((error) => ({ site, playerId: player.playerId, searchEntityKey: entityKey, canonicalName: player.canonicalName, ...error })));
      active.completed[key] = { at: new Date().toISOString(), candidates: result.candidates.length, failed: shouldRetryJob(result) };
      console.log(`${mode}/${site}: ${player.canonicalName} -> ${result.candidates.length} candidate(s)`);
    } catch (error) {
      active.errors.push({ site, playerId: player.playerId, searchEntityKey: entityKey, canonicalName: player.canonicalName, kind: 'adapter_exception', error: String(error?.stack ?? error) });
      active.completed[key] = { at: new Date().toISOString(), failed: true };
      console.log(`${mode}/${site}: ${player.canonicalName} -> ERROR ${error.message}`);
    }
    if (mode === 'all') await save(progressFile, active);
    done++;
  }
}
if (mode === 'sample') {
  const sampleFile = resolve(OUT, siteArg ? `sample-${siteArg}-candidates.json` : 'sample-candidates.json');
  await save(sampleFile, { schemaVersion: 'historical-card-search-candidates/1', generatedAt: new Date().toISOString(), samplePlayerIds: chosen.map((p) => p.playerId), candidates: active.candidates, observations: active.observations, errors: active.errors });
  console.log(`Wrote ${sampleFile} (${active.candidates.length} candidate rows)`);
} else {
  const finalFile = resolve(OUT, 'candidates.json');
  await save(finalFile, { schemaVersion: 'historical-card-search-candidates/1', generatedAt: new Date().toISOString(), playerCount: players.length, playerSeasonCount: playerSeasons.length, candidates: active.candidates, observations: active.observations, errors: active.errors });
  console.log(`Checkpoint ${done}; total candidate rows ${active.candidates.length}; ${Object.keys(active.completed).length}/${players.length * Object.keys(adapters).length} player-site jobs complete`);
  console.log(`Wrote ${finalFile}`);
  await import('./build-report.mjs');
}

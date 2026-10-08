import { createHttpTransport } from './http-transport.mjs';
import { extractWefutHeaderEvidence } from './worker-merge.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const RATE_MS = Number(process.env.HISTORICAL_CARD_RATE_MS || 900);
const editionsArg = process.argv.find((arg) => arg.startsWith('--editions='));
const editions = editionsArg
  ? [...new Set(editionsArg.slice('--editions='.length).split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 14 && value <= 27))]
  : Array.from({ length: 14 }, (_, index) => index + 14);
if (!editions.length) throw new Error('No valid FIFA edition selected. Use --editions=14,15,...,27.');

const { request } = createHttpTransport({ cacheDir: resolve(DIR, '.cache'), rateMs: RATE_MS });
const entries = [];
let halted = null;
for (const edition of editions) {
  if (halted) {
    entries.push({ edition, status: 'not_attempted_after_site_halt', haltedBy: halted });
    continue;
  }
  const url = `https://wefut.com/player-database/${edition}/`;
  const response = await request(url);
  const status = Number(response.status);
  if ([401, 403, 429].includes(status)) halted = { status, url: response.url ?? url };
  const schema = status >= 200 && status < 300
    ? extractWefutHeaderEvidence(response.text, edition, response.url ?? url)
    : null;
  entries.push({
    edition, url: response.url ?? url, httpStatus: status, contentType: response.contentType ?? null,
    status: halted?.url === (response.url ?? url) ? 'blocked_or_rate_limited' : schema ? 'header_observed' : status >= 200 && status < 300 ? 'header_not_found' : 'request_failed',
    headerEvidence: schema,
    error: response.error ?? null,
  });
}

const output = resolve(DIR, 'results/wefut-edition-headers.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  schemaVersion: 'historical-card-search-wefut-headers/1',
  generatedAt: new Date().toISOString(),
  rateLimitMs: RATE_MS,
  source: 'Public WeFUT player database HTML; GET only, cached by the shared transport.',
  entries,
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, entries: entries.map(({ edition, status, httpStatus, headerEvidence }) => ({ edition, status, httpStatus, headerColumns: headerEvidence?.headerColumnCount ?? null, detailedFields: headerEvidence?.expectedDetailedAttributeKeys?.length ?? null })), halted }, null, 2));

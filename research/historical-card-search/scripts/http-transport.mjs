import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function transient(result) {
  const status = Number(result?.status);
  return status === 0 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

export function isTransientHttpFailure(result) { return transient(result); }

export function createHttpTransport({ cacheDir, rateMs = 900, fetchImpl = globalThis.fetch, sleepFn = pause, now = Date.now } = {}) {
  if (!cacheDir) throw new Error('cacheDir is required');
  const retriedTransientKeys = new Set();
  const haltedOrigins = new Map();
  let lastRequestAt = 0;
  async function readCache(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
  async function writeCache(file, value) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

  async function request(url, options = {}) {
    const origin = new URL(url).origin;
    const originHalt = haltedOrigins.get(origin);
    if (originHalt) {
      return { status: originHalt.status, url, contentType: '', setCookie: [], text: '', halted: true, error: `request_not_attempted_after_origin_http_${originHalt.status}` };
    }
    const method = options.method ?? 'GET';
    const body = options.body ?? '';
    const cacheKey = method === 'GET' && !body ? `GET ${url}` : `${method} ${url}\n${body}`;
    const key = createHash('sha256').update(cacheKey).digest('hex');
    const file = resolve(cacheDir, 'http', `${key}.json`);
    const cached = await readCache(file);
    if (cached && !options.refresh && (!transient(cached) || retriedTransientKeys.has(key))) {
      if ([401, 403, 429].includes(Number(cached.status))) {
        haltedOrigins.set(origin, { status: Number(cached.status), url: cached.url ?? url });
      }
      return cached;
    }
    while (true) {
      const wait = Math.max(0, rateMs - (now() - lastRequestAt));
      if (wait) await sleepFn(wait);
      let result;
      try {
        const headers = { 'User-Agent': 'historical-card-search-research/1.0 (public page reader)', ...(options.headers ?? {}) };
        const response = await fetchImpl(url, { method, body: body || undefined, headers, redirect: 'follow', signal: AbortSignal.timeout(45000) });
        result = { status: response.status, url: response.url, contentType: response.headers.get('content-type') ?? '', setCookie: response.headers.getSetCookie?.() ?? [], text: await response.text() };
      } catch (error) {
        result = { status: 0, url, contentType: '', setCookie: [], text: '', error: String(error?.message ?? error) };
      }
      lastRequestAt = now();
      if ([401, 403, 429].includes(Number(result.status))) {
        haltedOrigins.set(origin, { status: Number(result.status), url: result.url ?? url });
      }
      await writeCache(file, result);
      if (transient(result) && !retriedTransientKeys.has(key)) {
        retriedTransientKeys.add(key);
        continue;
      }
      return result;
    }
  }
  return { request };
}

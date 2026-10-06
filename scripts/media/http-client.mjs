// scripts/media/http-client.mjs
// Polite HTTP/2 + HTTP/1.1 client with local disk caching, redirect tracking,
// rate limiting (concurrency <= 3, >= 300ms delay), and HEAD/GET image validation.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { fileURLToPath } from 'node:url';
import { foldAscii, normalizeLookupKey } from '../lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const CACHE_DIR = path.join(ROOT_DIR, 'data', 'cache', 'player-media-audit');
const PAGES_CACHE_DIR = path.join(CACHE_DIR, 'pages');
const IMAGES_CACHE_DIR = path.join(CACHE_DIR, 'images');

export const USER_AGENT = 'BattleBaseMediaAudit/1.0';
const DEFAULT_DELAY_MS = 280;
const REQUEST_TIMEOUT_MS = 15000;

fs.mkdirSync(PAGES_CACHE_DIR, { recursive: true });
fs.mkdirSync(IMAGES_CACHE_DIR, { recursive: true });

const lastRequestByHost = new Map();
const hostChains = new Map();
let activeRequests = 0;
const MAX_CONCURRENCY = 3;
const waitQueue = [];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(hostname, minDelayMs = DEFAULT_DELAY_MS) {
    const prevHost = hostChains.get(hostname) || Promise.resolve();
    let releaseHost;
    const currentHost = new Promise((resolve) => {
        releaseHost = resolve;
    });
    hostChains.set(hostname, prevHost.then(() => currentHost));
    await prevHost;

    while (activeRequests >= MAX_CONCURRENCY) {
        await new Promise((resolve) => waitQueue.push(resolve));
    }
    activeRequests++;

    const hostDelay = hostname.includes('fifaindex.com') ? Math.max(minDelayMs, 320) : minDelayMs;
    const now = Date.now();
    const prev = lastRequestByHost.get(hostname) || 0;
    const elapsed = now - prev;
    if (elapsed < hostDelay) {
        await sleep(hostDelay - elapsed);
    }
    lastRequestByHost.set(hostname, Date.now());
    return releaseHost;
}

function releaseSlot(hostname, releaseHost) {
    lastRequestByHost.set(hostname, Date.now());
    activeRequests = Math.max(0, activeRequests - 1);
    if (waitQueue.length > 0) {
        const nextGlobal = waitQueue.shift();
        nextGlobal();
    }
    if (typeof releaseHost === 'function') {
        releaseHost();
    }
}

function getCachePath(dir, key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(dir, `${hash}.json`);
}

export function normalizeAssetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        const u = new URL(rawUrl);
        u.search = '';
        u.hash = '';
        return u.toString();
    } catch {
        return rawUrl;
    }
}

export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

export function slugifyPlayerName(name) {
    return foldAscii(decodeHtmlEntities(name || ''))
        .toLowerCase()
        .replace(/['’.]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function normalizePersonName(name) {
    return normalizeLookupKey(
        decodeHtmlEntities(name || '').replace(/[ıİ]/g, 'i')
    )
        .replace(/['’.]/g, '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

let manualPlayerAliasesCache = null;

export function getExpandedAliases(entity) {
    if (!manualPlayerAliasesCache) {
        const aliasPath = path.join(ROOT_DIR, 'data', 'manual', 'player-aliases.json');
        try {
            manualPlayerAliasesCache = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
        } catch {
            manualPlayerAliasesCache = {};
        }
    }
    const extra = manualPlayerAliasesCache[entity.canonicalName] || [];
    return [
        entity.canonicalName,
        ...(entity.aliases?.en || []),
        ...extra,
    ].filter(Boolean);
}

function singleHttp2Request(urlStr, method = 'GET', maxBytes = 2 * 1024 * 1024) {
    return new Promise((resolve) => {
        let settled = false;
        let client = null;
        let req = null;

        const safeCleanup = () => {
            try {
                if (req && !req.destroyed) req.destroy();
            } catch {}
            try {
                if (client && !client.destroyed) client.destroy();
            } catch {}
        };

        const finish = (res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            safeCleanup();
            resolve(res);
        };

        let u;
        try {
            u = new URL(urlStr);
        } catch (err) {
            finish({ status: 0, headers: {}, buffer: Buffer.alloc(0), error: `Invalid URL: ${err.message}` });
            return;
        }

        const timer = setTimeout(() => {
            finish({ status: 0, headers: {}, buffer: Buffer.alloc(0), error: 'timeout' });
        }, REQUEST_TIMEOUT_MS);

        try {
            client = http2.connect(u.origin);
        } catch (err) {
            finish({ status: 0, headers: {}, buffer: Buffer.alloc(0), error: err.message });
            return;
        }

        client.on('error', (err) => {
            finish({ status: 0, headers: {}, buffer: Buffer.alloc(0), error: err.message });
        });

        try {
            req = client.request({
                ':method': method,
                ':path': (u.pathname || '/') + (u.search || ''),
                'user-agent': USER_AGENT,
                accept: '*/*',
                'accept-language': 'en-US,en;q=0.9',
            });
        } catch (err) {
            finish({ status: 0, headers: {}, buffer: Buffer.alloc(0), error: err.message });
            return;
        }

        let respHeaders = {};
        const chunks = [];
        let totalBytes = 0;

        req.on('error', (err) => {
            finish({
                status: Number(respHeaders[':status'] || 0),
                headers: respHeaders,
                buffer: Buffer.concat(chunks),
                error: respHeaders[':status'] ? null : err.message,
            });
        });

        req.on('response', (headers) => {
            respHeaders = headers;
            if (method === 'HEAD') {
                finish({
                    status: Number(headers[':status'] || 0),
                    headers: respHeaders,
                    buffer: Buffer.alloc(0),
                    error: null,
                });
            }
        });

        req.on('data', (chunk) => {
            if (totalBytes < maxBytes) {
                chunks.push(chunk);
                totalBytes += chunk.length;
                if (totalBytes >= maxBytes) {
                    finish({
                        status: Number(respHeaders[':status'] || 0),
                        headers: respHeaders,
                        buffer: Buffer.concat(chunks),
                        error: null,
                    });
                }
            }
        });

        req.on('end', () => {
            finish({
                status: Number(respHeaders[':status'] || 0),
                headers: respHeaders,
                buffer: Buffer.concat(chunks),
                error: null,
            });
        });

        req.end();
    });
}

async function singleFetchRequest(urlStr, method = 'GET', maxBytes = 2 * 1024 * 1024) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(urlStr, {
            method,
            redirect: 'manual',
            headers: {
                'user-agent': USER_AGENT,
                accept: '*/*',
                'accept-language': 'en-US,en;q=0.9',
            },
            signal: controller.signal,
        });

        const headers = {
            ':status': res.status,
            location: res.headers.get('location') || undefined,
            'content-type': res.headers.get('content-type') || undefined,
            'content-length': res.headers.get('content-length') || undefined,
            'cf-mitigated': res.headers.get('cf-mitigated') || undefined,
        };

        let buffer = Buffer.alloc(0);
        if (method !== 'HEAD' && res.body) {
            const arrBuf = await res.arrayBuffer();
            buffer = Buffer.from(arrBuf).subarray(0, maxBytes);
        }
        clearTimeout(timer);
        return {
            status: res.status,
            headers,
            buffer,
            error: null,
        };
    } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError' || /timeout|aborted/i.test(err.message);
        return {
            status: 0,
            headers: {},
            buffer: Buffer.alloc(0),
            error: isTimeout ? 'timeout' : err.message,
        };
    }
}

async function requestWithRedirects(initialUrl, method = 'GET', options = {}) {
    const maxRedirects = options.maxRedirects ?? 5;
    const minDelayMs = options.minDelayMs ?? DEFAULT_DELAY_MS;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;

    let currentUrl = initialUrl;
    let redirectCount = 0;

    while (true) {
        const u = new URL(currentUrl);
        const useHttp2 = u.hostname.includes('fifaindex.com');
        const transportFn = useHttp2 ? singleHttp2Request : singleFetchRequest;

        const releaseHost = await acquireSlot(u.hostname, minDelayMs);
        let rawRes;
        try {
            rawRes = await transportFn(currentUrl, method, maxBytes);
            if (
                rawRes.status === 0 ||
                (rawRes.status === 403 && String(rawRes.headers?.['cf-mitigated'] || '') === 'challenge')
            ) {
                await sleep(1000);
                rawRes = await transportFn(currentUrl, method, maxBytes);
            }
        } finally {
            releaseSlot(u.hostname, releaseHost);
        }

        const status = rawRes.status;
        const headers = rawRes.headers || {};
        const location = headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < maxRedirects) {
            currentUrl = new URL(location, currentUrl).toString();
            redirectCount++;
            continue;
        }

        const cfMitigated = String(headers['cf-mitigated'] || '').toLowerCase();
        const contentType = String(headers['content-type'] || '').toLowerCase();
        const contentLengthHeader = headers['content-length'];
        const contentLength =
            contentLengthHeader !== undefined && contentLengthHeader !== null
                ? Number(contentLengthHeader)
                : rawRes.buffer.length || null;

        const isBlocked =
            cfMitigated === 'challenge' ||
            status === 429 ||
            (status === 403 && !contentType.includes('xml') && u.hostname.includes('fifaindex'));

        return {
            requestedUrl: initialUrl,
            finalUrl: currentUrl,
            redirectCount,
            status,
            contentType: contentType.split(';')[0].trim() || null,
            rawContentType: contentType || null,
            contentLength: Number.isFinite(contentLength) ? contentLength : null,
            blocked: Boolean(isBlocked),
            error: rawRes.error || null,
            buffer: rawRes.buffer,
        };
    }
}

export async function fetchPage(url, options = {}) {
    const cacheFile = getCachePath(PAGES_CACHE_DIR, `GET:${url}`);
    if (!options.force && fs.existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (!cached.blocked && cached.status !== 0) {
                return cached;
            }
        } catch {}
    }

    const res = await requestWithRedirects(url, 'GET', options);
    const body = res.buffer ? res.buffer.toString('utf8') : '';

    const record = {
        requestedUrl: url,
        finalUrl: res.finalUrl,
        redirectCount: res.redirectCount,
        status: res.status,
        contentType: res.contentType,
        contentLength: res.contentLength,
        blocked: res.blocked,
        error: res.error,
        body,
        fetchedAt: new Date().toISOString(),
    };

    if (!res.blocked && res.status !== 0) {
        fs.writeFileSync(cacheFile, JSON.stringify(record), 'utf8');
    }
    return record;
}

export async function validateImageUrl(rawUrl, options = {}) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return {
            requestedUrl: rawUrl,
            finalUrl: null,
            normalizedAssetUrl: null,
            redirectCount: 0,
            httpStatus: 0,
            contentType: null,
            contentLength: null,
            reachableImage: false,
            availabilityStatus: 'missing-image',
            sha256: null,
            error: 'Empty image URL',
        };
    }

    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const cacheKey = `${options.computeHash ? 'GETHASH' : 'HEAD'}:${url}`;
    const cacheFile = getCachePath(IMAGES_CACHE_DIR, cacheKey);

    if (!options.force && fs.existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (cached.availabilityStatus !== 'blocked' && cached.httpStatus !== 0) {
                return cached;
            }
        } catch {}
    }

    let res = await requestWithRedirects(url, options.computeHash ? 'GET' : 'HEAD', {
        ...options,
        maxBytes: 512 * 1024,
    });

    if (!options.computeHash && (res.status === 405 || res.status === 400 || (res.status === 200 && !res.contentType))) {
        res = await requestWithRedirects(url, 'GET', {
            ...options,
            maxBytes: 64 * 1024,
        });
    }

    const isImageContent = Boolean(res.contentType && res.contentType.startsWith('image/'));
    const reachableImage = res.status === 200 && isImageContent && !res.blocked;

    let availabilityStatus = 'request-failed';
    if (reachableImage) {
        availabilityStatus = 'reachable';
    } else if (res.blocked) {
        availabilityStatus = 'blocked';
    } else if (res.status === 404 || (res.status === 403 && res.contentType === 'application/xml')) {
        availabilityStatus = 'not-found';
    } else if (res.error === 'timeout') {
        availabilityStatus = 'timeout';
    }

    let sha256 = null;
    if (options.computeHash && reachableImage && res.buffer && res.buffer.length > 0) {
        sha256 = crypto.createHash('sha256').update(res.buffer).digest('hex');
    }

    const record = {
        requestedUrl: url,
        finalUrl: res.finalUrl,
        normalizedAssetUrl: normalizeAssetUrl(res.finalUrl || url),
        redirectCount: res.redirectCount,
        httpStatus: res.status,
        contentType: res.contentType,
        contentLength: res.contentLength,
        reachableImage,
        availabilityStatus,
        sha256,
        error: res.error,
        checkedAt: new Date().toISOString(),
    };

    if (record.availabilityStatus !== 'blocked' && record.httpStatus !== 0) {
        fs.writeFileSync(cacheFile, JSON.stringify(record), 'utf8');
    }

    return record;
}

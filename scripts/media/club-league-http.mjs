// scripts/media/club-league-http.mjs
// Dedicated HTTP validation, magic-bytes parsing, SVG verification, and caching
// for Club / League Media v1. Caches under data/cache/club-league-media/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import http2 from 'node:http2';
import { fileURLToPath } from 'node:url';

// Prioritize IPv4 for reliable, fast socket connections on Windows
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const CACHE_DIR = path.join(ROOT_DIR, 'data', 'cache', 'club-league-media');
const PAGES_CACHE_DIR = path.join(CACHE_DIR, 'pages');
const IMAGES_CACHE_DIR = path.join(CACHE_DIR, 'images');

export const USER_AGENT = 'BattleBaseMediaAudit/1.0 (https://github.com/2505059-dot/battle-base)';
const DEFAULT_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONCURRENCY = 5;

fs.mkdirSync(PAGES_CACHE_DIR, { recursive: true });
fs.mkdirSync(IMAGES_CACHE_DIR, { recursive: true });

const lastRequestByHost = new Map();
const hostChains = new Map();
let activeRequests = 0;
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

    const hostDelay = hostname.includes('fifaindex.com') ? Math.max(minDelayMs, 250) : minDelayMs;
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

function singleHttp2Request(urlStr, method = 'GET', maxBytes = 4 * 1024 * 1024) {
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

async function singleFetchRequest(urlStr, method = 'GET', maxBytes = 4 * 1024 * 1024) {
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
    const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
    const retries = options.retries ?? 2;

    let currentUrl = initialUrl;
    let redirectCount = 0;

    while (true) {
        const u = new URL(currentUrl);
        const useHttp2 = u.hostname.includes('fifaindex.com');
        const transportFn = useHttp2 ? singleHttp2Request : singleFetchRequest;

        let rawRes = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const releaseHost = await acquireSlot(u.hostname, minDelayMs);
            try {
                rawRes = await transportFn(currentUrl, method, maxBytes);
                const isRetryableStatus =
                    rawRes.status === 0 ||
                    rawRes.status === 403 ||
                    rawRes.status === 429 ||
                    (rawRes.status >= 500 && rawRes.status <= 504);
                if (!isRetryableStatus) {
                    break;
                }
            } finally {
                releaseSlot(u.hostname, releaseHost);
            }
            if (attempt < retries) {
                await sleep(800 * (attempt + 1));
            }
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
        const rawContentType = String(headers['content-type'] || '').toLowerCase();
        const contentType = rawContentType.split(';')[0].trim() || null;
        const contentLengthHeader = headers['content-length'];
        const contentLength =
            contentLengthHeader !== undefined && contentLengthHeader !== null
                ? Number(contentLengthHeader)
                : rawRes.buffer.length || null;

        const isBlocked =
            cfMitigated === 'challenge' ||
            status === 429 ||
            (status === 403 && !rawContentType.includes('xml') && u.hostname.includes('fifaindex'));

        return {
            requestedUrl: initialUrl,
            finalUrl: currentUrl,
            redirectCount,
            status,
            contentType,
            rawContentType,
            contentLength: Number.isFinite(contentLength) ? contentLength : null,
            blocked: Boolean(isBlocked),
            error: rawRes.error || null,
            buffer: rawRes.buffer,
        };
    }
}

export function isPlaceholderUrl(urlStr, bufferText = '') {
    if (!urlStr) return false;
    const lowerUrl = urlStr.toLowerCase();
    const keywords = ['placeholder', 'no-image', 'notfound', 'not-found', 'default-logo', 'blank', '1x1', 'spacer'];
    for (const kw of keywords) {
        if (lowerUrl.includes(kw)) return true;
    }
    if (bufferText) {
        const lowerBuf = bufferText.toLowerCase();
        for (const kw of ['image not found', 'no image available', 'placeholder image']) {
            if (lowerBuf.includes(kw)) return true;
        }
    }
    return false;
}

export function parsePng(buf) {
    if (!buf || buf.length < 26) return null;
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
        if (buf[i] !== signature[i]) return null;
    }
    const chunkType = buf.toString('ascii', 12, 16);
    if (chunkType !== 'IHDR') return null;

    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf.readUInt8(24);
    const colorType = buf.readUInt8(25);

    let transparent = false;
    if (colorType === 4 || colorType === 6) {
        transparent = true;
    } else {
        // Scan chunks for tRNS
        let offset = 8;
        while (offset + 8 <= buf.length) {
            const length = buf.readUInt32BE(offset);
            const type = buf.toString('ascii', offset + 4, offset + 8);
            if (type === 'tRNS') {
                transparent = true;
                break;
            }
            if (type === 'IDAT' || type === 'IEND') {
                break;
            }
            offset += 12 + length;
        }
    }

    return {
        format: 'png',
        mimeType: 'image/png',
        width,
        height,
        bitDepth,
        colorType,
        transparent,
    };
}

export function parseJpeg(buf) {
    if (!buf || buf.length < 4) return null;
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;

    let offset = 2;
    while (offset < buf.length) {
        while (offset < buf.length && buf[offset] !== 0xff) offset++;
        while (offset < buf.length && buf[offset] === 0xff) offset++;
        if (offset >= buf.length) break;

        const marker = buf[offset++];
        if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS

        if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)
        ) {
            if (offset + 7 > buf.length) break;
            const height = buf.readUInt16BE(offset + 3);
            const width = buf.readUInt16BE(offset + 5);
            return {
                format: 'jpeg',
                mimeType: 'image/jpeg',
                width,
                height,
                transparent: false,
            };
        }

        if (offset + 2 > buf.length) break;
        const length = buf.readUInt16BE(offset);
        offset += length;
    }

    return {
        format: 'jpeg',
        mimeType: 'image/jpeg',
        width: null,
        height: null,
        transparent: false,
    };
}

export function parseWebp(buf) {
    if (!buf || buf.length < 16) return null;
    const riff = buf.toString('ascii', 0, 4);
    const webp = buf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || webp !== 'WEBP') return null;

    const chunkType = buf.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buf.length >= 30) {
        const flags = buf[20];
        const transparent = Boolean(flags & 0x10);
        const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return {
            format: 'webp',
            mimeType: 'image/webp',
            width,
            height,
            transparent,
        };
    }

    if (chunkType === 'VP8L' && buf.length >= 25) {
        if (buf[20] === 0x2f) {
            const b0 = buf[21];
            const b1 = buf[22];
            const b2 = buf[23];
            const b3 = buf[24];
            const width = 1 + (((b1 & 0x3f) << 8) | b0);
            const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
            const transparent = Boolean(b3 & 0x10);
            return {
                format: 'webp',
                mimeType: 'image/webp',
                width,
                height,
                transparent,
            };
        }
    }

    if (chunkType === 'VP8 ' && buf.length >= 30) {
        if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
            const width = (buf[26] | (buf[27] << 8)) & 0x3fff;
            const height = (buf[28] | (buf[29] << 8)) & 0x3fff;
            return {
                format: 'webp',
                mimeType: 'image/webp',
                width,
                height,
                transparent: false,
            };
        }
    }

    return {
        format: 'webp',
        mimeType: 'image/webp',
        width: null,
        height: null,
        transparent: false,
    };
}

export function parseSvg(text) {
    if (!text || typeof text !== 'string') return null;
    const lower = text.toLowerCase();
    if (!lower.includes('<svg')) return null;
    if (lower.includes('<!doctype html') || lower.includes('<html')) return null;

    let width = null;
    let height = null;

    const svgTagMatch = text.match(/<svg\b[^>]*>/i);
    if (svgTagMatch) {
        const svgTag = svgTagMatch[0];
        const wMatch = svgTag.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i);
        const hMatch = svgTag.match(/\bheight=["']([0-9.]+)(?:px)?["']/i);
        if (wMatch) width = Math.round(Number(wMatch[1])) || null;
        if (hMatch) height = Math.round(Number(hMatch[1])) || null;

        if (width === null || height === null) {
            const vbMatch = svgTag.match(/\bviewBox=["']([0-9.-]+)[,\s]+([0-9.-]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)["']/i);
            if (vbMatch) {
                if (width === null) width = Math.round(Number(vbMatch[3])) || null;
                if (height === null) height = Math.round(Number(vbMatch[4])) || null;
            }
        }
    }

    return {
        format: 'svg',
        mimeType: 'image/svg+xml',
        width,
        height,
        transparent: true,
    };
}

export async function fetchJsonPage(url, options = {}) {
    const cacheFile = getCachePath(PAGES_CACHE_DIR, `JSON:${url}`);
    if (!options.force && fs.existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (!cached.blocked && cached.status === 200) {
                return cached;
            }
        } catch {}
    }

    const res = await requestWithRedirects(url, 'GET', options);
    let jsonData = null;
    try {
        jsonData = JSON.parse(res.buffer ? res.buffer.toString('utf8') : '{}');
    } catch {}

    const record = {
        requestedUrl: url,
        finalUrl: res.finalUrl,
        redirectCount: res.redirectCount,
        status: res.status,
        contentType: res.contentType,
        blocked: res.blocked,
        error: res.error,
        data: jsonData,
    };

    if (!res.blocked && res.status === 200) {
        fs.writeFileSync(cacheFile, JSON.stringify(record), 'utf8');
    }
    return record;
}

export async function validateMediaAsset(rawUrl, options = {}) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return {
            requestedUrl: rawUrl,
            finalUrl: null,
            httpStatus: 0,
            mimeType: null,
            width: null,
            height: null,
            transparent: false,
            reachable: false,
            placeholder: false,
            status: 'error',
            error: 'Empty or non-string URL',
        };
    }

    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    if (!url.startsWith('https://')) {
        return {
            requestedUrl: url,
            finalUrl: null,
            httpStatus: 0,
            mimeType: null,
            width: null,
            height: null,
            transparent: false,
            reachable: false,
            placeholder: false,
            status: 'error',
            error: 'URL must use HTTPS protocol',
        };
    }

    const cacheKey = `VAL:${url}`;
    const cacheFile = getCachePath(IMAGES_CACHE_DIR, cacheKey);

    if (!options.force && fs.existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (cached.status === 'reachable' && cached.httpStatus === 200) {
                return cached;
            }
        } catch {}
    }

    const res = await requestWithRedirects(url, 'GET', {
        ...options,
        maxBytes: 8 * 1024 * 1024,
    });

    const isHttp200 = res.status === 200;
    const mimeType = res.contentType;
    const buf = res.buffer || Buffer.alloc(0);
    const bufText = mimeType === 'image/svg+xml' ? buf.toString('utf8') : '';

    let parsed = null;
    let placeholder = isPlaceholderUrl(res.finalUrl || url, bufText);

    if (isHttp200 && !res.blocked && buf.length > 0) {
        if (mimeType === 'image/svg+xml' || (!mimeType && buf.slice(0, 100).toString('utf8').includes('<svg'))) {
            parsed = parseSvg(buf.toString('utf8'));
        } else if (mimeType === 'image/png' || (!mimeType && buf[0] === 0x89 && buf[1] === 0x50)) {
            parsed = parsePng(buf);
        } else if (mimeType === 'image/webp' || (!mimeType && buf.toString('ascii', 0, 4) === 'RIFF')) {
            parsed = parseWebp(buf);
        } else if (mimeType === 'image/jpeg' || (!mimeType && buf[0] === 0xff && buf[1] === 0xd8)) {
            parsed = parseJpeg(buf);
        }
    }

    if (parsed && parsed.width === 1 && parsed.height === 1) {
        placeholder = true;
    }

    const isRecognizedImage = Boolean(
        parsed && ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'].includes(parsed.mimeType)
    );
    const reachable = Boolean(isHttp200 && !res.blocked && isRecognizedImage && !placeholder);

    let status = 'error';
    if (reachable) {
        status = 'reachable';
    } else if (res.blocked) {
        status = 'blocked';
    } else if (res.status === 404) {
        status = 'not-found';
    } else if (placeholder) {
        status = 'placeholder';
    }

    const record = {
        requestedUrl: url,
        finalUrl: res.finalUrl,
        redirectCount: res.redirectCount,
        httpStatus: res.status,
        mimeType: parsed ? parsed.mimeType : mimeType,
        width: parsed?.width ?? null,
        height: parsed?.height ?? null,
        transparent: parsed?.transparent ?? false,
        reachable,
        placeholder,
        status,
        contentLength: res.contentLength || buf.length,
        error: res.error,
    };

    if (reachable) {
        fs.writeFileSync(cacheFile, JSON.stringify(record), 'utf8');
    }

    return record;
}

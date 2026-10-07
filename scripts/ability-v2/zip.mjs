import { createReadStream, createWriteStream } from 'node:fs';
import { open, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function readAt(handle, length, position) {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) throw new Error('Unexpected end of ZIP file while reading central directory.');
    return buffer;
}

function zip64Values(extra, needUncompressed, needCompressed, needLocalOffset) {
    let cursor = 0;
    while (cursor + 4 <= extra.length) {
        const tag = extra.readUInt16LE(cursor);
        const size = extra.readUInt16LE(cursor + 2);
        const start = cursor + 4;
        if (tag === 0x0001) {
            let valueCursor = start;
            const take64 = () => {
                if (valueCursor + 8 > start + size) throw new Error('Truncated ZIP64 extra field.');
                const value = extra.readBigUInt64LE(valueCursor);
                valueCursor += 8;
                if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 value exceeds safe integer range.');
                return Number(value);
            };
            return {
                uncompressedSize: needUncompressed ? take64() : undefined,
                compressedSize: needCompressed ? take64() : undefined,
                localHeaderOffset: needLocalOffset ? take64() : undefined
            };
        }
        cursor = start + size;
    }
    return {};
}

export async function listZipEntries(zipPath) {
    const handle = await open(zipPath, 'r');
    try {
        const stat = await handle.stat();
        const tailLength = Math.min(stat.size, 65557);
        const tail = await readAt(handle, tailLength, stat.size - tailLength);
        let eocd = -1;
        for (let cursor = tail.length - 22; cursor >= 0; cursor -= 1) {
            if (tail.readUInt32LE(cursor) === 0x06054b50) {
                const commentLength = tail.readUInt16LE(cursor + 20);
                if (cursor + 22 + commentLength <= tail.length) { eocd = cursor; break; }
            }
        }
        if (eocd < 0) throw new Error('ZIP end-of-central-directory record not found: ' + zipPath);

        let entryCount = tail.readUInt16LE(eocd + 10);
        let directorySize = tail.readUInt32LE(eocd + 12);
        let directoryOffset = tail.readUInt32LE(eocd + 16);
        if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
            const locatorAt = eocd - 20;
            if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== 0x07064b50) throw new Error('ZIP64 locator missing.');
            const zip64Offset = Number(tail.readBigUInt64LE(locatorAt + 8));
            const zip64 = await readAt(handle, 56, zip64Offset);
            if (zip64.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 end record is invalid.');
            entryCount = Number(zip64.readBigUInt64LE(32));
            directorySize = Number(zip64.readBigUInt64LE(40));
            directoryOffset = Number(zip64.readBigUInt64LE(48));
        }
        if (!Number.isSafeInteger(directorySize) || directorySize > 100 * 1024 * 1024) throw new Error('ZIP central directory is too large.');
        if (!Number.isSafeInteger(entryCount) || entryCount > 100000) throw new Error('ZIP entry count is unreasonable.');
        const directory = await readAt(handle, directorySize, directoryOffset);
        const entries = [];
        let cursor = 0;
        while (cursor + 46 <= directory.length) {
            if (directory.readUInt32LE(cursor) !== 0x02014b50) break;
            const method = directory.readUInt16LE(cursor + 10);
            let compressedSize = directory.readUInt32LE(cursor + 20);
            let uncompressedSize = directory.readUInt32LE(cursor + 24);
            const nameLength = directory.readUInt16LE(cursor + 28);
            const extraLength = directory.readUInt16LE(cursor + 30);
            const commentLength = directory.readUInt16LE(cursor + 32);
            let localHeaderOffset = directory.readUInt32LE(cursor + 42);
            const nameStart = cursor + 46;
            const extraStart = nameStart + nameLength;
            const name = new TextDecoder('utf-8').decode(directory.subarray(nameStart, extraStart));
            const extra = directory.subarray(extraStart, extraStart + extraLength);
            const zip64 = zip64Values(extra, uncompressedSize === 0xffffffff, compressedSize === 0xffffffff, localHeaderOffset === 0xffffffff);
            if (uncompressedSize === 0xffffffff) uncompressedSize = zip64.uncompressedSize;
            if (compressedSize === 0xffffffff) compressedSize = zip64.compressedSize;
            if (localHeaderOffset === 0xffffffff) localHeaderOffset = zip64.localHeaderOffset;
            entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
            cursor = extraStart + extraLength + commentLength;
        }
        if (entries.length !== entryCount) throw new Error('ZIP central directory entry count mismatch.');
        return entries;
    } finally {
        await handle.close();
    }
}

export async function extractZipEntry(zipPath, requestedName, destination, expected = {}) {
    const entries = await listZipEntries(zipPath);
    const matches = entries.filter((entry) => entry.name === requestedName || entry.name.endsWith('/' + requestedName));
    if (matches.length !== 1) throw new Error('Expected exactly one ZIP member ' + requestedName + '; found ' + matches.length);
    const entry = matches[0];
    if (entry.method !== 0 && entry.method !== 8) throw new Error('Unsupported ZIP compression method ' + entry.method + ' for ' + entry.name);
    const handle = await open(zipPath, 'r');
    let input;
    try {
        const local = await readAt(handle, 30, entry.localHeaderOffset);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid local ZIP header for ' + entry.name);
        const localNameLength = local.readUInt16LE(26);
        const localExtraLength = local.readUInt16LE(28);
        const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
        await handle.close();
        input = createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
    } catch (error) {
        await handle.close().catch(() => {});
        throw error;
    }

    await mkdir(dirname(destination), { recursive: true });
    const part = destination + '.part';
    const meter = new Transform({
        transform(chunk, encoding, callback) {
            this.bytes += chunk.length;
            this.hash.update(chunk);
            callback(null, chunk);
        }
    });
    meter.bytes = 0;
    meter.hash = createHash('sha256');
    const decompressor = entry.method === 8 ? createInflateRaw() : new PassThrough();
    await pipeline(input, decompressor, meter, createWriteStream(part, { flags: 'wx' }));
    const sha256 = meter.hash.digest('hex');
    if (expected.bytes !== undefined && meter.bytes !== expected.bytes) throw new Error('Extracted member byte count mismatch for ' + entry.name);
    if (expected.sha256 && sha256 !== expected.sha256.toLowerCase()) throw new Error('Extracted member SHA-256 mismatch for ' + entry.name);
    await rename(part, destination);
    return { member: entry.name, bytes: meter.bytes, sha256 };
}

export async function hashZipEntry(zipPath, requestedName) {
    const entries = await listZipEntries(zipPath);
    const matches = entries.filter((entry) => entry.name === requestedName || entry.name.endsWith('/' + requestedName));
    if (matches.length !== 1) throw new Error('Expected exactly one ZIP member ' + requestedName + '; found ' + matches.length);
    const entry = matches[0];
    if (entry.method !== 0 && entry.method !== 8) throw new Error('Unsupported ZIP compression method ' + entry.method + ' for ' + entry.name);
    const handle = await open(zipPath, 'r');
    let input;
    try {
        const local = await readAt(handle, 30, entry.localHeaderOffset);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid local ZIP header for ' + entry.name);
        const dataStart = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        await handle.close();
        input = createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
    } catch (error) {
        await handle.close().catch(() => {});
        throw error;
    }
    const meter = new Transform({
        transform(chunk, encoding, callback) { this.bytes += chunk.length; this.hash.update(chunk); callback(null, chunk); }
    });
    meter.bytes = 0; meter.hash = createHash('sha256');
    const sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
    const decompressor = entry.method === 8 ? createInflateRaw() : new PassThrough();
    await pipeline(input, decompressor, meter, sink);
    if (meter.bytes !== entry.uncompressedSize) throw new Error('ZIP member uncompressed size mismatch: ' + entry.name);
    return { member: entry.name, bytes: meter.bytes, sha256: meter.hash.digest('hex') };
}

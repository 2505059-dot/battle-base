#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, basename, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractZipEntry, listZipEntries } from './zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = join(ROOT, 'research/fifa-rating-audit/source-manifest.json');
const LOCAL_ACQUISITION_PATH = join(ROOT, 'research/cache/fifa-rating-audit/player-ability-v2-acquisition-manifest.json');
const DEMO_CSV_PATH = 'research/cache/fifa-rating-audit/kaggle_fifa18_CompleteDataset.csv';
const DEMO_ZIP_PATH = 'research/cache/fifa-rating-audit/kaggle_fifa18_demo.zip';
const LEGACY_ZIP_PATH = 'research/cache/fifa-rating-audit/stefanoleone_fifa23_complete.zip';
const LEGACY_CSV_PATH = 'research/cache/fifa-rating-audit/stefanoleone_legacy_member.csv';

function withinRoot(relativePath) {
    const absolute = resolve(ROOT, relativePath);
    const rel = relative(ROOT, absolute);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Manifest cache path escapes repository: ' + relativePath);
    return absolute;
}

async function sha256File(filePath) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of (await import('node:fs')).createReadStream(filePath)) {
        hash.update(chunk);
        bytes += chunk.length;
    }
    return { bytes, sha256: hash.digest('hex') };
}

async function verifyManifestFile(source) {
    const path = withinRoot(source.cache_path);
    await access(path);
    const actual = await sha256File(path);
    if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256.toLowerCase()) {
        throw new Error('Manifest verification failed for ' + source.cache_path + ': bytes=' + actual.bytes + ', sha256=' + actual.sha256);
    }
    return { path: source.cache_path, bytes: actual.bytes, sha256: actual.sha256, status: 'verified' };
}

async function downloadSource(source) {
    const destination = withinRoot(source.cache_path);
    await mkdir(dirname(destination), { recursive: true });
    try {
        return await verifyManifestFile(source);
    } catch (error) {
        try {
            await access(destination);
            throw new Error('Existing cache has a manifest mismatch; preserved without overwrite: ' + source.cache_path + '; ' + error.message);
        } catch (accessError) {
            if (accessError.message.startsWith('Existing cache')) throw accessError;
        }
    }
    const part = destination + '.part';
    try {
        await access(part);
        throw new Error('Partial download exists and was preserved for inspection: ' + part);
    } catch (error) {
        if (error.message.startsWith('Partial download')) throw error;
    }
    if (!source.url) throw new Error('Manifest entry has no acquisition URL: ' + source.cache_path);
    const response = await fetch(source.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error('Source fetch failed for ' + source.cache_path + ': HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { flags: 'wx' }));
    const actual = await sha256File(part);
    if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256.toLowerCase()) {
        throw new Error('Downloaded payload does not match manifest for ' + source.cache_path + ': bytes=' + actual.bytes + ', sha256=' + actual.sha256);
    }
    await rename(part, destination);
    return { path: source.cache_path, bytes: actual.bytes, sha256: actual.sha256, status: 'downloaded', finalUrl: response.url };
}

async function findUniqueEntry(zipPath, predicate, label) {
    const entries = await listZipEntries(zipPath);
    const matches = entries.filter((entry) => predicate(entry.name));
    if (matches.length !== 1) {
        const sample = entries.slice(0, 30).map((entry) => entry.name).join(', ');
        throw new Error('Expected one ' + label + ' ZIP member; found ' + matches.length + '. ZIP entries begin: ' + sample);
    }
    return matches[0].name;
}

async function extractVerifiedMember(zipPath, member, destination, expected = {}) {
    const archive = await sha256File(zipPath);
    const target = withinRoot(destination);
    try {
        await access(target);
        const existing = await sha256File(target);
        if (expected.bytes !== undefined && existing.bytes !== expected.bytes) throw new Error('Existing extracted member byte count mismatch: ' + destination);
        if (expected.sha256 && existing.sha256 !== expected.sha256.toLowerCase()) throw new Error('Existing extracted member checksum mismatch: ' + destination);
        return { path: destination, member, bytes: existing.bytes, sha256: existing.sha256, archiveSha256: archive.sha256, status: 'verified-existing' };
    } catch (error) {
        if (!error.code && !error.message.startsWith('ENOENT')) throw error;
    }
    const result = await extractZipEntry(zipPath, member, target, expected);
    return { path: destination, member: result.member, bytes: result.bytes, sha256: result.sha256, archiveSha256: archive.sha256, status: 'extracted' };
}

async function main() {
    const verifyOnly = process.argv.includes('--verify-only');
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    const results = [];
    const downloadable = manifest.source_files.filter((source) => source.cache_path !== DEMO_CSV_PATH);
    const concurrency = 4;
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, downloadable.length) }, async () => {
        while (next < downloadable.length) {
            const source = downloadable[next++];
            try {
                if (verifyOnly) results.push(await verifyManifestFile(source));
                else results.push(await downloadSource(source));
            } catch (error) {
                results.push({ path: source.cache_path, status: 'failed', error: error.message });
            }
        }
    });
    await Promise.all(workers);

    const failures = results.filter((entry) => entry.status === 'failed');
    const demoCsv = manifest.source_files.find((source) => source.cache_path === DEMO_CSV_PATH);
    const demoZip = manifest.source_files.find((source) => source.cache_path === DEMO_ZIP_PATH);
    const legacyArchive = manifest.source_files.find((source) => source.cache_path === LEGACY_ZIP_PATH);
    const extracted = [];
    if (!failures.length) {
        try {
            const demoMember = await findUniqueEntry(withinRoot(DEMO_ZIP_PATH), (name) => /CompleteDataset\.csv$/i.test(name), 'FIFA18 demo CSV');
            extracted.push(await extractVerifiedMember(withinRoot(DEMO_ZIP_PATH), demoMember, DEMO_CSV_PATH, { bytes: demoCsv.bytes, sha256: demoCsv.sha256 }));
            const legacyConfig = JSON.parse(await readFile(join(ROOT, 'data/abilities/v2/sources.json'), 'utf8')).sources['stefano-legacy'];
            extracted.push(await extractVerifiedMember(withinRoot(LEGACY_ZIP_PATH), legacyConfig.member, LEGACY_CSV_PATH));
        } catch (error) {
            failures.push({ path: 'archive-extraction', status: 'failed', error: error.message });
        }
    }

    const localManifest = {
        purpose: 'Local acquisition metadata; not an input to deterministic data output.',
        sourceManifestPath: 'research/fifa-rating-audit/source-manifest.json',
        sourceManifestSha256: (await sha256File(MANIFEST_PATH)).sha256,
        acquiredAt: new Date().toISOString(),
        sources: results.sort((a, b) => a.path.localeCompare(b.path)),
        extractedMembers: extracted.sort((a, b) => a.path.localeCompare(b.path)),
        failures
    };
    await mkdir(dirname(LOCAL_ACQUISITION_PATH), { recursive: true });
    await writeFile(LOCAL_ACQUISITION_PATH, JSON.stringify(localManifest, null, 2) + '\n', 'utf8');
    if (failures.length) throw new Error('Source acquisition incomplete; inspect local acquisition manifest. ' + failures.map((entry) => entry.path + ': ' + entry.error).join('; '));
    if (results.length !== manifest.source_files.length - 1) throw new Error('Not all manifest inputs were checked.');
    console.log('Verified ' + results.length + ' source files and ' + extracted.length + ' extracted members.');
    for (const item of extracted) console.log(item.path + ' ' + item.bytes + ' bytes ' + item.sha256);
}

main().catch((error) => {
    console.error('[ability-v2-acquire] ' + error.message);
    process.exitCode = 1;
});

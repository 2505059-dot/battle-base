import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { renderPlayerIdentityIndex } from './build-player-identity-index.mjs';
import { identityIndexSourceMatches } from './validate-player-identity-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_INDEX = resolve(ROOT, 'public/data/player-identities.js');

test('identity source rendering is deterministic, read-only, and matches checked-in bytes', async () => {
    const before = await readFile(RUNTIME_INDEX);
    const first = Buffer.from(renderPlayerIdentityIndex().source, 'utf8');
    const second = Buffer.from(renderPlayerIdentityIndex().source, 'utf8');
    const after = await readFile(RUNTIME_INDEX);

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(after, before, 'rendering must not rewrite the runtime index');
    assert.ok(identityIndexSourceMatches(before, first), 'checked-in output may differ only by CRLF/LF');
});

test('identity source comparison accepts CRLF-only changes and rejects content-byte tampering', () => {
    const source = Buffer.from([0x61, 0x0a, 0x62, 0x0d, 0x63, 0xff]);
    const crlf = Buffer.from([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x63, 0xff]);

    assert.equal(identityIndexSourceMatches(crlf, source), true);

    const tampered = Buffer.from(crlf);
    tampered[3] = 0x78;
    assert.equal(identityIndexSourceMatches(tampered, source), false);
});

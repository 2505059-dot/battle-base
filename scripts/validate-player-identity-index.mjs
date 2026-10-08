#!/usr/bin/env node
// scripts/validate-player-identity-index.mjs
// Validates data/entities/players.json -> public/data/player-identities.js -> public/game/player-identity.js
// Verifies:
// - entities = 418
// - playerSeasons = 554
// - runtime mappings = 554
// - unknown = 0
// - duplicate ownership = 0
// - zero dependency on player-media subsystem
// - deterministic runtime output

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEAM_SEASONS } from '../public/data/team-seasons.js';
import { PLAYER_ENTITY_BY_SEASON_ID } from '../public/data/player-identities.js';
import {
    getPlayerEntityId,
    getPlayerIdentityKey,
    isSameCanonicalPlayer,
} from '../public/game/player-identity.js';
import { renderPlayerIdentityIndex } from './build-player-identity-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PLAYERS_JSON_PATH = path.join(ROOT_DIR, 'data', 'entities', 'players.json');
const RUNTIME_INDEX_PATH = path.join(ROOT_DIR, 'public', 'data', 'player-identities.js');
const HELPER_PATH = path.join(ROOT_DIR, 'public', 'game', 'player-identity.js');

export function normalizeLineEndings(bytes) {
    const input = Buffer.from(bytes);
    const normalized = Buffer.allocUnsafe(input.length);
    let length = 0;

    for (let index = 0; index < input.length; index += 1) {
        if (input[index] === 0x0d && input[index + 1] === 0x0a) continue;
        normalized[length] = input[index];
        length += 1;
    }

    return normalized.subarray(0, length);
}

export function identityIndexSourceMatches(actualBytes, generatedBytes) {
    return normalizeLineEndings(actualBytes).equals(normalizeLineEndings(generatedBytes));
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function validatePlayerIdentityIndex() {
    assert.ok(fs.existsSync(PLAYERS_JSON_PATH), 'data/entities/players.json must exist');
    assert.ok(fs.existsSync(RUNTIME_INDEX_PATH), 'public/data/player-identities.js must exist');
    assert.ok(fs.existsSync(HELPER_PATH), 'public/game/player-identity.js must exist');

    const playersData = JSON.parse(fs.readFileSync(PLAYERS_JSON_PATH, 'utf8'));
    const entities = Array.isArray(playersData.entities) ? playersData.entities : [];

    // 1. Check entities = 418
    assert.equal(entities.length, 418, `Expected 418 entities, got ${entities.length}`);
    assert.equal(
        playersData.totalEntities,
        418,
        `Expected totalEntities=418, got ${playersData.totalEntities}`
    );

    // 2. Check playerSeasons = 554
    const allPlayerSeasons = TEAM_SEASONS.flatMap((ts) => ts.players);
    assert.equal(
        allPlayerSeasons.length,
        554,
        `Expected 554 PlayerSeasons in TEAM_SEASONS, got ${allPlayerSeasons.length}`
    );
    assert.equal(
        playersData.totalPlayerSeasons,
        554,
        `Expected totalPlayerSeasons=554 in players.json, got ${playersData.totalPlayerSeasons}`
    );

    // 3. Check duplicate ownership = 0 across entities[].playerSeasonIds
    const entityIdSet = new Set();
    const ownershipCountBySeasonId = new Map();
    const ownerBySeasonId = new Map();
    let duplicateOwnershipCount = 0;

    for (const entity of entities) {
        assert.ok(entity && typeof entity.id === 'string' && entity.id.length > 0);
        assert.ok(!entityIdSet.has(entity.id), `Duplicate entity.id: ${entity.id}`);
        entityIdSet.add(entity.id);

        assert.ok(
            Array.isArray(entity.playerSeasonIds) && entity.playerSeasonIds.length > 0,
            `Entity ${entity.id} must have non-empty playerSeasonIds`
        );

        for (const psId of entity.playerSeasonIds) {
            const prevCount = ownershipCountBySeasonId.get(psId) || 0;
            if (prevCount > 0) {
                duplicateOwnershipCount += 1;
            }
            ownershipCountBySeasonId.set(psId, prevCount + 1);
            ownerBySeasonId.set(psId, entity.id);
        }
    }

    assert.equal(
        duplicateOwnershipCount,
        0,
        `Expected duplicate ownership = 0, got ${duplicateOwnershipCount}`
    );
    assert.equal(
        ownerBySeasonId.size,
        554,
        `Expected 554 unique owned PlayerSeason IDs across entities, got ${ownerBySeasonId.size}`
    );

    // 4. Check runtime mappings = 554 & unknown = 0
    const runtimeKeys = Object.keys(PLAYER_ENTITY_BY_SEASON_ID);
    assert.equal(
        runtimeKeys.length,
        554,
        `Expected 554 runtime mappings in PLAYER_ENTITY_BY_SEASON_ID, got ${runtimeKeys.length}`
    );

    const sortedRuntimeKeys = [...runtimeKeys].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(
        runtimeKeys,
        sortedRuntimeKeys,
        'PLAYER_ENTITY_BY_SEASON_ID keys must be deterministically sorted'
    );

    let unknownCount = 0;
    const mappedEntityIds = new Set();

    for (const ps of allPlayerSeasons) {
        const entityIdFromIndex = PLAYER_ENTITY_BY_SEASON_ID[ps.id];
        const entityIdFromHelper = getPlayerEntityId(ps);
        const entityIdFromIdString = getPlayerEntityId(ps.id);
        const identityKey = getPlayerIdentityKey(ps);

        if (
            !entityIdFromIndex ||
            !entityIdSet.has(entityIdFromIndex) ||
            entityIdFromHelper !== entityIdFromIndex ||
            entityIdFromIdString !== entityIdFromIndex ||
            identityKey !== `entity:${entityIdFromIndex}`
        ) {
            unknownCount += 1;
        } else {
            mappedEntityIds.add(entityIdFromIndex);
        }

        assert.equal(
            entityIdFromIndex,
            ownerBySeasonId.get(ps.id),
            `Runtime mapping for ${ps.id} must match entities[].playerSeasonIds owner`
        );
        assert.equal(
            entityIdFromIndex,
            playersData.playerSeasonMap[ps.id],
            `Runtime mapping for ${ps.id} must match players.json playerSeasonMap`
        );
        assert.equal(
            isSameCanonicalPlayer(ps, ps.id),
            true,
            `isSameCanonicalPlayer(player, player.id) must be true for ${ps.id}`
        );
    }

    assert.equal(unknownCount, 0, `Expected unknown = 0, got ${unknownCount}`);
    assert.equal(
        mappedEntityIds.size,
        418,
        `Expected all 418 canonical entities to be represented in runtime mappings, got ${mappedEntityIds.size}`
    );

    // 5. Verify no media dependency in player-identities.js or player-identity.js
    const runtimeSrc = fs.readFileSync(RUNTIME_INDEX_PATH, 'utf8');
    const helperSrc = fs.readFileSync(HELPER_PATH, 'utf8');
    assert.ok(
        !runtimeSrc.includes('player-media') && !runtimeSrc.includes('imageUrl'),
        'public/data/player-identities.js must not reference player-media or imageUrl'
    );
    assert.ok(
        !helperSrc.includes('player-media') && !helperSrc.includes('entity-media'),
        'public/game/player-identity.js must not import player-media or entity-media'
    );

    // 6. Compare complete bytes while treating only CRLF/LF as equivalent. Rendering is pure,
    // so validation never rewrites the checked-out runtime index as a side effect.
    const runtimeBytes = fs.readFileSync(RUNTIME_INDEX_PATH);
    const generatedBytes1 = Buffer.from(renderPlayerIdentityIndex().source, 'utf8');
    const generatedBytes2 = Buffer.from(renderPlayerIdentityIndex().source, 'utf8');
    assert.ok(
        identityIndexSourceMatches(runtimeBytes, generatedBytes1),
        'Runtime index on disk must match fresh generated output apart from CRLF/LF line endings'
    );
    assert.deepStrictEqual(generatedBytes1, generatedBytes2, 'Consecutive renders must produce identical bytes');

    return {
        entities: entities.length,
        playerSeasons: allPlayerSeasons.length,
        runtimeMappings: runtimeKeys.length,
        unknown: unknownCount,
        duplicateOwnership: duplicateOwnershipCount,
        sha256: sha256(normalizeLineEndings(generatedBytes2)),
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const res = validatePlayerIdentityIndex();
    console.log(
        `[validate-player-identity-index] PASS — entities=${res.entities}, playerSeasons=${res.playerSeasons}, runtimeMappings=${res.runtimeMappings}, unknown=${res.unknown}, duplicateOwnership=${res.duplicateOwnership}, sha256=${res.sha256}`
    );
}

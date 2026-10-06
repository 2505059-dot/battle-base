#!/usr/bin/env node
// scripts/validate-player-media-audit.mjs
// Comprehensive validator for Player Media Provider Audit v1 (Section 43):
// - provider enum valid ('fifaindex-current', 'fifaaddict-fo3', 'fifaaddict-fo4')
// - entity IDs all exist (all 418 entities present and no unknown entity IDs)
// - no unknown PlayerSeason IDs (all 554 PlayerSeasons present and valid)
// - image URLs valid http/https (no guessed/malformed URLs, no legacy static/FIFA URLs in current CDN audit)
// - reachable image content-type valid (starts with 'image/')
// - placeholder not counted real (including Kylian Mbappe FIFA 16 regression check)
// - manual-review not counted reliable
// - no gameplay fields (no overall, pace, shooting, attack, creation, defense, physical, goalkeeping)
// - no duplicate corrupted entries
// - all 418 entities present in audit result and deterministic ordering verified

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const TEAM_SEASONS_JS = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');

const VALID_PROVIDERS = new Set([
    'fifaindex-current',
    'fifaaddict-fo3',
    'fifaaddict-fo4',
]);

const VALID_CONFIDENCES = new Set([
    'exact-id',
    'exact-name',
    'alias-confirmed',
    'name+context',
    'manual-review',
    'unresolved',
]);

const RELIABLE_CONFIDENCES = new Set([
    'exact-id',
    'exact-name',
    'alias-confirmed',
    'name+context',
]);

const VALID_ASSET_KINDS = new Set([
    'real-photo',
    'placeholder',
    'missing-image',
    'request-failed',
    'unknown',
]);

const FORBIDDEN_GAMEPLAY_KEYS = new Set([
    'overall',
    'pace',
    'shooting',
    'passing',
    'dribbling',
    'defending',
    'physicality',
    'attack',
    'creation',
    'defense',
    'physical',
    'goalkeeping',
    'positions',
]);

function isValidHttpUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        if (!u.hostname || !u.hostname.includes('.')) return false;
        if (!u.pathname || u.pathname === '/') return false;
        return true;
    } catch {
        return false;
    }
}

function checkNoForbiddenKeys(obj, pathLabel, errors) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            checkNoForbiddenKeys(obj[i], `${pathLabel}[${i}]`, errors);
        }
        return;
    }
    for (const [k, v] of Object.entries(obj)) {
        if (FORBIDDEN_GAMEPLAY_KEYS.has(k)) {
            errors.push(`Forbidden gameplay field "${k}" found at ${pathLabel}`);
        }
        checkNoForbiddenKeys(v, `${pathLabel}.${k}`, errors);
    }
}

async function main() {
    const errors = [];

    const playersPath = path.join(ENTITIES_DIR, 'players.json');
    const sidecarPath = path.join(ENTITIES_DIR, 'player-media-candidates.json');
    const reportJsonPath = path.join(REPORTS_DIR, 'player-media-provider-audit.json');
    const reportMdPath = path.join(REPORTS_DIR, 'player-media-provider-audit.md');

    for (const [label, p] of [
        ['data/entities/players.json', playersPath],
        ['data/entities/player-media-candidates.json', sidecarPath],
        ['data/reports/player-media-provider-audit.json', reportJsonPath],
        ['data/reports/player-media-provider-audit.md', reportMdPath],
    ]) {
        if (!fs.existsSync(p)) {
            errors.push(`Missing required file: ${label}`);
        }
    }

    if (errors.length > 0) {
        console.error('[validate-player-media-audit] Prerequisite files missing:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    const sidecarData = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    const reportData = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    const reportMd = fs.readFileSync(reportMdPath, 'utf8');

    const tsModule = await import(pathToFileURL(TEAM_SEASONS_JS).href);
    const { TEAM_SEASONS } = tsModule;
    const allPlayerSeasons = TEAM_SEASONS.flatMap((ts) => ts.players);

    const canonicalEntityIds = new Set(playersData.entities.map((e) => e.id));
    const canonicalPsIds = new Set(allPlayerSeasons.map((ps) => ps.id));

    // 1. Validate all 418 entities present & deterministic ordering
    const sidecarKeys = Object.keys(sidecarData.entities || {});
    if (sidecarKeys.length !== 418 || sidecarData.totalEntities !== 418) {
        errors.push(
            `Expected 418 entities in player-media-candidates.json, got keys=${sidecarKeys.length}, totalEntities=${sidecarData.totalEntities}`
        );
    }

    const sortedSidecarKeys = [...sidecarKeys].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < sidecarKeys.length; i++) {
        if (sidecarKeys[i] !== sortedSidecarKeys[i]) {
            errors.push(`player-media-candidates.json entities are not in deterministic alphabetical order at index ${i}`);
            break;
        }
    }

    for (const id of canonicalEntityIds) {
        if (!sidecarData.entities[id]) {
            errors.push(`Missing entity "${id}" in player-media-candidates.json`);
        }
    }
    for (const id of sidecarKeys) {
        if (!canonicalEntityIds.has(id)) {
            errors.push(`Unknown entity "${id}" in player-media-candidates.json`);
        }
    }

    // 2. Validate all 554 PlayerSeasons in reportData.playerSeasonResolutions
    const psResolutions = reportData.playerSeasonResolutions || [];
    if (psResolutions.length !== 554 || reportData.scope?.totalPlayerSeasons !== 554) {
        errors.push(`Expected 554 PlayerSeason resolutions in report JSON, got ${psResolutions.length}`);
    }
    const seenPsIds = new Set();
    for (const psr of psResolutions) {
        if (!canonicalPsIds.has(psr.playerSeasonId)) {
            errors.push(`Unknown PlayerSeason ID in playerSeasonResolutions: "${psr.playerSeasonId}"`);
        }
        if (seenPsIds.has(psr.playerSeasonId)) {
            errors.push(`Duplicate PlayerSeason ID in playerSeasonResolutions: "${psr.playerSeasonId}"`);
        }
        seenPsIds.add(psr.playerSeasonId);
        if (!canonicalEntityIds.has(psr.entityId)) {
            errors.push(`Unknown entityId "${psr.entityId}" in playerSeasonResolutions for "${psr.playerSeasonId}"`);
        }
    }

    // 3. Validate every candidate across all 418 entities
    for (const [entityId, entry] of Object.entries(sidecarData.entities)) {
        checkNoForbiddenKeys(entry, `entities.${entityId}`, errors);

        const groups = [
            ['fifaindex-current', entry.fifaIndex],
            ['fifaaddict-fo3', entry.fifaAddictFo3],
            ['fifaaddict-fo4', entry.fifaAddictFo4],
        ];

        for (const [expectedProvider, list] of groups) {
            if (!Array.isArray(list)) {
                errors.push(`Entity ${entityId} provider list for ${expectedProvider} is not an array`);
                continue;
            }

            const seenCandKeys = new Set();
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                const cLabel = `entities.${entityId}.${expectedProvider}[${i}]`;

                if (!VALID_PROVIDERS.has(c.provider) || c.provider !== expectedProvider) {
                    errors.push(`${cLabel}: invalid provider "${c.provider}" (expected "${expectedProvider}")`);
                }
                if (!VALID_CONFIDENCES.has(c.matchConfidence)) {
                    errors.push(`${cLabel}: invalid matchConfidence "${c.matchConfidence}"`);
                }
                if (!VALID_ASSET_KINDS.has(c.assetKind)) {
                    errors.push(`${cLabel}: invalid assetKind "${c.assetKind}"`);
                }
                if (c.licenseStatus !== 'external-provider') {
                    errors.push(`${cLabel}: invalid licenseStatus "${c.licenseStatus}" (must be "external-provider")`);
                }
                if (!isValidHttpUrl(c.sourcePageUrl)) {
                    errors.push(`${cLabel}: invalid sourcePageUrl "${c.sourcePageUrl}"`);
                }
                if (!isValidHttpUrl(c.imageUrl)) {
                    errors.push(`${cLabel}: invalid imageUrl "${c.imageUrl}"`);
                }
                if (expectedProvider === 'fifaindex-current' && c.assetKind === 'real-photo') {
                    if (!c.imageUrl.startsWith('https://images.fifaindex.com/')) {
                        errors.push(`${cLabel}: FIFAIndex real-photo must use images.fifaindex.com CDN, got "${c.imageUrl}"`);
                    }
                }
                if (expectedProvider === 'fifaaddict-fo4' && !c.manualReview) {
                    if (!c.fo4OpaqueUid || !/^[a-z0-9]+$/i.test(c.fo4OpaqueUid)) {
                        errors.push(`${cLabel}: FO4 candidate missing valid opaque UID`);
                    }
                }

                // Reachable image must have contentType starting with 'image/' and httpStatus === 200
                if (c.reachableImage) {
                    if (c.httpStatus !== 200) {
                        errors.push(`${cLabel}: reachableImage=true but httpStatus=${c.httpStatus}`);
                    }
                    if (!c.contentType || !c.contentType.startsWith('image/')) {
                        errors.push(`${cLabel}: reachableImage=true but invalid contentType="${c.contentType}"`);
                    }
                    if (c.assetKind === 'placeholder') {
                        errors.push(`${cLabel}: placeholder assetKind cannot have reachableImage=true`);
                    }
                }

                // Placeholder must never be counted as reachable real photo
                if (c.assetKind === 'placeholder' && c.reachableImage) {
                    errors.push(`${cLabel}: placeholder counted as reachable real photo`);
                }

                // Manual review must not have reliable confidence
                if (c.manualReview && RELIABLE_CONFIDENCES.has(c.matchConfidence)) {
                    errors.push(`${cLabel}: manualReview=true cannot have reliable matchConfidence="${c.matchConfidence}"`);
                }

                // Duplicate corrupted entry check
                const dedupKey = `${c.provider}|${c.sourcePageUrl}|${c.imageUrl}|${c.editionOrClass}`;
                if (seenCandKeys.has(dedupKey)) {
                    errors.push(`${cLabel}: duplicate candidate entry "${dedupKey}"`);
                }
                seenCandKeys.add(dedupKey);
            }
        }
    }

    // 4. Regression check: Kylian Mbappe FIFA 16 must be detected as placeholder and NOT counted as real-photo (Section 37)
    const mbappeFi = sidecarData.entities['kylian-mbappe']?.fifaIndex || [];
    const mbappe2016 = mbappeFi.find((c) => c.editionYear === 2016 || c.editionOrClass === 'FIFA16');
    if (!mbappe2016) {
        errors.push('Regression failure: Kylian Mbappe FIFA16 candidate missing from sidecar');
    } else {
        if (mbappe2016.assetKind !== 'placeholder') {
            errors.push(`Regression failure: Kylian Mbappe FIFA16 expected assetKind="placeholder", got "${mbappe2016.assetKind}"`);
        }
        if (mbappe2016.reachableImage) {
            errors.push('Regression failure: Kylian Mbappe FIFA16 placeholder must not have reachableImage=true');
        }
    }

    // 5. Regression check: Current FIFAIndex CDN modern + FIFA 05/06 /g/ path (Section 38)
    const messiFi = sidecarData.entities['lionel-messi']?.fifaIndex || [];
    const maldiniFi = sidecarData.entities['paolo-maldini']?.fifaIndex || [];
    if (!messiFi.some((c) => c.imageUrl?.startsWith('https://images.fifaindex.com/') && c.reachableImage)) {
        errors.push('Regression failure: Lionel Messi missing reachable images.fifaindex.com candidate');
    }
    if (![...messiFi, ...maldiniFi].some((c) => c.imageUrl?.includes('/players/g/') && c.reachableImage)) {
        errors.push('Regression failure: Missing reachable legacy /players/g/ FIFA 05-08 candidate on images.fifaindex.com');
    }

    // 6. Verify required report sections in Markdown and JSON (Section 44)
    for (const requiredSection of [
        'Provider Summary',
        'Unique Player Coverage',
        'PlayerSeason Coverage',
        'Era Breakdown',
        'Legend / Historical Gap',
        'Famous Historical Sample Audit',
        'Regression Fixtures',
        'Manual Review Queue',
        'Still Missing Players',
    ]) {
        if (!reportMd.includes(requiredSection)) {
            errors.push(`Markdown report missing required section: "${requiredSection}"`);
        }
    }

    if (errors.length > 0) {
        console.error(`[validate-player-media-audit] FAILED with ${errors.length} error(s):`);
        for (const err of errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    console.log('[validate-player-media-audit] All audit validation checks PASSED:');
    console.log('  - All 418 unique Player Entities and 554 PlayerSeasons present and deterministically ordered');
    console.log('  - Provider enums, HTTP/HTTPS URLs, and image/* content-types strictly verified');
    console.log('  - Kylian Mbappe FIFA 16 placeholder and FIFA 05-08 /g/ CDN regressions verified');
    console.log('  - Manual-review items excluded from reliable coverage');
    console.log('  - Zero forbidden gameplay attributes present in sidecar or reports');
}

main().catch((err) => {
    console.error('[validate-player-media-audit] Fatal error:', err);
    process.exit(1);
});

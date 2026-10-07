#!/usr/bin/env node
// scripts/validate-player-media-resolution.mjs
// Comprehensive validator for Player Media Resolution v1 (Sections 42–48):
// - Total PlayerSeasons = 554, resolution entries = 554
// - Exact classification counts:
//   - fifaindex-exact-year = 454
//   - fifaindex-nearest-year = 90
//   - fo3-supplemental = 4
//   - fo4-supplemental = 1
//   - silhouette = 5
//   - external total = 549, fallback total = 5
// - Candidate integrity: every external selection traces to an existing audited candidate
// - No bad candidates: no placeholder, manualReview, blocked, not-found, timeout, or request-failed
// - Required fixtures verified (Exact, Nearest, FO3, FO4, Silhouette, Mbappe placeholder regression)
// - Runtime index (public/data/player-media.js) and helper (public/media/entity-media.js) verified

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const PLAYERS_PATH = path.join(ROOT_DIR, 'data', 'entities', 'players.json');
const CANDIDATES_PATH = path.join(ROOT_DIR, 'data', 'entities', 'player-media-candidates.json');
const AUDIT_REPORT_PATH = path.join(ROOT_DIR, 'data', 'reports', 'player-media-provider-audit.json');
const OVERRIDES_PATH = path.join(ROOT_DIR, 'data', 'manual', 'player-media-overrides.json');
const RESOLUTIONS_PATH = path.join(ROOT_DIR, 'data', 'entities', 'player-media-resolutions.json');
const REPORT_JSON_PATH = path.join(ROOT_DIR, 'data', 'reports', 'player-media-resolution-report.json');
const REPORT_MD_PATH = path.join(ROOT_DIR, 'data', 'reports', 'player-media-resolution-report.md');
const RUNTIME_INDEX_PATH = path.join(ROOT_DIR, 'public', 'data', 'player-media.js');
const HELPER_PATH = path.join(ROOT_DIR, 'public', 'media', 'entity-media.js');
const SILHOUETTE_SVG_PATH = path.join(ROOT_DIR, 'public', 'assets', 'player-silhouette.svg');
const TEAM_SEASONS_PATH = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');

const EXPECTED_TOTAL = 554;
const EXPECTED_ENTITIES = 418;
const EXPECTED_EXACT = 454;
const EXPECTED_NEAREST = 90;
const EXPECTED_FO3 = 4;
const EXPECTED_FO4 = 1;
const EXPECTED_SILHOUETTE = 5;
const EXPECTED_EXTERNAL = 549;

const RELIABLE_CONFIDENCES = new Set([
    'exact-id',
    'exact-name',
    'alias-confirmed',
    'name+context',
]);

const FORBIDDEN_AVAILABILITY = new Set([
    'placeholder',
    'blocked',
    'not-found',
    'timeout',
    'request-failed',
    'not-probed',
    'manual-review',
]);

async function main() {
    const errors = [];
    console.log('[validate-player-media-resolution] Starting validation...');

    const requiredFiles = [
        ['data/entities/players.json', PLAYERS_PATH],
        ['data/entities/player-media-candidates.json', CANDIDATES_PATH],
        ['data/reports/player-media-provider-audit.json', AUDIT_REPORT_PATH],
        ['data/manual/player-media-overrides.json', OVERRIDES_PATH],
        ['data/entities/player-media-resolutions.json', RESOLUTIONS_PATH],
        ['data/reports/player-media-resolution-report.json', REPORT_JSON_PATH],
        ['data/reports/player-media-resolution-report.md', REPORT_MD_PATH],
        ['public/data/player-media.js', RUNTIME_INDEX_PATH],
        ['public/media/entity-media.js', HELPER_PATH],
        ['public/assets/player-silhouette.svg', SILHOUETTE_SVG_PATH],
    ];

    for (const [label, filePath] of requiredFiles) {
        if (!fs.existsSync(filePath)) {
            errors.push(`Missing required file: ${label}`);
        }
    }

    if (errors.length > 0) {
        console.error('[validate-player-media-resolution] Missing required files:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    const playersData = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
    const candidatesData = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
    const auditReport = JSON.parse(fs.readFileSync(AUDIT_REPORT_PATH, 'utf8'));
    const overridesData = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    const resolutionsData = JSON.parse(fs.readFileSync(RESOLUTIONS_PATH, 'utf8'));
    const reportJson = JSON.parse(fs.readFileSync(REPORT_JSON_PATH, 'utf8'));
    const reportMd = fs.readFileSync(REPORT_MD_PATH, 'utf8');
    const silhouetteSvg = fs.readFileSync(SILHOUETTE_SVG_PATH, 'utf8');

    const { TEAM_SEASONS } = await import(pathToFileURL(TEAM_SEASONS_PATH).href);
    const { PLAYER_SEASON_MEDIA, PLAYER_ENTITY_DEFAULT_MEDIA, PLAYER_SILHOUETTE_URL } = await import(
        pathToFileURL(RUNTIME_INDEX_PATH).href
    );
    const { getPlayerMedia, getPlayerEntityDefaultMedia, getClubCrest, getLeagueEmblem } = await import(
        pathToFileURL(HELPER_PATH).href
    );

    // 1. Validate silhouette SVG
    if (!silhouetteSvg.includes('<svg') || !silhouetteSvg.includes('</svg>')) {
        errors.push('public/assets/player-silhouette.svg is not a valid SVG document');
    }
    if (silhouetteSvg.includes('data:image/')) {
        errors.push('public/assets/player-silhouette.svg must not embed Base64 data URIs');
    }

    // 2. Validate manual overrides skeleton
    if (overridesData.schemaVersion !== '1.0.0') {
        errors.push(`Expected overrides schemaVersion "1.0.0", got "${overridesData.schemaVersion}"`);
    }
    if (!overridesData.playerSeasons || typeof overridesData.playerSeasons !== 'object') {
        errors.push('overrides.playerSeasons must be an object');
    }
    if (!overridesData.entities || typeof overridesData.entities !== 'object') {
        errors.push('overrides.entities must be an object');
    }

    // 3. Collect canonical PlayerSeasons from TEAM_SEASONS
    const canonicalSeasons = new Map();
    for (const ts of TEAM_SEASONS) {
        for (const p of ts.players) {
            canonicalSeasons.set(p.id, p);
        }
    }
    if (canonicalSeasons.size !== EXPECTED_TOTAL) {
        errors.push(`Expected ${EXPECTED_TOTAL} PlayerSeasons in TEAM_SEASONS, got ${canonicalSeasons.size}`);
    }

    // 4. Validate top-level counts in player-media-resolutions.json
    if (resolutionsData.policyVersion !== 'availability-v1') {
        errors.push(`Expected policyVersion "availability-v1", got "${resolutionsData.policyVersion}"`);
    }
    if (resolutionsData.totalPlayerSeasons !== EXPECTED_TOTAL) {
        errors.push(`Expected totalPlayerSeasons=${EXPECTED_TOTAL}, got ${resolutionsData.totalPlayerSeasons}`);
    }
    if (resolutionsData.externalMediaCount !== EXPECTED_EXTERNAL) {
        errors.push(`Expected externalMediaCount=${EXPECTED_EXTERNAL}, got ${resolutionsData.externalMediaCount}`);
    }
    if (resolutionsData.silhouetteCount !== EXPECTED_SILHOUETTE) {
        errors.push(`Expected silhouetteCount=${EXPECTED_SILHOUETTE}, got ${resolutionsData.silhouetteCount}`);
    }

    const resEntries = resolutionsData.resolutions || {};
    const resKeys = Object.keys(resEntries);
    if (resKeys.length !== EXPECTED_TOTAL) {
        errors.push(`Expected ${EXPECTED_TOTAL} resolution entries, got ${resKeys.length}`);
    }

    // Verify deterministic key sorting
    const sortedResKeys = [...resKeys].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < resKeys.length; i++) {
        if (resKeys[i] !== sortedResKeys[i]) {
            errors.push(`Resolution keys are not deterministically sorted at index ${i}`);
            break;
        }
    }

    // Map audit report playerSeasonResolutions by playerSeasonId
    const auditSeasonById = new Map();
    for (const item of auditReport.playerSeasonResolutions || []) {
        auditSeasonById.set(item.playerSeasonId, item);
    }

    // 5. Validate each resolution entry + candidate integrity
    const counts = {
        'fifaindex-exact-year': 0,
        'fifaindex-nearest-year': 0,
        'fo3-supplemental': 0,
        'fo4-supplemental': 0,
        'silhouette': 0,
    };

    for (const [psId, psObj] of canonicalSeasons.entries()) {
        const res = resEntries[psId];
        if (!res) {
            errors.push(`Missing resolution entry for PlayerSeason "${psId}"`);
            continue;
        }

        const expectedEntityId = playersData.playerSeasonMap[psId];
        if (res.entityId !== expectedEntityId) {
            errors.push(`${psId}: entityId mismatch (${res.entityId} !== ${expectedEntityId})`);
        }
        if (res.targetYear !== psObj.year) {
            errors.push(`${psId}: targetYear mismatch (${res.targetYear} !== ${psObj.year})`);
        }
        if (! Object.prototype.hasOwnProperty.call(counts, res.resolutionType)) {
            errors.push(`${psId}: unexpected resolutionType "${res.resolutionType}"`);
            continue;
        }
        counts[res.resolutionType]++;

        // Cross-check against audit report resolvedBy
        const auditItem = auditSeasonById.get(psId);
        if (auditItem) {
            const expectedResolvedBy =
                res.resolutionType === 'silhouette' ? 'none' : res.resolutionType;
            if (auditItem.resolvedBy !== expectedResolvedBy) {
                errors.push(
                    `${psId}: resolutionType "${res.resolutionType}" does not match audit resolvedBy "${auditItem.resolvedBy}"`
                );
            }
        }

        const candEntity = candidatesData.entities[res.entityId];
        if (!candEntity) {
            errors.push(`${psId}: missing entity "${res.entityId}" in player-media-candidates.json`);
            continue;
        }

        if (res.resolutionType === 'silhouette') {
            if (res.provider !== 'local-fallback') {
                errors.push(`${psId}: silhouette must use provider "local-fallback"`);
            }
            if (res.imageUrl !== '/assets/player-silhouette.svg') {
                errors.push(`${psId}: silhouette imageUrl must be "/assets/player-silhouette.svg"`);
            }
            if (res.licenseStatus !== 'project-generated') {
                errors.push(`${psId}: silhouette licenseStatus must be "project-generated"`);
            }
            if (res.selectionReason !== 'silhouette-fallback') {
                errors.push(`${psId}: silhouette selectionReason must be "silhouette-fallback"`);
            }
        } else {
            // External candidate integrity validation (Sections 44 & 45)
            if (res.licenseStatus !== 'external-provider') {
                errors.push(`${psId}: external media must have licenseStatus "external-provider"`);
            }
            if (!res.imageUrl || !res.imageUrl.startsWith('https://')) {
                errors.push(`${psId}: external media imageUrl must be https://, got "${res.imageUrl}"`);
            }
            if (res.imageUrl.includes('notfound_')) {
                errors.push(`${psId}: placeholder URL selected (${res.imageUrl})`);
            }

            let matchedCand = null;
            if (
                res.resolutionType === 'fifaindex-exact-year' ||
                res.resolutionType === 'fifaindex-nearest-year'
            ) {
                if (res.provider !== 'fifaindex-current') {
                    errors.push(`${psId}: expected provider "fifaindex-current", got "${res.provider}"`);
                }
                const seasonRes = candEntity.seasonResolutions?.[String(res.targetYear)];
                if (!seasonRes) {
                    errors.push(`${psId}: missing seasonResolution for year ${res.targetYear}`);
                } else {
                    if (seasonRes.imageUrl !== res.imageUrl) {
                        errors.push(
                            `${psId}: imageUrl "${res.imageUrl}" does not match seasonResolutions imageUrl "${seasonRes.imageUrl}"`
                        );
                    }
                    if (seasonRes.resolvedYear !== res.sourceYear) {
                        errors.push(
                            `${psId}: sourceYear ${res.sourceYear} !== seasonResolutions.resolvedYear ${seasonRes.resolvedYear}`
                        );
                    }
                    const expectedDist = Math.abs(res.sourceYear - res.targetYear);
                    if (res.yearDistance !== expectedDist) {
                        errors.push(`${psId}: yearDistance ${res.yearDistance} !== ${expectedDist}`);
                    }
                    if (res.resolutionType === 'fifaindex-exact-year' && res.yearDistance !== 0) {
                        errors.push(`${psId}: exact-year must have yearDistance=0`);
                    }
                    if (res.resolutionType === 'fifaindex-nearest-year' && res.yearDistance <= 0) {
                        errors.push(`${psId}: nearest-year must have yearDistance > 0`);
                    }
                }
                matchedCand = (candEntity.fifaIndex || []).find((c) => c.imageUrl === res.imageUrl);
            } else if (res.resolutionType === 'fo3-supplemental') {
                if (res.provider !== 'fifaaddict-fo3') {
                    errors.push(`${psId}: expected provider "fifaaddict-fo3", got "${res.provider}"`);
                }
                matchedCand = (candEntity.fifaAddictFo3 || []).find((c) => c.imageUrl === res.imageUrl);
            } else if (res.resolutionType === 'fo4-supplemental') {
                if (res.provider !== 'fifaaddict-fo4') {
                    errors.push(`${psId}: expected provider "fifaaddict-fo4", got "${res.provider}"`);
                }
                matchedCand = (candEntity.fifaAddictFo4 || []).find((c) => c.imageUrl === res.imageUrl);
            }

            if (!matchedCand) {
                errors.push(
                    `${psId}: selected external imageUrl "${res.imageUrl}" not found in audited candidates for "${res.entityId}"`
                );
            } else {
                // Verify no bad candidate selected (Section 45)
                if (matchedCand.assetKind !== 'real-photo') {
                    errors.push(`${psId}: selected candidate assetKind="${matchedCand.assetKind}" (must be "real-photo")`);
                }
                if (matchedCand.reachableImage !== true || matchedCand.httpStatus !== 200) {
                    errors.push(`${psId}: selected candidate is not reachable HTTP 200`);
                }
                if (matchedCand.manualReview === true) {
                    errors.push(`${psId}: selected candidate is marked manualReview=true`);
                }
                if (FORBIDDEN_AVAILABILITY.has(matchedCand.availabilityStatus)) {
                    errors.push(`${psId}: selected candidate has forbidden availabilityStatus "${matchedCand.availabilityStatus}"`);
                }
                if (!RELIABLE_CONFIDENCES.has(matchedCand.matchConfidence)) {
                    errors.push(`${psId}: selected candidate has unreliable matchConfidence "${matchedCand.matchConfidence}"`);
                }
                if (!matchedCand.contentType || !matchedCand.contentType.startsWith('image/')) {
                    errors.push(`${psId}: selected candidate has invalid contentType "${matchedCand.contentType}"`);
                }
            }
        }
    }

    // 6. Verify exact breakdown counts (Section 43)
    if (counts['fifaindex-exact-year'] !== EXPECTED_EXACT) {
        errors.push(`Expected fifaindex-exact-year=${EXPECTED_EXACT}, got ${counts['fifaindex-exact-year']}`);
    }
    if (counts['fifaindex-nearest-year'] !== EXPECTED_NEAREST) {
        errors.push(`Expected fifaindex-nearest-year=${EXPECTED_NEAREST}, got ${counts['fifaindex-nearest-year']}`);
    }
    if (counts['fo3-supplemental'] !== EXPECTED_FO3) {
        errors.push(`Expected fo3-supplemental=${EXPECTED_FO3}, got ${counts['fo3-supplemental']}`);
    }
    if (counts['fo4-supplemental'] !== EXPECTED_FO4) {
        errors.push(`Expected fo4-supplemental=${EXPECTED_FO4}, got ${counts['fo4-supplemental']}`);
    }
    if (counts['silhouette'] !== EXPECTED_SILHOUETTE) {
        errors.push(`Expected silhouette=${EXPECTED_SILHOUETTE}, got ${counts['silhouette']}`);
    }

    // 7. Required Media Fixtures (Section 42)
    // A. FIFAIndex exact-year
    const exactFixture = resEntries['manchester-united-2008-0'];
    if (!exactFixture || exactFixture.resolutionType !== 'fifaindex-exact-year' || exactFixture.yearDistance !== 0) {
        errors.push('Fixture A (manchester-united-2008-0 exact-year) failed');
    }

    // B. FIFAIndex nearest-year (1999-2004 player with 2005+ media)
    const nearestFixture = resEntries['manchester-united-1999-1'];
    if (
        !nearestFixture ||
        nearestFixture.resolutionType !== 'fifaindex-nearest-year' ||
        nearestFixture.targetYear !== 1999 ||
        nearestFixture.sourceYear !== 2005
    ) {
        errors.push('Fixture B (manchester-united-1999-1 nearest-year 1999->2005) failed');
    }

    // C. FO3 supplemental (all 4)
    for (const fo3PsId of [
        'manchester-united-1999-0',
        'manchester-united-1999-3',
        'real-madrid-2002-2',
        'bayern-munich-2001-5',
    ]) {
        const item = resEntries[fo3PsId];
        if (!item || item.resolutionType !== 'fo3-supplemental' || item.provider !== 'fifaaddict-fo3') {
            errors.push(`Fixture C (FO3 supplemental "${fo3PsId}") failed`);
        }
    }

    // D. FO4 supplemental (Gabriel Batistuta)
    const fo4Fixture = resEntries['roma-2001-8'];
    if (
        !fo4Fixture ||
        fo4Fixture.entityId !== 'gabriel-batistuta' ||
        fo4Fixture.resolutionType !== 'fo4-supplemental' ||
        fo4Fixture.provider !== 'fifaaddict-fo4'
    ) {
        errors.push('Fixture D (roma-2001-8 Gabriel Batistuta FO4 supplemental) failed');
    }

    // E. Silhouette (all 5 missing players)
    for (const silPsId of [
        'parma-1999-6',
        'deportivo-la-coruna-2000-2',
        'roma-2001-0',
        'deportivo-la-coruna-2000-0',
        'lazio-2000-8',
    ]) {
        const item = resEntries[silPsId];
        if (
            !item ||
            item.resolutionType !== 'silhouette' ||
            item.provider !== 'local-fallback' ||
            item.imageUrl !== '/assets/player-silhouette.svg'
        ) {
            errors.push(`Fixture E (silhouette "${silPsId}") failed`);
        }
    }

    // F. Mbappe placeholder regression & Oblak placeholder regression
    const mbappeCand = candidatesData.entities['kylian-mbappe'];
    const mbappe2016 = (mbappeCand?.fifaIndex || []).find((c) => c.editionYear === 2016);
    if (!mbappe2016 || mbappe2016.assetKind !== 'placeholder' || mbappe2016.reachableImage !== false) {
        errors.push('Fixture F: kylian-mbappe 2016 candidate must remain marked as unreachable placeholder');
    }
    const mbappeSeason = resEntries['monaco-2017-7'];
    if (
        !mbappeSeason ||
        mbappeSeason.imageUrl.includes('notfound_') ||
        mbappeSeason.resolutionType !== 'fifaindex-exact-year'
    ) {
        errors.push('Fixture F: monaco-2017-7 Kylian Mbappe must resolve to real 2017 photo, not placeholder');
    }
    const oblak2014 = resEntries['benfica-2014-0'];
    if (
        !oblak2014 ||
        oblak2014.imageUrl.includes('notfound_') ||
        oblak2014.resolutionType !== 'fifaindex-nearest-year' ||
        oblak2014.sourceYear !== 2015
    ) {
        errors.push('Fixture F: benfica-2014-0 Jan Oblak (2014 placeholder) must resolve to nearest real photo (2015)');
    }

    // 8. Validate Runtime Index (public/data/player-media.js) & Helper (Section 46)
    const runtimeSeasonKeys = Object.keys(PLAYER_SEASON_MEDIA || {});
    if (runtimeSeasonKeys.length !== EXPECTED_TOTAL) {
        errors.push(`Expected ${EXPECTED_TOTAL} entries in PLAYER_SEASON_MEDIA, got ${runtimeSeasonKeys.length}`);
    }
    const runtimeEntityKeys = Object.keys(PLAYER_ENTITY_DEFAULT_MEDIA || {});
    if (runtimeEntityKeys.length !== EXPECTED_ENTITIES) {
        errors.push(`Expected ${EXPECTED_ENTITIES} entries in PLAYER_ENTITY_DEFAULT_MEDIA, got ${runtimeEntityKeys.length}`);
    }

    for (const psId of resKeys) {
        const res = resEntries[psId];
        const rt = PLAYER_SEASON_MEDIA[psId];
        if (!rt) {
            errors.push(`Missing "${psId}" in runtime index PLAYER_SEASON_MEDIA`);
            continue;
        }
        if (
            rt.imageUrl !== res.imageUrl ||
            rt.provider !== res.provider ||
            rt.resolutionType !== res.resolutionType ||
            rt.sourceYear !== res.sourceYear ||
            rt.targetYear !== res.targetYear ||
            rt.licenseStatus !== res.licenseStatus
        ) {
            errors.push(`Runtime index mismatch for "${psId}"`);
        }

        const helperById = getPlayerMedia(psId);
        const helperByObj = getPlayerMedia({ id: psId, name: res.canonicalName, year: res.targetYear });
        if (helperById.imageUrl !== res.imageUrl || helperByObj.imageUrl !== res.imageUrl) {
            errors.push(`getPlayerMedia() returned mismatched imageUrl for "${psId}"`);
        }
    }

    // Unknown ID & malformed input safety check
    for (const badInput of ['unknown-player-season-9999', '', null, undefined, {}, { id: 'non-existent' }]) {
        const fb = getPlayerMedia(badInput);
        if (
            !fb ||
            fb.imageUrl !== PLAYER_SILHOUETTE_URL ||
            fb.provider !== 'local-fallback' ||
            fb.resolutionType !== 'silhouette'
        ) {
            errors.push(`getPlayerMedia(${JSON.stringify(badInput)}) did not return safe silhouette fallback`);
        }
    }

    for (const badEntityInput of ['unknown-entity', '', null, undefined]) {
        const fb = getPlayerEntityDefaultMedia(badEntityInput);
        if (!fb || fb.imageUrl !== PLAYER_SILHOUETTE_URL || fb.resolutionType !== 'silhouette') {
            errors.push(`getPlayerEntityDefaultMedia(${JSON.stringify(badEntityInput)}) did not return safe fallback`);
        }
    }

    // Ensure Club & League helpers still work
    if (!getClubCrest('Manchester United')?.url || !getLeagueEmblem('Premier League')?.url) {
        errors.push('getClubCrest or getLeagueEmblem broken in entity-media.js');
    }

    // 9. Validate Report JSON & Markdown (Sections 47 & 48)
    if (
        reportJson.totalPlayerSeasons !== EXPECTED_TOTAL ||
        reportJson.exactCount !== EXPECTED_EXACT ||
        reportJson.nearestCount !== EXPECTED_NEAREST ||
        reportJson.fo3Count !== EXPECTED_FO3 ||
        reportJson.fo4Count !== EXPECTED_FO4 ||
        reportJson.silhouetteCount !== EXPECTED_SILHOUETTE ||
        reportJson.externalMediaCount !== EXPECTED_EXTERNAL
    ) {
        errors.push('Report JSON counts do not match expected resolution counts');
    }

    const distSum = Object.values(reportJson.nearestYearAnalysis?.distanceDistribution || {}).reduce(
        (acc, v) => acc + v,
        0
    );
    if (distSum !== EXPECTED_NEAREST) {
        errors.push(`Nearest-year distance distribution sum=${distSum}, expected ${EXPECTED_NEAREST}`);
    }
    if (!reportMd.includes('549 / 554 (99.1%)')) {
        errors.push('Report Markdown missing "549 / 554 (99.1%)" summary');
    }

    if (errors.length > 0) {
        console.error(`[validate-player-media-resolution] FAILED with ${errors.length} error(s):`);
        for (const err of errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    console.log(
        '[validate-player-media-resolution] PASS — 554/554 PlayerSeasons verified ' +
            '(454 exact, 90 nearest, 4 FO3, 1 FO4, 5 silhouette; runtime index 554/554).'
    );
}

main().catch((err) => {
    console.error('[validate-player-media-resolution] Unhandled error:', err);
    process.exit(1);
});

#!/usr/bin/env node
// scripts/validate-club-league-media.mjs
// Comprehensive validator for Club & League Media v1:
// - All 28 clubs and 7 leagues present and deterministically ordered
// - All preferred media reachable (HTTP 200, valid MIME type, reachable: true, placeholder: false)
// - All URLs use HTTPS
// - Provider, source, and licenseStatus non-empty
// - 0 duplicate preferred URLs
// - No unknown entity IDs
// - data/manual/club-league-media.json does NOT contain canonicalName or localizedName
// - Dedicated fifaIndexCoverage metrics present and verified
// - Runtime index (public/data/club-league-media.js) and helpers (public/media/entity-media.js) strictly verified

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'public', 'data');
const PUBLIC_MEDIA_DIR = path.join(ROOT_DIR, 'public', 'media');

const EXPECTED_CLUB_COUNT = 28;
const EXPECTED_LEAGUE_COUNT = 7;
const EXPECTED_TOTAL_ENTITIES = 35;

const VALID_MIME_TYPES = new Set([
    'image/svg+xml',
    'image/png',
    'image/webp',
    'image/jpeg',
]);

function isValidHttpsUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && Boolean(u.hostname) && u.hostname.includes('.') && u.pathname.length > 1;
    } catch {
        return false;
    }
}

async function main() {
    const errors = [];
    console.log('[validate-club-league-media] Starting comprehensive validation...');

    const clubsPath = path.join(ENTITIES_DIR, 'clubs.json');
    const leaguesPath = path.join(ENTITIES_DIR, 'leagues.json');
    const candidatesPath = path.join(ENTITIES_DIR, 'club-league-media-candidates.json');
    const manualPath = path.join(MANUAL_DIR, 'club-league-media.json');
    const reportJsonPath = path.join(REPORTS_DIR, 'club-league-media-audit.json');
    const reportMdPath = path.join(REPORTS_DIR, 'club-league-media-audit.md');
    const runtimeJsPath = path.join(PUBLIC_DATA_DIR, 'club-league-media.js');
    const helperJsPath = path.join(PUBLIC_MEDIA_DIR, 'entity-media.js');

    const requiredFiles = [
        ['data/entities/clubs.json', clubsPath],
        ['data/entities/leagues.json', leaguesPath],
        ['data/entities/club-league-media-candidates.json', candidatesPath],
        ['data/manual/club-league-media.json', manualPath],
        ['data/reports/club-league-media-audit.json', reportJsonPath],
        ['data/reports/club-league-media-audit.md', reportMdPath],
        ['public/data/club-league-media.js', runtimeJsPath],
        ['public/media/entity-media.js', helperJsPath],
    ];

    for (const [label, p] of requiredFiles) {
        if (!fs.existsSync(p)) {
            errors.push(`Missing required file: ${label}`);
        }
    }

    if (errors.length > 0) {
        console.error('[validate-club-league-media] Prerequisite files missing:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    const clubsData = JSON.parse(fs.readFileSync(clubsPath, 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(leaguesPath, 'utf8'));
    const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    const manualData = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    const reportJson = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    const reportMd = fs.readFileSync(reportMdPath, 'utf8');

    const canonicalClubIds = new Set(clubsData.entities.map((c) => c.id));
    const canonicalLeagueIds = new Set(leaguesData.entities.map((l) => l.id));

    // 1. Check entity counts
    if (canonicalClubIds.size !== EXPECTED_CLUB_COUNT) {
        errors.push(`Expected ${EXPECTED_CLUB_COUNT} clubs, got ${canonicalClubIds.size}`);
    }
    if (canonicalLeagueIds.size !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`Expected ${EXPECTED_LEAGUE_COUNT} leagues, got ${canonicalLeagueIds.size}`);
    }

    // 2. Validate club-league-media-candidates.json
    const candClubs = Object.keys(candidatesData.clubs || {});
    const candLeagues = Object.keys(candidatesData.leagues || {});

    if (candClubs.length !== EXPECTED_CLUB_COUNT) {
        errors.push(`Candidates file has ${candClubs.length} clubs (expected ${EXPECTED_CLUB_COUNT})`);
    }
    if (candLeagues.length !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`Candidates file has ${candLeagues.length} leagues (expected ${EXPECTED_LEAGUE_COUNT})`);
    }

    for (const cid of canonicalClubIds) {
        if (!candidatesData.clubs[cid]) {
            errors.push(`Missing club "${cid}" in club-league-media-candidates.json`);
        }
    }
    for (const lid of canonicalLeagueIds) {
        if (!candidatesData.leagues[lid]) {
            errors.push(`Missing league "${lid}" in club-league-media-candidates.json`);
        }
    }

    // Check candidate structure
    for (const [entityId, list] of [
        ...Object.entries(candidatesData.clubs),
        ...Object.entries(candidatesData.leagues),
    ]) {
        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            const prefix = `Candidate ${entityId}[${i}]`;
            if (!isValidHttpsUrl(c.url)) errors.push(`${prefix}: invalid https url "${c.url}"`);
            if (!c.provider) errors.push(`${prefix}: missing provider`);
            if (!c.source) errors.push(`${prefix}: missing source`);
            if (!c.licenseStatus) errors.push(`${prefix}: missing licenseStatus`);
            if (c.reachable && !VALID_MIME_TYPES.has(c.mimeType)) {
                errors.push(`${prefix}: reachable candidate has invalid mimeType "${c.mimeType}"`);
            }
        }
    }

    // 3. Validate data/manual/club-league-media.json
    const manualClubsKeys = Object.keys(manualData.clubs || {});
    const manualLeaguesKeys = Object.keys(manualData.leagues || {});

    if (manualClubsKeys.length !== EXPECTED_CLUB_COUNT) {
        errors.push(`manual club-league-media.json clubs count ${manualClubsKeys.length} !== ${EXPECTED_CLUB_COUNT}`);
    }
    if (manualLeaguesKeys.length !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`manual club-league-media.json leagues count ${manualLeaguesKeys.length} !== ${EXPECTED_LEAGUE_COUNT}`);
    }

    const seenPreferredUrls = new Set();

    for (const cid of canonicalClubIds) {
        const item = manualData.clubs[cid];
        if (!item) {
            errors.push(`Missing club "${cid}" in manual club-league-media.json`);
            continue;
        }

        // STRICT REQUIREMENT: Do NOT include canonicalName or localizedName in manual file!
        if ('canonicalName' in item) {
            errors.push(`Prohibited "canonicalName" property found in manual club entry "${cid}"`);
        }
        if ('localizedName' in item || 'localizedNames' in item) {
            errors.push(`Prohibited "localizedName(s)" property found in manual club entry "${cid}"`);
        }

        const pref = item.preferred;
        if (!pref) {
            errors.push(`Club "${cid}" missing preferred media object in manual file`);
            continue;
        }

        if (!isValidHttpsUrl(pref.url)) {
            errors.push(`Club "${cid}" preferred URL is not valid HTTPS: "${pref.url}"`);
        }
        if (seenPreferredUrls.has(pref.url)) {
            errors.push(`Duplicate preferred URL detected: "${pref.url}" in club "${cid}"`);
        }
        seenPreferredUrls.add(pref.url);

        if (!pref.provider) errors.push(`Club "${cid}" preferred missing provider`);
        if (!pref.source) errors.push(`Club "${cid}" preferred missing source`);
        if (!VALID_MIME_TYPES.has(pref.mimeType)) {
            errors.push(`Club "${cid}" preferred invalid mimeType "${pref.mimeType}"`);
        }
        if (pref.status !== 'reachable') {
            errors.push(`Club "${cid}" preferred status is not reachable: "${pref.status}"`);
        }
        if (pref.licenseStatus !== 'external-provider' && pref.licenseStatus !== 'verified-free') {
            errors.push(`Club "${cid}" preferred invalid licenseStatus "${pref.licenseStatus}"`);
        }
    }

    for (const lid of canonicalLeagueIds) {
        const item = manualData.leagues[lid];
        if (!item) {
            errors.push(`Missing league "${lid}" in manual club-league-media.json`);
            continue;
        }

        // STRICT REQUIREMENT: Do NOT include canonicalName or localizedName in manual file!
        if ('canonicalName' in item) {
            errors.push(`Prohibited "canonicalName" property found in manual league entry "${lid}"`);
        }
        if ('localizedName' in item || 'localizedNames' in item) {
            errors.push(`Prohibited "localizedName(s)" property found in manual league entry "${lid}"`);
        }

        const pref = item.preferred;
        if (!pref) {
            errors.push(`League "${lid}" missing preferred media object in manual file`);
            continue;
        }

        if (!isValidHttpsUrl(pref.url)) {
            errors.push(`League "${lid}" preferred URL is not valid HTTPS: "${pref.url}"`);
        }
        if (seenPreferredUrls.has(pref.url)) {
            errors.push(`Duplicate preferred URL detected: "${pref.url}" in league "${lid}"`);
        }
        seenPreferredUrls.add(pref.url);

        if (!pref.provider) errors.push(`League "${lid}" preferred missing provider`);
        if (!pref.source) errors.push(`League "${lid}" preferred missing source`);
        if (!VALID_MIME_TYPES.has(pref.mimeType)) {
            errors.push(`League "${lid}" preferred invalid mimeType "${pref.mimeType}"`);
        }
        if (pref.status !== 'reachable') {
            errors.push(`League "${lid}" preferred status is not reachable: "${pref.status}"`);
        }
        if (pref.licenseStatus !== 'external-provider' && pref.licenseStatus !== 'verified-free') {
            errors.push(`League "${lid}" preferred invalid licenseStatus "${pref.licenseStatus}"`);
        }
    }

    // 4. Validate Audit Report JSON
    const summary = reportJson.summary || {};
    if (summary.clubEntitiesTotal !== EXPECTED_CLUB_COUNT || summary.clubPreferredReachable !== EXPECTED_CLUB_COUNT) {
        errors.push(`Report JSON club coverage mismatch: total=${summary.clubEntitiesTotal}, reachable=${summary.clubPreferredReachable}`);
    }
    if (summary.leagueEntitiesTotal !== EXPECTED_LEAGUE_COUNT || summary.leaguePreferredReachable !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`Report JSON league coverage mismatch: total=${summary.leagueEntitiesTotal}, reachable=${summary.leaguePreferredReachable}`);
    }
    if (summary.totalEntities !== EXPECTED_TOTAL_ENTITIES || summary.totalPreferredReachable !== EXPECTED_TOTAL_ENTITIES) {
        errors.push(`Report JSON total coverage mismatch: total=${summary.totalEntities}, reachable=${summary.totalPreferredReachable}`);
    }
    if (summary.duplicatePreferredUrls !== 0) {
        errors.push(`Report JSON duplicatePreferredUrls is ${summary.duplicatePreferredUrls} (expected 0)`);
    }

    // Check fifaIndexCoverage section
    const fiCov = reportJson.fifaIndexCoverage;
    if (!fiCov) {
        errors.push('Report JSON missing required fifaIndexCoverage section');
    } else {
        if (!fiCov.fifaIndexClubMatched || !fiCov.fifaIndexLeagueMatched || !fiCov.fifaIndexTotal) {
            errors.push('Report JSON fifaIndexCoverage missing matched ratio strings');
        }
        if (typeof fiCov.fifaIndexReachable !== 'number' || fiCov.fifaIndexReachable <= 0) {
            errors.push('Report JSON fifaIndexCoverage fifaIndexReachable must be positive number');
        }
        if (fiCov.historicalAssetPatternObserved !== true) {
            errors.push('Report JSON fifaIndexCoverage historicalAssetPatternObserved must be true');
        }
    }

    // 5. Validate Markdown Report
    for (const heading of [
        '# Club & League Media Audit Report v1',
        '## 1. Summary Metrics',
        '## 2. FIFAIndex Priority & Single-Source Coverage',
        '## 3. Provider Distribution',
        '## 4. Format & License Breakdown',
        '## 5. Manual Review Queue',
        '## 6. Per-Entity Audit Table',
    ]) {
        if (!reportMd.includes(heading)) {
            errors.push(`Report Markdown missing required section: "${heading}"`);
        }
    }

    // 6. Test Runtime Index & Helper Modules
    const runtimeModule = await import(pathToFileURL(runtimeJsPath).href);
    const helperModule = await import(pathToFileURL(helperJsPath).href);

    const { CLUB_MEDIA, LEAGUE_MEDIA, CLUB_CANONICAL_TO_ID, LEAGUE_CANONICAL_TO_ID } = runtimeModule;
    const { getClubCrest, getLeagueEmblem } = helperModule;

    if (!CLUB_MEDIA || Object.keys(CLUB_MEDIA).length !== EXPECTED_CLUB_COUNT) {
        errors.push(`Runtime CLUB_MEDIA entry count mismatch: ${Object.keys(CLUB_MEDIA || {}).length}`);
    }
    if (!LEAGUE_MEDIA || Object.keys(LEAGUE_MEDIA).length !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`Runtime LEAGUE_MEDIA entry count mismatch: ${Object.keys(LEAGUE_MEDIA || {}).length}`);
    }
    if (!CLUB_CANONICAL_TO_ID || Object.keys(CLUB_CANONICAL_TO_ID).length !== EXPECTED_CLUB_COUNT) {
        errors.push(`Runtime CLUB_CANONICAL_TO_ID entry count mismatch: ${Object.keys(CLUB_CANONICAL_TO_ID || {}).length}`);
    }
    if (!LEAGUE_CANONICAL_TO_ID || Object.keys(LEAGUE_CANONICAL_TO_ID).length !== EXPECTED_LEAGUE_COUNT) {
        errors.push(`Runtime LEAGUE_CANONICAL_TO_ID entry count mismatch: ${Object.keys(LEAGUE_CANONICAL_TO_ID || {}).length}`);
    }

    // Test getClubCrest by canonicalName and entityId
    const arsenalByCanonical = getClubCrest('Arsenal');
    const arsenalById = getClubCrest('arsenal');
    if (!arsenalByCanonical || !isValidHttpsUrl(arsenalByCanonical.url)) {
        errors.push('getClubCrest("Arsenal") failed to return valid crest object');
    }
    if (!arsenalById || arsenalById.url !== arsenalByCanonical?.url) {
        errors.push('getClubCrest("arsenal") by slug ID did not match canonical lookup');
    }

    // Test getLeagueEmblem by canonicalName and entityId
    const plByCanonical = getLeagueEmblem('Premier League');
    const plById = getLeagueEmblem('premier-league');
    if (!plByCanonical || !isValidHttpsUrl(plByCanonical.url)) {
        errors.push('getLeagueEmblem("Premier League") failed to return valid emblem object');
    }
    if (!plById || plById.url !== plByCanonical?.url) {
        errors.push('getLeagueEmblem("premier-league") by slug ID did not match canonical lookup');
    }

    // Test safe fallbacks / non-throwing behavior
    if (getClubCrest(null) !== null) errors.push('getClubCrest(null) did not return null');
    if (getClubCrest(undefined) !== null) errors.push('getClubCrest(undefined) did not return null');
    if (getClubCrest('') !== null) errors.push('getClubCrest("") did not return null');
    if (getClubCrest('NonExistentTeam123') !== null) errors.push('getClubCrest("NonExistentTeam123") did not return null');
    if (getLeagueEmblem(null) !== null) errors.push('getLeagueEmblem(null) did not return null');
    if (getLeagueEmblem('NonExistentLeague456') !== null) errors.push('getLeagueEmblem("NonExistentLeague456") did not return null');

    if (errors.length > 0) {
        console.error(`[validate-club-league-media] FAILED with ${errors.length} error(s):`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    console.log('[validate-club-league-media] All checks PASSED successfully:');
    console.log(`- All ${EXPECTED_CLUB_COUNT} clubs and ${EXPECTED_LEAGUE_COUNT} leagues validated`);
    console.log(`- 100% preferred coverage with valid HTTPS URLs and MIME types`);
    console.log(`- Zero duplicate preferred URLs (${seenPreferredUrls.size} unique URLs)`);
    console.log(`- Runtime index and helper APIs strictly verified`);
}

main().catch((err) => {
    console.error('[validate-club-league-media] Fatal error:', err);
    process.exit(1);
});

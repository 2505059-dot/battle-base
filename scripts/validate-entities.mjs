#!/usr/bin/env node
// scripts/validate-entities.mjs
// Comprehensive schema, identity, media URL, and integrity validator for:
// - data/entities/players.json
// - data/entities/clubs.json
// - data/entities/leagues.json
// - data/reports/entity-media-audit.json
// - data/reports/entity-media-audit.md
// - scripts/import-fifa.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const TEAM_SEASONS_JS = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');
const IMPORT_FIFA_MJS = path.join(ROOT_DIR, 'scripts', 'import-fifa.mjs');

const FORBIDDEN_GAMEPLAY_KEYS = [
    'overall',
    'attack',
    'creation',
    'defense',
    'physical',
    'goalkeeping',
    'positions',
];

function isValidHttpUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        if (!u.hostname || u.hostname.endsWith('NA') || !u.hostname.includes('.')) return false;
        if (!u.pathname || u.pathname === '/') return false;
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const errors = [];
    const warnings = [];

    // 0. Check existence of files
    const playersPath = path.join(ENTITIES_DIR, 'players.json');
    const clubsPath = path.join(ENTITIES_DIR, 'clubs.json');
    const leaguesPath = path.join(ENTITIES_DIR, 'leagues.json');
    const auditJsonPath = path.join(REPORTS_DIR, 'entity-media-audit.json');
    const auditMdPath = path.join(REPORTS_DIR, 'entity-media-audit.md');

    for (const [name, filePath] of [
        ['data/entities/players.json', playersPath],
        ['data/entities/clubs.json', clubsPath],
        ['data/entities/leagues.json', leaguesPath],
        ['data/reports/entity-media-audit.json', auditJsonPath],
        ['data/reports/entity-media-audit.md', auditMdPath],
    ]) {
        if (!fs.existsSync(filePath)) {
            errors.push(`Missing expected file: ${name}`);
        }
    }

    if (errors.length > 0) {
        console.error('[validate-entities] Prerequisite check failed:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    const clubsData = JSON.parse(fs.readFileSync(clubsPath, 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(leaguesPath, 'utf8'));
    const auditJsonData = JSON.parse(fs.readFileSync(auditJsonPath, 'utf8'));

    // Load canonical TEAM_SEASONS
    const tsModule = await import(pathToFileURL(TEAM_SEASONS_JS).href);
    const { TEAM_SEASONS } = tsModule;
    const allPlayerSeasons = TEAM_SEASONS.flatMap((ts) => ts.players);
    const expectedClubs = [...new Set(TEAM_SEASONS.map((ts) => ts.club))];
    const expectedLeagues = [...new Set(TEAM_SEASONS.map((ts) => ts.league))];

    // Assert 1: Unique entity IDs (418 players, 28 clubs, 7 leagues)
    if (playersData.entities.length !== 418 || playersData.totalEntities !== 418) {
        errors.push(
            `players.json entity count mismatch: expected 418, got entities=${playersData.entities.length}, totalEntities=${playersData.totalEntities}`
        );
    }
    const playerIds = new Set();
    for (const p of playersData.entities) {
        if (!p.id || typeof p.id !== 'string') {
            errors.push(`Player entity missing valid id: ${JSON.stringify(p)}`);
        } else if (playerIds.has(p.id)) {
            errors.push(`Duplicate player entity id: ${p.id}`);
        } else {
            playerIds.add(p.id);
        }
    }

    if (clubsData.entities.length !== 28 || clubsData.totalEntities !== 28) {
        errors.push(
            `clubs.json entity count mismatch: expected 28, got entities=${clubsData.entities.length}, totalEntities=${clubsData.totalEntities}`
        );
    }
    const clubIds = new Set();
    for (const c of clubsData.entities) {
        if (!c.id || typeof c.id !== 'string') {
            errors.push(`Club entity missing valid id: ${JSON.stringify(c)}`);
        } else if (clubIds.has(c.id)) {
            errors.push(`Duplicate club entity id: ${c.id}`);
        } else {
            clubIds.add(c.id);
        }
    }

    if (leaguesData.entities.length !== 7 || leaguesData.totalEntities !== 7) {
        errors.push(
            `leagues.json entity count mismatch: expected 7, got entities=${leaguesData.entities.length}, totalEntities=${leaguesData.totalEntities}`
        );
    }
    const leagueIds = new Set();
    for (const l of leaguesData.entities) {
        if (!l.id || typeof l.id !== 'string') {
            errors.push(`League entity missing valid id: ${JSON.stringify(l)}`);
        } else if (leagueIds.has(l.id)) {
            errors.push(`Duplicate league entity id: ${l.id}`);
        } else {
            leagueIds.add(l.id);
        }
    }

    // Assert 2: No duplicate playerSeason mappings; all 554 PlayerSeasons map to exactly 1 Player Entity
    if (allPlayerSeasons.length !== 554) {
        errors.push(`TEAM_SEASONS player count mismatch: expected 554, got ${allPlayerSeasons.length}`);
    }
    if (playersData.totalPlayerSeasons !== 554) {
        errors.push(`players.json totalPlayerSeasons mismatch: expected 554, got ${playersData.totalPlayerSeasons}`);
    }

    const expectedPsIds = new Set(allPlayerSeasons.map((ps) => ps.id));
    const mapPsKeys = Object.keys(playersData.playerSeasonMap || {});
    if (mapPsKeys.length !== 554) {
        errors.push(`players.json playerSeasonMap count mismatch: expected 554, got ${mapPsKeys.length}`);
    }

    for (const psId of expectedPsIds) {
        if (!playersData.playerSeasonMap[psId]) {
            errors.push(`playerSeasonMap missing entry for PlayerSeason ID: ${psId}`);
        }
    }

    const mappedEntitiesPsIds = new Set();
    for (const entity of playersData.entities) {
        if (!Array.isArray(entity.playerSeasonIds)) {
            errors.push(`Player entity ${entity.id} playerSeasonIds is not an array`);
            continue;
        }
        for (const psId of entity.playerSeasonIds) {
            if (!expectedPsIds.has(psId)) {
                errors.push(`Player entity ${entity.id} references unknown PlayerSeason ID: ${psId}`);
            }
            if (mappedEntitiesPsIds.has(psId)) {
                errors.push(`Duplicate PlayerSeason ID mapping in entities: ${psId}`);
            }
            mappedEntitiesPsIds.add(psId);

            if (playersData.playerSeasonMap[psId] !== entity.id) {
                errors.push(
                    `playerSeasonMap mismatch for ${psId}: map has "${playersData.playerSeasonMap[psId]}", entity has "${entity.id}"`
                );
            }
        }
    }
    if (mappedEntitiesPsIds.size !== 554) {
        errors.push(`Total PlayerSeason IDs mapped in entities: expected 554, got ${mappedEntitiesPsIds.size}`);
    }
    if (playersData.unresolvedCount !== 0) {
        errors.push(`players.json unresolvedCount is ${playersData.unresolvedCount}, expected 0`);
    }

    // Assert 3: 28 canonical clubs and 7 canonical leagues 100% represented
    const entityClubNames = new Set(clubsData.entities.map((c) => c.canonicalName));
    for (const club of expectedClubs) {
        if (!entityClubNames.has(club)) {
            errors.push(`Canonical club "${club}" not found in clubs.json entities`);
        }
        if (!clubsData.clubMap || !clubsData.clubMap[club]) {
            errors.push(`Canonical club "${club}" missing from clubs.json clubMap`);
        }
    }

    const entityLeagueNames = new Set(leaguesData.entities.map((l) => l.canonicalName));
    for (const league of expectedLeagues) {
        if (!entityLeagueNames.has(league)) {
            errors.push(`Canonical league "${league}" not found in leagues.json entities`);
        }
        if (!leaguesData.leagueMap || !leaguesData.leagueMap[league]) {
            errors.push(`Canonical league "${league}" missing from leagues.json leagueMap`);
        }
    }

    // Assert 4: External ID types valid
    for (const entity of playersData.entities) {
        if (!entity.externalIds || typeof entity.externalIds !== 'object') {
            errors.push(`Player ${entity.id} missing externalIds object`);
            continue;
        }
        const { sofifa, fifaIndex } = entity.externalIds;
        if (sofifa !== null && (!Number.isInteger(sofifa) || sofifa <= 0)) {
            errors.push(`Player ${entity.id} invalid sofifa ID: ${sofifa}`);
        }
        if (fifaIndex !== null && (!Number.isInteger(fifaIndex) || fifaIndex <= 0)) {
            errors.push(`Player ${entity.id} invalid fifaIndex ID: ${fifaIndex}`);
        }
        if ('externalId' in entity) {
            errors.push(`Player ${entity.id} contains prohibited generic "externalId" property`);
        }
    }

    for (const entity of [...clubsData.entities, ...leaguesData.entities]) {
        if (!entity.externalIds || typeof entity.externalIds !== 'object') {
            errors.push(`Entity ${entity.id} missing externalIds object`);
            continue;
        }
        const expectedKeys = ['footballData', 'theSportsDb', 'wikidata'];
        for (const k of expectedKeys) {
            if (!(k in entity.externalIds)) {
                errors.push(`Entity ${entity.id} externalIds missing required provider key "${k}"`);
            }
        }
        if ('externalId' in entity) {
            errors.push(`Entity ${entity.id} contains prohibited generic "externalId" property`);
        }
    }

    // Assert 5: No malformed URLs in players.json, clubs.json, or leagues.json
    for (const entity of playersData.entities) {
        if (entity.media) {
            if (entity.media.fifaIndexPageUrl !== null) {
                if (!isValidHttpUrl(entity.media.fifaIndexPageUrl)) {
                    errors.push(`Player ${entity.id} malformed fifaIndexPageUrl: "${entity.media.fifaIndexPageUrl}"`);
                }
            }
            if (Array.isArray(entity.media.fifaIndexPageUrls)) {
                for (const p of entity.media.fifaIndexPageUrls) {
                    if (!isValidHttpUrl(p.url)) {
                        errors.push(`Player ${entity.id} malformed entry in fifaIndexPageUrls: "${p.url}"`);
                    }
                }
            }
            if (Array.isArray(entity.media.fifaIndexHeadshotUrls)) {
                for (const u of entity.media.fifaIndexHeadshotUrls) {
                    if (!isValidHttpUrl(u)) {
                        errors.push(`Player ${entity.id} malformed URL in fifaIndexHeadshotUrls: "${u}"`);
                    }
                }
            }
            if (Array.isArray(entity.media.fifaIndexHeadshots)) {
                for (const h of entity.media.fifaIndexHeadshots) {
                    if (!isValidHttpUrl(h.url)) {
                        errors.push(`Player ${entity.id} malformed URL in fifaIndexHeadshots: "${h.url}"`);
                    }
                    if (h.pageUrl !== null && !isValidHttpUrl(h.pageUrl)) {
                        errors.push(`Player ${entity.id} malformed pageUrl in fifaIndexHeadshots: "${h.pageUrl}"`);
                    }
                }
            }
        }
    }

    for (const entity of clubsData.entities) {
        if (entity.media) {
            if (entity.media.crest !== null && !isValidHttpUrl(entity.media.crest)) {
                errors.push(`Club ${entity.id} malformed crest URL: "${entity.media.crest}"`);
            }
            if (Array.isArray(entity.media.crestCandidates)) {
                for (const c of entity.media.crestCandidates) {
                    if (!isValidHttpUrl(c.url)) {
                        errors.push(`Club ${entity.id} malformed crest candidate URL: "${c.url}"`);
                    }
                }
            }
        }
    }

    for (const entity of leaguesData.entities) {
        if (entity.media) {
            if (entity.media.emblem !== null && !isValidHttpUrl(entity.media.emblem)) {
                errors.push(`League ${entity.id} malformed emblem URL: "${entity.media.emblem}"`);
            }
            if (Array.isArray(entity.media.emblemCandidates)) {
                for (const c of entity.media.emblemCandidates) {
                    if (!isValidHttpUrl(c.url)) {
                        errors.push(`League ${entity.id} malformed emblem candidate URL: "${c.url}"`);
                    }
                }
            }
        }
    }

    // Assert 6: localizedNames.en exists and matches canonicalName; aliases object with en, zh-CN, ja arrays
    for (const entity of [...playersData.entities, ...clubsData.entities, ...leaguesData.entities]) {
        if (!entity.localizedNames || typeof entity.localizedNames !== 'object') {
            errors.push(`Entity ${entity.id} missing localizedNames object`);
        } else if (entity.localizedNames.en !== entity.canonicalName) {
            errors.push(
                `Entity ${entity.id} localizedNames.en ("${entity.localizedNames.en}") !== canonicalName ("${entity.canonicalName}")`
            );
        }

        if (!entity.aliases || typeof entity.aliases !== 'object') {
            errors.push(`Entity ${entity.id} missing aliases object`);
        } else {
            for (const lang of ['en', 'zh-CN', 'ja']) {
                if (!Array.isArray(entity.aliases[lang])) {
                    errors.push(`Entity ${entity.id} aliases["${lang}"] is not an array`);
                }
            }
        }
    }

    // Assert 7: No gameplay stats anywhere on any entity object
    for (const entity of [...playersData.entities, ...clubsData.entities, ...leaguesData.entities]) {
        for (const stat of FORBIDDEN_GAMEPLAY_KEYS) {
            if (stat in entity) {
                errors.push(`Entity ${entity.id} contains forbidden gameplay attribute: "${stat}"`);
            }
        }
    }

    // Assert 8: Check scripts/import-fifa.mjs
    if (fs.existsSync(IMPORT_FIFA_MJS)) {
        const importContent = fs.readFileSync(IMPORT_FIFA_MJS, 'utf8');
        if (importContent.includes('sofifaId: cleanOptionalString(row.player_id)')) {
            errors.push(
                'scripts/import-fifa.mjs incorrectly assigns row.player_id to sofifaId (legacy bug).'
            );
        }
        if (!importContent.includes('fifaIndexId: cleanOptionalString(row.player_id)')) {
            errors.push(
                'scripts/import-fifa.mjs does not assign row.player_id to fifaIndexId.'
            );
        }
    } else {
        errors.push(`scripts/import-fifa.mjs not found at ${IMPORT_FIFA_MJS}`);
    }

    // Report results
    if (errors.length > 0) {
        console.error(`[validate-entities] FAILED with ${errors.length} error(s):`);
        for (const err of errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    console.log('[validate-entities] All entity validation checks PASSED successfully:');
    console.log(`- 418 Player Entities validated (0 collisions, 0 unresolved)`);
    console.log(`- 554 PlayerSeasons mapped (100% 1-to-1 correspondence)`);
    console.log(`- 28 Club Entities and 7 League Entities validated`);
    console.log(`- External IDs, URL formats, localizedNames, and aliases strictly verified`);
    console.log(`- Zero gameplay stats present in entity models`);
    console.log(`- scripts/import-fifa.mjs correct and aligned`);
    process.exit(0);
}

main().catch((err) => {
    console.error('[validate-entities] Uncaught fatal error:', err);
    process.exit(1);
});

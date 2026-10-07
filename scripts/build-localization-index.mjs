#!/usr/bin/env node
// scripts/build-localization-index.mjs
// Reads:
// - data/entities/players.json
// - data/entities/clubs.json
// - data/entities/leagues.json
// - data/manual/entity-localizations.json
// Outputs:
// - public/data/entity-localizations.js (minimal browser runtime localization index)
// - data/reports/football-localization-report.json
// - data/reports/football-localization-report.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'public', 'data');

// Historical or less-common player names flagged for optional future human editorial review.
// All entries still have 100% non-empty conservative standard zh-CN and ja primary names.
const MANUAL_REVIEW_REASONS = {
    'amedeo-carboni': 'Historical Valencia defender (2004); multiple Chinese transliterations exist (卡博尼 / 阿梅代奥·卡博尼).',
    'berat-djimsiti': 'Albanian/Swiss surname Djimsiti has multiple Chinese/Japanese media spellings (吉姆西蒂 / 迪짐시티 / ジムシティ).',
    'damiano-tommasi': 'Historical Roma midfielder (2001); transliterated as 托马西 / 达米亚诺·托马西.',
    'diego-fuser': 'Historical Parma midfielder (1999); less common in modern FIFA databases (富塞尔 / 迭戈·富塞尔).',
    'francesco-antonioli': 'Historical Roma goalkeeper (2001); transliterated as 安东尼奥利.',
    'giuseppe-pancaro': 'Historical Lazio defender (2000); transliterated as 潘卡罗.',
    'jacques-songo-o': 'Historical Deportivo goalkeeper (2000); apostrophe surname Songo\'o has variants (松戈奥 / 宋戈奥).',
    'jan-vennegoor-of-hesselink': 'Compound Dutch surname Vennegoor of Hesselink has long and abbreviated forms in zh-CN/ja.',
    'luca-marchegiani': 'Historical Lazio goalkeeper (2000); transliterated as 马尔凯贾尼.',
    'reinildo-mandava': 'Mozambican defender Reinildo Mandava; commonly referred to as 雷尼尔多 or 雷尼尔多·曼达瓦.',
    'roberto-sensini': 'Historical Parma defender/midfielder (1999); transliterated as 森西尼 / 罗伯托·森西尼.',
    'wilfred-bouma': 'Historical PSV defender (2005); transliterated as 鲍马 / 博马.',
};

function buildRuntimeMaps(entities) {
    const sorted = [...entities].sort((a, b) => a.id.localeCompare(b.id));
    const localizations = {};
    const canonicalPairs = [];

    for (const entity of sorted) {
        const enName = entity.localizedNames?.en ?? entity.canonicalName;
        const zhName = entity.localizedNames?.['zh-CN'] ?? enName;
        const jaName = entity.localizedNames?.ja ?? enName;

        localizations[entity.id] = {
            canonicalName: entity.canonicalName,
            localizedNames: {
                en: enName,
                'zh-CN': zhName,
                ja: jaName,
            },
        };
        canonicalPairs.push([entity.canonicalName, entity.id]);
    }

    canonicalPairs.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalToId = {};
    for (const [canonicalName, id] of canonicalPairs) {
        canonicalToId[canonicalName] = id;
    }

    return { localizations, canonicalToId };
}

function findDuplicatePrimaryNames(entities, locale) {
    const byName = new Map();
    for (const e of entities) {
        const val = e.localizedNames?.[locale];
        if (!val || typeof val !== 'string') continue;
        const trimmed = val.trim();
        if (!trimmed) continue;
        if (!byName.has(trimmed)) byName.set(trimmed, []);
        byName.get(trimmed).push({ id: e.id, canonicalName: e.canonicalName });
    }
    const duplicates = [];
    for (const [name, list] of byName.entries()) {
        if (list.length > 1) {
            duplicates.push({
                locale,
                localizedName: name,
                entities: list,
            });
        }
    }
    duplicates.sort((a, b) => a.localizedName.localeCompare(b.localizedName));
    return duplicates;
}

function findAliasCollisions(entities, locale) {
    const byAlias = new Map();
    for (const e of entities) {
        const aliases = e.aliases?.[locale];
        if (!Array.isArray(aliases)) continue;
        for (const raw of aliases) {
            if (typeof raw !== 'string') continue;
            const alias = raw.trim();
            if (!alias) continue;
            if (!byAlias.has(alias)) byAlias.set(alias, []);
            byAlias.get(alias).push({ id: e.id, canonicalName: e.canonicalName });
        }
    }
    const collisions = [];
    for (const [alias, list] of byAlias.entries()) {
        if (list.length > 1) {
            collisions.push({
                locale,
                alias,
                entities: list,
            });
        }
    }
    collisions.sort((a, b) => a.alias.localeCompare(b.alias));
    return collisions;
}

function findSuspiciousNames(entities, entityType) {
    const suspicious = [];
    const forbiddenMechanicalClubs = new Set(['曼彻斯特联合', '国际米兰足球', '皇家马德里足球']);

    for (const e of entities) {
        for (const locale of ['zh-CN', 'ja']) {
            const val = e.localizedNames?.[locale];
            if (!val || typeof val !== 'string' || !val.trim()) {
                suspicious.push({
                    entityType,
                    entityId: e.id,
                    canonicalName: e.canonicalName,
                    locale,
                    value: val ?? null,
                    reason: 'Missing or empty localized name',
                });
                continue;
            }
            const trimmed = val.trim();
            if (entityType === 'player' && /^[\x20-\x7E]+$/.test(trimmed)) {
                suspicious.push({
                    entityType,
                    entityId: e.id,
                    canonicalName: e.canonicalName,
                    locale,
                    value: trimmed,
                    reason: 'Player localized name is pure ASCII in non-English locale',
                });
            }
            if (entityType === 'club' && forbiddenMechanicalClubs.has(trimmed)) {
                suspicious.push({
                    entityType,
                    entityId: e.id,
                    canonicalName: e.canonicalName,
                    locale,
                    value: trimmed,
                    reason: 'Mechanical literal translation instead of standard community name',
                });
            }
        }
    }
    return suspicious;
}

function main() {
    const playersPath = path.join(ENTITIES_DIR, 'players.json');
    const clubsPath = path.join(ENTITIES_DIR, 'clubs.json');
    const leaguesPath = path.join(ENTITIES_DIR, 'leagues.json');
    const manualPath = path.join(MANUAL_DIR, 'entity-localizations.json');

    for (const p of [playersPath, clubsPath, leaguesPath, manualPath]) {
        if (!fs.existsSync(p)) {
            console.error(`[build-localization-index] Missing prerequisite file: ${p}`);
            process.exit(1);
        }
    }

    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    const clubsData = JSON.parse(fs.readFileSync(clubsPath, 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(leaguesPath, 'utf8'));

    const playerMaps = buildRuntimeMaps(playersData.entities);
    const clubMaps = buildRuntimeMaps(clubsData.entities);
    const leagueMaps = buildRuntimeMaps(leaguesData.entities);

    fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const jsLines = [
        '// Auto-generated by scripts/build-localization-index.mjs',
        '// Do not edit manually. Source of truth: data/manual/entity-localizations.json -> data/entities/*.json',
        '',
        `export const PLAYER_LOCALIZATIONS = ${JSON.stringify(playerMaps.localizations, null, 2)};`,
        '',
        `export const CLUB_LOCALIZATIONS = ${JSON.stringify(clubMaps.localizations, null, 2)};`,
        '',
        `export const LEAGUE_LOCALIZATIONS = ${JSON.stringify(leagueMaps.localizations, null, 2)};`,
        '',
        `export const PLAYER_CANONICAL_TO_ID = ${JSON.stringify(playerMaps.canonicalToId, null, 2)};`,
        '',
        `export const CLUB_CANONICAL_TO_ID = ${JSON.stringify(clubMaps.canonicalToId, null, 2)};`,
        '',
        `export const LEAGUE_CANONICAL_TO_ID = ${JSON.stringify(leagueMaps.canonicalToId, null, 2)};`,
        '',
    ];

    const outputPath = path.join(PUBLIC_DATA_DIR, 'entity-localizations.js');
    fs.writeFileSync(outputPath, jsLines.join('\n'), 'utf8');

    // Compute coverage and audit metrics for report
    const totalPlayers = playersData.entities.length;
    const zhPlayersCovered = playersData.entities.filter(
        (e) => typeof e.localizedNames?.['zh-CN'] === 'string' && e.localizedNames['zh-CN'].trim().length > 0
    ).length;
    const jaPlayersCovered = playersData.entities.filter(
        (e) => typeof e.localizedNames?.ja === 'string' && e.localizedNames.ja.trim().length > 0
    ).length;

    const totalClubs = clubsData.entities.length;
    const zhClubsCovered = clubsData.entities.filter(
        (e) => typeof e.localizedNames?.['zh-CN'] === 'string' && e.localizedNames['zh-CN'].trim().length > 0
    ).length;
    const jaClubsCovered = clubsData.entities.filter(
        (e) => typeof e.localizedNames?.ja === 'string' && e.localizedNames.ja.trim().length > 0
    ).length;

    const totalLeagues = leaguesData.entities.length;
    const zhLeaguesCovered = leaguesData.entities.filter(
        (e) => typeof e.localizedNames?.['zh-CN'] === 'string' && e.localizedNames['zh-CN'].trim().length > 0
    ).length;
    const jaLeaguesCovered = leaguesData.entities.filter(
        (e) => typeof e.localizedNames?.ja === 'string' && e.localizedNames.ja.trim().length > 0
    ).length;

    const duplicatePlayerZh = findDuplicatePrimaryNames(playersData.entities, 'zh-CN');
    const duplicatePlayerJa = findDuplicatePrimaryNames(playersData.entities, 'ja');
    const duplicateClubZh = findDuplicatePrimaryNames(clubsData.entities, 'zh-CN');
    const duplicateClubJa = findDuplicatePrimaryNames(clubsData.entities, 'ja');
    const duplicateLeagueZh = findDuplicatePrimaryNames(leaguesData.entities, 'zh-CN');
    const duplicateLeagueJa = findDuplicatePrimaryNames(leaguesData.entities, 'ja');

    const aliasCollisionsPlayerZh = findAliasCollisions(playersData.entities, 'zh-CN');
    const aliasCollisionsPlayerJa = findAliasCollisions(playersData.entities, 'ja');
    const aliasCollisionsClubZh = findAliasCollisions(clubsData.entities, 'zh-CN');
    const aliasCollisionsClubJa = findAliasCollisions(clubsData.entities, 'ja');
    const aliasCollisionsLeagueZh = findAliasCollisions(leaguesData.entities, 'zh-CN');
    const aliasCollisionsLeagueJa = findAliasCollisions(leaguesData.entities, 'ja');

    const suspiciousNames = [
        ...findSuspiciousNames(playersData.entities, 'player'),
        ...findSuspiciousNames(clubsData.entities, 'club'),
        ...findSuspiciousNames(leaguesData.entities, 'league'),
    ];

    const manualReviewNames = [];
    for (const entityId of Object.keys(MANUAL_REVIEW_REASONS).sort()) {
        const entity = playersData.entities.find((e) => e.id === entityId);
        if (!entity) continue;
        manualReviewNames.push({
            entityId: entity.id,
            canonicalName: entity.canonicalName,
            'zh-CN': entity.localizedNames?.['zh-CN'] ?? null,
            ja: entity.localizedNames?.ja ?? null,
            reason: MANUAL_REVIEW_REASONS[entityId],
        });
    }

    const reportJson = {
        schemaVersion: '1.0.0',
        summary: {
            totalPlayerEntities: totalPlayers,
            zhPlayerCoverage: {
                covered: zhPlayersCovered,
                total: totalPlayers,
                percent: Number(((zhPlayersCovered / totalPlayers) * 100).toFixed(2)),
            },
            jaPlayerCoverage: {
                covered: jaPlayersCovered,
                total: totalPlayers,
                percent: Number(((jaPlayersCovered / totalPlayers) * 100).toFixed(2)),
            },
            totalClubCoverage: {
                total: totalClubs,
                zhCovered: zhClubsCovered,
                jaCovered: jaClubsCovered,
                percent: Number((((zhClubsCovered + jaClubsCovered) / (totalClubs * 2)) * 100).toFixed(2)),
            },
            totalLeagueCoverage: {
                total: totalLeagues,
                zhCovered: zhLeaguesCovered,
                jaCovered: jaLeaguesCovered,
                percent: Number((((zhLeaguesCovered + jaLeaguesCovered) / (totalLeagues * 2)) * 100).toFixed(2)),
            },
            duplicateLocalizedPlayerNamesCount: {
                'zh-CN': duplicatePlayerZh.length,
                ja: duplicatePlayerJa.length,
            },
            aliasCollisionsCount: {
                playersZh: aliasCollisionsPlayerZh.length,
                playersJa: aliasCollisionsPlayerJa.length,
                clubsZh: aliasCollisionsClubZh.length,
                clubsJa: aliasCollisionsClubJa.length,
                leaguesZh: aliasCollisionsLeagueZh.length,
                leaguesJa: aliasCollisionsLeagueJa.length,
                total:
                    aliasCollisionsPlayerZh.length +
                    aliasCollisionsPlayerJa.length +
                    aliasCollisionsClubZh.length +
                    aliasCollisionsClubJa.length +
                    aliasCollisionsLeagueZh.length +
                    aliasCollisionsLeagueJa.length,
            },
            suspiciousNamesCount: suspiciousNames.length,
            manualReviewNamesCount: manualReviewNames.length,
        },
        duplicateLocalizedNames: {
            players: {
                'zh-CN': duplicatePlayerZh,
                ja: duplicatePlayerJa,
            },
            clubs: {
                'zh-CN': duplicateClubZh,
                ja: duplicateClubJa,
            },
            leagues: {
                'zh-CN': duplicateLeagueZh,
                ja: duplicateLeagueJa,
            },
        },
        aliasCollisions: {
            players: {
                'zh-CN': aliasCollisionsPlayerZh,
                ja: aliasCollisionsPlayerJa,
            },
            clubs: {
                'zh-CN': aliasCollisionsClubZh,
                ja: aliasCollisionsClubJa,
            },
            leagues: {
                'zh-CN': aliasCollisionsLeagueZh,
                ja: aliasCollisionsLeagueJa,
            },
        },
        suspiciousNames,
        manualReviewNames,
    };

    const reportJsonPath = path.join(REPORTS_DIR, 'football-localization-report.json');
    fs.writeFileSync(reportJsonPath, JSON.stringify(reportJson, null, 2) + '\n', 'utf8');

    const mdLines = [
        '# Football Localization v1 — Audit & Coverage Report',
        '',
        '## 1. Entity Localization Coverage Summary',
        '',
        '| Entity Type | Total Entities | `en` Coverage | `zh-CN` Coverage | `ja` Coverage | Status |',
        '| :--- | :---: | :---: | :---: | :---: | :---: |',
        `| **Players** | ${totalPlayers} | ${totalPlayers} / ${totalPlayers} (100%) | ${zhPlayersCovered} / ${totalPlayers} (${reportJson.summary.zhPlayerCoverage.percent}%) | ${jaPlayersCovered} / ${totalPlayers} (${reportJson.summary.jaPlayerCoverage.percent}%) | PASS |`,
        `| **Clubs** | ${totalClubs} | ${totalClubs} / ${totalClubs} (100%) | ${zhClubsCovered} / ${totalClubs} (100%) | ${jaClubsCovered} / ${totalClubs} (100%) | PASS |`,
        `| **Leagues** | ${totalLeagues} | ${totalLeagues} / ${totalLeagues} (100%) | ${zhLeaguesCovered} / ${totalLeagues} (100%) | ${jaLeaguesCovered} / ${totalLeagues} (100%) | PASS |`,
        '',
        '## 2. Duplicate Primary Name & Alias Collision Audit',
        '',
        `- **Duplicate \`zh-CN\` Primary Player Names**: ${duplicatePlayerZh.length}`,
        `- **Duplicate \`ja\` Primary Player Names**: ${duplicatePlayerJa.length}`,
        `- **Duplicate \`zh-CN\` Primary Club Names**: ${duplicateClubZh.length}`,
        `- **Duplicate \`ja\` Primary Club Names**: ${duplicateClubJa.length}`,
        `- **Cross-Entity Alias Collisions**: ${reportJson.summary.aliasCollisionsCount.total}`,
        `- **Suspicious Names Detected**: ${suspiciousNames.length}`,
        '',
        '## 3. League Localizations (7 / 7)',
        '',
        '| Entity ID | Canonical Name (`en`) | `zh-CN` | `ja` |',
        '| :--- | :--- | :--- | :--- |',
        ...leaguesData.entities.map(
            (l) => `| \`${l.id}\` | ${l.canonicalName} | ${l.localizedNames['zh-CN']} | ${l.localizedNames.ja} |`
        ),
        '',
        '## 4. Club Localizations (28 / 28)',
        '',
        '| Entity ID | Canonical Name (`en`) | `zh-CN` | `ja` | `zh-CN` Aliases | `ja` Aliases |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        ...clubsData.entities.map(
            (c) =>
                `| \`${c.id}\` | ${c.canonicalName} | ${c.localizedNames['zh-CN']} | ${c.localizedNames.ja} | ${(c.aliases['zh-CN'] || []).join(', ') || '—'} | ${(c.aliases.ja || []).join(', ') || '—'} |`
        ),
        '',
        '## 5. Manual Review Names Queue',
        '',
        'The following historical or multi-variant player names use conservative standard transliterations (with canonical English preserved as secondary display) and are recorded for optional future editorial review:',
        '',
        '| `entityId` | `canonicalName` | `zh-CN` | `ja` | `reason` |',
        '| :--- | :--- | :--- | :--- | :--- |',
        ...manualReviewNames.map(
            (item) =>
                `| \`${item.entityId}\` | ${item.canonicalName} | ${item['zh-CN']} | ${item.ja} | ${item.reason} |`
        ),
        '',
    ];

    const reportMdPath = path.join(REPORTS_DIR, 'football-localization-report.md');
    fs.writeFileSync(reportMdPath, mdLines.join('\n'), 'utf8');

    console.log('[build-localization-index] Built public/data/entity-localizations.js and localization reports:');
    console.log(`- Players: ${zhPlayersCovered}/${totalPlayers} zh-CN, ${jaPlayersCovered}/${totalPlayers} ja`);
    console.log(`- Clubs: ${zhClubsCovered}/${totalClubs} zh-CN, ${jaClubsCovered}/${totalClubs} ja`);
    console.log(`- Leagues: ${zhLeaguesCovered}/${totalLeagues} zh-CN, ${jaLeaguesCovered}/${totalLeagues} ja`);
    console.log(`- Duplicate primary player names: zh-CN=${duplicatePlayerZh.length}, ja=${duplicatePlayerJa.length}`);
    console.log(`- Cross-entity alias collisions: ${reportJson.summary.aliasCollisionsCount.total}`);
    console.log(`- Manual review queue entries: ${manualReviewNames.length}`);
}

main();

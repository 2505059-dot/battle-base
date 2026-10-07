#!/usr/bin/env node
// scripts/validate-football-localization.mjs
// Comprehensive validator for Football Localization v1 (Sections 25, 33–37):
// 1. 418/418 Players, 28/28 Clubs, 7/7 Leagues non-empty en, zh-CN, ja localizations
// 2. Manual localization source ID integrity & deterministic sorting
// 3. Alias validation (arrays, non-empty strings, deduplicated, cross-entity collision warning)
// 4. Public localization index parity & zero gameplay/media leakage
// 5. Mandatory Regression Fixtures (Zidane, Real Madrid, Messi, Cristiano Ronaldo, 7 Leagues)
// 6. Display Fallback Regression (Unknown Test Player / Club / League)
// 7. Primary / Secondary Display Regression (en secondary === null, zh-CN/ja secondary === canonical)
// 8. Locale Independence Regression across en, zh-CN, and ja (Draft + Match Engine determinism)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const FORBIDDEN_KEYS = new Set([
    'overall',
    'attack',
    'creation',
    'defense',
    'physical',
    'goalkeeping',
    'positions',
    'media',
    'fifaIndexHeadshots',
    'crest',
    'emblem',
]);

function checkNoForbiddenKeys(obj, label, errors) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            checkNoForbiddenKeys(obj[i], `${label}[${i}]`, errors);
        }
        return;
    }
    for (const [k, v] of Object.entries(obj)) {
        if (FORBIDDEN_KEYS.has(k)) {
            errors.push(`Forbidden field "${k}" found in public localization index at ${label}`);
        }
        checkNoForbiddenKeys(v, `${label}.${k}`, errors);
    }
}

function validateAliasesForGroup(entities, groupLabel, errors, warnings) {
    for (const locale of ['en', 'zh-CN', 'ja']) {
        const aliasMap = new Map();
        for (const entity of entities) {
            const arr = entity.aliases?.[locale];
            if (!Array.isArray(arr)) {
                errors.push(`${groupLabel} "${entity.id}" aliases["${locale}"] is not an array`);
                continue;
            }
            const seenInEntity = new Set();
            const primary = entity.localizedNames?.[locale];
            for (let i = 0; i < arr.length; i++) {
                const item = arr[i];
                if (typeof item !== 'string' || item.trim().length === 0) {
                    errors.push(
                        `${groupLabel} "${entity.id}" aliases["${locale}"][${i}] must be a non-empty string`
                    );
                    continue;
                }
                const trimmed = item.trim();
                if (trimmed !== item) {
                    errors.push(
                        `${groupLabel} "${entity.id}" aliases["${locale}"][${i}] has untrimmed whitespace: "${item}"`
                    );
                }
                if (seenInEntity.has(trimmed)) {
                    errors.push(
                        `${groupLabel} "${entity.id}" has duplicate alias "${trimmed}" in locale "${locale}"`
                    );
                }
                seenInEntity.add(trimmed);
                if (primary && trimmed === primary.trim()) {
                    errors.push(
                        `${groupLabel} "${entity.id}" alias "${trimmed}" duplicates primary localizedName in "${locale}"`
                    );
                }
                if (!aliasMap.has(trimmed)) aliasMap.set(trimmed, []);
                aliasMap.get(trimmed).push(entity.id);
            }
        }

        for (const [alias, ids] of aliasMap.entries()) {
            if (ids.length > 1) {
                warnings.push(
                    `Cross-entity alias collision in ${groupLabel} (${locale}): "${alias}" shared by [${ids.join(', ')}]`
                );
            }
        }
    }
}

async function main() {
    const errors = [];
    const warnings = [];

    const manualPath = path.join(MANUAL_DIR, 'entity-localizations.json');
    const playersPath = path.join(ENTITIES_DIR, 'players.json');
    const clubsPath = path.join(ENTITIES_DIR, 'clubs.json');
    const leaguesPath = path.join(ENTITIES_DIR, 'leagues.json');
    const publicLocPath = path.join(PUBLIC_DIR, 'data', 'entity-localizations.js');
    const reportJsonPath = path.join(REPORTS_DIR, 'football-localization-report.json');
    const reportMdPath = path.join(REPORTS_DIR, 'football-localization-report.md');

    for (const [label, p] of [
        ['data/manual/entity-localizations.json', manualPath],
        ['data/entities/players.json', playersPath],
        ['data/entities/clubs.json', clubsPath],
        ['data/entities/leagues.json', leaguesPath],
        ['public/data/entity-localizations.js', publicLocPath],
        ['data/reports/football-localization-report.json', reportJsonPath],
        ['data/reports/football-localization-report.md', reportMdPath],
    ]) {
        if (!fs.existsSync(p)) {
            errors.push(`Missing required file: ${label}`);
        }
    }

    if (errors.length > 0) {
        console.error('[validate-football-localization] Missing prerequisite files:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }

    const manualData = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    const clubsData = JSON.parse(fs.readFileSync(clubsPath, 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(leaguesPath, 'utf8'));
    const reportData = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));

    const publicLocMod = await import(pathToFileURL(publicLocPath).href);
    const {
        PLAYER_LOCALIZATIONS,
        CLUB_LOCALIZATIONS,
        LEAGUE_LOCALIZATIONS,
        PLAYER_CANONICAL_TO_ID,
        CLUB_CANONICAL_TO_ID,
        LEAGUE_CANONICAL_TO_ID,
    } = publicLocMod;

    // 1. Validate counts and ID parity between manual source, entity JSONs, and public index
    const groups = [
        {
            name: 'players',
            expectedCount: 418,
            entities: playersData.entities,
            manualMap: manualData.players || {},
            publicMap: PLAYER_LOCALIZATIONS || {},
            publicCanonicalToId: PLAYER_CANONICAL_TO_ID || {},
        },
        {
            name: 'clubs',
            expectedCount: 28,
            entities: clubsData.entities,
            manualMap: manualData.clubs || {},
            publicMap: CLUB_LOCALIZATIONS || {},
            publicCanonicalToId: CLUB_CANONICAL_TO_ID || {},
        },
        {
            name: 'leagues',
            expectedCount: 7,
            entities: leaguesData.entities,
            manualMap: manualData.leagues || {},
            publicMap: LEAGUE_LOCALIZATIONS || {},
            publicCanonicalToId: LEAGUE_CANONICAL_TO_ID || {},
        },
    ];

    for (const grp of groups) {
        if (grp.entities.length !== grp.expectedCount) {
            errors.push(
                `${grp.name}: expected ${grp.expectedCount} entities, got ${grp.entities.length}`
            );
        }

        const entityIds = new Set(grp.entities.map((e) => e.id));
        const manualKeys = Object.keys(grp.manualMap);
        if (manualKeys.length !== grp.expectedCount) {
            errors.push(
                `manual.${grp.name}: expected ${grp.expectedCount} keys, got ${manualKeys.length}`
            );
        }

        const sortedManualKeys = [...manualKeys].sort((a, b) => a.localeCompare(b));
        for (let i = 0; i < manualKeys.length; i++) {
            if (manualKeys[i] !== sortedManualKeys[i]) {
                errors.push(
                    `manual.${grp.name} keys are not in deterministic alphabetical order at index ${i} ("${manualKeys[i]}")`
                );
                break;
            }
        }

        for (const k of manualKeys) {
            if (!entityIds.has(k)) {
                errors.push(`Unknown ${grp.name} ID in manual source: "${k}"`);
            }
            const mEntry = grp.manualMap[k];
            if ('en' in mEntry || 'canonicalName' in mEntry) {
                errors.push(
                    `manual.${grp.name}["${k}"] must not duplicate canonical English ("en" or "canonicalName")`
                );
            }
        }

        for (const entity of grp.entities) {
            const mEntry = grp.manualMap[entity.id];
            if (!mEntry) {
                errors.push(`Missing ${grp.name} ID in manual source: "${entity.id}"`);
                continue;
            }

            // Validate en, zh-CN, ja non-empty strings
            for (const locale of ['en', 'zh-CN', 'ja']) {
                const val = entity.localizedNames?.[locale];
                if (typeof val !== 'string' || val.trim().length === 0) {
                    errors.push(
                        `${grp.name} "${entity.id}" localizedNames["${locale}"] is null or empty`
                    );
                }
            }

            if (entity.localizedNames?.en !== entity.canonicalName) {
                errors.push(
                    `${grp.name} "${entity.id}" localizedNames.en ("${entity.localizedNames?.en}") !== canonicalName ("${entity.canonicalName}")`
                );
            }

            if (entity.localizedNames?.['zh-CN'] !== mEntry['zh-CN']) {
                errors.push(
                    `${grp.name} "${entity.id}" localizedNames["zh-CN"] ("${entity.localizedNames?.['zh-CN']}") !== manual ("${mEntry['zh-CN']}")`
                );
            }
            if (entity.localizedNames?.ja !== mEntry.ja) {
                errors.push(
                    `${grp.name} "${entity.id}" localizedNames.ja ("${entity.localizedNames?.ja}") !== manual ("${mEntry.ja}")`
                );
            }

            // Validate public index parity
            const pubEntry = grp.publicMap[entity.id];
            if (!pubEntry) {
                errors.push(`Missing ${grp.name} "${entity.id}" in public localization index`);
            } else {
                if (pubEntry.canonicalName !== entity.canonicalName) {
                    errors.push(
                        `Public index ${grp.name} "${entity.id}" canonicalName mismatch`
                    );
                }
                for (const locale of ['en', 'zh-CN', 'ja']) {
                    if (pubEntry.localizedNames?.[locale] !== entity.localizedNames?.[locale]) {
                        errors.push(
                            `Public index ${grp.name} "${entity.id}" localizedNames["${locale}"] mismatch with entity data`
                        );
                    }
                }
            }

            if (grp.publicCanonicalToId[entity.canonicalName] !== entity.id) {
                errors.push(
                    `Public canonicalToId map for ${grp.name} "${entity.canonicalName}" !== "${entity.id}"`
                );
            }
        }

        checkNoForbiddenKeys(grp.publicMap, `PUBLIC_${grp.name.toUpperCase()}`, errors);
        validateAliasesForGroup(grp.entities, grp.name, errors, warnings);
    }

    // 2. Runtime API, Regression Fixtures, Fallback, and Secondary Display Checks
    const i18nMod = await import(pathToFileURL(path.join(PUBLIC_DIR, 'i18n', 'i18n.js')).href);
    const {
        setLocale,
        formatEntityName,
        formatPlayerName,
        formatClubName,
        formatLeagueName,
        getPlayerDisplayName,
        getClubDisplayName,
    } = i18nMod;

    // Section 35: Mandatory Regression Fixtures
    const playerFixtures = [
        {
            canonical: 'Zinedine Zidane',
            en: 'Zinedine Zidane',
            'zh-CN': '齐达内',
            ja: 'ジネディーヌ・ジダン',
        },
        {
            canonical: 'Lionel Messi',
            en: 'Lionel Messi',
            'zh-CN': '梅西',
            ja: 'リオネル・メッシ',
        },
        {
            canonical: 'Cristiano Ronaldo',
            en: 'Cristiano Ronaldo',
            'zh-CN': 'C罗',
            ja: 'クリスティアーノ・ロナウド',
        },
        {
            canonical: 'Kylian Mbappe',
            en: 'Kylian Mbappe',
            'zh-CN': '姆巴佩',
            ja: 'キリアン・エムバペ',
        },
        {
            canonical: 'Paolo Maldini',
            en: 'Paolo Maldini',
            'zh-CN': '马尔蒂尼',
            ja: 'パオロ・マルディーニ',
        },
    ];

    for (const fix of playerFixtures) {
        for (const loc of ['en', 'zh-CN', 'ja']) {
            const actual = formatPlayerName(fix.canonical, loc);
            if (actual !== fix[loc]) {
                errors.push(
                    `Fixture mismatch for player "${fix.canonical}" in ${loc}: expected "${fix[loc]}", got "${actual}"`
                );
            }
        }
    }

    const clubFixtures = [
        {
            canonical: 'Real Madrid',
            en: 'Real Madrid',
            'zh-CN': '皇家马德里',
            ja: 'レアル・マドリード',
        },
        {
            canonical: 'Barcelona',
            en: 'Barcelona',
            'zh-CN': '巴塞罗那',
            ja: 'バルセロナ',
        },
        {
            canonical: 'Manchester United',
            en: 'Manchester United',
            'zh-CN': '曼联',
            ja: 'マンチェスター・ユナイテッド',
        },
        {
            canonical: 'Manchester City',
            en: 'Manchester City',
            'zh-CN': '曼城',
            ja: 'マンチェスター・シティ',
        },
        {
            canonical: 'Bayern Munich',
            en: 'Bayern Munich',
            'zh-CN': '拜仁慕尼黑',
            ja: 'バイエルン・ミュンヘン',
        },
        {
            canonical: 'Borussia Dortmund',
            en: 'Borussia Dortmund',
            'zh-CN': '多特蒙德',
            ja: 'ボルシア・ドルトムント',
        },
        {
            canonical: 'Inter Milan',
            en: 'Inter Milan',
            'zh-CN': '国际米兰',
            ja: 'インテル',
        },
        {
            canonical: 'AC Milan',
            en: 'AC Milan',
            'zh-CN': 'AC米兰',
            ja: 'ACミラン',
        },
        {
            canonical: 'Juventus',
            en: 'Juventus',
            'zh-CN': '尤文图斯',
            ja: 'ユヴェントス',
        },
    ];

    for (const fix of clubFixtures) {
        for (const loc of ['en', 'zh-CN', 'ja']) {
            const actual = formatClubName(fix.canonical, loc);
            if (actual !== fix[loc]) {
                errors.push(
                    `Fixture mismatch for club "${fix.canonical}" in ${loc}: expected "${fix[loc]}", got "${actual}"`
                );
            }
        }
    }

    const leagueFixtures = [
        { canonical: 'Premier League', en: 'Premier League', 'zh-CN': '英超', ja: 'プレミアリーグ' },
        { canonical: 'La Liga', en: 'La Liga', 'zh-CN': '西甲', ja: 'ラ・リーガ' },
        { canonical: 'Serie A', en: 'Serie A', 'zh-CN': '意甲', ja: 'セリエA' },
        { canonical: 'Bundesliga', en: 'Bundesliga', 'zh-CN': '德甲', ja: 'ブンデスリーガ' },
        { canonical: 'Ligue 1', en: 'Ligue 1', 'zh-CN': '法甲', ja: 'リーグ・アン' },
        { canonical: 'Eredivisie', en: 'Eredivisie', 'zh-CN': '荷甲', ja: 'エールディヴィジ' },
        { canonical: 'Primeira Liga', en: 'Primeira Liga', 'zh-CN': '葡超', ja: 'プリメイラ・リーガ' },
    ];

    for (const fix of leagueFixtures) {
        for (const loc of ['en', 'zh-CN', 'ja']) {
            const actual = formatLeagueName(fix.canonical, loc);
            if (actual !== fix[loc]) {
                errors.push(
                    `Fixture mismatch for league "${fix.canonical}" in ${loc}: expected "${fix[loc]}", got "${actual}"`
                );
            }
        }
    }

    // Section 36: Display Fallback Regression
    for (const loc of ['en', 'zh-CN', 'ja']) {
        setLocale(loc);
        assert.equal(
            formatPlayerName('Unknown Test Player'),
            'Unknown Test Player',
            `formatPlayerName fallback failed in ${loc}`
        );
        assert.equal(
            formatClubName('Unknown Test Club'),
            'Unknown Test Club',
            `formatClubName fallback failed in ${loc}`
        );
        assert.equal(
            formatLeagueName('Unknown Test League'),
            'Unknown Test League',
            `formatLeagueName fallback failed in ${loc}`
        );
        assert.equal(formatPlayerName(''), '');
        assert.equal(formatPlayerName(null), '');
        assert.equal(formatEntityName('unknown-type', 'Fallback Name'), 'Fallback Name');
    }

    // Section 37: English Secondary Regression
    assert.deepEqual(getPlayerDisplayName('Lionel Messi', 'en'), {
        primary: 'Lionel Messi',
        secondary: null,
    });
    assert.deepEqual(getPlayerDisplayName('Lionel Messi', 'zh-CN'), {
        primary: '梅西',
        secondary: 'Lionel Messi',
    });
    assert.deepEqual(getPlayerDisplayName('Lionel Messi', 'ja'), {
        primary: 'リオネル・メッシ',
        secondary: 'Lionel Messi',
    });

    assert.deepEqual(getClubDisplayName('Real Madrid', 'en'), {
        primary: 'Real Madrid',
        secondary: null,
    });
    assert.deepEqual(getClubDisplayName('Real Madrid', 'zh-CN'), {
        primary: '皇家马德里',
        secondary: 'Real Madrid',
    });
    assert.deepEqual(getClubDisplayName('Real Madrid', 'ja'), {
        primary: 'レアル・マドリード',
        secondary: 'Real Madrid',
    });

    // Section 25: Locale Independence Regression (Draft + Match Engine + Formatters)
    const { simulateSingleBotDraft } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'scripts', 'simulate-bot-drafts.mjs')).href
    );
    const { generateMatchScript } = await import(
        pathToFileURL(path.join(PUBLIC_DIR, 'game', 'match', 'engine.js')).href
    );
    const { formatHistoryEvent, formatMatchEvent } = await import(
        pathToFileURL(path.join(PUBLIC_DIR, 'game', 'shared', 'event-formatters.js')).href
    );

    const draftResults = {};
    const matchResults = {};

    for (const loc of ['en', 'zh-CN', 'ja']) {
        setLocale(loc);
        const draftA = simulateSingleBotDraft({ seed: 20261007, difficulty: 'smart', persona: 'neutral' });
        const draftB = simulateSingleBotDraft({ seed: 20261008, difficulty: 'expert', persona: 'neutral' });
        draftResults[loc] = {
            rosterA: draftA.team.roster,
            historyA: draftA.team.draft.history,
            rosterB: draftB.team.roster,
            historyB: draftB.team.draft.history,
        };
        matchResults[loc] = generateMatchScript(draftA.team.roster, draftB.team.roster, 998877);
    }

    assert.deepEqual(
        draftResults.en,
        draftResults['zh-CN'],
        'Draft state must be identical between en and zh-CN'
    );
    assert.deepEqual(
        draftResults.en,
        draftResults.ja,
        'Draft state must be identical between en and ja'
    );
    assert.deepEqual(
        matchResults.en,
        matchResults['zh-CN'],
        'Match script must be identical between en and zh-CN'
    );
    assert.deepEqual(
        matchResults.en,
        matchResults.ja,
        'Match script must be identical between en and ja'
    );

    // Verify formatHistoryEvent and formatMatchEvent localize entities without mutating events
    const sampleRollEvent = {
        type: 'draft.roll',
        actorId: 'p1',
        actorName: '玩家 A',
        club: 'Real Madrid',
        year: 2002,
    };
    const samplePickEvent = {
        type: 'draft.pick',
        actorId: 'p1',
        actorName: '玩家 A',
        playerId: 'real-madrid-2002-5',
        playerName: 'Zinedine Zidane',
        slot: 'MF1',
    };
    assert.equal(
        formatHistoryEvent(sampleRollEvent, 'zh-CN'),
        '玩家 A 抽到了 皇家马德里 2002'
    );
    assert.equal(
        formatHistoryEvent(samplePickEvent, 'zh-CN'),
        '玩家 A 选择了 齐达内 → MF 1'
    );
    assert.equal(
        formatHistoryEvent({ ...sampleRollEvent, actorName: 'Player A' }, 'ja'),
        'Player A が レアル・マドリード 2002 を引きました'
    );
    assert.equal(
        formatHistoryEvent({ ...samplePickEvent, actorName: 'Player A' }, 'ja'),
        'Player A が ジネディーヌ・ジダン を MF 1 に指名'
    );

    const sampleGoalEvent = {
        type: 'goal',
        minute: 42,
        team: 'A',
        scorerName: 'Lionel Messi',
        assistName: 'Andres Iniesta',
    };
    assert.ok(
        formatMatchEvent(sampleGoalEvent, 'zh-CN').includes('梅西') &&
            formatMatchEvent(sampleGoalEvent, 'zh-CN').includes('伊涅斯塔'),
        'formatMatchEvent goal must localize scorer and assist in zh-CN'
    );
    assert.ok(
        formatMatchEvent(sampleGoalEvent, 'ja').includes('リオネル・メッシ') &&
            formatMatchEvent(sampleGoalEvent, 'ja').includes('アンドレス・イニエスタ'),
        'formatMatchEvent goal must localize scorer and assist in ja'
    );
    assert.equal(
        sampleGoalEvent.scorerName,
        'Lionel Messi',
        'formatMatchEvent must not mutate canonical event object'
    );

    // 3. Report validation
    if (reportData.summary?.totalPlayerEntities !== 418) {
        errors.push(`Report summary totalPlayerEntities !== 418`);
    }
    if (reportData.summary?.zhPlayerCoverage?.covered !== 418) {
        errors.push(`Report summary zhPlayerCoverage.covered !== 418`);
    }
    if (reportData.summary?.jaPlayerCoverage?.covered !== 418) {
        errors.push(`Report summary jaPlayerCoverage.covered !== 418`);
    }

    if (warnings.length > 0) {
        console.warn(`[validate-football-localization] ${warnings.length} warning(s):`);
        for (const w of warnings) console.warn(`  - ${w}`);
    }

    if (errors.length > 0) {
        console.error(`[validate-football-localization] FAILED with ${errors.length} error(s):`);
        for (const err of errors) console.error(`  - ${err}`);
        process.exit(1);
    }

    console.log('[validate-football-localization] PASS — All localization checks succeeded:');
    console.log('- 418/418 Players (en, zh-CN, ja) verified');
    console.log('- 28/28 Clubs (en, zh-CN, ja) verified');
    console.log('- 7/7 Leagues (en, zh-CN, ja) verified');
    console.log('- Aliases, regression fixtures, unknown fallbacks, and secondary display verified');
    console.log('- Locale independence verified across en, zh-CN, and ja');
    process.exit(0);
}

main().catch((err) => {
    console.error('[validate-football-localization] Fatal error:', err);
    process.exit(1);
});

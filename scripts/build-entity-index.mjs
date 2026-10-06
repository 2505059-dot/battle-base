#!/usr/bin/env node
// scripts/build-entity-index.mjs
// Builds deterministic entity indexes in:
// - data/entities/players.json
// - data/entities/clubs.json
// - data/entities/leagues.json
// And invokes audit-entity-media.mjs to generate:
// - data/reports/entity-media-audit.json
// - data/reports/entity-media-audit.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    buildAliasIndex,
    canonicalizeClubName,
    canonicalizePlayerName,
    foldAscii,
} from './lib/normalize.mjs';
import {
    isValidHttpUrl,
    isValidHeadshotUrl,
    runMediaAudit,
} from './audit-entity-media.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const TEAM_SEASONS_JS = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');
const RAW_FIFA_INDEX = path.join(ROOT_DIR, 'data', 'raw', 'fifa', 'fifa-index.json');

function decodeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
}

function slugify(name) {
    return foldAscii(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

async function main() {
    // 1. Check prerequisite fifa-index.json
    if (!fs.existsSync(RAW_FIFA_INDEX)) {
        console.error(
            '[build-entity-index] Missing data/raw/fifa/fifa-index.json. Please run "node scripts/import-fifa.mjs" first.'
        );
        process.exit(1);
    }

    const rawFifaContent = fs.readFileSync(RAW_FIFA_INDEX, 'utf8');
    const rawFifaData = JSON.parse(rawFifaContent);
    const fifaRecords = rawFifaData.records || [];

    // Check fifaIndexId presence on lbenz records
    const sampleLbenz = fifaRecords.find((r) => r.source && r.source.includes('lbenz730/fifa_model'));
    if (!sampleLbenz || !('fifaIndexId' in sampleLbenz)) {
        console.error(
            '[build-entity-index] fifa-index.json records lack "fifaIndexId" on lbenz730/fifa_model records.'
        );
        process.exit(1);
    }

    fs.mkdirSync(ENTITIES_DIR, { recursive: true });

    // 2. Load TEAM_SEASONS and manuals
    const tsModule = await import(pathToFileURL(TEAM_SEASONS_JS).href);
    const { TEAM_SEASONS } = tsModule;
    const allPlayerSeasons = TEAM_SEASONS.flatMap((ts) => ts.players);

    const seasonPool = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'season-pool.json'), 'utf8')
    );
    const rawClubAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'club-aliases.json'), 'utf8')
    );
    const playerAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'player-aliases.json'), 'utf8')
    );
    const buildReport = JSON.parse(
        fs.readFileSync(path.join(REPORTS_DIR, 'build-report.json'), 'utf8')
    );

    // Augmented club aliases in memory
    const clubAliases = {
        ...rawClubAliases,
        Barcelona: [...(rawClubAliases.Barcelona || []), 'F.C. Barcelona'],
        'Real Madrid': [...(rawClubAliases['Real Madrid'] || []), 'Real Madrid Club de Fútbol'],
        Benfica: [...(rawClubAliases.Benfica || []), 'Sport Lisboa Benfica'],
    };

    const knownClubs = [...new Set(seasonPool.map((s) => s.club))];
    const knownPlayers = [...new Set(allPlayerSeasons.map((p) => p.name))];

    const clubAliasIndex = buildAliasIndex(clubAliases, knownClubs);
    const playerAliasIndex = buildAliasIndex(playerAliases, knownPlayers);
    const reportStatusMap = new Map(buildReport.players.map((p) => [p.id, p.status]));

    // Index FIFA records
    const eafcRecords = [];
    const lbenzRecords = [];

    for (const r of fifaRecords) {
        const isEafc = r.source.includes('ea-fc');
        const isLbenz = r.source.includes('lbenz');
        const resolvedClub = canonicalizeClubName(r.rawClub, clubAliasIndex) || r.club;
        const processed = { ...r, club: resolvedClub };

        if (isEafc) {
            eafcRecords.push(processed);
        } else if (isLbenz) {
            processed.decodedShort = decodeHtml(r.shortName);
            processed.decodedLong = decodeHtml(r.longName);
            lbenzRecords.push(processed);
        }
    }

    const eafcByClubYear = new Map();
    const eafcByYear = new Map();
    for (const r of eafcRecords) {
        if (r.club) {
            const k = `${r.club}::${r.year}`;
            if (!eafcByClubYear.has(k)) eafcByClubYear.set(k, []);
            eafcByClubYear.get(k).push(r);
        }
        if (!eafcByYear.has(r.year)) eafcByYear.set(r.year, []);
        eafcByYear.get(r.year).push(r);
    }

    const lbenzByClubYear = new Map();
    const lbenzByYear = new Map();
    for (const r of lbenzRecords) {
        if (r.club) {
            const k = `${r.club}::${r.year}`;
            if (!lbenzByClubYear.has(k)) lbenzByClubYear.set(k, []);
            lbenzByClubYear.get(k).push(r);
        }
        if (!lbenzByYear.has(r.year)) lbenzByYear.set(r.year, []);
        lbenzByYear.get(r.year).push(r);
    }

    function matchPlayer(recordNames, targetCanonical) {
        for (const name of recordNames) {
            if (!name) continue;
            const res = canonicalizePlayerName(name, playerAliasIndex);
            if (res.canonicalName === targetCanonical) return true;
        }
        return false;
    }

    // Match each of the 554 PlayerSeasons
    const playerSeasonMatches = [];

    for (const ps of allPlayerSeasons) {
        const canonical = ps.name;
        const status = reportStatusMap.get(ps.id);
        const cyKey = `${ps.club}::${ps.year}`;

        // 1. Match ea-fc records
        const clubEafc = eafcByClubYear.get(cyKey) || [];
        let matchedEafc = clubEafc.filter((r) =>
            matchPlayer([r.longName, r.shortName, r.aliasName], canonical)
        );

        if (matchedEafc.length === 0 && status !== 'fallback-generated') {
            const yearEafc = eafcByYear.get(ps.year) || [];
            const isSingleWord = canonical.trim().split(/\s+/).length === 1;
            const yearMatches = [];
            for (const r of yearEafc) {
                const names = isSingleWord ? [r.longName] : [r.longName, r.shortName, r.aliasName];
                if (matchPlayer(names, canonical)) {
                    if (isSingleWord && r.longName.trim().split(/\s+/).length === 1) continue;
                    yearMatches.push(r);
                }
            }
            if (yearMatches.length === 1) {
                matchedEafc = yearMatches;
            }
        }

        let sofifaId = null;
        if (matchedEafc.length > 0) {
            const sid = matchedEafc.map((r) => r.sofifaId).filter(Boolean)[0];
            if (sid) sofifaId = Number(sid);
        }

        // 2. Match lbenz records
        const clubLbenz = lbenzByClubYear.get(cyKey) || [];
        let matchedLbenz = clubLbenz.filter((r) =>
            matchPlayer([r.decodedLong, r.decodedShort], canonical)
        );

        if (matchedLbenz.length === 0 && status !== 'fallback-generated') {
            const yearLbenz = lbenzByYear.get(ps.year) || [];
            const isSingleWord = canonical.trim().split(/\s+/).length === 1;
            const yearMatches = [];
            for (const r of yearLbenz) {
                const names = isSingleWord ? [r.decodedLong] : [r.decodedLong, r.decodedShort];
                if (matchPlayer(names, canonical)) {
                    if (isSingleWord && r.decodedLong.trim().split(/\s+/).length === 1) continue;
                    yearMatches.push(r);
                }
            }
            if (yearMatches.length === 1) {
                matchedLbenz = yearMatches;
            }
        }

        if (matchedLbenz.length === 0 && matchedEafc.length === 1 && sofifaId) {
            const byId = clubLbenz.filter((r) => String(r.fifaIndexId) === String(sofifaId));
            if (byId.length === 1) {
                matchedLbenz = byId;
            }
        }

        let fifaIndexId = null;
        let headshotUrl = null;
        let pageUrl = null;
        if (matchedLbenz.length > 0) {
            const cand = matchedLbenz[0];
            if (cand.fifaIndexId) fifaIndexId = Number(cand.fifaIndexId);
            headshotUrl = cand.fifaIndexHeadshotUrl;
            pageUrl = cand.fifaIndexPageUrl;
        }

        playerSeasonMatches.push({
            ps,
            sofifaId,
            fifaIndexId,
            headshotUrl,
            pageUrl,
        });
    }

    // 3. Identity Merge Safety & Collision Detection
    const playersByCanonical = new Map();
    for (const m of playerSeasonMatches) {
        const canonical = m.ps.name;
        if (!playersByCanonical.has(canonical)) {
            playersByCanonical.set(canonical, []);
        }
        playersByCanonical.get(canonical).push(m);
    }

    // Check slug collision
    const slugToCanonical = new Map();
    const slugCollisions = [];
    for (const canonical of playersByCanonical.keys()) {
        const slug = slugify(canonical);
        if (slugToCanonical.has(slug) && slugToCanonical.get(slug) !== canonical) {
            slugCollisions.push({ slug, a: slugToCanonical.get(slug), b: canonical });
        } else {
            slugToCanonical.set(slug, canonical);
        }
    }

    // Check external ID collisions
    const canonicalWithMultipleSofifa = [];
    const canonicalWithMultipleFifaIndex = [];
    const sofifaIdToCanonical = new Map();
    const fifaIndexIdToCanonical = new Map();
    const externalIdReused = [];
    const roleConflicts = [];

    for (const [canonical, matches] of playersByCanonical.entries()) {
        const sofifaIds = new Set(matches.map((m) => m.sofifaId).filter(Boolean));
        if (sofifaIds.size > 1) {
            canonicalWithMultipleSofifa.push({ canonical, ids: [...sofifaIds] });
        }
        for (const sid of sofifaIds) {
            if (sofifaIdToCanonical.has(sid) && sofifaIdToCanonical.get(sid) !== canonical) {
                externalIdReused.push({ idType: 'sofifa', id: sid, canonicalA: sofifaIdToCanonical.get(sid), canonicalB: canonical });
            } else {
                sofifaIdToCanonical.set(sid, canonical);
            }
        }

        const fifaIndexIds = new Set(matches.map((m) => m.fifaIndexId).filter(Boolean));
        if (fifaIndexIds.size > 1) {
            canonicalWithMultipleFifaIndex.push({ canonical, ids: [...fifaIndexIds] });
        }
        for (const fid of fifaIndexIds) {
            if (fifaIndexIdToCanonical.has(fid) && fifaIndexIdToCanonical.get(fid) !== canonical) {
                externalIdReused.push({ idType: 'fifaIndex', id: fid, canonicalA: fifaIndexIdToCanonical.get(fid), canonicalB: canonical });
            } else {
                fifaIndexIdToCanonical.set(fid, canonical);
            }
        }

        // Role conflict
        const isGkSet = new Set(matches.map((m) => m.ps.positions.includes('GK')));
        if (isGkSet.size > 1) {
            roleConflicts.push(canonical);
        }
    }

    const hasAnyConflict =
        slugCollisions.length > 0 ||
        canonicalWithMultipleSofifa.length > 0 ||
        canonicalWithMultipleFifaIndex.length > 0 ||
        externalIdReused.length > 0 ||
        roleConflicts.length > 0;

    if (hasAnyConflict) {
        console.warn('[build-entity-index] Conflicts detected:', {
            slugCollisions,
            canonicalWithMultipleSofifa,
            canonicalWithMultipleFifaIndex,
            externalIdReused,
            roleConflicts,
        });
    }

    // 4. Build Player Entities
    const playerEntities = [];
    const playerSeasonMap = {};
    const unresolvedPlayerSeasons = [];

    for (const [canonical, matches] of playersByCanonical.entries()) {
        const slug = slugify(canonical);
        const playerSeasonIds = matches.map((m) => m.ps.id).sort();
        for (const psId of playerSeasonIds) {
            playerSeasonMap[psId] = slug;
        }

        const clubs = [...new Set(matches.map((m) => m.ps.club))].sort();
        const leagues = [...new Set(matches.map((m) => m.ps.league))].sort();
        const seasons = [...new Set(matches.map((m) => m.ps.year))].sort((a, b) => a - b);

        const sofifaId = matches.map((m) => m.sofifaId).find((id) => id !== null) ?? null;
        const fifaIndexId = matches.map((m) => m.fifaIndexId).find((id) => id !== null) ?? null;

        // Collect valid headshots and page URLs
        const validHeadshots = [];
        const validHeadshotUrls = [];
        const pageUrls = [];
        let canonicalPageUrl = null;

        for (const m of matches) {
            if (m.pageUrl && isValidHttpUrl(m.pageUrl)) {
                pageUrls.push({
                    source: 'fifa-index',
                    year: m.ps.year,
                    url: m.pageUrl,
                });
                if (!canonicalPageUrl) {
                    canonicalPageUrl = m.pageUrl.replace(/\/fifa\d+\/?$/, '/');
                }
            }

            if (m.headshotUrl && isValidHeadshotUrl(m.headshotUrl)) {
                validHeadshotUrls.push(m.headshotUrl);
                validHeadshots.push({
                    source: 'fifa-index',
                    provider: 'lbenz730/fifa_model',
                    year: m.ps.year,
                    url: m.headshotUrl,
                    pageUrl: m.pageUrl && isValidHttpUrl(m.pageUrl) ? m.pageUrl : null,
                    status: 'blocked',
                    licenseStatus: 'external-provider',
                });
            }
        }

        // Deduplicate and sort
        pageUrls.sort((a, b) => a.year - b.year);
        validHeadshots.sort((a, b) => a.year - b.year);
        const distinctHeadshotUrls = [...new Set(validHeadshotUrls)];

        playerEntities.push({
            id: slug,
            canonicalName: canonical,
            identityStatus: 'resolved',
            localizedNames: {
                en: canonical,
                'zh-CN': null,
                ja: null,
            },
            aliases: {
                en: [],
                'zh-CN': [],
                ja: [],
            },
            externalIds: {
                sofifa: sofifaId,
                fifaIndex: fifaIndexId,
            },
            media: {
                fifaIndexPageUrl: canonicalPageUrl,
                fifaIndexPageUrls: pageUrls,
                fifaIndexHeadshotUrls: distinctHeadshotUrls,
                fifaIndexHeadshots: validHeadshots,
                preferredResolutionOrder: [
                    'same-season-fifa-index',
                    'nearest-season-fifa-index',
                    'wikimedia-commons-licensed',
                    'silhouette-fallback',
                ],
            },
            clubs,
            leagues,
            seasons,
            playerSeasonIds,
        });
    }

    // Sort entities deterministically by id ascending
    playerEntities.sort((a, b) => a.id.localeCompare(b.id));

    // Sort playerSeasonMap keys
    const sortedPlayerSeasonMap = {};
    for (const k of Object.keys(playerSeasonMap).sort()) {
        sortedPlayerSeasonMap[k] = playerSeasonMap[k];
    }

    const playersOutput = {
        schemaVersion: '1.0.0',
        entityType: 'player',
        totalPlayerSeasons: allPlayerSeasons.length,
        totalEntities: playerEntities.length,
        unresolvedCount: unresolvedPlayerSeasons.length,
        entities: playerEntities,
        playerSeasonMap: sortedPlayerSeasonMap,
        unresolvedPlayerSeasons,
    };

    fs.writeFileSync(
        path.join(ENTITIES_DIR, 'players.json'),
        JSON.stringify(playersOutput, null, 2) + '\n',
        'utf8'
    );

    // 5. Build Club Entities (28 clubs)
    const clubsByCanonical = new Map();
    for (const ts of TEAM_SEASONS) {
        if (!clubsByCanonical.has(ts.club)) {
            clubsByCanonical.set(ts.club, []);
        }
        clubsByCanonical.get(ts.club).push(ts);
    }

    const clubEntities = [];
    const clubMap = {};

    for (const [canonicalClub, tsList] of clubsByCanonical.entries()) {
        const slug = slugify(canonicalClub);
        clubMap[canonicalClub] = slug;

        const league = tsList[0].league;
        const leagueId = slugify(league);
        const seasons = [...new Set(tsList.map((ts) => ts.year))].sort((a, b) => a - b);
        const teamSeasonIds = tsList.map((ts) => ts.id).sort();

        clubEntities.push({
            id: slug,
            canonicalName: canonicalClub,
            league,
            leagueId,
            localizedNames: {
                en: canonicalClub,
                'zh-CN': null,
                ja: null,
            },
            aliases: {
                en: [],
                'zh-CN': [],
                ja: [],
            },
            externalIds: {
                footballData: null,
                theSportsDb: null,
                wikidata: null,
            },
            media: {
                crest: null,
                crestCandidates: [],
            },
            seasons,
            teamSeasonIds,
        });
    }

    clubEntities.sort((a, b) => a.id.localeCompare(b.id));
    const sortedClubMap = {};
    for (const k of Object.keys(clubMap).sort()) {
        sortedClubMap[k] = clubMap[k];
    }

    const clubsOutput = {
        schemaVersion: '1.0.0',
        entityType: 'club',
        totalEntities: clubEntities.length,
        entities: clubEntities,
        clubMap: sortedClubMap,
    };

    fs.writeFileSync(
        path.join(ENTITIES_DIR, 'clubs.json'),
        JSON.stringify(clubsOutput, null, 2) + '\n',
        'utf8'
    );

    // 6. Build League Entities (7 leagues)
    const leaguesByName = new Map();
    for (const ts of TEAM_SEASONS) {
        if (!leaguesByName.has(ts.league)) {
            leaguesByName.set(ts.league, []);
        }
        leaguesByName.get(ts.league).push(ts);
    }

    const leagueEntities = [];
    const leagueMap = {};

    for (const [canonicalLeague, tsList] of leaguesByName.entries()) {
        const slug = slugify(canonicalLeague);
        leagueMap[canonicalLeague] = slug;

        const clubs = [...new Set(tsList.map((ts) => ts.club))].sort();
        const clubIds = clubs.map((c) => slugify(c));
        const teamSeasonIds = tsList.map((ts) => ts.id).sort();

        leagueEntities.push({
            id: slug,
            canonicalName: canonicalLeague,
            localizedNames: {
                en: canonicalLeague,
                'zh-CN': null,
                ja: null,
            },
            aliases: {
                en: [],
                'zh-CN': [],
                ja: [],
            },
            externalIds: {
                footballData: null,
                theSportsDb: null,
                wikidata: null,
            },
            media: {
                emblem: null,
                emblemCandidates: [],
            },
            clubs,
            clubIds,
            teamSeasonIds,
        });
    }

    leagueEntities.sort((a, b) => a.id.localeCompare(b.id));
    const sortedLeagueMap = {};
    for (const k of Object.keys(leagueMap).sort()) {
        sortedLeagueMap[k] = leagueMap[k];
    }

    const leaguesOutput = {
        schemaVersion: '1.0.0',
        entityType: 'league',
        totalEntities: leagueEntities.length,
        entities: leagueEntities,
        leagueMap: sortedLeagueMap,
    };

    fs.writeFileSync(
        path.join(ENTITIES_DIR, 'leagues.json'),
        JSON.stringify(leaguesOutput, null, 2) + '\n',
        'utf8'
    );

    console.log('[build-entity-index] Successfully built entities:');
    console.log(`- Players: ${playerEntities.length} (from ${allPlayerSeasons.length} PlayerSeasons)`);
    console.log(`- Clubs: ${clubEntities.length}`);
    console.log(`- Leagues: ${leagueEntities.length}`);

    // 7. Invoke runMediaAudit to audit headshots, update statuses in players.json, and write reports
    console.log('[build-entity-index] Invoking media audit...');
    await runMediaAudit({
        skipHttp: process.argv.includes('--skip-http') || process.argv.includes('--offline'),
    });
    console.log('[build-entity-index] Media audit and report generation complete.');
}

main().catch((err) => {
    console.error('[build-entity-index] Fatal error:', err);
    process.exit(1);
});

#!/usr/bin/env node
// scripts/import-squads.mjs
// Downloads and normalizes historical club squad rosters from:
// 1. ewenme/squads (2004/05 - 2020/21 across all 7 leagues)
// 2. footballcsv/cache.footballsquads (1998/99 - 2023/24 CC0 public domain archive)
// Only fetches files needed for seasons in data/manual/season-pool.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildAliasIndex,
    canonicalizeClubName,
    normalizeSeasonYear,
    normalizePositions,
    parseCsvRecords,
} from './lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_SQUADS_DIR = path.join(ROOT_DIR, 'data', 'raw', 'squads');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');

const EWENME_LEAGUE_MAP = {
    'Premier League': 'premier_league',
    'La Liga': 'primera_division',
    'Serie A': 'serie_a',
    'Bundesliga': '1_bundesliga',
    'Ligue 1': 'ligue_1',
    'Eredivisie': 'eredivisie',
    'Primeira Liga': 'liga_nos',
};

const FOOTBALLCSV_CLUB_SLUGS = {
    'Manchester United': ['manutd'],
    'Arsenal': ['arsenal'],
    'Chelsea': ['chelsea'],
    'Manchester City': ['mancity'],
    'Liverpool': ['liverpool'],
    'Leicester City': ['leicester'],
    'Barcelona': ['barce', 'barca', 'barcelona'],
    'Real Madrid': ['rmadrid'],
    'Valencia': ['valencia'],
    'Deportivo La Coruna': ['lacoruna', 'depor'],
    'Atletico Madrid': ['amadrid', 'atletico'],
    'AC Milan': ['milan'],
    'Inter Milan': ['inter'],
    'Juventus': ['juventus'],
    'Napoli': ['napoli'],
    'Roma': ['roma'],
    'Lazio': ['lazio'],
    'Parma': ['parma'],
    'Atalanta': ['atalanta'],
    'Bayern Munich': ['bayern'],
    'Borussia Dortmund': ['dortmund'],
    'Bayer Leverkusen': ['bayerlev', 'leverkus', 'leverkusen'],
    'Monaco': ['monaco'],
    'Lille': ['lille'],
    'Ajax': ['ajax'],
    'PSV': ['psv'],
    'Porto': ['porto', 'fcporto'],
    'Benfica': ['benfica'],
};

function getFootballCsvLeaguePaths(league, year) {
    const seasonStr = `${year - 1}-${year}`;
    switch (league) {
        case 'Premier League':
            return [year <= 2018 ? `eng/${seasonStr}/faprem` : `eng/${seasonStr}/engprem`];
        case 'La Liga':
            return [`spain/${seasonStr}/laliga`];
        case 'Serie A':
            return [`italy/${seasonStr}/seriea`];
        case 'Bundesliga':
            return [`ger/${seasonStr}/bundes`];
        case 'Ligue 1':
            return [year <= 2002 ? `france/${seasonStr}/div1` : `france/${seasonStr}/ligue1`];
        case 'Eredivisie':
            return [`ned/${seasonStr}/erediv`, `holland/${seasonStr}/erediv`, `uefa/${seasonStr}/cl`];
        case 'Primeira Liga':
            return [
                `portugal/${seasonStr}/superl`,
                `portugal/${seasonStr}/primeira`,
                `portugal/${seasonStr}/liganos`,
                `uefa/${seasonStr}/cl`,
            ];
        default:
            return [];
    }
}

async function fetchTextWithCache(url, cachePath, force = false) {
    if (!force && fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath, 'utf8');
    }
    const res = await fetch(url);
    if (!res.ok) {
        return null;
    }
    const text = await res.text();
    fs.writeFileSync(cachePath, text, 'utf8');
    return text;
}

/**
 * Parse a footballcsv/cache.footballsquads .txt file into squad player entries.
 */
function parseFootballCsvTxt(txtContent, fallbackClub, fallbackYear, fallbackLeague) {
    const lines = txtContent.split(/\r?\n/);
    let headerClub = fallbackClub;
    let headerYear = fallbackYear;
    let columns = null;
    const players = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('=') && !line.startsWith('==')) {
            // Example: "=  Manchester United - English Premiership 1998/99"
            const m = line.match(/^=\s+(.+?)\s+-\s+(.+?)\s+(\d{4}[/-]\d{2,4})\s*$/);
            if (m) {
                headerClub = m[1].trim();
                const parsedYr = normalizeSeasonYear(m[3]);
                if (parsedYr) headerYear = parsedYr;
            }
            continue;
        }

        if (line.startsWith('Number,')) {
            columns = line.split(',').map((c) => c.trim());
            continue;
        }

        if (!columns) continue;
        if (line.startsWith('==')) {
            // Continue reading "== Past Players" as well since mid-season transfers/loans are listed there
            continue;
        }

        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 3) continue;

        const nameIdx = columns.indexOf('Name');
        const posIdx = columns.indexOf('Pos');
        if (nameIdx === -1 || posIdx === -1) continue;

        const playerName = parts[nameIdx];
        const rawPos = parts[posIdx];
        if (!playerName || !rawPos) continue;

        const positions = normalizePositions(rawPos);
        if (positions.length === 0) continue;

        players.push({
            playerName,
            rawPosition: rawPos,
            positions,
            rawClub: headerClub,
            year: headerYear,
            league: fallbackLeague,
            source: 'footballcsv/cache.footballsquads',
        });
    }

    return players;
}

async function main() {
    const force = process.argv.includes('--force');
    fs.mkdirSync(RAW_SQUADS_DIR, { recursive: true });

    const seasonPool = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'season-pool.json'), 'utf8')
    );
    const clubAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'club-aliases.json'), 'utf8')
    );
    const knownClubs = [...new Set(seasonPool.map((s) => s.club))];
    const clubAliasIndex = buildAliasIndex(clubAliases, knownClubs);

    const allSquadEntries = [];
    const fetchedEwenmePairs = new Set();
    let ewenmeFilesCount = 0;
    let footballCsvFilesCount = 0;

    console.log(`[import-squads] Importing squad data for ${seasonPool.length} allowlisted TeamSeasons...`);

    // 1. Fetch ewenme/squads for seasons in [2005..2021] (start_year in [2004..2020])
    for (const ts of seasonPool) {
        const startYear = ts.year - 1;
        const leagueSlug = EWENME_LEAGUE_MAP[ts.league];
        if (startYear >= 2004 && startYear <= 2020 && leagueSlug) {
            const pairKey = `${startYear}_${leagueSlug}`;
            if (!fetchedEwenmePairs.has(pairKey)) {
                fetchedEwenmePairs.add(pairKey);
                const url = `https://raw.githubusercontent.com/ewenme/squads/master/data/${startYear}/${leagueSlug}.csv`;
                const cacheFile = path.join(RAW_SQUADS_DIR, `ewenme_${startYear}_${leagueSlug}.csv`);
                const csvText = await fetchTextWithCache(url, cacheFile, force);
                if (csvText) {
                    ewenmeFilesCount++;
                    const rows = parseCsvRecords(csvText);
                    for (const row of rows) {
                        const canonicalClub = canonicalizeClubName(row.club_name, clubAliasIndex);
                        if (!canonicalClub) continue;
                        const seasonYear = normalizeSeasonYear(row.season) || (Number(row.year) + 1);
                        const positions = normalizePositions(row.position);
                        if (!row.player_name || positions.length === 0) continue;

                        allSquadEntries.push({
                            club: canonicalClub,
                            rawClub: row.club_name,
                            year: seasonYear,
                            league: ts.league,
                            playerName: row.player_name.trim(),
                            rawPosition: row.position,
                            positions,
                            nationality: row.nationality || null,
                            source: 'ewenme/squads',
                        });
                    }
                }
            }
        }
    }

    // 2. Fetch footballcsv/cache.footballsquads for all allowlisted TeamSeasons (1999-2024)
    for (const ts of seasonPool) {
        const leaguePaths = getFootballCsvLeaguePaths(ts.league, ts.year);
        const candidateSlugs = FOOTBALLCSV_CLUB_SLUGS[ts.club] || [ts.club.toLowerCase().replace(/\s+/g, '')];

        let loaded = false;
        for (const leaguePath of leaguePaths) {
            if (loaded) break;
            for (const slug of candidateSlugs) {
                const url = `https://raw.githubusercontent.com/footballcsv/cache.footballsquads/master/${leaguePath}/${slug}.txt`;
                const safeCacheName = `footballcsv_${leaguePath.replace(/\//g, '_')}_${slug}.txt`;
                const cacheFile = path.join(RAW_SQUADS_DIR, safeCacheName);
                const txt = await fetchTextWithCache(url, cacheFile, force);
                if (txt) {
                    footballCsvFilesCount++;
                    const parsed = parseFootballCsvTxt(txt, ts.club, ts.year, ts.league);
                    for (const p of parsed) {
                        allSquadEntries.push({
                            club: ts.club,
                            rawClub: p.rawClub,
                            year: ts.year,
                            league: ts.league,
                            playerName: p.playerName,
                            rawPosition: p.rawPosition,
                            positions: p.positions,
                            nationality: null,
                            source: 'footballcsv/cache.footballsquads',
                        });
                    }
                    loaded = true;
                    break;
                }
            }
        }
    }

    const indexPath = path.join(RAW_SQUADS_DIR, 'squads-index.json');
    fs.writeFileSync(
        indexPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                ewenmeFilesCount,
                footballCsvFilesCount,
                totalEntries: allSquadEntries.length,
                entries: allSquadEntries,
            },
            null,
            2
        ) + '\n',
        'utf8'
    );

    // Check how many of the 62 TeamSeasons have squad entries
    const coveredSeasons = new Set(allSquadEntries.map((e) => `${e.club}::${e.year}`));
    const matchedPool = seasonPool.filter((ts) => coveredSeasons.has(`${ts.club}::${ts.year}`));
    const missingPool = seasonPool.filter((ts) => !coveredSeasons.has(`${ts.club}::${ts.year}`));

    console.log(`[import-squads] Done.`);
    console.log(`  - ewenme/squads CSV files loaded: ${ewenmeFilesCount}`);
    console.log(`  - footballcsv/cache.footballsquads TXT files loaded: ${footballCsvFilesCount}`);
    console.log(`  - Total normalized club-season player entries: ${allSquadEntries.length}`);
    console.log(`  - TeamSeasons covered in season-pool: ${matchedPool.length} / ${seasonPool.length}`);
    if (missingPool.length > 0) {
        console.log(`  - TeamSeasons without dedicated squad file (will check FIFA club rosters): ${missingPool.map((m) => m.id).join(', ')}`);
    }
}

main().catch((err) => {
    console.error('[import-squads] Error:', err);
    process.exit(1);
});

#!/usr/bin/env node
// scripts/import-fifa.mjs
// Downloads and normalizes historical FIFA / EA FC player ratings and technical attributes from:
// 1. mzafram2001/ea-fc (MIT License, FIFA 07 - EA FC 24, i.e. seasons 2007 - 2024)
// 2. lbenz730/fifa_model (Public academic repo, FIFA 05 - FIFA 20, i.e. seasons 2005 - 2020)
//
// Only downloads the specific season years referenced in data/manual/season-pool.json
// and writes a normalized index to data/raw/fifa/fifa-index.json.

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
const RAW_FIFA_DIR = path.join(ROOT_DIR, 'data', 'raw', 'fifa');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');

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

function toValidNum(val) {
    if (val === undefined || val === null || val === '' || val === 'NA') return null;
    const n = Number(val);
    return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
}

function cleanOptionalString(val) {
    if (val === undefined || val === null) return null;
    const trimmed = String(val).trim();
    if (!trimmed || trimmed === 'NA' || trimmed === 'null') return null;
    return trimmed;
}

function parseEaFcRow(row, year, clubAliasIndex) {
    const canonicalClub = canonicalizeClubName(row.club_name, clubAliasIndex);
    const positions = normalizePositions(row.positions);
    const overall = toValidNum(row.overall);
    if (!overall) return null;

    const tech = {
        overall,
        finishing: toValidNum(row.finishing),
        positioning: toValidNum(row.positioning),
        shot_power: toValidNum(row.shot_power),
        long_shots: toValidNum(row.long_shots),
        heading_accuracy: toValidNum(row.heading_accuracy),
        vision: toValidNum(row.vision),
        short_passing: toValidNum(row.short_passing),
        long_passing: toValidNum(row.long_passing),
        crossing: toValidNum(row.crossing),
        ball_control: toValidNum(row.ball_control),
        dribbling: toValidNum(row.dribbling_stat) ?? toValidNum(row.dribbling),
        interceptions: toValidNum(row.interceptions),
        defensive_awareness: toValidNum(row.defensive_awareness),
        marking: toValidNum(row.defensive_awareness),
        standing_tackle: toValidNum(row.standing_tackle),
        sliding_tackle: toValidNum(row.sliding_tackle),
        strength: toValidNum(row.strength),
        stamina: toValidNum(row.stamina),
        acceleration: toValidNum(row.acceleration),
        sprint_speed: toValidNum(row.sprint_speed),
        aggression: toValidNum(row.aggression),
        gk_diving: toValidNum(row.gk_diving),
        gk_handling: toValidNum(row.gk_handling),
        gk_kicking: toValidNum(row.gk_kicking),
        gk_positioning: toValidNum(row.gk_positioning),
        gk_reflexes: toValidNum(row.gk_reflexes),
    };

    // For outfield players in older FIFA editions where GK stats were left blank/0,
    // use standard FIFA outfield goalkeeper baseline (10-12) only if player is not GK.
    const isGk = positions.includes('GK');
    if (!isGk) {
        if (!tech.gk_diving) tech.gk_diving = 11;
        if (!tech.gk_handling) tech.gk_handling = 11;
        if (!tech.gk_kicking) tech.gk_kicking = 11;
        if (!tech.gk_positioning) tech.gk_positioning = 11;
        if (!tech.gk_reflexes) tech.gk_reflexes = 11;
    }

    return {
        source: `mzafram2001/ea-fc (${row.game_version || 'FIFA ' + String(year).slice(-2)})`,
        sourcePriority: year >= 2011 ? 1 : 2,
        year,
        club: canonicalClub,
        rawClub: row.club_name || '',
        shortName: (row.short_name || '').trim(),
        longName: (row.long_name || '').trim(),
        aliasName: (row.alias || '').trim(),
        sofifaId: cleanOptionalString(row.sofifa_id),
        fifaIndexId: null,
        fifaIndexPageUrl: null,
        fifaIndexHeadshotUrl: null,
        rawPositions: row.positions || '',
        positions,
        overall,
        tech,
    };
}

function parseLbenzRow(row, year, clubAliasIndex) {
    const canonicalClub = canonicalizeClubName(row.club, clubAliasIndex);
    const rawPos = [row.preferred_positions, row.club_position].filter(Boolean).join('/');
    const positions = normalizePositions(rawPos);
    const overall = toValidNum(row.rating);
    if (!overall) return null;

    // In FIFA 05, 'shot_accuracy' was used before being renamed 'finishing',
    // and in FIFA 05-07 FIFA Index stored the single 'Tackling' attribute in 'slide_tackle'.
    const tech = {
        overall,
        finishing: toValidNum(row.finishing) ?? toValidNum(row.shot_accuracy),
        positioning: toValidNum(row.att_position),
        shot_power: toValidNum(row.shot_power),
        long_shots: toValidNum(row.long_shots),
        heading_accuracy: toValidNum(row.heading),
        vision: toValidNum(row.vision),
        creativity: toValidNum(row.creativity),
        short_passing: toValidNum(row.short_pass),
        long_passing: toValidNum(row.long_pass),
        crossing: toValidNum(row.crossing),
        ball_control: toValidNum(row.ball_control),
        dribbling: toValidNum(row.dribbling),
        interceptions: toValidNum(row.interceptions),
        defensive_awareness: toValidNum(row.marking),
        marking: toValidNum(row.marking),
        standing_tackle: toValidNum(row.stand_tackle) ?? toValidNum(row.slide_tackle),
        sliding_tackle: toValidNum(row.slide_tackle),
        strength: toValidNum(row.strength),
        stamina: toValidNum(row.stamina),
        acceleration: toValidNum(row.acceleration),
        sprint_speed: toValidNum(row.sprint_speed),
        aggression: toValidNum(row.aggression),
        gk_diving: toValidNum(row.gk_diving) ?? toValidNum(row.gk_rushing),
        gk_handling: toValidNum(row.gk_handling),
        gk_kicking: toValidNum(row.gk_kicking),
        gk_positioning: toValidNum(row.gk_positioning),
        gk_reflexes: toValidNum(row.gk_reflexes),
    };

    const isGk = positions.includes('GK');
    if (!isGk) {
        if (!tech.gk_diving) tech.gk_diving = 11;
        if (!tech.gk_handling) tech.gk_handling = 11;
        if (!tech.gk_kicking) tech.gk_kicking = 11;
        if (!tech.gk_positioning) tech.gk_positioning = 11;
        if (!tech.gk_reflexes) tech.gk_reflexes = 11;
    }

    return {
        source: `lbenz730/fifa_model (FIFA ${String(year).slice(-2)})`,
        sourcePriority: year <= 2010 ? 1 : 2,
        year,
        club: canonicalClub,
        rawClub: row.club || '',
        shortName: (row.name || '').trim(),
        longName: (row.name || '').trim(),
        aliasName: '',
        sofifaId: null,
        fifaIndexId: cleanOptionalString(row.player_id),
        fifaIndexPageUrl: cleanOptionalString(row.page_url),
        fifaIndexHeadshotUrl: cleanOptionalString(row.headshot_url),
        rawPositions: rawPos,
        positions,
        overall,
        tech,
    };
}

async function main() {
    const force = process.argv.includes('--force');
    fs.mkdirSync(RAW_FIFA_DIR, { recursive: true });

    const seasonPool = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'season-pool.json'), 'utf8')
    );
    const clubAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'club-aliases.json'), 'utf8')
    );
    const knownClubs = [...new Set(seasonPool.map((s) => s.club))];
    const clubAliasIndex = buildAliasIndex(clubAliases, knownClubs);

    // Distinct years needed by season-pool
    const targetYears = [...new Set(seasonPool.map((s) => s.year))].sort((a, b) => a - b);
    // Club set per year so we retain all players in our 28 clubs + high-rated players (>=75) for mid-season transfer verification
    const indexedRecords = [];
    let eaFcFilesCount = 0;
    let lbenzFilesCount = 0;

    console.log(`[import-fifa] Target years in season-pool: ${targetYears.join(', ')}`);

    for (const year of targetYears) {
        // 1. mzafram2001/ea-fc covers 2007..2024
        if (year >= 2007 && year <= 2024) {
            const yy = String(year).slice(-2);
            const fileName = year <= 2023 ? `dataset_fifa_${yy}.csv` : `dataset_ea_fc_${yy}.csv`;
            const url = `https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/${fileName}`;
            const cachePath = path.join(RAW_FIFA_DIR, `eafc_${fileName}`);
            const csvText = await fetchTextWithCache(url, cachePath, force);
            if (csvText) {
                eaFcFilesCount++;
                const rows = parseCsvRecords(csvText);
                for (const row of rows) {
                    const parsed = parseEaFcRow(row, year, clubAliasIndex);
                    if (!parsed) continue;
                    // Keep if club is one of our 28 canonical clubs OR overall >= 76 (to allow mid-season transfer lookup when squad-verified)
                    if (parsed.club || parsed.overall >= 76) {
                        indexedRecords.push(parsed);
                    }
                }
                console.log(`  [mzafram2001/ea-fc] Loaded ${fileName} (year ${year})`);
            }
        }

        // 2. lbenz730/fifa_model covers 2005..2020
        if (year >= 2005 && year <= 2020) {
            const fileName = `player_stats_${year}.csv`;
            const url = `https://raw.githubusercontent.com/lbenz730/fifa_model/master/stats/${fileName}`;
            const cachePath = path.join(RAW_FIFA_DIR, `lbenz_${fileName}`);
            const csvText = await fetchTextWithCache(url, cachePath, force);
            if (csvText) {
                lbenzFilesCount++;
                const rows = parseCsvRecords(csvText);
                for (const row of rows) {
                    const parsed = parseLbenzRow(row, year, clubAliasIndex);
                    if (!parsed) continue;
                    if (parsed.club || parsed.overall >= 76) {
                        indexedRecords.push(parsed);
                    }
                }
                console.log(`  [lbenz730/fifa_model] Loaded ${fileName} (year ${year})`);
            }
        }
    }

    const indexPath = path.join(RAW_FIFA_DIR, 'fifa-index.json');
    fs.writeFileSync(
        indexPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                eaFcFilesCount,
                lbenzFilesCount,
                totalRecords: indexedRecords.length,
                records: indexedRecords,
            },
            null,
            2
        ) + '\n',
        'utf8'
    );

    console.log(`[import-fifa] Done.`);
    console.log(`  - mzafram2001/ea-fc CSV files loaded: ${eaFcFilesCount}`);
    console.log(`  - lbenz730/fifa_model CSV files loaded: ${lbenzFilesCount}`);
    console.log(`  - Total indexed FIFA player-season records: ${indexedRecords.length}`);
}

main().catch((err) => {
    console.error('[import-fifa] Error:', err);
    process.exit(1);
});

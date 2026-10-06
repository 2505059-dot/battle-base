#!/usr/bin/env node
// scripts/analyze-era-drift.mjs
// Statistical investigation of era rating drift across FIFA 05 to EA FC 24 (2005-2024).
// Reads raw full-population CSVs in data/raw/fifa/ and generates:
// - data/reports/era-calibration.json
// - data/reports/era-calibration.md
//
// NOTE: Read-only analysis script. Does NOT modify public/data/team-seasons.js or game code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    POSITION_MAP,
    aggregateAttributes,
    buildAliasIndex,
    canonicalizeClubName,
    canonicalizePlayerName,
    clampStat,
    parseCsvRecords,
} from './lib/normalize.mjs';
import {
    buildCohortDistribution,
    calibratePlayerStats,
    mergeCohortDistributions,
} from './lib/calibrate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_FIFA_DIR = path.join(ROOT_DIR, 'data', 'raw', 'fifa');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');

const EXTENDED_POSITION_MAP = {
    ...POSITION_MAP,
    LWM: 'FW',
    RWM: 'FW',
    LCAM: 'MF',
    RCAM: 'MF',
    LCDM: 'MF',
    RCDM: 'MF',
};

function normalizeAnalysisPositions(rawPositions) {
    if (!rawPositions) return [];
    const items = Array.isArray(rawPositions)
        ? rawPositions.flatMap((p) => String(p).split(/[,/]+/))
        : String(rawPositions).split(/[,/]+/);

    const result = [];
    for (const rawItem of items) {
        const cleaned = rawItem.trim().toUpperCase();
        if (!cleaned) continue;
        if (EXTENDED_POSITION_MAP[cleaned]) {
            const mapped = EXTENDED_POSITION_MAP[cleaned];
            if (!result.includes(mapped)) result.push(mapped);
            continue;
        }
        for (const token of cleaned.split(/\s+/)) {
            const mapped = EXTENDED_POSITION_MAP[token];
            if (mapped && !result.includes(mapped)) {
                result.push(mapped);
            }
        }
    }
    if (result.includes('GK') && result.length > 1) {
        return result[0] === 'GK' ? ['GK'] : result.filter((p) => p !== 'GK');
    }
    return result;
}

function toValidNum(val) {
    if (val === undefined || val === null || val === '' || val === 'NA') return null;
    const n = Number(val);
    return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
}

function computeStats(values) {
    if (!values || values.length === 0) {
        return {
            count: 0,
            mean: 0,
            median: 0,
            std: 0,
            min: 0,
            max: 0,
            top1Pct: 0,
            top5Pct: 0,
            top10Pct: 0,
            count90Plus: 0,
            count85Plus: 0,
            count80Plus: 0,
            rank10: 0,
            rank25: 0,
            rank50: 0,
            rank100: 0,
            rank250: 0,
            top100Mean: 0,
            top500Mean: 0,
            top500Std: 0,
        };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;
    const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);

    const quantile = (q) => {
        const pos = (n - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        }
        return sorted[base];
    };

    const desc = [...sorted].reverse();
    const top100 = desc.slice(0, Math.min(100, n));
    const top500 = desc.slice(0, Math.min(500, n));
    const top100Mean = top100.reduce((a, b) => a + b, 0) / top100.length;
    const top500Mean = top500.reduce((a, b) => a + b, 0) / top500.length;
    const top500Std = Math.sqrt(
        top500.reduce((a, v) => a + (v - top500Mean) ** 2, 0) / top500.length
    );

    return {
        count: n,
        mean: Number(mean.toFixed(2)),
        median: Number(quantile(0.5).toFixed(2)),
        std: Number(std.toFixed(2)),
        min: sorted[0],
        max: sorted[n - 1],
        top1Pct: Number(quantile(0.99).toFixed(2)),
        top5Pct: Number(quantile(0.95).toFixed(2)),
        top10Pct: Number(quantile(0.9).toFixed(2)),
        count90Plus: sorted.filter((v) => v >= 90).length,
        count85Plus: sorted.filter((v) => v >= 85).length,
        count80Plus: sorted.filter((v) => v >= 80).length,
        rank10: desc[Math.min(9, n - 1)],
        rank25: desc[Math.min(24, n - 1)],
        rank50: desc[Math.min(49, n - 1)],
        rank100: desc[Math.min(99, n - 1)],
        rank250: desc[Math.min(249, n - 1)],
        top100Mean: Number(top100Mean.toFixed(2)),
        top500Mean: Number(top500Mean.toFixed(2)),
        top500Std: Number(top500Std.toFixed(2)),
    };
}

/**
 * Compute exact percentile [0, 100] of value `val` within a sorted ascending array `sortedAsc`.
 */
function computePercentile(val, sortedAsc) {
    const n = sortedAsc.length;
    if (n === 0) return 0;
    let less = 0;
    let equal = 0;
    for (let i = 0; i < n; i++) {
        if (sortedAsc[i] < val) less++;
        else if (sortedAsc[i] === val) equal++;
        else break;
    }
    return Number((((less + 0.5 * equal) / n) * 100).toFixed(2));
}

function computeRank(val, sortedAsc) {
    const n = sortedAsc.length;
    let strictlyGreater = 0;
    for (let i = n - 1; i >= 0; i--) {
        if (sortedAsc[i] > val) strictlyGreater++;
        else break;
    }
    return strictlyGreater + 1;
}

function quantileFromSorted(sortedAsc, q) {
    const n = sortedAsc.length;
    if (n === 0) return 0;
    const clampedQ = Math.max(0, Math.min(1, q));
    const pos = (n - 1) * clampedQ;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sortedAsc[base + 1] !== undefined) {
        return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
    }
    return sortedAsc[base];
}

function loadYearDataset(year, clubAliasIndex) {
    const useLbenzPrimary = year <= 2010;
    const yy = String(year).slice(-2);

    const lbenzPath = path.join(RAW_FIFA_DIR, `lbenz_player_stats_${year}.csv`);
    const eafcFile = year <= 2023 ? `eafc_dataset_fifa_${yy}.csv` : `eafc_dataset_ea_fc_${yy}.csv`;
    const eafcPath = path.join(RAW_FIFA_DIR, eafcFile);

    let chosenPath = useLbenzPrimary ? lbenzPath : eafcPath;
    let sourceType = useLbenzPrimary ? 'lbenz' : 'eafc';

    if (!fs.existsSync(chosenPath)) {
        if (fs.existsSync(eafcPath)) {
            chosenPath = eafcPath;
            sourceType = 'eafc';
        } else if (fs.existsSync(lbenzPath)) {
            chosenPath = lbenzPath;
            sourceType = 'lbenz';
        } else {
            return null;
        }
    }

    const csvText = fs.readFileSync(chosenPath, 'utf8');
    const rawRows = parseCsvRecords(csvText);
    const players = [];

    for (const row of rawRows) {
        if (sourceType === 'lbenz') {
            const overall = toValidNum(row.rating);
            if (!overall) continue;
            const rawPos = [row.preferred_positions, row.club_position].filter(Boolean).join('/');
            const positions = normalizeAnalysisPositions(rawPos);
            if (positions.length === 0) continue;
            const isGk = positions[0] === 'GK';

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
                gk_diving: toValidNum(row.gk_diving) ?? toValidNum(row.gk_rushing) ?? (isGk ? null : 11),
                gk_handling: toValidNum(row.gk_handling) ?? (isGk ? null : 11),
                gk_kicking: toValidNum(row.gk_kicking) ?? (isGk ? null : 11),
                gk_positioning: toValidNum(row.gk_positioning) ?? (isGk ? null : 11),
                gk_reflexes: toValidNum(row.gk_reflexes) ?? (isGk ? null : 11),
            };

            const agg = aggregateAttributes(tech);
            players.push({
                year,
                source: `lbenz730/fifa_model (FIFA ${yy})`,
                name: (row.name || '').trim(),
                shortName: (row.name || '').trim(),
                longName: (row.name || '').trim(),
                aliasName: '',
                club: canonicalizeClubName(row.club, clubAliasIndex) || row.club || '',
                rawClub: row.club || '',
                positions,
                primaryPosition: positions[0],
                overall,
                agg,
            });
        } else {
            const overall = toValidNum(row.overall);
            if (!overall) continue;
            const positions = normalizeAnalysisPositions(row.positions);
            if (positions.length === 0) continue;
            const isGk = positions[0] === 'GK';

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
                gk_diving: toValidNum(row.gk_diving) ?? (isGk ? null : 11),
                gk_handling: toValidNum(row.gk_handling) ?? (isGk ? null : 11),
                gk_kicking: toValidNum(row.gk_kicking) ?? (isGk ? null : 11),
                gk_positioning: toValidNum(row.gk_positioning) ?? (isGk ? null : 11),
                gk_reflexes: toValidNum(row.gk_reflexes) ?? (isGk ? null : 11),
            };

            const agg = aggregateAttributes(tech);
            players.push({
                year,
                source: `mzafram2001/ea-fc (${row.game_version || 'FIFA ' + yy})`,
                name: (row.long_name || row.short_name || '').trim(),
                shortName: (row.short_name || '').trim(),
                longName: (row.long_name || '').trim(),
                aliasName: (row.alias || '').trim(),
                club: canonicalizeClubName(row.club_name, clubAliasIndex) || row.club_name || '',
                rawClub: row.club_name || '',
                positions,
                primaryPosition: positions[0],
                overall,
                agg,
            });
        }
    }

    return {
        year,
        source: players[0]?.source || sourceType,
        players,
    };
}

// Fixed-size elite position pool sizes (reflecting top-flight European starter/rotation pool,
// invariant to EA adding lower-tier leagues in 2011-2024):
const ELITE_POS_POOL_SIZE = {
    GK: 350,
    DF: 1200,
    MF: 1400,
    FW: 900,
};

function main() {
    const seasonPool = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'season-pool.json'), 'utf8')
    );
    const clubAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'club-aliases.json'), 'utf8')
    );
    const playerAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'player-aliases.json'), 'utf8')
    );
    const fallbackSeasons = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'fallback-team-seasons.json'), 'utf8')
    );

    const extendedPlayerAliases = {
        ...playerAliases,
        Ronaldinho: [
            'Ronaldinho',
            'Ronaldinho Gaúcho',
            'Ronaldo de Assis Moreira',
            'R. de Assis Moreira',
        ],
        'Thierry Henry': ['Thierry Henry'],
        'Paolo Maldini': ['Paolo Maldini', 'P. Maldini', 'Maldini'],
        'Gianluigi Buffon': ['Gianluigi Buffon', 'G. Buffon', 'Buffon'],
        'Manuel Neuer': ['Manuel Neuer', 'M. Neuer', 'Neuer'],
        'Erling Haaland': ['Erling Haaland', 'E. Haaland', 'Erling Braut Haaland'],
    };

    const knownClubs = [...new Set(seasonPool.map((s) => s.club))];
    const knownPlayers = [
        ...new Set([
            ...fallbackSeasons.flatMap((ts) => ts.players.map((p) => p.name)),
            'Ronaldinho',
        ]),
    ];

    const clubAliasIndex = buildAliasIndex(clubAliases, knownClubs);
    const playerAliasIndex = buildAliasIndex(extendedPlayerAliases, knownPlayers);

    const years = [];
    for (let y = 2005; y <= 2024; y++) years.push(y);

    const yearlyData = new Map();
    const yearlySummary = [];

    console.log('[analyze-era-drift] Loading full raw FIFA datasets for 2005-2024...');

    for (const year of years) {
        const ds = loadYearDataset(year, clubAliasIndex);
        if (!ds) continue;

        const seen = new Set();
        const uniquePlayers = [];
        for (const p of ds.players) {
            const k = `${p.longName}::${p.rawClub}::${p.overall}`;
            if (!seen.has(k)) {
                seen.add(k);
                uniquePlayers.push(p);
            }
        }
        ds.players = uniquePlayers;

        const overalls = uniquePlayers.map((p) => p.overall);
        const sortedOveralls = [...overalls].sort((a, b) => a - b);

        // Full position sorted overall arrays
        const posSortedOveralls = {
            GK: uniquePlayers.filter((p) => p.primaryPosition === 'GK').map((p) => p.overall).sort((a, b) => a - b),
            DF: uniquePlayers.filter((p) => p.primaryPosition === 'DF').map((p) => p.overall).sort((a, b) => a - b),
            MF: uniquePlayers.filter((p) => p.primaryPosition === 'MF').map((p) => p.overall).sort((a, b) => a - b),
            FW: uniquePlayers.filter((p) => p.primaryPosition === 'FW').map((p) => p.overall).sort((a, b) => a - b),
        };

        // Fixed-size Elite Position Cohort sorted ascending (for database-size-invariant percentile mapping)
        const elitePosSortedOveralls = {
            GK: posSortedOveralls.GK.slice(-ELITE_POS_POOL_SIZE.GK),
            DF: posSortedOveralls.DF.slice(-ELITE_POS_POOL_SIZE.DF),
            MF: posSortedOveralls.MF.slice(-ELITE_POS_POOL_SIZE.MF),
            FW: posSortedOveralls.FW.slice(-ELITE_POS_POOL_SIZE.FW),
        };

        const validAggPlayers = uniquePlayers.filter((p) => p.agg !== null);
        const outfieldAgg = validAggPlayers.filter((p) => p.primaryPosition !== 'GK');
        const gkAgg = validAggPlayers.filter((p) => p.primaryPosition === 'GK');
        const fwMfAgg = validAggPlayers.filter(
            (p) => p.positions.includes('FW') || p.positions.includes('MF')
        );
        const dfMfAgg = validAggPlayers.filter(
            (p) => p.positions.includes('DF') || p.positions.includes('MF')
        );
        const pureDfAgg = validAggPlayers.filter(
            (p) => p.positions.includes('DF') && !p.positions.includes('FW') && !p.positions.includes('MF')
        );
        const pureFwAgg = validAggPlayers.filter(
            (p) => p.positions.includes('FW') && !p.positions.includes('DF') && !p.positions.includes('MF')
        );
        const dfPosAgg = validAggPlayers.filter((p) => p.primaryPosition === 'DF');
        const mfPosAgg = validAggPlayers.filter((p) => p.primaryPosition === 'MF');
        const fwPosAgg = validAggPlayers.filter((p) => p.primaryPosition === 'FW');

        const yearCalibModel = {
            overall: {
                elite500: buildCohortDistribution(overalls, 500),
                byPos: {
                    GK: buildCohortDistribution(posSortedOveralls.GK, ELITE_POS_POOL_SIZE.GK),
                    DF: buildCohortDistribution(posSortedOveralls.DF, ELITE_POS_POOL_SIZE.DF),
                    MF: buildCohortDistribution(posSortedOveralls.MF, ELITE_POS_POOL_SIZE.MF),
                    FW: buildCohortDistribution(posSortedOveralls.FW, ELITE_POS_POOL_SIZE.FW),
                },
            },
            attack: {
                fwMfElite500: buildCohortDistribution(fwMfAgg.map((p) => p.agg.attack), 500),
                fwMf: buildCohortDistribution(fwMfAgg.map((p) => p.agg.attack), 1800),
                df: buildCohortDistribution(pureDfAgg.map((p) => p.agg.attack), 1200),
            },
            creation: {
                mfFwElite500: buildCohortDistribution(fwMfAgg.map((p) => p.agg.creation), 500),
                mfFw: buildCohortDistribution(fwMfAgg.map((p) => p.agg.creation), 1800),
                df: buildCohortDistribution(pureDfAgg.map((p) => p.agg.creation), 1200),
            },
            defense: {
                dfMfElite500: buildCohortDistribution(dfMfAgg.map((p) => p.agg.defense), 500),
                dfMf: buildCohortDistribution(dfMfAgg.map((p) => p.agg.defense), 1800),
                fw: buildCohortDistribution(pureFwAgg.map((p) => p.agg.defense), 900),
            },
            physical: {
                outfieldElite500: buildCohortDistribution(outfieldAgg.map((p) => p.agg.physical), 500),
                gkElite100: buildCohortDistribution(gkAgg.map((p) => p.agg.physical), 100),
                byPos: {
                    GK: buildCohortDistribution(gkAgg.map((p) => p.agg.physical), ELITE_POS_POOL_SIZE.GK),
                    DF: buildCohortDistribution(dfPosAgg.map((p) => p.agg.physical), ELITE_POS_POOL_SIZE.DF),
                    MF: buildCohortDistribution(mfPosAgg.map((p) => p.agg.physical), ELITE_POS_POOL_SIZE.MF),
                    FW: buildCohortDistribution(fwPosAgg.map((p) => p.agg.physical), ELITE_POS_POOL_SIZE.FW),
                },
            },
            goalkeeping: {
                gkElite100: buildCohortDistribution(gkAgg.map((p) => p.agg.goalkeeping), 100),
                gkElite350: buildCohortDistribution(gkAgg.map((p) => p.agg.goalkeeping), ELITE_POS_POOL_SIZE.GK),
            },
        };

        const attrDistributions = {
            attack: computeStats(outfieldAgg.map((p) => p.agg.attack)),
            creation: computeStats(outfieldAgg.map((p) => p.agg.creation)),
            defense: computeStats(outfieldAgg.map((p) => p.agg.defense)),
            physical: computeStats(outfieldAgg.map((p) => p.agg.physical)),
            goalkeeping: computeStats(gkAgg.map((p) => p.agg.goalkeeping)),
            allPlayers: {
                attack: computeStats(validAggPlayers.map((p) => p.agg.attack)),
                creation: computeStats(validAggPlayers.map((p) => p.agg.creation)),
                defense: computeStats(validAggPlayers.map((p) => p.agg.defense)),
                physical: computeStats(validAggPlayers.map((p) => p.agg.physical)),
                goalkeeping: computeStats(validAggPlayers.map((p) => p.agg.goalkeeping)),
            },
        };

        const overallStats = computeStats(overalls);

        yearlyData.set(year, {
            ...ds,
            sortedOveralls,
            posSortedOveralls,
            elitePosSortedOveralls,
            overallStats,
            attrDistributions,
            yearCalibModel,
        });

        yearlySummary.push({
            year,
            source: ds.source,
            overall: overallStats,
            attributes: {
                attack: attrDistributions.attack,
                creation: attrDistributions.creation,
                defense: attrDistributions.defense,
                physical: attrDistributions.physical,
                goalkeeping: attrDistributions.goalkeeping,
            },
        });
    }

    // 2. Classic 13 Players Multi-Year Sampling
    const SAMPLED_LEGENDS = [
        { canonical: 'Cristiano Ronaldo', primaryPos: 'FW' },
        { canonical: 'Lionel Messi', primaryPos: 'FW' },
        { canonical: 'Thierry Henry', primaryPos: 'FW' },
        { canonical: 'Kaka', primaryPos: 'MF' },
        { canonical: 'Ronaldinho', primaryPos: 'MF' },
        { canonical: 'Xavi', primaryPos: 'MF' },
        { canonical: 'Andres Iniesta', primaryPos: 'MF' },
        { canonical: 'Paolo Maldini', primaryPos: 'DF' },
        { canonical: 'Gianluigi Buffon', primaryPos: 'GK' },
        { canonical: 'Manuel Neuer', primaryPos: 'GK' },
        { canonical: 'Robert Lewandowski', primaryPos: 'FW' },
        { canonical: 'Kylian Mbappe', primaryPos: 'FW' },
        { canonical: 'Erling Haaland', primaryPos: 'FW' },
    ];

    const legendTrajectories = {};
    for (const leg of SAMPLED_LEGENDS) {
        const entries = [];
        for (const year of years) {
            const yd = yearlyData.get(year);
            if (!yd) continue;

            const matches = yd.players.filter((p) => {
                for (const nm of [p.longName, p.shortName, p.aliasName]) {
                    if (!nm) continue;
                    const res = canonicalizePlayerName(nm, playerAliasIndex);
                    if (res.canonicalName === leg.canonical) return true;
                }
                return false;
            });

            if (matches.length > 0) {
                const filtered = matches.filter((m) => {
                    if (leg.canonical === 'Cristiano Ronaldo') {
                        return (
                            m.longName.includes('Cristiano') ||
                            m.shortName.includes('C. Ronaldo') ||
                            ['Manchester United', 'Real Madrid', 'Juventus'].includes(m.club) ||
                            m.rawClub.includes('Al Nassr')
                        );
                    }
                    if (leg.canonical === 'Lionel Messi') {
                        return (
                            m.longName.includes('Lionel') ||
                            m.shortName.includes('L. Messi') ||
                            ['Barcelona'].includes(m.club) ||
                            m.rawClub.includes('Paris') ||
                            m.rawClub.includes('Miami')
                        );
                    }
                    if (leg.canonical === 'Thierry Henry') {
                        return (
                            year <= 2015 &&
                            (m.longName.includes('Thierry') ||
                                ['Arsenal', 'Barcelona'].includes(m.club) ||
                                m.rawClub.includes('New York'))
                        );
                    }
                    if (leg.canonical === 'Kaka') {
                        return (
                            ['AC Milan', 'Real Madrid'].includes(m.club) ||
                            m.rawClub.includes('Orlando') ||
                            m.rawClub.includes('São Paulo') ||
                            m.overall >= 80
                        );
                    }
                    if (leg.canonical === 'Erling Haaland') {
                        return m.longName.includes('Erling') || m.shortName.includes('E. Haaland');
                    }
                    return true;
                });

                if (filtered.length > 0) {
                    filtered.sort((a, b) => b.overall - a.overall);
                    const best = filtered[0];
                    const posGroup = best.primaryPosition;
                    const posArr = yd.posSortedOveralls[posGroup] || yd.sortedOveralls;

                    const editionPct = computePercentile(best.overall, yd.sortedOveralls);
                    const positionPct = computePercentile(best.overall, posArr);
                    const editionRank = computeRank(best.overall, yd.sortedOveralls);
                    const positionRank = computeRank(best.overall, posArr);

                    entries.push({
                        year,
                        club: best.club || best.rawClub,
                        position: best.positions.join('/'),
                        primaryPosition: posGroup,
                        rawOverall: best.overall,
                        editionPercentile: editionPct,
                        positionPercentile: positionPct,
                        editionRank,
                        editionTotal: yd.sortedOveralls.length,
                        positionRank,
                        positionTotal: posArr.length,
                        attack: best.agg?.attack ?? null,
                        creation: best.agg?.creation ?? null,
                        defense: best.agg?.defense ?? null,
                        physical: best.agg?.physical ?? null,
                        goalkeeping: best.agg?.goalkeeping ?? null,
                    });
                }
            }
        }
        legendTrajectories[leg.canonical] = entries;
    }

    // 3. Reference Era (2017-2024 Modern Calibrated Era)
    // In 2017-2024, EA stabilized the modern 1-99 scale (P99 = 82-83, 85+ = 84-115, 90+ = 7-15, Top100Mean = 86.3-87.3).
    const refYears = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

    const refElitePosOveralls = {
        GK: refYears.flatMap((y) => yearlyData.get(y)?.elitePosSortedOveralls.GK || []).sort((a, b) => a - b),
        DF: refYears.flatMap((y) => yearlyData.get(y)?.elitePosSortedOveralls.DF || []).sort((a, b) => a - b),
        MF: refYears.flatMap((y) => yearlyData.get(y)?.elitePosSortedOveralls.MF || []).sort((a, b) => a - b),
        FW: refYears.flatMap((y) => yearlyData.get(y)?.elitePosSortedOveralls.FW || []).sort((a, b) => a - b),
    };

    const refTop500Mean =
        refYears.reduce((s, y) => s + (yearlyData.get(y)?.overallStats.top500Mean || 0), 0) /
        refYears.length;
    const refTop500Std =
        refYears.reduce((s, y) => s + (yearlyData.get(y)?.overallStats.top500Std || 0), 0) /
        refYears.length;

    const refAttrTop500 = {};
    for (const attr of ['attack', 'creation', 'defense', 'physical', 'goalkeeping']) {
        refAttrTop500[attr] = {
            mean:
                refYears.reduce(
                    (s, y) => s + (yearlyData.get(y)?.attrDistributions[attr].top500Mean || 0),
                    0
                ) / refYears.length,
            std:
                refYears.reduce(
                    (s, y) => s + (yearlyData.get(y)?.attrDistributions[attr].top500Std || 0),
                    0
                ) / refYears.length,
        };
    }

    const yearsCalibMap = {};
    for (const y of years) {
        const yd = yearlyData.get(y);
        if (yd?.yearCalibModel) {
            yearsCalibMap[String(y)] = yd.yearCalibModel;
        }
    }

    const refModels = refYears.map((y) => yearsCalibMap[String(y)]).filter(Boolean);
    const referenceCalibModel = {
        overall: {
            elite500: mergeCohortDistributions(refModels.map((m) => m.overall.elite500)),
            byPos: {
                GK: mergeCohortDistributions(refModels.map((m) => m.overall.byPos.GK)),
                DF: mergeCohortDistributions(refModels.map((m) => m.overall.byPos.DF)),
                MF: mergeCohortDistributions(refModels.map((m) => m.overall.byPos.MF)),
                FW: mergeCohortDistributions(refModels.map((m) => m.overall.byPos.FW)),
            },
        },
        attack: {
            fwMfElite500: mergeCohortDistributions(refModels.map((m) => m.attack.fwMfElite500)),
            fwMf: mergeCohortDistributions(refModels.map((m) => m.attack.fwMf)),
            df: mergeCohortDistributions(refModels.map((m) => m.attack.df)),
        },
        creation: {
            mfFwElite500: mergeCohortDistributions(refModels.map((m) => m.creation.mfFwElite500)),
            mfFw: mergeCohortDistributions(refModels.map((m) => m.creation.mfFw)),
            df: mergeCohortDistributions(refModels.map((m) => m.creation.df)),
        },
        defense: {
            dfMfElite500: mergeCohortDistributions(refModels.map((m) => m.defense.dfMfElite500)),
            dfMf: mergeCohortDistributions(refModels.map((m) => m.defense.dfMf)),
            fw: mergeCohortDistributions(refModels.map((m) => m.defense.fw)),
        },
        physical: {
            outfieldElite500: mergeCohortDistributions(refModels.map((m) => m.physical.outfieldElite500)),
            gkElite100: mergeCohortDistributions(refModels.map((m) => m.physical.gkElite100)),
            byPos: {
                GK: mergeCohortDistributions(refModels.map((m) => m.physical.byPos.GK)),
                DF: mergeCohortDistributions(refModels.map((m) => m.physical.byPos.DF)),
                MF: mergeCohortDistributions(refModels.map((m) => m.physical.byPos.MF)),
                FW: mergeCohortDistributions(refModels.map((m) => m.physical.byPos.FW)),
            },
        },
        goalkeeping: {
            gkElite100: mergeCohortDistributions(refModels.map((m) => m.goalkeeping.gkElite100)),
            gkElite350: mergeCohortDistributions(refModels.map((m) => m.goalkeeping.gkElite350)),
        },
    };

    const calibrationModel = {
        referenceEra: '2017-2024',
        referenceYears: refYears,
        reference: referenceCalibModel,
        years: yearsCalibMap,
    };

    // Evaluate 3 Normalization Schemes on 30 Iconic Player-Seasons from season-pool.json
    const buildReport = JSON.parse(
        fs.readFileSync(path.join(REPORTS_DIR, 'build-report.json'), 'utf8')
    );

    const SHOWCASE_IDS = [
        { teamSeasonId: 'chelsea-2005', name: 'John Terry' },
        { teamSeasonId: 'chelsea-2005', name: 'Frank Lampard' },
        { teamSeasonId: 'chelsea-2005', name: 'Petr Cech' },
        { teamSeasonId: 'liverpool-2005', name: 'Steven Gerrard' },
        { teamSeasonId: 'ac-milan-2007', name: 'Kaka' },
        { teamSeasonId: 'ac-milan-2007', name: 'Alessandro Nesta' },
        { teamSeasonId: 'ac-milan-2007', name: 'Paolo Maldini' },
        { teamSeasonId: 'manchester-united-2008', name: 'Cristiano Ronaldo' },
        { teamSeasonId: 'manchester-united-2008', name: 'Wayne Rooney' },
        { teamSeasonId: 'manchester-united-2008', name: 'Rio Ferdinand' },
        { teamSeasonId: 'barcelona-2009', name: 'Lionel Messi' },
        { teamSeasonId: 'barcelona-2009', name: 'Xavi' },
        { teamSeasonId: 'inter-milan-2010', name: 'Wesley Sneijder' },
        { teamSeasonId: 'barcelona-2011', name: 'Lionel Messi' },
        { teamSeasonId: 'barcelona-2011', name: 'Andres Iniesta' },
        { teamSeasonId: 'real-madrid-2012', name: 'Cristiano Ronaldo' },
        { teamSeasonId: 'juventus-2012', name: 'Gianluigi Buffon' },
        { teamSeasonId: 'juventus-2012', name: 'Andrea Pirlo' },
        { teamSeasonId: 'bayern-munich-2013', name: 'Manuel Neuer' },
        { teamSeasonId: 'bayern-munich-2013', name: 'Franck Ribery' },
        { teamSeasonId: 'barcelona-2015', name: 'Lionel Messi' },
        { teamSeasonId: 'barcelona-2015', name: 'Luis Suarez' },
        { teamSeasonId: 'real-madrid-2017', name: 'Cristiano Ronaldo' },
        { teamSeasonId: 'real-madrid-2017', name: 'Luka Modric' },
        { teamSeasonId: 'monaco-2017', name: 'Kylian Mbappe' },
        { teamSeasonId: 'liverpool-2019', name: 'Virgil van Dijk' },
        { teamSeasonId: 'bayern-munich-2020', name: 'Robert Lewandowski' },
        { teamSeasonId: 'real-madrid-2022', name: 'Karim Benzema' },
        { teamSeasonId: 'manchester-city-2023', name: 'Erling Haaland' },
        { teamSeasonId: 'manchester-city-2023', name: 'Kevin De Bruyne' },
    ];

    const schemeComparison = [];

    for (const item of SHOWCASE_IDS) {
        const pRep = buildReport.players.find(
            (p) => p.teamSeasonId === item.teamSeasonId && p.name === item.name
        );
        if (!pRep) continue;

        const yd = yearlyData.get(pRep.year);
        if (!yd) continue;

        const primaryPos = pRep.positions[0];
        const posArr = yd.posSortedOveralls[primaryPos] || yd.sortedOveralls;
        const elitePosArr = yd.elitePosSortedOveralls[primaryPos] || posArr;

        const rawOverall = pRep.provenance?.rawOverall ?? pRep.overall;
        const rawAttack = pRep.provenance?.rawAttack ?? pRep.attack;
        const rawCreation = pRep.provenance?.rawCreation ?? pRep.creation;
        const rawDefense = pRep.provenance?.rawDefense ?? pRep.defense;
        const rawPhysical = pRep.provenance?.rawPhysical ?? pRep.physical;
        const rawGoalkeeping = pRep.provenance?.rawGoalkeeping ?? pRep.goalkeeping;

        const editionPct = computePercentile(rawOverall, yd.sortedOveralls);
        const positionPct = computePercentile(rawOverall, posArr);
        const elitePositionPct = computePercentile(rawOverall, elitePosArr);
        const editionRank = computeRank(rawOverall, yd.sortedOveralls);
        const positionRank = computeRank(rawOverall, posArr);

        const calibRes = calibratePlayerStats(
            {
                overall: rawOverall,
                attack: rawAttack,
                creation: rawCreation,
                defense: rawDefense,
                physical: rawPhysical,
                goalkeeping: rawGoalkeeping,
            },
            pRep.positions,
            pRep.year,
            calibrationModel,
            'hybrid'
        );

        const scheme1Raw = rawOverall;
        const scheme2PctMapped = calibRes.stats.overall.pctCalibrated;
        const scheme3Hybrid = calibRes.stats.overall.hybridCalibrated;

        const s3Stats = {
            attack: calibRes.stats.attack.hybridCalibrated,
            creation: calibRes.stats.creation.hybridCalibrated,
            defense: calibRes.stats.defense.hybridCalibrated,
            physical: calibRes.stats.physical.hybridCalibrated,
            goalkeeping: calibRes.stats.goalkeeping.hybridCalibrated,
        };

        schemeComparison.push({
            teamSeasonId: pRep.teamSeasonId,
            playerName: pRep.name,
            club: pRep.club,
            year: pRep.year,
            positions: pRep.positions,
            editionRank,
            positionRank,
            editionPercentile: editionPct,
            positionPercentile: positionPct,
            elitePositionPercentile: elitePositionPct,
            rawStats: {
                overall: rawOverall,
                attack: rawAttack,
                creation: rawCreation,
                defense: rawDefense,
                physical: rawPhysical,
                goalkeeping: rawGoalkeeping,
            },
            scheme1_raw: scheme1Raw,
            scheme2_percentile: scheme2PctMapped,
            scheme3_hybrid: scheme3Hybrid,
            scheme3_stats: s3Stats,
            delta_s2: scheme2PctMapped - scheme1Raw,
            delta_s3: scheme3Hybrid - scheme1Raw,
        });
    }

    const reportJson = {
        pipelineVersion: '1.1.0',
        description:
            '2005-2024 FIFA / EA FC Era Rating Drift Statistical Analysis & Normalization Proposals',
        referenceEra: '2017-2024 Modern Calibrated SoFIFA Distribution',
        referenceStats: {
            refTop500Mean: Number(refTop500Mean.toFixed(2)),
            refTop500Std: Number(refTop500Std.toFixed(2)),
            elitePositionPoolSizes: ELITE_POS_POOL_SIZE,
        },
        yearlyDistributions: yearlySummary,
        classicPlayerTrajectories: legendTrajectories,
        normalizationShowcase: schemeComparison,
        calibrationModel,
    };

    fs.writeFileSync(
        path.join(REPORTS_DIR, 'era-calibration.json'),
        JSON.stringify(reportJson, null, 2) + '\n',
        'utf8'
    );

    // Generate comprehensive Markdown report data/reports/era-calibration.md
    const md = [];
    md.push('# 2005–2024 FIFA / EA FC 年代评分漂移（Era Rating Drift）统计分析与标准化方案');
    md.push('');
    md.push('> **阶段说明**：本报告基于 `data/raw/fifa/` 中已下载的 2005～2024 共 **20 个完整年度**原始 FIFA / EA FC 数据库（共 **296,174** 条去重球员赛季记录）进行统计分析。本阶段仅输出统计结论与校准方案建议，**未修改** `public/data/team-seasons.js` 或任何游戏代码。');
    md.push('');
    md.push('---');
    md.push('');
    md.push('## 一、核心结论：不同 FIFA 年代的 90 分是否具有相同含义？');
    md.push('');
    md.push('**结论：完全不同。2005～2024 年间存在显著的“四阶段年代评分漂移（Era Drift）”，尤其在顶层精英区间（Overall 85+ / 90+）与防守/身体子属性上差异巨大。**');
    md.push('');
    md.push('1. **Era I：早期膨胀期（2005–2006，FIFA 05–06）**');
    md.push('   - **90+ 人数高达 44～60 人**（2005 年 `90+` 有 **60 人**，`85+` 多达 **183 人**；全库 Top 1% 分位线高达 **87.0**，Top 100 均值高达 **90.49**，最高分 Thierry Henry / Gianluigi Buffon 达到 **97**）。');
    md.push('   - 在 **FIFA 05（2005）** 中拿到 **90 分**，仅代表全游戏 **第 43～60 名**（约前 `0.55%`），其真实稀缺度只相当于现代版本（2017–2024）的 **86～87 分**。');
    md.push('2. **Era II：阶梯式压缩过渡期（2007–2008，FIFA 07–08）**');
    md.push('   - EA 开始大幅收紧高分段：`90+` 人数骤降至 **8 人**，`85+` 降至 **87～105 人**，Top 100 均值回落至 **86.16～86.71**。');
    md.push('   - 此时的 **90 分** 代表全游戏 **Top 8（前 0.08%）**。');
    md.push('3. **Era III：大幅通缩低谷期 / 梅罗垄断期（2009–2016，尤其 2010–2015，FIFA 10–15）**');
    md.push('   - **2010 与 2011 年（FIFA 10–11）全游戏最高分仅 90 分，全球仅有 1 名球员达到 90 分**（2010/2011 Lionel Messi `90`，全库 `85+` 暴跌至仅 **42～59 人**，Top 1% 跌至 **81.0**）。');
    md.push('   - **2012–2016 年**，EA 将 `92–94` 变成梅西与 C 罗的专属区间，其余世界前三/金球奖候选人被整体压制在 `86–90`（每年 `90+` 仅 **3～6 人**，`85+` 仅 **47～63 人**）。');
    md.push('   - 在 **2010–2015** 拿到 **90 分**，意味着你是 **全球前 1～5 名的绝对统治级超巨**（在现代版本或早期版本中对应 **92～94 分**）；而当时许多金球奖前三名级别的中场/门将（如 2009/2011 Xavi `87`、2011 Iniesta `87`、2010 Sneijder `83/86`、2012 Buffon `86`、2013 Neuer `86`）原始总评只有 `85–87`。');
    md.push('4. **Era IV：现代再平衡与后梅罗时代（2017–2024，FIFA 17 – EA FC 24）**');
    md.push('   - **2017–2022 年**：中上层精英池恢复稳定（`85+` 稳定在 **85～115 人**，`90+` 稳定在 **9～15 人**，Top 1% 稳定在 **83.0**）。');
    md.push('   - **2023–2024 年**：随着梅西与 C 罗离开欧洲主流联赛，绝对天花板从 `94` 回落至 **`91`**（Mbappé、Haaland、De Bruyne 并列 `91`），`90+` 为 **7～8 人**，`85+` 为 **84～86 人**。');
    md.push('');
    md.push('---');
    md.push('');
    md.push('## 二、2005–2024 全体球员 Overall 年度分布统计表');
    md.push('');
    md.push('| Year | 数据源版本 | 球员总数 (N) | Mean | Median | Std | Top 1% (P99) | Top 5% (P95) | Top 10% (P90) | 90+ 人数 | 85+ 人数 | Top 100 Mean | Max |');
    md.push('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
    for (const ys of yearlySummary) {
        const o = ys.overall;
        md.push(
            `| **${ys.year}** | \`${ys.source}\` | ${o.count} | ${o.mean.toFixed(2)} | ${o.median.toFixed(0)} | ${o.std.toFixed(2)} | **${o.top1Pct.toFixed(1)}** | ${o.top5Pct.toFixed(1)} | ${o.top10Pct.toFixed(1)} | **${o.count90Plus}** | **${o.count85Plus}** | ${o.top100Mean.toFixed(2)} | ${o.max} |`
        );
    }
    md.push('');
    md.push('> **注（底层样本库扩容效应）**：2005–2010 年样本数约 `10,000～10,960` 人；2011 年起 EA 扩充了更多次级联赛与边缘联赛，全库人数增至 `15,204 → 18,508` 人。因此 `90+ 人数`、`85+ 人数` 与 `Top 100 Mean` 比全库 `Mean` 更能直接反映顶层精英评分尺度的变化。');
    md.push('');
    md.push('---');
    md.push('');
    md.push('## 三、五维聚合技术属性（Attack / Creation / Defense / Physical / Goalkeeping）年度分布变化');
    md.push('');
    md.push('下表统计非门将球员（Outfield）在 `attack`、`creation`、`defense`、`physical` 四维，以及门将（GK）在 `goalkeeping` 维度的年度 **Mean / Top 1% (P99) / 85+ 人数**：');
    md.push('');
    md.push('| Year | Attack (Mean / P99 / 85+) | Creation (Mean / P99 / 85+) | Defense (Mean / P99 / 85+) | Physical (Mean / P99 / 85+) | Goalkeeping (Mean / P99 / 85+) |');
    md.push('| :---: | :---: | :---: | :---: | :---: | :---: |');
    for (const ys of yearlySummary) {
        const a = ys.attributes;
        md.push(
            `| **${ys.year}** | ${a.attack.mean.toFixed(1)} / **${a.attack.top1Pct.toFixed(0)}** / ${a.attack.count85Plus}人 | ${a.creation.mean.toFixed(1)} / **${a.creation.top1Pct.toFixed(0)}** / ${a.creation.count85Plus}人 | ${a.defense.mean.toFixed(1)} / **${a.defense.top1Pct.toFixed(0)}** / ${a.defense.count85Plus}人 | ${a.physical.mean.toFixed(1)} / **${a.physical.top1Pct.toFixed(0)}** / ${a.physical.count85Plus}人 | ${a.goalkeeping.mean.toFixed(1)} / **${a.goalkeeping.top1Pct.toFixed(0)}** / ${a.goalkeeping.count85Plus}人 |`
        );
    }
    md.push('');
    md.push('### 五维子属性漂移特征总结：');
    md.push('1. **`defense` 与 `physical` 在 2005–2006 存在极度膨胀**：');
    md.push('   - 2005 年 `defense 85+` 有 **172 人**、`physical 85+` 有 **234 人**（P99 均为 `87`）；而在 2011–2024 年，`defense 85+` 仅有 **20～43 人**，`physical 85+` 仅有 **13～27 人**（P99 稳定在 `80–81`）。这意味着直接未校准的 2005 后卫/后腰在防守和身体维度上比现代顶级后卫高出 **5～7 分**。');
    md.push('2. **`attack` 在 2011 年后经历了结构性下调**：');
    md.push('   - 2005–2006 年 `attack 85+` 多达 **114～118 人**（P99 为 `85–86`）；2007–2010 年降至 **37～50 人**（P99 为 `82`）；2011–2024 年稳定在 **14～28 人**（P99 为 `78–80`）。现代版本中只有最顶级的约 20 名射手能达到聚合 `attack >= 85`。');
    md.push('3. **`creation` 最为稳定，但 2009–2013 巴萨黄金一代拉高了顶层上限**：');
    md.push('   - 2007–2024 年间 `creation` 的 P99 长期稳定在 `80–83` 之间，`85+` 人数稳定在 **35～65 人**。');
    md.push('4. **`goalkeeping` 在 2011–2016 极度严苛**：');
    md.push('   - 2014 年全球仅有 **1 名门将**（Neuer）聚合 `goalkeeping >= 85`，2012–2016 年每年仅 **1～5 人**，直到 2019–2024 年才恢复至 **10～14 人**。');
    md.push('');
    md.push('---');
    md.push('');
    md.push('## 四、13 名经典球员跨年代抽样追踪（Raw Overall / Edition Percentile / Position Percentile）');
    md.push('');
    for (const leg of SAMPLED_LEGENDS) {
        const traj = legendTrajectories[leg.canonical] || [];
        md.push(`### 4.${SAMPLED_LEGENDS.indexOf(leg) + 1} ${leg.canonical}`);
        md.push('');
        md.push('| Year | Club | Pos | Raw OVR | Edition Percentile (Rank/N) | Position Percentile (Rank/PosN) | ATK | CRE | DEF | PHY | GK |');
        md.push('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
        for (const t of traj) {
            md.push(
                `| ${t.year} | ${t.club} | ${t.position} | **${t.rawOverall}** | ${t.editionPercentile.toFixed(2)}% (#${t.editionRank}/${t.editionTotal}) | **${t.positionPercentile.toFixed(2)}%** (#${t.positionRank}/${t.positionTotal}) | ${t.attack} | ${t.creation} | ${t.defense} | ${t.physical} | ${t.goalkeeping} |`
            );
        }
        md.push('');
    }
    md.push('---');
    md.push('');
    md.push('## 五、三种跨年代标准化方案（Normalization Schemes）设计');
    md.push('');
    md.push('为了解决 2005–2006 评分膨胀与 2009–2015 评分通缩带来的跨年代不公平问题，同时避免因 EA 扩充低级别联赛样本导致分位数失真，我们提出并对比以下 3 种方案（以 **2017–2024 现代稳定期分布** 作为统一参考锚点）：');
    md.push('');
    md.push('### 方案 1：Raw Rating 不调整（Baseline Unadjusted）');
    md.push('- **定义**：直接使用各年度 FIFA 原始 `overall` 及加权聚合后的五维属性：');
    md.push('  $$\\text{OVR}_{\\text{S1}} = \\text{OVR}_{\\text{raw}}$$');
    md.push('- **优点**：与当年游戏卡面完全一致，直观透明。');
    md.push('- **缺点**：2005 赛季（Chelsea 2005、Liverpool 2005、PSV 2005）吃尽早期版本膨胀红利，而 2009–2015 赛季（如 2011 巴萨、2010 国米、2012 尤文、2013 拜仁）除梅罗外的核心球员普遍偏低 `2～4` 分。');
    md.push('');
    md.push('### 方案 2：同位置精英池分位数映射（Elite-Cohort Position Percentile Mapping）');
    md.push('- **定义**：为消除底层弱队扩容干扰，每年按固定规模提取各位置顶级精英池（`Top 350 GK / Top 1200 DF / Top 1400 MF / Top 900 FW`），计算球员在当年同位置精英池中的分位数 $q_{y, \\text{pos}}$，并映射到 **2017–2024 现代参考分布** 的同位置对应分位值：');
    md.push('  $$\\text{OVR}_{\\text{S2}} = Q_{\\text{ref, pos}}\\left(F_{y, \\text{pos}}(\\text{OVR}_{\\text{raw}})\\right)$$');
    md.push('- **优点**：彻底消除年代通胀/通缩，严格反映球员在当年同位置中的相对排位。');
    md.push('- **缺点**：纯分位数映射会将每一年的位置第 1 名强制对齐到相同的现代上限（约 `91–92`），从而抹平了 **2012/2015 梅西（94）** 与 **2017 C 罗（94）** 这种历史级断层峰值。');
    md.push('');
    md.push('### 方案 3（推荐）：精英层 Z-Score 与位置分位数阻尼混合映射（Damped Elite Z-Score + Position Percentile Hybrid）');
    md.push('- **定义**：结合 **Top-500 精英池 Z-Score**（保留梅罗等断层超巨的 $+4\\sigma$ 极值突破）与 **同位置精英分位数映射**（修正位置结构偏置），并与原始评分做阻尼加权融合（`40% Raw + 35% Elite Z-Score + 25% Elite Position Percentile`）：');
    md.push('  $$\\text{OVR}_{Z} = \\mu_{\\text{ref, 500}} + \\left(\\frac{\\text{OVR}_{\\text{raw}} - \\mu_{y, 500}}{\\sigma_{y, 500}}\\right)\\cdot \\sigma_{\\text{ref, 500}}$$');
    md.push('  $$\\text{OVR}_{\\text{S3}} = \\text{round}\\left(0.40\\cdot \\text{OVR}_{\\text{raw}} + 0.35\\cdot \\text{OVR}_{Z} + 0.25\\cdot \\text{OVR}_{\\text{S2}}\\right)$$');
    md.push('- **优点**：');
    md.push('  1. **温和挤出 2005 泡沫**：将 2005 年虚高的 `90–93` 分球星合理回调 `-2` 分左右（如 2005 Gerrard `93 → 91`、Lampard `90 → 88`、Terry `89 → 87`）。');
    md.push('  2. **精准补偿 2009–2015 通缩低谷**：将 2011 梅西从 `90` 恢复至 `92`，2011 伊涅斯塔从 `87` 提升至 `89`，2012 布冯与 2013 诺伊尔从 `86` 提升至 `87–88`。');
    md.push('  3. **保留历史级 GOAT 峰值**：2012/2015 梅西（`93–94`）和 2012/2017 C 罗（`92–94`）依然保持 `92–94` 的独一档统治力。');
    md.push('  4. **现代赛季（2017–2024）零扰动**：现代球员变化全部在 `0` 至 `±1` 分以内。');
    md.push('');
    md.push('---');
    md.push('');
    md.push('## 六、30 名经典赛季球员在三种方案下的结果对比表');
    md.push('');
    md.push('| # | Player | Club | Year | Pos | Edition Rank | Elite Pos Pct | 方案1: Raw | 方案2: Pos Pct (Δ) | 方案3: Hybrid (Δ) | 方案3 五维 (ATK/CRE/DEF/PHY/GK) |');
    md.push('| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
    schemeComparison.forEach((sc, idx) => {
        const d2 = sc.delta_s2 >= 0 ? `+${sc.delta_s2}` : `${sc.delta_s2}`;
        const d3 = sc.delta_s3 >= 0 ? `+${sc.delta_s3}` : `${sc.delta_s3}`;
        const st = sc.scheme3_stats;
        md.push(
            `| ${idx + 1} | **${sc.playerName}** | ${sc.club} | ${sc.year} | ${sc.positions.join('/')} | #${sc.editionRank} | ${sc.elitePositionPercentile.toFixed(1)}% | **${sc.scheme1_raw}** | ${sc.scheme2_percentile} (${d2}) | **${sc.scheme3_hybrid}** (${d3}) | \`${st.attack}/${st.creation}/${st.defense}/${st.physical}/${st.goalkeeping}\` |`
        );
    });
    md.push('');

    fs.writeFileSync(path.join(REPORTS_DIR, 'era-calibration.md'), md.join('\n') + '\n', 'utf8');
    console.log('[analyze-era-drift] Wrote data/reports/era-calibration.json and data/reports/era-calibration.md');
}

main();

// Reusable Match Balance & Calibration Analysis Library (scripts/lib/match-balance.mjs)
// Pure ES module — deterministic, no DOM or network dependencies.

import { TEAM_SEASONS } from '../../public/data/team-seasons.js';
import { ROLES, ROSTER_SLOTS, SLOTS, getSlotRole } from '../../public/game/shared/constants.js';
import { clamp } from '../../public/game/shared/math.js';
import {
    createEmptyRoster,
    getPlayerOverall,
    canPlayerFitSlot,
} from '../../public/game/draft/rules.js';
import {
    ROLE_WEIGHTS,
    SHOT_ROLE_WEIGHTS,
    ASSIST_ROLE_WEIGHTS,
    DEFENSE_ROLE_WEIGHTS,
    MATCH_SIM_CONFIG,
} from '../../public/game/match/config.js';
import { calculateTeamProfile, getEffectiveSlotRole } from '../../public/game/match/team-profile.js';
import { getRosterEntries, generateMatchScript } from '../../public/game/match/engine.js';

export const MATCH_ATTRIBUTES = ['attack', 'creation', 'defense', 'physical', 'goalkeeping'];

export function deriveMatchSeed(baseSeed, index) {
    const startSeed = (Number(baseSeed) || 20261006) >>> 0;
    return (startSeed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

export function clampStat(value) {
    return clamp(Math.round(Number(value) || 1), 1, 99);
}

export function cloneRoster(roster) {
    return structuredClone(roster);
}

const CANONICAL_SELECTION_WEIGHTS = {
    GK: { goalkeeping: 1.0, defense: 0.08, physical: 0.10, creation: 0.10, attack: 0.0 },
    DF: { defense: 0.48, physical: 0.30, creation: 0.14, attack: 0.04, goalkeeping: 0.0 },
    MF: { creation: 0.44, attack: 0.28, defense: 0.24, physical: 0.26, goalkeeping: 0.0 },
    FW: { attack: 0.56, creation: 0.24, physical: 0.24, defense: 0.04, goalkeeping: 0.0 },
};

export function computeRoleSpecificScore(player, role) {
    const weights = CANONICAL_SELECTION_WEIGHTS[role] ?? CANONICAL_SELECTION_WEIGHTS.MF;
    let weightedSum = 0;
    let weightTotal = 0;
    for (const attr of MATCH_ATTRIBUTES) {
        const w = weights[attr] ?? 0;
        if (w > 0) {
            weightedSum += w * (Number(player[attr]) || 0);
            weightTotal += w;
        }
    }
    const functional = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const ovr = getPlayerOverall(player);
    return 0.75 * functional + 0.25 * ovr;
}

/**
 * Builds sorted candidate pools per role from all historical TEAM_SEASONS.
 * Sorted descending by role-specific score, then overall, then id.
 */
export function buildSortedRolePools(teamSeasons = TEAM_SEASONS) {
    const allPlayers = [];
    const seenIds = new Set();
    for (const ts of teamSeasons) {
        if (!ts || !Array.isArray(ts.players)) continue;
        for (const p of ts.players) {
            if (!p?.id || seenIds.has(p.id)) continue;
            seenIds.add(p.id);
            allPlayers.push(p);
        }
    }

    const pools = {};
    for (const role of ROLES) {
        const primary = allPlayers.filter((p) => p.positions?.[0] === role);
        const compatible =
            primary.length >= 20
                ? primary
                : allPlayers.filter((p) => Array.isArray(p.positions) && p.positions.includes(role));

        pools[role] = [...compatible].sort((a, b) => {
            const diffScore = computeRoleSpecificScore(b, role) - computeRoleSpecificScore(a, role);
            if (Math.abs(diffScore) > 1e-9) return diffScore;
            const diffOvr = getPlayerOverall(b) - getPlayerOverall(a);
            if (diffOvr !== 0) return diffOvr;
            return String(a.id).localeCompare(String(b.id));
        });
    }
    return pools;
}

/**
 * Deterministic selection of an 11-player 4-3-3 roster at a given quantile (0.0 = top/elite, 0.5 = median, 0.85 = weak).
 * Enforces 1 GK, 4 DF, 3 MF, 3 FW, unique player.id and unique player.name.
 */
export function buildRosterAtQuantile(quantile, rolePools = null) {
    const pools = rolePools ?? buildSortedRolePools(TEAM_SEASONS);
    const roster = createEmptyRoster();
    const usedIds = new Set();
    const usedNames = new Set();

    const roleCounts = { GK: 1, DF: 4, MF: 3, FW: 3 };

    for (const role of ROLES) {
        const pool = pools[role] || [];
        const needed = roleCounts[role];
        const maxStart = Math.max(0, pool.length - needed * 3);
        const startIdx = clamp(Math.floor(maxStart * quantile), 0, maxStart);

        const roleSlots = ROSTER_SLOTS.filter((s) => s.role === role);
        let cursor = startIdx;

        for (const slotDef of roleSlots) {
            let picked = null;
            // Search forward from startIdx
            for (let i = cursor; i < pool.length; i++) {
                const candidate = pool[i];
                if (
                    candidate &&
                    !usedIds.has(candidate.id) &&
                    !usedNames.has(candidate.name) &&
                    canPlayerFitSlot(candidate, slotDef.id)
                ) {
                    picked = candidate;
                    cursor = i + 1;
                    break;
                }
            }
            // Fallback search from beginning if near the tail
            if (!picked) {
                for (let i = 0; i < pool.length; i++) {
                    const candidate = pool[i];
                    if (
                        candidate &&
                        !usedIds.has(candidate.id) &&
                        !usedNames.has(candidate.name) &&
                        canPlayerFitSlot(candidate, slotDef.id)
                    ) {
                        picked = candidate;
                        break;
                    }
                }
            }
            if (picked) {
                roster[slotDef.id] = structuredClone(picked);
                usedIds.add(picked.id);
                usedNames.add(picked.name);
            }
        }
    }

    return roster;
}

/**
 * Builds the 4 deterministic real historical tier rosters:
 * - Elite (top ~2% quantile)
 * - Strong (~22% quantile)
 * - Average (~50% median quantile — also serves as the base CONTROL / Mirror team)
 * - Weak (~88% quantile)
 */
export function buildHistoricalTierRosters() {
    const pools = buildSortedRolePools(TEAM_SEASONS);
    return {
        Elite: buildRosterAtQuantile(0.0, pools),
        Strong: buildRosterAtQuantile(0.22, pools),
        Average: buildRosterAtQuantile(0.50, pools),
        Weak: buildRosterAtQuantile(0.88, pools),
    };
}

/**
 * Modifies selected slots and attributes on a cloned roster, clamping attributes to 1..99.
 */
export function applyRosterAttributeDelta(baseRoster, targetRoles, targetAttrs, delta) {
    const copy = cloneRoster(baseRoster);
    const roleSet = new Set(targetRoles);
    for (const slotId of SLOTS) {
        const player = copy[slotId];
        if (!player) continue;
        const slotRole = getEffectiveSlotRole(slotId);
        if (!roleSet.has(slotRole)) continue;

        for (const attr of targetAttrs) {
            if (typeof player[attr] === 'number') {
                player[attr] = clampStat(player[attr] + delta);
            }
        }
        if (targetAttrs.length === MATCH_ATTRIBUTES.length && typeof player.overall === 'number') {
            player.overall = clampStat(player.overall + delta);
        }
    }
    return copy;
}

/**
 * Builds controlled synthetic rosters from a base CONTROL roster.
 * Definitions:
 * - ATTACK_PLUS_5 / 10: 3 FW slots (FW1..FW3) attack +5 / +10
 * - CREATION_PLUS_5 / 10: 3 MF slots (MF1..MF3) creation +5 / +10
 * - DEFENSE_PLUS_5 / 10: 4 DF slots (DF1..DF4) defense +5 / +10
 * - GK_PLUS_5 / 10: 1 GK slot (GK1) goalkeeping +5 / +10
 * - PHYSICAL_PLUS_5 / 10: All 10 outfield slots (DF, MF, FW) physical +5 / +10
 * - ALL_PLUS_5 / 10: All 11 slots all 5 match attributes +5 / +10
 */
export function buildControlledSyntheticRosters(controlRoster) {
    const CONTROL = cloneRoster(controlRoster);
    return {
        CONTROL,
        ATTACK_PLUS_5: applyRosterAttributeDelta(CONTROL, ['FW'], ['attack'], 5),
        ATTACK_PLUS_10: applyRosterAttributeDelta(CONTROL, ['FW'], ['attack'], 10),
        CREATION_PLUS_5: applyRosterAttributeDelta(CONTROL, ['MF'], ['creation'], 5),
        CREATION_PLUS_10: applyRosterAttributeDelta(CONTROL, ['MF'], ['creation'], 10),
        DEFENSE_PLUS_5: applyRosterAttributeDelta(CONTROL, ['DF'], ['defense'], 5),
        DEFENSE_PLUS_10: applyRosterAttributeDelta(CONTROL, ['DF'], ['defense'], 10),
        GK_PLUS_5: applyRosterAttributeDelta(CONTROL, ['GK'], ['goalkeeping'], 5),
        GK_PLUS_10: applyRosterAttributeDelta(CONTROL, ['GK'], ['goalkeeping'], 10),
        PHYSICAL_PLUS_5: applyRosterAttributeDelta(CONTROL, ['DF', 'MF', 'FW'], ['physical'], 5),
        PHYSICAL_PLUS_10: applyRosterAttributeDelta(CONTROL, ['DF', 'MF', 'FW'], ['physical'], 10),
        ALL_PLUS_5: applyRosterAttributeDelta(CONTROL, ROLES, MATCH_ATTRIBUTES, 5),
        ALL_PLUS_10: applyRosterAttributeDelta(CONTROL, ROLES, MATCH_ATTRIBUTES, 10),
    };
}

function percentileFromHistogram(hist, totalCount, q) {
    if (totalCount <= 0) return 0;
    const target = totalCount * q;
    let cumulative = 0;
    for (let value = 0; value < hist.length; value++) {
        cumulative += hist[value];
        if (cumulative >= target) {
            return value;
        }
    }
    return hist.length - 1;
}

function createOnlineStat() {
    return { n: 0, sum: 0, sumSq: 0 };
}

function pushOnlineStat(stat, x) {
    stat.n += 1;
    stat.sum += x;
    stat.sumSq += x * x;
}

function summarizeOnlineStat(stat) {
    if (stat.n === 0) {
        return { mean: 0, sd: 0, se: 0, ci95: 0, low95: 0, high95: 0 };
    }
    const mean = stat.sum / stat.n;
    const variance = Math.max(0, stat.sumSq / stat.n - mean * mean);
    const sd = Math.sqrt(variance);
    const se = sd / Math.sqrt(stat.n);
    const ci95 = 1.96 * se;
    return {
        mean,
        sd,
        se,
        ci95,
        low95: mean - ci95,
        high95: mean + ci95,
    };
}

function buildPlayerLookup(teamA, teamB) {
    const mapA = new Map();
    const mapB = new Map();
    for (const slotId of SLOTS) {
        const pA = teamA?.[slotId];
        if (pA?.id) {
            mapA.set(pA.id, { slot: slotId, role: getSlotRole(slotId), player: pA });
        }
        const pB = teamB?.[slotId];
        if (pB?.id) {
            mapB.set(pB.id, { slot: slotId, role: getSlotRole(slotId), player: pB });
        }
    }
    return { A: mapA, B: mapB };
}

/**
 * Memory-efficient Monte Carlo batch collector.
 * Aggregates match outcomes, distributions, histograms, and role/slot event attributions without retaining event arrays.
 */
export function runBatchMatches(
    teamA,
    teamB,
    count = 10000,
    baseSeed = 20261006,
    cachedControlBaseline = null
) {
    const totalMatches = Math.max(1, Number(count) || 10000);
    const startSeed = (Number(baseSeed) || 20261006) >>> 0;
    const lookup = buildPlayerLookup(teamA, teamB);

    let winsA = 0;
    let draws = 0;
    let winsB = 0;

    let goalsA = 0;
    let goalsB = 0;
    let shotsA = 0;
    let shotsB = 0;
    let sotA = 0;
    let sotB = 0;
    let savesA = 0;
    let savesB = 0;
    let possessionSumA = 0;
    let attackSeqA = 0;
    let attackSeqB = 0;

    let cleanSheetA = 0;
    let cleanSheetB = 0;
    let anyCleanSheet = 0;
    let zeroZeroCount = 0;
    let oneGoalGameCount = 0;
    let threePlusGoalCount = 0;
    let fivePlusGoalCount = 0;
    let sevenPlusGoalCount = 0;
    let blowout4PlusCount = 0;
    let blowout5PlusCount = 0;
    let possessionClampMinHits = 0;
    let possessionClampMaxHits = 0;

    const pointsStatA = createOnlineStat();
    const winStatA = createOnlineStat();
    const goalsForStatA = createOnlineStat();
    const goalsAgainstStatA = createOnlineStat();

    const deltaPoints = createOnlineStat();
    const deltaGoalsFor = createOnlineStat();
    const deltaGoalsAgainst = createOnlineStat();
    const deltaShotsFor = createOnlineStat();
    const deltaShotsAgainst = createOnlineStat();
    const deltaSotFor = createOnlineStat();
    const deltaPossession = createOnlineStat();

    const totalGoalsHist = new Array(25).fill(0);
    const shotsHistA = new Array(45).fill(0);
    const shotsHistB = new Array(45).fill(0);
    const shotsHistTeam = new Array(45).fill(0);
    const sotHistTeam = new Array(35).fill(0);
    const possessionHistA = new Array(101).fill(0);
    const scoreHistogram = {};

    const createRoleCounter = () => ({ GK: 0, DF: 0, MF: 0, FW: 0, total: 0 });
    const createSlotCounter = () =>
        Object.fromEntries([...SLOTS.map((s) => [s, 0]), ['total', 0]]);

    const roleEvents = {
        shots: createRoleCounter(),
        goals: createRoleCounter(),
        assists: createRoleCounter(),
        creator: createRoleCounter(),
        buildUpCreator: createRoleCounter(),
        defensive: createRoleCounter(),
    };

    const roleEventsByTeam = {
        A: {
            shots: createRoleCounter(),
            goals: createRoleCounter(),
            assists: createRoleCounter(),
            creator: createRoleCounter(),
            defensive: createRoleCounter(),
        },
        B: {
            shots: createRoleCounter(),
            goals: createRoleCounter(),
            assists: createRoleCounter(),
            creator: createRoleCounter(),
            defensive: createRoleCounter(),
        },
    };

    const slotEventsA = {
        shots: createSlotCounter(),
        goals: createSlotCounter(),
        assists: createSlotCounter(),
        creator: createSlotCounter(),
        defensive: createSlotCounter(),
    };

    const recordRoleEvent = (teamTag, category, playerId) => {
        if (!playerId) return;
        const info = lookup[teamTag]?.get(playerId);
        if (!info) return;
        const { role, slot } = info;
        if (roleEvents[category] && role in roleEvents[category]) {
            roleEvents[category][role] += 1;
            roleEvents[category].total += 1;
        }
        if (roleEventsByTeam[teamTag]?.[category] && role in roleEventsByTeam[teamTag][category]) {
            roleEventsByTeam[teamTag][category][role] += 1;
            roleEventsByTeam[teamTag][category].total += 1;
        }
        if (teamTag === 'A' && slotEventsA[category] && slot in slotEventsA[category]) {
            slotEventsA[category][slot] += 1;
            slotEventsA[category].total += 1;
        }
    };

    for (let i = 0; i < totalMatches; i++) {
        const seed = deriveMatchSeed(startSeed, i);
        const script = generateMatchScript(teamA, teamB, seed);

        const gA = script.finalScore.A;
        const gB = script.finalScore.B;
        const totalG = gA + gB;
        const margin = Math.abs(gA - gB);

        const stA = script.stats.A;
        const stB = script.stats.B;

        let ptsA = 0.5;
        if (gA > gB) {
            winsA++;
            ptsA = 1.0;
            pushOnlineStat(winStatA, 1);
        } else if (gB > gA) {
            winsB++;
            ptsA = 0.0;
            pushOnlineStat(winStatA, 0);
        } else {
            draws++;
            ptsA = 0.5;
            pushOnlineStat(winStatA, 0);
        }

        pushOnlineStat(pointsStatA, ptsA);
        pushOnlineStat(goalsForStatA, gA);
        pushOnlineStat(goalsAgainstStatA, gB);

        if (cachedControlBaseline && cachedControlBaseline[i]) {
            const ctrlMatch = cachedControlBaseline[i];
            pushOnlineStat(deltaPoints, ptsA - ctrlMatch.ptsA);
            pushOnlineStat(deltaGoalsFor, gA - ctrlMatch.gA);
            pushOnlineStat(deltaGoalsAgainst, gB - ctrlMatch.gB);
            pushOnlineStat(deltaShotsFor, stA.shots - ctrlMatch.shotsA);
            pushOnlineStat(deltaShotsAgainst, stB.shots - ctrlMatch.shotsB);
            pushOnlineStat(deltaSotFor, stA.shotsOnTarget - ctrlMatch.sotA);
            pushOnlineStat(deltaPossession, stA.possession - ctrlMatch.possA);
        }

        goalsA += gA;
        goalsB += gB;
        shotsA += stA.shots;
        shotsB += stB.shots;
        sotA += stA.shotsOnTarget;
        sotB += stB.shotsOnTarget;
        savesA += stA.saves;
        savesB += stB.saves;
        possessionSumA += stA.possession;

        if (stA.possession <= MATCH_SIM_CONFIG.minPossession) possessionClampMinHits++;
        if (stA.possession >= MATCH_SIM_CONFIG.maxPossession) possessionClampMaxHits++;

        if (gB === 0) cleanSheetA++;
        if (gA === 0) cleanSheetB++;
        if (gA === 0 || gB === 0) anyCleanSheet++;
        if (gA === 0 && gB === 0) zeroZeroCount++;
        if (margin === 1) oneGoalGameCount++;
        if (totalG >= 3) threePlusGoalCount++;
        if (totalG >= 5) fivePlusGoalCount++;
        if (totalG >= 7) sevenPlusGoalCount++;
        if (margin >= 4) blowout4PlusCount++;
        if (margin >= 5) blowout5PlusCount++;

        totalGoalsHist[Math.min(totalGoalsHist.length - 1, totalG)] += 1;
        shotsHistA[Math.min(shotsHistA.length - 1, stA.shots)] += 1;
        shotsHistB[Math.min(shotsHistB.length - 1, stB.shots)] += 1;
        shotsHistTeam[Math.min(shotsHistTeam.length - 1, stA.shots)] += 1;
        shotsHistTeam[Math.min(shotsHistTeam.length - 1, stB.shots)] += 1;
        sotHistTeam[Math.min(sotHistTeam.length - 1, stA.shotsOnTarget)] += 1;
        sotHistTeam[Math.min(sotHistTeam.length - 1, stB.shotsOnTarget)] += 1;
        possessionHistA[clamp(stA.possession, 0, 100)] += 1;

        const scoreKey = `${gA}-${gB}`;
        scoreHistogram[scoreKey] = (scoreHistogram[scoreKey] || 0) + 1;

        for (const ev of script.events) {
            if (!ev.team) continue;
            const attTag = ev.team;
            const defTag = attTag === 'A' ? 'B' : 'A';

            if (ev.type === 'attack') {
                if (attTag === 'A') attackSeqA++;
                else attackSeqB++;
                recordRoleEvent(attTag, 'buildUpCreator', ev.playerId);
                recordRoleEvent(attTag, 'creator', ev.playerId);
                recordRoleEvent(defTag, 'defensive', ev.defenderId);
            } else if (ev.type === 'shot') {
                if (attTag === 'A') attackSeqA++;
                else attackSeqB++;
                recordRoleEvent(attTag, 'shots', ev.playerId);
                recordRoleEvent(defTag, 'defensive', ev.defenderId);
            } else if (ev.type === 'miss' || ev.type === 'save') {
                if (attTag === 'A') attackSeqA++;
                else attackSeqB++;
                recordRoleEvent(attTag, 'shots', ev.playerId);
            } else if (ev.type === 'goal') {
                if (attTag === 'A') attackSeqA++;
                else attackSeqB++;
                recordRoleEvent(attTag, 'shots', ev.scorerId ?? ev.playerId);
                recordRoleEvent(attTag, 'goals', ev.scorerId ?? ev.playerId);
                if (ev.assistId) {
                    recordRoleEvent(attTag, 'assists', ev.assistId);
                    recordRoleEvent(attTag, 'creator', ev.assistId);
                }
            }
        }
    }

    const totalShots = shotsA + shotsB;
    const totalSot = sotA + sotB;
    const totalGoals = goalsA + goalsB;
    const totalAttackSeq = attackSeqA + attackSeqB;

    const formatRoleShares = (counter) => {
        const tot = counter.total || 1;
        return {
            GK: (counter.GK / tot) * 100,
            DF: (counter.DF / tot) * 100,
            MF: (counter.MF / tot) * 100,
            FW: (counter.FW / tot) * 100,
            counts: { ...counter },
        };
    };

    const formatSlotShares = (counter) => {
        const tot = counter.total || 1;
        const shares = {};
        for (const s of SLOTS) {
            shares[s] = (counter[s] / tot) * 100;
        }
        return { shares, counts: { ...counter } };
    };

    const goalsBuckets = {
        '0': (totalGoalsHist[0] / totalMatches) * 100,
        '1': (totalGoalsHist[1] / totalMatches) * 100,
        '2': (totalGoalsHist[2] / totalMatches) * 100,
        '3': (totalGoalsHist[3] / totalMatches) * 100,
        '4': (totalGoalsHist[4] / totalMatches) * 100,
        '5': (totalGoalsHist[5] / totalMatches) * 100,
        '6+':
            (totalGoalsHist.slice(6).reduce((a, b) => a + b, 0) / totalMatches) * 100,
    };

    const getScorePct = (key) => ((scoreHistogram[key] || 0) / totalMatches) * 100;

    return {
        matches: totalMatches,
        baseSeed: startSeed,
        profiles: {
            A: calculateTeamProfile(teamA),
            B: calculateTeamProfile(teamB),
        },
        winsA,
        draws,
        winsB,
        winRateA: (winsA / totalMatches) * 100,
        drawRate: (draws / totalMatches) * 100,
        winRateB: (winsB / totalMatches) * 100,
        seatWinDelta: ((winsA - winsB) / totalMatches) * 100,
        nonDrawWinShareA: winsA + winsB > 0 ? (winsA / (winsA + winsB)) * 100 : 50,
        pointsPerMatchA: pointsStatA.sum / totalMatches,
        pointsPerMatchB: 1 - pointsStatA.sum / totalMatches,
        pointsCI: summarizeOnlineStat(pointsStatA),
        winRateACI: summarizeOnlineStat(winStatA),
        goalsForACI: summarizeOnlineStat(goalsForStatA),
        goalsAgainstACI: summarizeOnlineStat(goalsAgainstStatA),
        pairedDeltas: cachedControlBaseline
            ? {
                  points: summarizeOnlineStat(deltaPoints),
                  goalsFor: summarizeOnlineStat(deltaGoalsFor),
                  goalsAgainst: summarizeOnlineStat(deltaGoalsAgainst),
                  shotsFor: summarizeOnlineStat(deltaShotsFor),
                  shotsAgainst: summarizeOnlineStat(deltaShotsAgainst),
                  sotFor: summarizeOnlineStat(deltaSotFor),
                  possession: summarizeOnlineStat(deltaPossession),
              }
            : null,
        avgGoalsA: goalsA / totalMatches,
        avgGoalsB: goalsB / totalMatches,
        avgTotalGoals: totalGoals / totalMatches,
        avgShotsA: shotsA / totalMatches,
        avgShotsB: shotsB / totalMatches,
        avgTotalShots: totalShots / totalMatches,
        avgOnTargetA: sotA / totalMatches,
        avgOnTargetB: sotB / totalMatches,
        avgTotalOnTarget: totalSot / totalMatches,
        shotOnTargetRateA: shotsA > 0 ? (sotA / shotsA) * 100 : 0,
        shotOnTargetRateB: shotsB > 0 ? (sotB / shotsB) * 100 : 0,
        shotOnTargetRateTotal: totalShots > 0 ? (totalSot / totalShots) * 100 : 0,
        goalPerShotA: shotsA > 0 ? (goalsA / shotsA) * 100 : 0,
        goalPerShotB: shotsB > 0 ? (goalsB / shotsB) * 100 : 0,
        goalPerShotTotal: totalShots > 0 ? (totalGoals / totalShots) * 100 : 0,
        goalPerOnTargetA: sotA > 0 ? (goalsA / sotA) * 100 : 0,
        goalPerOnTargetB: sotB > 0 ? (goalsB / sotB) * 100 : 0,
        goalPerOnTargetTotal: totalSot > 0 ? (totalGoals / totalSot) * 100 : 0,
        avgSavesA: savesA / totalMatches,
        avgSavesB: savesB / totalMatches,
        saveRateA: sotB > 0 ? (savesA / sotB) * 100 : 0,
        saveRateB: sotA > 0 ? (savesB / sotA) * 100 : 0,
        avgPossessionA: possessionSumA / totalMatches,
        avgPossessionB: 100 - possessionSumA / totalMatches,
        attackShareA: totalAttackSeq > 0 ? (attackSeqA / totalAttackSeq) * 100 : 50,
        avgAttackSeqA: attackSeqA / totalMatches,
        avgAttackSeqB: attackSeqB / totalMatches,
        cleanSheetRateA: (cleanSheetA / totalMatches) * 100,
        cleanSheetRateB: (cleanSheetB / totalMatches) * 100,
        anyCleanSheetRate: (anyCleanSheet / totalMatches) * 100,
        zeroZeroRate: (zeroZeroCount / totalMatches) * 100,
        oneGoalGameRate: (oneGoalGameCount / totalMatches) * 100,
        threePlusGoalRate: (threePlusGoalCount / totalMatches) * 100,
        fivePlusGoalRate: (fivePlusGoalCount / totalMatches) * 100,
        sevenPlusGoalRate: (sevenPlusGoalCount / totalMatches) * 100,
        blowout4PlusRate: (blowout4PlusCount / totalMatches) * 100,
        blowout5PlusRate: (blowout5PlusCount / totalMatches) * 100,
        specificScorelines: {
            '0-0': getScorePct('0-0'),
            '1-0 / 0-1': getScorePct('1-0') + getScorePct('0-1'),
            '1-1': getScorePct('1-1'),
            '2-1 / 1-2': getScorePct('2-1') + getScorePct('1-2'),
            '2-2': getScorePct('2-2'),
        },
        topScorelines: Object.entries(scoreHistogram)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([scoreline, cnt]) => ({
                scoreline,
                count: cnt,
                pct: (cnt / totalMatches) * 100,
            })),
        totalGoalsHistogram: goalsBuckets,
        shotsPercentilesTeam: {
            P10: percentileFromHistogram(shotsHistTeam, totalMatches * 2, 0.1),
            P25: percentileFromHistogram(shotsHistTeam, totalMatches * 2, 0.25),
            P50: percentileFromHistogram(shotsHistTeam, totalMatches * 2, 0.5),
            P75: percentileFromHistogram(shotsHistTeam, totalMatches * 2, 0.75),
            P90: percentileFromHistogram(shotsHistTeam, totalMatches * 2, 0.9),
        },
        sotPercentilesTeam: {
            P10: percentileFromHistogram(sotHistTeam, totalMatches * 2, 0.1),
            P25: percentileFromHistogram(sotHistTeam, totalMatches * 2, 0.25),
            P50: percentileFromHistogram(sotHistTeam, totalMatches * 2, 0.5),
            P75: percentileFromHistogram(sotHistTeam, totalMatches * 2, 0.75),
            P90: percentileFromHistogram(sotHistTeam, totalMatches * 2, 0.9),
        },
        possessionPercentilesA: {
            P10: percentileFromHistogram(possessionHistA, totalMatches, 0.1),
            P25: percentileFromHistogram(possessionHistA, totalMatches, 0.25),
            P50: percentileFromHistogram(possessionHistA, totalMatches, 0.5),
            P75: percentileFromHistogram(possessionHistA, totalMatches, 0.75),
            P90: percentileFromHistogram(possessionHistA, totalMatches, 0.9),
        },
        empiricalPossessionClampRate: {
            minPct: (possessionClampMinHits / totalMatches) * 100,
            maxPct: (possessionClampMaxHits / totalMatches) * 100,
        },
        roleDistribution: {
            shots: formatRoleShares(roleEvents.shots),
            goals: formatRoleShares(roleEvents.goals),
            assists: formatRoleShares(roleEvents.assists),
            creator: formatRoleShares(roleEvents.creator),
            buildUpCreator: formatRoleShares(roleEvents.buildUpCreator),
            defensive: formatRoleShares(roleEvents.defensive),
        },
        roleDistributionByTeam: {
            A: {
                shots: formatRoleShares(roleEventsByTeam.A.shots),
                goals: formatRoleShares(roleEventsByTeam.A.goals),
                assists: formatRoleShares(roleEventsByTeam.A.assists),
                creator: formatRoleShares(roleEventsByTeam.A.creator),
                defensive: formatRoleShares(roleEventsByTeam.A.defensive),
            },
            B: {
                shots: formatRoleShares(roleEventsByTeam.B.shots),
                goals: formatRoleShares(roleEventsByTeam.B.goals),
                assists: formatRoleShares(roleEventsByTeam.B.assists),
                creator: formatRoleShares(roleEventsByTeam.B.creator),
                defensive: formatRoleShares(roleEventsByTeam.B.defensive),
            },
        },
        slotDistributionA: {
            shots: formatSlotShares(slotEventsA.shots),
            goals: formatSlotShares(slotEventsA.goals),
            assists: formatSlotShares(slotEventsA.assists),
            creator: formatSlotShares(slotEventsA.creator),
            defensive: formatSlotShares(slotEventsA.defensive),
        },
    };
}

/**
 * Runs a seat-swapped comparison (X as A vs Y as B, and Y as A vs X as B) on the exact same seed set.
 */
export function runSeatSwapExperiment(teamX, teamY, count = 10000, baseSeed = 20261006) {
    const xAsA = runBatchMatches(teamX, teamY, count, baseSeed);
    const yAsA = runBatchMatches(teamY, teamX, count, baseSeed);

    const xWinAsA = xAsA.winRateA;
    const xWinAsB = yAsA.winRateB;
    const xDrawAsA = xAsA.drawRate;
    const xDrawAsB = yAsA.drawRate;
    const xPpmAsA = xAsA.pointsPerMatchA;
    const xPpmAsB = yAsA.pointsPerMatchB;

    const xOverallWinRate = (xWinAsA + xWinAsB) / 2;
    const yOverallWinRate = (xAsA.winRateB + yAsA.winRateA) / 2;
    const overallDrawRate = (xDrawAsA + xDrawAsB) / 2;
    const xOverallPpm = (xPpmAsA + xPpmAsB) / 2;
    const seatBiasWinDiff = xWinAsA - xWinAsB;
    const seatBiasPpmDiff = xPpmAsA - xPpmAsB;

    return {
        matchesPerSeat: count,
        totalMatches: count * 2,
        xAsA,
        yAsA,
        xWinAsA,
        xWinAsB,
        xPpmAsA,
        xPpmAsB,
        xOverallWinRate,
        yOverallWinRate,
        overallDrawRate,
        xOverallPpm,
        seatBiasWinDiff,
        seatBiasPpmDiff,
    };
}

/**
 * Runs a paired seed comparison between (Variant vs Control) and (Control vs Control) in a single pass.
 */
export function runPairedSensitivity(
    variantTeam,
    controlTeam,
    count = 10000,
    baseSeed = 20261006,
    cachedControlBaseline = null
) {
    const baseline =
        cachedControlBaseline ?? buildControlBaselineRecords(controlTeam, count, baseSeed);
    const batch = runBatchMatches(variantTeam, controlTeam, count, baseSeed, baseline);
    return {
        batch,
        pairedDeltas: batch.pairedDeltas,
    };
}

export function buildControlBaselineRecords(controlTeam, count = 10000, baseSeed = 20261006) {
    const records = new Array(count);
    for (let i = 0; i < count; i++) {
        const seed = deriveMatchSeed(baseSeed, i);
        const m = generateMatchScript(controlTeam, controlTeam, seed);
        const gA = m.finalScore.A;
        const gB = m.finalScore.B;
        records[i] = {
            ptsA: gA > gB ? 1.0 : gA < gB ? 0.0 : 0.5,
            gA,
            gB,
            shotsA: m.stats.A.shots,
            shotsB: m.stats.B.shots,
            sotA: m.stats.A.shotsOnTarget,
            possA: m.stats.A.possession,
        };
    }
    return records;
}

/**
 * Computes exact shooter selection weights for each entry in a team.
 */
export function computeShooterWeights(entries) {
    const rawWeights = entries.map((entry) => {
        const roleMult = SHOT_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const atk = Math.max(15, Number(entry.player.attack) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow(atk / 80, 2.1) * (0.82 + 0.18 * (phy / 80));
    });
    const total = rawWeights.reduce((a, b) => a + b, 0) || 1;
    return entries.map((entry, idx) => ({
        entry,
        weight: rawWeights[idx],
        prob: rawWeights[idx] / total,
    }));
}

/**
 * Evaluates exact probability clamp diagnostics for a given matchup (teamA vs teamB).
 */
export function analyzeMatchupClamps(teamA, teamB) {
    const profileA = calculateTeamProfile(teamA);
    const profileB = calculateTeamProfile(teamB);
    const entriesA = getRosterEntries(teamA);
    const entriesB = getRosterEntries(teamB);

    // 1. Possession clamp saturation (analytical over uniform noise [-noiseMax, +noiseMax])
    const controlA =
        0.64 * profileA.creation +
        0.16 * profileA.physical +
        0.10 * profileA.attack +
        0.10 * profileA.defense;
    const controlB =
        0.64 * profileB.creation +
        0.16 * profileB.physical +
        0.10 * profileB.attack +
        0.10 * profileB.defense;
    const basePossA = 50 + (controlA - controlB) * MATCH_SIM_CONFIG.possessionDiffScale;
    const noiseMax = MATCH_SIM_CONFIG.possessionNoiseMax;
    const possLow = basePossA - noiseMax;
    const possHigh = basePossA + noiseMax;
    let possMinClampRate = 0;
    let possMaxClampRate = 0;
    if (noiseMax > 0) {
        if (possLow < MATCH_SIM_CONFIG.minPossession) {
            possMinClampRate = clamp(
                (MATCH_SIM_CONFIG.minPossession - possLow) / (2 * noiseMax),
                0,
                1
            );
        }
        if (possHigh > MATCH_SIM_CONFIG.maxPossession) {
            possMaxClampRate = clamp(
                (possHigh - MATCH_SIM_CONFIG.maxPossession) / (2 * noiseMax),
                0,
                1
            );
        }
    }

    // 2. Attack Share (Step 1)
    const initiativeA =
        0.48 * profileA.creation +
        0.22 * profileA.defense +
        0.15 * profileA.attack +
        0.15 * profileA.physical;
    const initiativeB =
        0.48 * profileB.creation +
        0.22 * profileB.defense +
        0.15 * profileB.attack +
        0.15 * profileB.physical;
    const rawAttackShareA =
        MATCH_SIM_CONFIG.baseAttackShare +
        (initiativeA - initiativeB) * MATCH_SIM_CONFIG.initiativeDiffScale;
    const clampedAttackShareA = clamp(
        rawAttackShareA,
        MATCH_SIM_CONFIG.minAttackShare,
        MATCH_SIM_CONFIG.maxAttackShare
    );

    // 3. Shot Progression (Step 2) for A and B
    const computeShotProg = (attProf, defProf) => {
        const attackBuild =
            0.52 * attProf.creation + 0.34 * attProf.attack + 0.14 * attProf.physical;
        const defenseStop = 0.80 * defProf.defense + 0.20 * defProf.physical;
        const raw =
            MATCH_SIM_CONFIG.baseShotProb +
            (attackBuild - defenseStop) * MATCH_SIM_CONFIG.progressionDiffScale;
        const clamped = clamp(raw, MATCH_SIM_CONFIG.minShotProb, MATCH_SIM_CONFIG.maxShotProb);
        return {
            raw,
            clamped,
            hitMin: raw <= MATCH_SIM_CONFIG.minShotProb ? 1 : 0,
            hitMax: raw >= MATCH_SIM_CONFIG.maxShotProb ? 1 : 0,
        };
    };

    const shotProgA = computeShotProg(profileA, profileB);
    const shotProgB = computeShotProg(profileB, profileA);

    // 4 & 5. On-Target (Step 4) and Goal-on-Target (Step 5) weighted across shooters
    const computeShooterClamps = (attEntries, attProf, defProf) => {
        const shooterWeights = computeShooterWeights(attEntries);
        const shotPressure = 0.78 * defProf.defense + 0.22 * defProf.physical;
        const gkRating =
            0.76 * defProf.goalkeeping + 0.18 * defProf.defense + 0.06 * defProf.physical;

        let onTargetMinRate = 0;
        let onTargetMaxRate = 0;
        let goalMinRate = 0;
        let goalMaxRate = 0;
        let expectedRawOnTarget = 0;
        let expectedClampedOnTarget = 0;
        let expectedRawGoal = 0;
        let expectedClampedGoal = 0;

        for (const { entry, prob } of shooterWeights) {
            const shooterAtk = Number(entry.player.attack) || attProf.attack;
            const shotQuality =
                0.55 * shooterAtk + 0.25 * attProf.attack + 0.20 * attProf.creation;
            const rawOnTarget =
                MATCH_SIM_CONFIG.baseOnTargetProb +
                (shotQuality - shotPressure) * MATCH_SIM_CONFIG.onTargetDiffScale;
            const clampedOnTarget = clamp(
                rawOnTarget,
                MATCH_SIM_CONFIG.minOnTargetProb,
                MATCH_SIM_CONFIG.maxOnTargetProb
            );

            if (rawOnTarget <= MATCH_SIM_CONFIG.minOnTargetProb) onTargetMinRate += prob;
            if (rawOnTarget >= MATCH_SIM_CONFIG.maxOnTargetProb) onTargetMaxRate += prob;
            expectedRawOnTarget += prob * rawOnTarget;
            expectedClampedOnTarget += prob * clampedOnTarget;

            const finishRating = shotQuality;
            const rawGoal =
                MATCH_SIM_CONFIG.baseGoalOnTargetProb +
                (finishRating - gkRating) * MATCH_SIM_CONFIG.goalDiffScale;
            const clampedGoal = clamp(
                rawGoal,
                MATCH_SIM_CONFIG.minGoalOnTargetProb,
                MATCH_SIM_CONFIG.maxGoalOnTargetProb
            );

            if (rawGoal <= MATCH_SIM_CONFIG.minGoalOnTargetProb) goalMinRate += prob;
            if (rawGoal >= MATCH_SIM_CONFIG.maxGoalOnTargetProb) goalMaxRate += prob;
            expectedRawGoal += prob * rawGoal;
            expectedClampedGoal += prob * clampedGoal;
        }

        return {
            onTargetMinPct: onTargetMinRate * 100,
            onTargetMaxPct: onTargetMaxRate * 100,
            expectedRawOnTarget,
            expectedClampedOnTarget,
            goalMinPct: goalMinRate * 100,
            goalMaxPct: goalMaxRate * 100,
            expectedRawGoal,
            expectedClampedGoal,
        };
    };

    const shooterClampsA = computeShooterClamps(entriesA, profileA, profileB);
    const shooterClampsB = computeShooterClamps(entriesB, profileB, profileA);

    return {
        possession: {
            basePossA,
            minPct: possMinClampRate * 100,
            maxPct: possMaxClampRate * 100,
            anyPct: (possMinClampRate + possMaxClampRate) * 100,
        },
        attackShare: {
            raw: rawAttackShareA,
            clamped: clampedAttackShareA,
            minPct: rawAttackShareA <= MATCH_SIM_CONFIG.minAttackShare ? 100 : 0,
            maxPct: rawAttackShareA >= MATCH_SIM_CONFIG.maxAttackShare ? 100 : 0,
            anyPct:
                rawAttackShareA <= MATCH_SIM_CONFIG.minAttackShare ||
                rawAttackShareA >= MATCH_SIM_CONFIG.maxAttackShare
                    ? 100
                    : 0,
        },
        shotProb: {
            A: shotProgA,
            B: shotProgB,
            minPct: ((shotProgA.hitMin + shotProgB.hitMin) / 2) * 100,
            maxPct: ((shotProgA.hitMax + shotProgB.hitMax) / 2) * 100,
            anyPct:
                ((shotProgA.hitMin + shotProgA.hitMax + shotProgB.hitMin + shotProgB.hitMax) / 2) *
                100,
        },
        onTargetProb: {
            A: shooterClampsA,
            B: shooterClampsB,
            minPct: (shooterClampsA.onTargetMinPct + shooterClampsB.onTargetMinPct) / 2,
            maxPct: (shooterClampsA.onTargetMaxPct + shooterClampsB.onTargetMaxPct) / 2,
            anyPct:
                (shooterClampsA.onTargetMinPct +
                    shooterClampsA.onTargetMaxPct +
                    shooterClampsB.onTargetMinPct +
                    shooterClampsB.onTargetMaxPct) /
                2,
        },
        goalOnTargetProb: {
            A: shooterClampsA,
            B: shooterClampsB,
            minPct: (shooterClampsA.goalMinPct + shooterClampsB.goalMinPct) / 2,
            maxPct: (shooterClampsA.goalMaxPct + shooterClampsB.goalMaxPct) / 2,
            anyPct:
                (shooterClampsA.goalMinPct +
                    shooterClampsA.goalMaxPct +
                    shooterClampsB.goalMinPct +
                    shooterClampsB.goalMaxPct) /
                2,
        },
    };
}

/**
 * Evaluates clamp saturation across a grid of N diverse historical rosters (N x N matchups).
 */
export function analyzePopulationClampGrid(rosterCount = 25) {
    const pools = buildSortedRolePools(TEAM_SEASONS);
    const rosters = [];
    for (let i = 0; i < rosterCount; i++) {
        const q = rosterCount > 1 ? i / (rosterCount - 1) : 0.5;
        rosters.push(buildRosterAtQuantile(q * 0.92, pools));
    }

    let pairs = 0;
    let possMinSum = 0;
    let possMaxSum = 0;
    let atkMinSum = 0;
    let atkMaxSum = 0;
    let shotMinSum = 0;
    let shotMaxSum = 0;
    let sotMinSum = 0;
    let sotMaxSum = 0;
    let goalMinSum = 0;
    let goalMaxSum = 0;

    for (let i = 0; i < rosters.length; i++) {
        for (let j = 0; j < rosters.length; j++) {
            const c = analyzeMatchupClamps(rosters[i], rosters[j]);
            pairs++;
            possMinSum += c.possession.minPct;
            possMaxSum += c.possession.maxPct;
            atkMinSum += c.attackShare.minPct;
            atkMaxSum += c.attackShare.maxPct;
            shotMinSum += c.shotProb.minPct;
            shotMaxSum += c.shotProb.maxPct;
            sotMinSum += c.onTargetProb.minPct;
            sotMaxSum += c.onTargetProb.maxPct;
            goalMinSum += c.goalOnTargetProb.minPct;
            goalMaxSum += c.goalOnTargetProb.maxPct;
        }
    }

    return {
        rosterCount,
        matchupPairs: pairs,
        possession: { minPct: possMinSum / pairs, maxPct: possMaxSum / pairs },
        attackShare: { minPct: atkMinSum / pairs, maxPct: atkMaxSum / pairs },
        shotProb: { minPct: shotMinSum / pairs, maxPct: shotMaxSum / pairs },
        onTargetProb: { minPct: sotMinSum / pairs, maxPct: sotMaxSum / pairs },
        goalOnTargetProb: { minPct: goalMinSum / pairs, maxPct: goalMaxSum / pairs },
    };
}

/**
 * Tests intra-role player quality differentiation (Section 23):
 * - FW1 (ATK 95) vs FW2 (ATK 82) vs FW3 (ATK 70) -> shooter share
 * - MF1 (CRE 95) vs MF2 (CRE 82) vs MF3 (CRE 70) -> creator & assist share
 * - DF1 (DEF 95) vs DF2 (DEF 82) vs DF3 (DEF 82) vs DF4 (DEF 70) -> defender share
 */
export function runIntraRoleQualityTest(controlRoster, matches = 10000, baseSeed = 20261006) {
    const testRoster = cloneRoster(controlRoster);

    // Normalize FW physicals and set distinct Attack: 95 vs 82 vs 70
    for (const s of ['FW1', 'FW2', 'FW3']) {
        testRoster[s].physical = 80;
    }
    testRoster.FW1.attack = 95;
    testRoster.FW2.attack = 82;
    testRoster.FW3.attack = 70;

    // Normalize MF physicals and set distinct Creation: 95 vs 82 vs 70
    for (const s of ['MF1', 'MF2', 'MF3']) {
        testRoster[s].physical = 80;
    }
    testRoster.MF1.creation = 95;
    testRoster.MF2.creation = 82;
    testRoster.MF3.creation = 70;

    // Normalize DF physicals and set distinct Defense: 95 vs 82 vs 82 vs 70
    for (const s of ['DF1', 'DF2', 'DF3', 'DF4']) {
        testRoster[s].physical = 80;
    }
    testRoster.DF1.defense = 95;
    testRoster.DF2.defense = 82;
    testRoster.DF3.defense = 82;
    testRoster.DF4.defense = 70;

    const result = runBatchMatches(testRoster, controlRoster, matches, baseSeed);
    const slots = result.slotDistributionA;

    return {
        matches,
        fwShooterShare: {
            FW1_ATK95: slots.shots.shares.FW1,
            FW2_ATK82: slots.shots.shares.FW2,
            FW3_ATK70: slots.shots.shares.FW3,
            ratio95to70:
                slots.shots.shares.FW3 > 0
                    ? slots.shots.shares.FW1 / slots.shots.shares.FW3
                    : Infinity,
        },
        mfCreatorShare: {
            MF1_CRE95: slots.creator.shares.MF1,
            MF2_CRE82: slots.creator.shares.MF2,
            MF3_CRE70: slots.creator.shares.MF3,
            ratio95to70:
                slots.creator.shares.MF3 > 0
                    ? slots.creator.shares.MF1 / slots.creator.shares.MF3
                    : Infinity,
        },
        mfAssistShare: {
            MF1_CRE95: slots.assists.shares.MF1,
            MF2_CRE82: slots.assists.shares.MF2,
            MF3_CRE70: slots.assists.shares.MF3,
            ratio95to70:
                slots.assists.shares.MF3 > 0
                    ? slots.assists.shares.MF1 / slots.assists.shares.MF3
                    : Infinity,
        },
        dfDefensiveShare: {
            DF1_DEF95: slots.defensive.shares.DF1,
            DF2_DEF82: slots.defensive.shares.DF2,
            DF3_DEF82: slots.defensive.shares.DF3,
            DF4_DEF70: slots.defensive.shares.DF4,
            ratio95to70:
                slots.defensive.shares.DF4 > 0
                    ? slots.defensive.shares.DF1 / slots.defensive.shares.DF4
                    : Infinity,
        },
    };
}

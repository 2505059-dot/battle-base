// Batch simulation debug helper for Match Simulation v1 balance testing (11v11)

import { TEAM_SEASONS } from '../../data/team-seasons.js';
import { ROSTER_SLOTS } from '../shared/constants.js';
import { createEmptyRoster, getPlayerOverall, canPlayerFitSlot } from '../draft/rules.js';
import { calculateTeamProfile } from './team-profile.js';
import { generateMatchScript } from './engine.js';

function buildOrderedSeasonPool(source) {
    if (Array.isArray(source) && source.length > 0) {
        const seen = new Set(source.map((ts) => ts?.id).filter(Boolean));
        return [...source.filter(Boolean), ...TEAM_SEASONS.filter((ts) => !seen.has(ts.id))];
    }
    if (source && Array.isArray(source.players)) {
        const idx = TEAM_SEASONS.findIndex((ts) => ts.id === source.id);
        if (idx >= 0) {
            return [
                ...TEAM_SEASONS.slice(idx),
                ...TEAM_SEASONS.slice(0, idx),
            ];
        }
        return [source, ...TEAM_SEASONS];
    }
    if (typeof source === 'number' && Number.isInteger(source) && TEAM_SEASONS.length > 0) {
        const offset = ((source % TEAM_SEASONS.length) + TEAM_SEASONS.length) % TEAM_SEASONS.length;
        return [
            ...TEAM_SEASONS.slice(offset),
            ...TEAM_SEASONS.slice(0, offset),
        ];
    }
    return [...TEAM_SEASONS];
}

export function buildSampleRosterFromPool(teamSeasons = TEAM_SEASONS) {
    const roster = createEmptyRoster();
    const orderedSeasons = buildOrderedSeasonPool(teamSeasons);
    const candidatePlayers = [];

    for (const ts of orderedSeasons) {
        if (!ts || !Array.isArray(ts.players)) continue;
        const sortedSeasonPlayers = [...ts.players].sort(
            (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
        );
        candidatePlayers.push(...sortedSeasonPlayers);
    }

    const usedIds = new Set();

    for (const slotDef of ROSTER_SLOTS) {
        let candidate = candidatePlayers.find(
            (p) => p?.id && !usedIds.has(p.id) && p.positions?.[0] === slotDef.role
        );
        if (!candidate) {
            candidate = candidatePlayers.find(
                (p) => p?.id && !usedIds.has(p.id) && canPlayerFitSlot(p, slotDef.id)
            );
        }
        if (candidate) {
            roster[slotDef.id] = candidate;
            usedIds.add(candidate.id);
        }
    }

    return roster;
}

export function buildSample11PlayerRoster(source = 0) {
    return buildSampleRosterFromPool(source);
}

export function buildSampleRosterFromSeason(teamSeason) {
    return buildSampleRosterFromPool(teamSeason);
}

export function normalizeTeamInput(teamInput, fallbackSource = 0) {
    if (!teamInput) return buildSample11PlayerRoster(fallbackSource);
    if (Array.isArray(teamInput)) return buildSampleRosterFromPool(teamInput);
    if (Array.isArray(teamInput.players)) return buildSample11PlayerRoster(teamInput);
    return teamInput;
}

export function simulateManyMatches(teamA, teamB, count = 1000, baseSeed = 10001) {
    const resolvedTeamA = normalizeTeamInput(teamA, TEAM_SEASONS.slice(0, 4));
    const resolvedTeamB = normalizeTeamInput(teamB, TEAM_SEASONS.slice(4, 8));
    const totalMatches = Math.max(1, Number(count) || 1000);
    const startSeed = (Number(baseSeed) || 10001) >>> 0;

    let winsA = 0;
    let draws = 0;
    let winsB = 0;
    let totalGoalsA = 0;
    let totalGoalsB = 0;
    let totalShotsA = 0;
    let totalShotsB = 0;
    let totalOnTargetA = 0;
    let totalOnTargetB = 0;
    let totalSavesA = 0;
    let totalSavesB = 0;
    let totalPossessionA = 0;
    const scoreHistogram = {};

    for (let i = 0; i < totalMatches; i++) {
        const seed = (startSeed + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
        const result = generateMatchScript(resolvedTeamA, resolvedTeamB, seed);
        const gA = result.finalScore.A;
        const gB = result.finalScore.B;

        if (gA > gB) winsA++;
        else if (gB > gA) winsB++;
        else draws++;

        totalGoalsA += gA;
        totalGoalsB += gB;
        totalShotsA += result.stats.A.shots;
        totalShotsB += result.stats.B.shots;
        totalOnTargetA += result.stats.A.shotsOnTarget;
        totalOnTargetB += result.stats.B.shotsOnTarget;
        totalSavesA += result.stats.A.saves;
        totalSavesB += result.stats.B.saves;
        totalPossessionA += result.stats.A.possession;

        const key = `${gA}-${gB}`;
        scoreHistogram[key] = (scoreHistogram[key] || 0) + 1;
    }

    const summary = {
        matches: totalMatches,
        baseSeed: startSeed,
        'A win %': Number(((winsA / totalMatches) * 100).toFixed(2)),
        'Draw %': Number(((draws / totalMatches) * 100).toFixed(2)),
        'B win %': Number(((winsB / totalMatches) * 100).toFixed(2)),
        'Average goals A': Number((totalGoalsA / totalMatches).toFixed(2)),
        'Average goals B': Number((totalGoalsB / totalMatches).toFixed(2)),
        avgShotsA: Number((totalShotsA / totalMatches).toFixed(2)),
        avgShotsB: Number((totalShotsB / totalMatches).toFixed(2)),
        avgOnTargetA: Number((totalOnTargetA / totalMatches).toFixed(2)),
        avgOnTargetB: Number((totalOnTargetB / totalMatches).toFixed(2)),
        avgSavesA: Number((totalSavesA / totalMatches).toFixed(2)),
        avgSavesB: Number((totalSavesB / totalMatches).toFixed(2)),
        avgPossessionA: Number((totalPossessionA / totalMatches).toFixed(1)),
        avgPossessionB: Number((100 - totalPossessionA / totalMatches).toFixed(1)),
        profiles: {
            A: calculateTeamProfile(resolvedTeamA),
            B: calculateTeamProfile(resolvedTeamB),
        },
        topScorelines: Object.entries(scoreHistogram)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([scoreline, cnt]) => ({
                scoreline,
                count: cnt,
                pct: `${((cnt / totalMatches) * 100).toFixed(1)}%`,
            })),
    };

    console.log(
        `[Match Simulation v1] Simulated ${totalMatches} matches (baseSeed=${startSeed}):`,
        summary
    );
    return summary;
}

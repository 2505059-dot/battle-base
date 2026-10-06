// Batch simulation debug helper for Match Simulation v0 balance testing

import { TEAM_SEASONS } from '../../data/team-seasons.js';
import { createEmptyRoster, getPlayerOverall, canPlayerFitSlot } from '../draft/rules.js';
import { calculateTeamProfile } from './team-profile.js';
import { generateMatchScript } from './engine.js';

export function buildSampleRosterFromSeason(teamSeason) {
    const roster = createEmptyRoster();
    if (!teamSeason || !Array.isArray(teamSeason.players)) return roster;

    const sortedPlayers = [...teamSeason.players].sort(
        (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
    );
    const usedIds = new Set();

    // First fill GK, DF, MF, FW preferring primary position match, then any valid fit
    for (const slot of ['GK', 'DF', 'MF', 'FW']) {
        let candidate = sortedPlayers.find(
            (p) => !usedIds.has(p.id) && p.positions?.[0] === slot
        );
        if (!candidate) {
            candidate = sortedPlayers.find(
                (p) => !usedIds.has(p.id) && canPlayerFitSlot(p, slot)
            );
        }
        if (candidate) {
            roster[slot] = candidate;
            usedIds.add(candidate.id);
        }
    }

    // Fill FLEX with highest-rated remaining outfield player
    const flexCandidate = sortedPlayers.find(
        (p) => !usedIds.has(p.id) && canPlayerFitSlot(p, 'FLEX')
    );
    if (flexCandidate) {
        roster.FLEX = flexCandidate;
        usedIds.add(flexCandidate.id);
    }

    return roster;
}

export function normalizeTeamInput(teamInput, fallbackSeason) {
    if (!teamInput) return buildSampleRosterFromSeason(fallbackSeason);
    if (Array.isArray(teamInput.players)) return buildSampleRosterFromSeason(teamInput);
    return teamInput;
}

export function simulateManyMatches(teamA, teamB, count = 1000, baseSeed = 10001) {
    const resolvedTeamA = normalizeTeamInput(teamA, TEAM_SEASONS[0]);
    const resolvedTeamB = normalizeTeamInput(teamB, TEAM_SEASONS[1] ?? TEAM_SEASONS[0]);
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
        `[Match Simulation v0] Simulated ${totalMatches} matches (baseSeed=${startSeed}):`,
        summary
    );
    return summary;
}

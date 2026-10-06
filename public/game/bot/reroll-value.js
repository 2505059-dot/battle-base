// Reroll Expected Value (EV) & Resource Opportunity Cost calculator
// Strictly uses public dataset distribution and hierarchical League -> Club -> Year probabilities.
// NEVER peeks at future RNG rolls or hidden match/opponent state.

import {
    TEAM_SEASON_MAP,
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from '../../data/team-seasons.js';
import { ROLES, SLOTS, REROLL_TYPES } from '../shared/constants.js';
import {
    hasRerollOption,
    getFirstAvailableSlotForRole,
    isPlayerInRoster,
    getRoleProgress,
    getPickedCount,
} from '../draft/rules.js';
import {
    PUBLIC_ROLE_BASELINES,
    ROLE_SLOT_IMPACT,
    ROLE_SCARCITY_PRIOR,
    BOT_DIFFICULTY_CONFIG,
    normalizeDifficulty,
} from './config.js';
import { NEUTRAL_PERSONA, resolvePersona } from './personas.js';
import { scorePlayerForRole, evaluateCandidatePick } from './scoring.js';

// Cache for hierarchical reroll outcome distributions: key -> Array<{ teamSeason, probability }>
const REROLL_DISTRIBUTION_CACHE = new Map();

// Cache for static per-TeamSeason best role scores (when no player from that TeamSeason is in roster)
// key: `${teamSeason.id}::${difficulty}::${persona.id}` -> { GK, DF, MF, FW }
const STATIC_SEASON_ROLE_BEST_CACHE = new Map();

function computeStaticPlayerTerm(player, role, difficulty, persona) {
    const candidateScore = scorePlayerForRole(player, role, { difficulty, persona });
    const baseline = PUBLIC_ROLE_BASELINES[role] ?? 81.0;
    const slotImpact = ROLE_SLOT_IMPACT[role] ?? 1.0;
    const valueOverBaseline = (candidateScore - baseline) * slotImpact;
    const normalizedQuality = 81.5 + valueOverBaseline;

    let flexibilityBonus = 0;
    if (Array.isArray(player.positions) && player.positions.length > 1) {
        const scarcity = ROLE_SCARCITY_PRIOR[role] ?? 1.0;
        flexibilityBonus = (scarcity - 1.0) * 0.6;
    }

    return normalizedQuality + flexibilityBonus;
}

function getStaticSeasonBestByRole(teamSeason, difficulty, persona) {
    const canCache =
        persona === NEUTRAL_PERSONA &&
        typeof teamSeason?.id === 'string' &&
        TEAM_SEASON_MAP.get(teamSeason.id) === teamSeason;

    const cacheKey = canCache ? `${teamSeason.id}::${difficulty}::${persona.id}` : null;
    if (cacheKey && STATIC_SEASON_ROLE_BEST_CACHE.has(cacheKey)) {
        return STATIC_SEASON_ROLE_BEST_CACHE.get(cacheKey);
    }

    const bestByRole = {
        GK: -Infinity,
        DF: -Infinity,
        MF: -Infinity,
        FW: -Infinity,
    };

    const players = teamSeason?.players ?? [];
    for (const player of players) {
        if (!Array.isArray(player.positions)) continue;
        for (const role of player.positions) {
            if (!ROLES.includes(role)) continue;
            const val = computeStaticPlayerTerm(player, role, difficulty, persona);
            if (val > bestByRole[role]) {
                bestByRole[role] = val;
            }
        }
    }

    if (cacheKey) {
        STATIC_SEASON_ROLE_BEST_CACHE.set(cacheKey, bestByRole);
    }
    return bestByRole;
}

/**
 * Enumerates all legal outcome TeamSeasons and their exact 3-stage uniform probabilities
 * for a given (currentRoll, rerollType).
 *
 * - league: uniform over other leagues -> uniform over clubs in league -> uniform over years in club
 * - club:   same league, uniform over other clubs -> uniform over years in club
 * - year:   same league & club, uniform over other years
 */
export function getRerollOutcomeDistribution(currentRoll, rerollType) {
    if (!currentRoll || !REROLL_TYPES.includes(rerollType)) return [];
    if (!hasRerollOption(currentRoll, rerollType)) return [];

    const cacheKey = `${currentRoll.league}::${currentRoll.club}::${currentRoll.year}::${rerollType}`;
    if (REROLL_DISTRIBUTION_CACHE.has(cacheKey)) {
        return REROLL_DISTRIBUTION_CACHE.get(cacheKey);
    }

    const outcomes = [];

    if (rerollType === 'league') {
        const otherLeagues = getLeagues().filter((l) => l !== currentRoll.league);
        if (otherLeagues.length === 0) return [];
        const leagueProb = 1 / otherLeagues.length;

        for (const league of otherLeagues) {
            const clubs = getClubsByLeague(league);
            if (clubs.length === 0) continue;
            const clubProb = leagueProb / clubs.length;

            for (const club of clubs) {
                const years = getYearsByLeagueAndClub(league, club);
                if (years.length === 0) continue;
                const yearProb = clubProb / years.length;

                for (const year of years) {
                    const ts = findTeamSeason(league, club, year);
                    if (ts) {
                        outcomes.push({ teamSeason: ts, probability: yearProb });
                    }
                }
            }
        }
    } else if (rerollType === 'club') {
        const otherClubs = getClubsByLeague(currentRoll.league).filter(
            (c) => c !== currentRoll.club
        );
        if (otherClubs.length === 0) return [];
        const clubProb = 1 / otherClubs.length;

        for (const club of otherClubs) {
            const years = getYearsByLeagueAndClub(currentRoll.league, club);
            if (years.length === 0) continue;
            const yearProb = clubProb / years.length;

            for (const year of years) {
                const ts = findTeamSeason(currentRoll.league, club, year);
                if (ts) {
                    outcomes.push({ teamSeason: ts, probability: yearProb });
                }
            }
        }
    } else if (rerollType === 'year') {
        const otherYears = getYearsByLeagueAndClub(currentRoll.league, currentRoll.club).filter(
            (y) => y !== currentRoll.year
        );
        if (otherYears.length === 0) return [];
        const yearProb = 1 / otherYears.length;

        for (const year of otherYears) {
            const ts = findTeamSeason(currentRoll.league, currentRoll.club, year);
            if (ts) {
                outcomes.push({ teamSeason: ts, probability: yearProb });
            }
        }
    }

    REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
    return outcomes;
}

export function getRerollOpportunityCost(team, rerollType, context = {}) {
    const roster = team?.roster ?? team;
    const rerolls = team?.rerolls ?? {};
    const pickedCount = getPickedCount(roster);
    const remainingFutureRolls = Math.max(0, SLOTS.length - 1 - pickedCount);

    const universalRerollsRemaining =
        (Number(rerolls.league) || 0) + (Number(rerolls.club) || 0);
    const totalRerollsRemaining =
        universalRerollsRemaining + (Number(rerolls.year) || 0);

    const persona = resolvePersona(context.persona);
    const riskAdjustment = 1.0 - Math.max(-0.5, Math.min(0.5, persona.riskPreference ?? 0)) * 0.25;

    // Base cost of consuming a limited reroll token + option value for future rolls
    let cost = 1.15 + remainingFutureRolls * 0.22;

    // Preserve the final reroll token (and especially final universal league/club token)
    // as insurance against late-draft bad/duplicate rolls on single-year clubs
    if (totalRerollsRemaining <= 1 && remainingFutureRolls >= 2) {
        cost += 1.25;
    } else if (totalRerollsRemaining === 2 && remainingFutureRolls >= 5) {
        cost += 0.45;
    }

    if (rerollType !== 'year' && universalRerollsRemaining <= 1 && remainingFutureRolls >= 2) {
        cost += 0.75;
    }

    // 'year' reroll is conditional (only usable on multi-year clubs), so spending it when
    // available has lower opportunity cost than burning a universal league/club token
    if (rerollType === 'year') {
        cost -= 0.30;
    } else if (rerollType === 'league' && remainingFutureRolls >= 4) {
        cost += 0.20;
    }

    return Math.max(0.4, cost * riskAdjustment);
}

function evaluateBestPickInTeamSeasonFast(
    team,
    teamSeason,
    openRoles,
    roleOffsets,
    pickedPlayerIds,
    hasOverlapWithSeason,
    difficulty,
    persona
) {
    if (!hasOverlapWithSeason) {
        const bestByRole = getStaticSeasonBestByRole(teamSeason, difficulty, persona);
        let bestVal = -Infinity;
        for (const role of openRoles) {
            const val = bestByRole[role] + roleOffsets[role];
            if (val > bestVal) {
                bestVal = val;
            }
        }
        return bestVal;
    }

    // Fallback when at least one player from this TeamSeason is already in the team's roster
    let bestVal = -Infinity;
    const players = teamSeason?.players ?? [];
    for (const player of players) {
        if (pickedPlayerIds.has(player.id)) continue;
        if (!Array.isArray(player.positions)) continue;
        for (const role of player.positions) {
            if (!openRoles.includes(role)) continue;
            const val = computeStaticPlayerTerm(player, role, difficulty, persona) + roleOffsets[role];
            if (val > bestVal) {
                bestVal = val;
            }
        }
    }
    return bestVal;
}

export function estimateRerollValue({
    team,
    currentRoll = null,
    rerollType,
    bestCurrentPickValue = -Infinity,
    bestCurrentCandidateScore = 0,
    difficulty = 'expert',
    persona = 'neutral',
} = {}) {
    const resolvedRoll = currentRoll ?? team?.draft?.currentRoll ?? team?.currentRoll ?? null;
    const rerolls = team?.rerolls ?? {};

    if (!team || !resolvedRoll || !REROLL_TYPES.includes(rerollType)) {
        return {
            available: false,
            rerollType,
            expectedValue: -Infinity,
            opportunityCost: Infinity,
            downsidePenalty: 0,
            netExpectedValue: -Infinity,
            netGain: -Infinity,
            upgradeProbability: 0,
            deadRollProbability: 0,
        };
    }

    if ((rerolls[rerollType] ?? 0) <= 0 || !hasRerollOption(resolvedRoll, rerollType)) {
        return {
            available: false,
            rerollType,
            expectedValue: -Infinity,
            opportunityCost: Infinity,
            downsidePenalty: 0,
            netExpectedValue: -Infinity,
            netGain: -Infinity,
            upgradeProbability: 0,
            deadRollProbability: 0,
        };
    }

    const normDiff = normalizeDifficulty(difficulty);
    const resolvedPersona = resolvePersona(persona);
    const diffCfg = BOT_DIFFICULTY_CONFIG[normDiff] ?? BOT_DIFFICULTY_CONFIG.expert;
    const roster = team.roster ?? team;

    const outcomes = getRerollOutcomeDistribution(resolvedRoll, rerollType);
    if (outcomes.length === 0) {
        return {
            available: false,
            rerollType,
            expectedValue: -Infinity,
            opportunityCost: Infinity,
            downsidePenalty: 0,
            netExpectedValue: -Infinity,
            netGain: -Infinity,
            upgradeProbability: 0,
            deadRollProbability: 0,
        };
    }

    const openRoles = ROLES.filter((role) => getFirstAvailableSlotForRole(roster, role) !== null);
    if (openRoles.length === 0) {
        return {
            available: false,
            rerollType,
            expectedValue: -Infinity,
            opportunityCost: Infinity,
            downsidePenalty: 0,
            netExpectedValue: -Infinity,
            netGain: -Infinity,
            upgradeProbability: 0,
            deadRollProbability: 0,
        };
    }

    const opportunityCost = getRerollOpportunityCost(team, rerollType, {
        difficulty: normDiff,
        persona: resolvedPersona,
    });

    // Simple EV mode for Smart difficulty: fast hierarchical approximation without full roster-offset tree
    if (diffCfg.evMode === 'simple') {
        let weightedMean = 0;
        let upgradeProb = 0;
        for (const { teamSeason, probability } of outcomes) {
            const bestByRole = getStaticSeasonBestByRole(teamSeason, normDiff, resolvedPersona);
            let seasonBest = -Infinity;
            for (const role of openRoles) {
                if (bestByRole[role] > seasonBest) {
                    seasonBest = bestByRole[role];
                }
            }
            const approxVal = Number.isFinite(seasonBest) ? seasonBest + 1.0 : 68.0;
            weightedMean += probability * approxVal;
            if (approxVal > bestCurrentPickValue) {
                upgradeProb += probability;
            }
        }

        const currentHoldBonus =
            bestCurrentCandidateScore > 82.0 ? (bestCurrentCandidateScore - 82.0) * 0.35 : 0;
        const netExpectedValue = weightedMean - opportunityCost - currentHoldBonus;
        const netGain = Number.isFinite(bestCurrentPickValue)
            ? netExpectedValue - bestCurrentPickValue
            : netExpectedValue;

        return {
            available: true,
            rerollType,
            expectedValue: weightedMean,
            opportunityCost,
            downsidePenalty: currentHoldBonus,
            netExpectedValue,
            netGain,
            upgradeProbability: upgradeProb,
            deadRollProbability: 0,
        };
    }

    // Exact EV mode for Expert difficulty:
    // Precompute roster-dependent role offsets once for each open role
    const roleOffsets = {};
    const dummyProbe = {
        id: '__probe__',
        positions: ROLES,
        overall: 80,
        attack: 80,
        creation: 80,
        defense: 80,
        physical: 80,
        goalkeeping: 80,
    };

    for (const role of openRoles) {
        const evalRes = evaluateCandidatePick(roster, dummyProbe, role, {
            difficulty: normDiff,
            persona: resolvedPersona,
        });
        roleOffsets[role] = (evalRes.roleWeaknessBonus ?? 0) + (evalRes.urgencyBonus ?? 0);
    }

    const pickedPlayerIds = new Set();
    const pickedSeasonPrefixes = new Set();
    for (const slot of SLOTS) {
        const p = roster[slot];
        if (p?.id) {
            pickedPlayerIds.add(p.id);
            const dashIdx = p.id.lastIndexOf('-');
            if (dashIdx > 0) {
                pickedSeasonPrefixes.add(p.id.slice(0, dashIdx));
            }
        }
    }

    let expectedValue = 0;
    let expectedDownside = 0;
    let upgradeProbability = 0;
    let deadRollProbability = 0;

    const hasFiniteCurrent = Number.isFinite(bestCurrentPickValue);

    for (const { teamSeason, probability } of outcomes) {
        const hasOverlap =
            pickedSeasonPrefixes.has(teamSeason.id) ||
            (teamSeason.players && teamSeason.players.some((p) => pickedPlayerIds.has(p.id)));

        const bestVal = evaluateBestPickInTeamSeasonFast(
            team,
            teamSeason,
            openRoles,
            roleOffsets,
            pickedPlayerIds,
            hasOverlap,
            normDiff,
            resolvedPersona
        );

        if (!Number.isFinite(bestVal)) {
            deadRollProbability += probability;
            const deadFallback = hasFiniteCurrent ? bestCurrentPickValue - 14.0 : 65.0;
            expectedValue += probability * deadFallback;
            if (hasFiniteCurrent) {
                expectedDownside += probability * 14.0;
            }
        } else {
            expectedValue += probability * bestVal;
            if (hasFiniteCurrent) {
                if (bestVal > bestCurrentPickValue) {
                    upgradeProbability += probability;
                } else {
                    expectedDownside += probability * (bestCurrentPickValue - bestVal);
                }
            }
        }
    }

    // Concave utility / bird-in-hand protection:
    // Avoid gambling away an already strong starter or a decent late-draft role-completing starter
    let downsidePenalty = expectedDownside * 0.32;

    if (bestCurrentCandidateScore > 83.0) {
        downsidePenalty += (bestCurrentCandidateScore - 83.0) * 0.42;
    }

    // Late-draft completion safety: if only 1 role remains open (or on the final pick 10/11)
    // and we already have a decent legal candidate, do not gamble recklessly
    const progress = getRoleProgress(roster);
    const openRoleCount = ROLES.filter((r) => progress[r].filled < progress[r].total).length;
    const pickedCount = getPickedCount(roster);
    const remainingPicks = SLOTS.length - pickedCount;

    if ((openRoleCount === 1 || remainingPicks === 1) && bestCurrentCandidateScore >= 77.5) {
        downsidePenalty += 2.2;
    }

    const netExpectedValue = expectedValue - opportunityCost - downsidePenalty;
    const netGain = hasFiniteCurrent
        ? netExpectedValue - bestCurrentPickValue
        : netExpectedValue;

    return {
        available: true,
        rerollType,
        expectedValue,
        opportunityCost,
        downsidePenalty,
        netExpectedValue,
        netGain,
        upgradeProbability,
        deadRollProbability,
    };
}

// Headless Bot Draft Simulator & Dead-Roll Analyzer
// Uses production state, production draft rules, and production transitions without DOM or network.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROLES, SLOTS } from '../public/game/shared/constants.js';
import { createInitialState } from '../public/game/state.js';
import {
    getPickedCount,
    isRosterComplete,
    calculateTeamRating,
    getLegalPickActions,
} from '../public/game/draft/rules.js';
import {
    applyBotDraftAction,
    resolveBotPickSlot,
} from '../public/game/draft/transitions.js';
import { calculateTeamProfile } from '../public/game/match/team-profile.js';
import {
    BOT_DIFFICULTIES,
    chooseDraftAction,
    diagnoseDeadRoll,
    scorePlayerForRole,
} from '../public/game/bot/decision.js';
import { createBotRng, hashBotSeed } from '../public/game/bot/rng.js';

export function deriveDraftSeed(baseSeed, index) {
    const start = (Number(baseSeed) || 20261006) >>> 0;
    return (start + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

export function simulateSingleBotDraft({
    seed = 20261006,
    difficulty = 'expert',
    persona = 'neutral',
    actorId = 'bot-a',
} = {}) {
    const state = createInitialState({
        seed,
        order: [actorId, 'bot-b-idle'],
        players: [
            { id: actorId, name: `Bot (${difficulty})` },
            { id: 'bot-b-idle', name: 'Idle Opponent' },
        ],
    });

    const team = state.teams[0];
    let stepIndex = 0;
    let decisions = 0;
    let invalidActions = 0;
    let stuckInfo = null;

    const rerollsUsed = {
        league: 0,
        club: 0,
        year: 0,
    };
    let freeRedrawCount = 0;

    // Track pre-reroll best candidate score vs eventual picked score in that round
    let roundPreRerollBestScore = null;
    const rerollTransitions = [];

    const maxSteps = 60;
    while (stepIndex < maxSteps && !team.draft.locked && team.draft.phase !== 'LOCKED') {
        const pickedBefore = getPickedCount(team);
        const decisionSeed = hashBotSeed(`decision::${seed}::${stepIndex}`);

        const action = chooseDraftAction({
            team,
            difficulty,
            persona,
            decisionSeed,
        });
        decisions += 1;

        if (!action || action.type === 'stuck') {
            const diagnosis = diagnoseDeadRoll(team);
            const filledSlots = {};
            for (const slot of SLOTS) {
                if (team.roster[slot]) {
                    filledSlots[slot] = `${team.roster[slot].id} (${team.roster[slot].name})`;
                }
            }
            stuckInfo = {
                seed,
                difficulty,
                persona: typeof persona === 'string' ? persona : persona?.id ?? 'neutral',
                stepIndex,
                pickedCount: pickedBefore,
                phase: team.draft.phase,
                currentTeamSeason: team.draft.currentRoll?.id ?? null,
                remainingRerolls: { ...team.rerolls },
                openRoles: diagnosis.openRoles,
                reason: action?.reason ?? diagnosis.primaryReason,
                flags: diagnosis.flags,
                roster: filledSlots,
            };
            break;
        }

        // Measure best candidate score before rerolling (for over-reroll analysis)
        if (action.type === 'reroll') {
            if (roundPreRerollBestScore === null) {
                const legalPicks = getLegalPickActions(team);
                if (legalPicks.length > 0) {
                    let bestCand = -Infinity;
                    for (const lp of legalPicks) {
                        const s = scorePlayerForRole(lp.player, lp.role, {
                            difficulty: 'expert',
                            persona,
                        });
                        if (s > bestCand) bestCand = s;
                    }
                    if (Number.isFinite(bestCand)) {
                        roundPreRerollBestScore = bestCand;
                    }
                }
            }
        }

        // Create paired per-round RNG so all difficulties see identical initial rolls for a given seed
        let stepRng;
        if (action.type === 'roll') {
            stepRng = createBotRng(hashBotSeed(`initial-roll::${seed}::round-${pickedBefore}`));
        } else if (action.type === 'reroll') {
            const totalRerollsSoFar =
                rerollsUsed.league + rerollsUsed.club + rerollsUsed.year;
            stepRng = createBotRng(
                hashBotSeed(
                    `reroll-roll::${seed}::round-${pickedBefore}::${action.rerollType}::${totalRerollsSoFar}`
                )
            );
        } else if (action.type === 'redraw') {
            stepRng = createBotRng(
                hashBotSeed(
                    `free-redraw::${seed}::round-${pickedBefore}::redraw-${freeRedrawCount}`
                )
            );
        } else {
            stepRng = createBotRng(hashBotSeed(`step::${seed}::${stepIndex}`));
        }

        // Verify pick action returns abstract role (not concrete slot) and driver resolves concrete slot
        if (action.type === 'pick') {
            if (!ROLES.includes(action.role) || ('slot' in action && action.slot !== undefined)) {
                invalidActions += 1;
            }
            const resolvedSlot = resolveBotPickSlot(team.roster, action);
            if (!resolvedSlot) {
                invalidActions += 1;
            }
        }

        const transitionRes = applyBotDraftAction(state, actorId, action, stepRng.random);
        if (!transitionRes.ok) {
            invalidActions += 1;
            const diagnosis = diagnoseDeadRoll(team);
            stuckInfo = {
                seed,
                difficulty,
                persona: typeof persona === 'string' ? persona : persona?.id ?? 'neutral',
                stepIndex,
                pickedCount: pickedBefore,
                phase: team.draft.phase,
                currentTeamSeason: team.draft.currentRoll?.id ?? null,
                remainingRerolls: { ...team.rerolls },
                openRoles: diagnosis.openRoles,
                reason: `transition_failed:${transitionRes.reason}`,
                flags: diagnosis.flags,
            };
            break;
        }

        if (action.type === 'reroll') {
            rerollsUsed[action.rerollType] = (rerollsUsed[action.rerollType] ?? 0) + 1;
        } else if (action.type === 'redraw') {
            freeRedrawCount += 1;
        } else if (action.type === 'pick') {
            if (roundPreRerollBestScore !== null && transitionRes.player) {
                const postScore = scorePlayerForRole(transitionRes.player, action.role, {
                    difficulty: 'expert',
                    persona,
                });
                rerollTransitions.push({
                    preScore: roundPreRerollBestScore,
                    postScore,
                    delta: postScore - roundPreRerollBestScore,
                });
            }
            roundPreRerollBestScore = null;
        }

        stepIndex += 1;
    }

    const completed = Boolean(
        team.draft.locked && team.draft.phase === 'LOCKED' && isRosterComplete(team)
    );

    // Check duplicate violations
    const pickedIds = SLOTS.map((slot) => team.roster[slot]?.id).filter(Boolean);
    const uniqueIds = new Set(pickedIds);
    const duplicateViolations = pickedIds.length - uniqueIds.size;

    const teamRating = calculateTeamRating(team);
    const profile = calculateTeamProfile(team);

    const roleQuality = {};
    for (const role of ROLES) {
        const rolePlayers = SLOTS.filter((s) => s.startsWith(role))
            .map((s) => team.roster[s])
            .filter(Boolean);
        if (rolePlayers.length === 0) {
            roleQuality[role] = 0;
        } else {
            const sum = rolePlayers.reduce(
                (acc, p) => acc + scorePlayerForRole(p, role, { difficulty: 'expert', persona }),
                0
            );
            roleQuality[role] = sum / rolePlayers.length;
        }
    }

    return {
        seed,
        difficulty,
        completed,
        stuck: !completed,
        stuckInfo,
        decisions,
        invalidActions,
        duplicateViolations,
        rerollsUsed,
        freeRedrawCount,
        rerollTransitions,
        teamRating,
        profile,
        roleQuality,
        team,
    };
}

export function simulateBotDraftBatch({
    difficulty = 'expert',
    persona = 'neutral',
    runs = 1000,
    baseSeed = 20261006,
    maxStuckExamples = 5,
} = {}) {
    let completed = 0;
    let stuck = 0;
    let duplicateViolations = 0;
    let invalidActions = 0;
    let totalDecisions = 0;
    let freeRedrawCount = 0;
    let draftsUsingFreeRedraw = 0;

    let sumTeamRating = 0;
    const sumProfile = {
        attack: 0,
        creation: 0,
        defense: 0,
        physical: 0,
        goalkeeping: 0,
        overall: 0,
    };
    const sumRoleQuality = {
        GK: 0,
        DF: 0,
        MF: 0,
        FW: 0,
    };
    const sumRerolls = {
        league: 0,
        club: 0,
        year: 0,
    };

    let rerollRoundCount = 0;
    let sumPreRerollScore = 0;
    let sumPostRerollScore = 0;

    const stuckByReason = {
        no_legal_pick: 0,
        no_reroll_remaining: 0,
        duplicate_only: 0,
        role_unavailable: 0,
    };
    const stuckPrimaryCounts = {};
    const stuckExamples = [];

    for (let i = 0; i < runs; i++) {
        const seed = deriveDraftSeed(baseSeed, i);
        const res = simulateSingleBotDraft({
            seed,
            difficulty,
            persona,
        });

        totalDecisions += res.decisions;
        duplicateViolations += res.duplicateViolations;
        invalidActions += res.invalidActions;

        freeRedrawCount += res.freeRedrawCount;
        if (res.freeRedrawCount > 0) {
            draftsUsingFreeRedraw += 1;
        }

        sumRerolls.league += res.rerollsUsed.league;
        sumRerolls.club += res.rerollsUsed.club;
        sumRerolls.year += res.rerollsUsed.year;

        for (const rt of res.rerollTransitions) {
            rerollRoundCount += 1;
            sumPreRerollScore += rt.preScore;
            sumPostRerollScore += rt.postScore;
        }

        if (res.completed) {
            completed += 1;
            sumTeamRating += res.teamRating;
            sumProfile.attack += res.profile.attack;
            sumProfile.creation += res.profile.creation;
            sumProfile.defense += res.profile.defense;
            sumProfile.physical += res.profile.physical;
            sumProfile.goalkeeping += res.profile.goalkeeping;
            sumProfile.overall += res.profile.overall;

            for (const role of ROLES) {
                sumRoleQuality[role] += res.roleQuality[role];
            }
        } else {
            stuck += 1;
            const info = res.stuckInfo;
            if (info) {
                stuckPrimaryCounts[info.reason] = (stuckPrimaryCounts[info.reason] ?? 0) + 1;
                if (info.flags?.noLegalPick) stuckByReason.no_legal_pick += 1;
                if (info.flags?.noRerollRemaining) stuckByReason.no_reroll_remaining += 1;
                if (info.flags?.duplicateOnly) stuckByReason.duplicate_only += 1;
                if (info.flags?.roleUnavailable) stuckByReason.role_unavailable += 1;

                if (stuckExamples.length < maxStuckExamples) {
                    stuckExamples.push(info);
                }
            }
        }
    }

    const denom = Math.max(1, completed);
    const round2 = (n) => Math.round(n * 100) / 100;
    const round4 = (n) => Math.round(n * 10000) / 10000;

    return {
        difficulty,
        persona: typeof persona === 'string' ? persona : persona?.id ?? 'neutral',
        runs,
        completed,
        stuck,
        completionRate: round4((completed / Math.max(1, runs)) * 100),
        stuckRate: round4((stuck / Math.max(1, runs)) * 100),
        freeRedrawCount,
        draftsUsingFreeRedraw,
        freeRedrawRate: round4((draftsUsingFreeRedraw / Math.max(1, runs)) * 100),
        avgTeamRating: round2(sumTeamRating / denom),
        avgProfile: {
            attack: round2(sumProfile.attack / denom),
            creation: round2(sumProfile.creation / denom),
            defense: round2(sumProfile.defense / denom),
            physical: round2(sumProfile.physical / denom),
            goalkeeping: round2(sumProfile.goalkeeping / denom),
            overall: round2(sumProfile.overall / denom),
        },
        avgFinalRoleQuality: {
            GK: round2(sumRoleQuality.GK / denom),
            DF: round2(sumRoleQuality.DF / denom),
            MF: round2(sumRoleQuality.MF / denom),
            FW: round2(sumRoleQuality.FW / denom),
        },
        rerollUsage: {
            league: round2(sumRerolls.league / Math.max(1, runs)),
            club: round2(sumRerolls.club / Math.max(1, runs)),
            year: round2(sumRerolls.year / Math.max(1, runs)),
            total: round2(
                (sumRerolls.league + sumRerolls.club + sumRerolls.year) / Math.max(1, runs)
            ),
        },
        rerollQualityEffect: {
            rerolledRoundsWithLegalAlternative: rerollRoundCount,
            avgPreRerollBestScore:
                rerollRoundCount > 0 ? round2(sumPreRerollScore / rerollRoundCount) : null,
            avgPostRerollPickedScore:
                rerollRoundCount > 0 ? round2(sumPostRerollScore / rerollRoundCount) : null,
            avgGainFromReroll:
                rerollRoundCount > 0
                    ? round2((sumPostRerollScore - sumPreRerollScore) / rerollRoundCount)
                    : null,
        },
        avgDecisionsPerDraft: round2(totalDecisions / Math.max(1, runs)),
        duplicateViolations,
        invalidActions,
        stuckByReason,
        stuckPrimaryCounts,
        stuckExamples,
    };
}

function parseCliArgs(argv) {
    const args = {
        runs: 100000,
        baseSeed: 20261006,
        difficulty: null,
    };

    for (const token of argv) {
        if (token.startsWith('--runs=')) {
            args.runs = Math.max(1, Number(token.slice('--runs='.length)) || 100000);
        } else if (token.startsWith('--base-seed=')) {
            args.baseSeed = Number(token.slice('--base-seed='.length)) || 20261006;
        } else if (token.startsWith('--difficulty=')) {
            args.difficulty = token.slice('--difficulty='.length).trim().toLowerCase();
        }
    }
    return args;
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const { runs, baseSeed, difficulty } = parseCliArgs(process.argv.slice(2));
    const difficulties =
        difficulty && BOT_DIFFICULTIES.includes(difficulty)
            ? [difficulty]
            : [...BOT_DIFFICULTIES];

    const runsPerDiff = Math.ceil(runs / difficulties.length);
    const totalTargetRuns = runsPerDiff * difficulties.length;

    console.log(
        `[simulate-bot-drafts] Running ${totalTargetRuns} total draft attempts (${runsPerDiff} per difficulty) with baseSeed=${baseSeed}...`
    );

    const startTime = Date.now();
    const results = {};
    let totalAttempts = 0;
    let totalCompleted = 0;
    let totalStuck = 0;
    let totalFreeRedrawCount = 0;
    let totalDraftsUsingFreeRedraw = 0;
    const aggregateStuckByReason = {
        no_legal_pick: 0,
        no_reroll_remaining: 0,
        duplicate_only: 0,
        role_unavailable: 0,
    };
    const allStuckExamples = [];

    for (const diff of difficulties) {
        const summary = simulateBotDraftBatch({
            difficulty: diff,
            persona: 'neutral',
            runs: runsPerDiff,
            baseSeed,
            maxStuckExamples: 3,
        });
        results[diff] = summary;
        totalAttempts += summary.runs;
        totalCompleted += summary.completed;
        totalStuck += summary.stuck;
        totalFreeRedrawCount += summary.freeRedrawCount;
        totalDraftsUsingFreeRedraw += summary.draftsUsingFreeRedraw;
        aggregateStuckByReason.no_legal_pick += summary.stuckByReason.no_legal_pick;
        aggregateStuckByReason.no_reroll_remaining += summary.stuckByReason.no_reroll_remaining;
        aggregateStuckByReason.duplicate_only += summary.stuckByReason.duplicate_only;
        aggregateStuckByReason.role_unavailable += summary.stuckByReason.role_unavailable;
        for (const ex of summary.stuckExamples) {
            if (allStuckExamples.length < 6) {
                allStuckExamples.push(ex);
            }
        }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
        JSON.stringify(
            {
                baseSeed,
                totalAttempts,
                totalCompleted,
                totalStuck,
                overallCompletionRatePct:
                    Math.round((totalCompleted / Math.max(1, totalAttempts)) * 10000) / 100,
                overallStuckRatePct:
                    Math.round((totalStuck / Math.max(1, totalAttempts)) * 10000) / 100,
                freeRedrawCount: totalFreeRedrawCount,
                draftsUsingFreeRedraw: totalDraftsUsingFreeRedraw,
                freeRedrawRate:
                    Math.round(
                        (totalDraftsUsingFreeRedraw / Math.max(1, totalAttempts)) * 1000000
                    ) / 10000,
                aggregateStuckByReason,
                elapsedSeconds: Number(elapsedSec),
                byDifficulty: results,
                reproducibleStuckExamples: allStuckExamples,
            },
            null,
            2
        )
    );
}

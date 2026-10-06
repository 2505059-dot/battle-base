// Bot Difficulty Benchmark — Draft Quality + Head-to-Head Match Simulation v1 with Seat Swap

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ROLES } from '../public/game/shared/constants.js';
import { generateMatchScript } from '../public/game/match/engine.js';
import { BOT_DIFFICULTIES } from '../public/game/bot/decision.js';
import { hashBotSeed } from '../public/game/bot/rng.js';
import {
    deriveDraftSeed,
    simulateSingleBotDraft,
} from './simulate-bot-drafts.mjs';

const HEAD_TO_HEAD_PAIRINGS = [
    ['random', 'casual'],
    ['casual', 'smart'],
    ['smart', 'expert'],
    ['expert', 'random'],
];

function round2(n) {
    return Math.round(n * 100) / 100;
}

function round4(n) {
    return Math.round(n * 10000) / 10000;
}

export function runBotBenchmark({
    runs = 5000,
    matchupPairs = 2500,
    baseSeed = 20261006,
} = {}) {
    const startTime = Date.now();
    const draftStats = {};
    const rostersByDiff = {};

    for (const diff of BOT_DIFFICULTIES) {
        rostersByDiff[diff] = new Array(runs).fill(null);

        let completed = 0;
        let stuck = 0;
        let duplicateViolations = 0;
        let invalidActions = 0;
        let totalDecisions = 0;
        let sumTeamRating = 0;
        const sumProfile = {
            attack: 0,
            creation: 0,
            defense: 0,
            physical: 0,
            goalkeeping: 0,
            overall: 0,
        };
        const sumRoleQuality = { GK: 0, DF: 0, MF: 0, FW: 0 };
        const sumRerolls = { league: 0, club: 0, year: 0 };
        let rerollRoundCount = 0;
        let sumPreRerollScore = 0;
        let sumPostRerollScore = 0;
        const stuckByReason = {
            no_legal_pick: 0,
            no_reroll_remaining: 0,
            duplicate_only: 0,
            role_unavailable: 0,
        };
        const stuckExamples = [];

        for (let i = 0; i < runs; i++) {
            const seed = deriveDraftSeed(baseSeed, i);
            const res = simulateSingleBotDraft({
                seed,
                difficulty: diff,
                persona: 'neutral',
            });

            totalDecisions += res.decisions;
            duplicateViolations += res.duplicateViolations;
            invalidActions += res.invalidActions;
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
                rostersByDiff[diff][i] = res.team.roster;
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
                if (res.stuckInfo) {
                    if (res.stuckInfo.flags?.noLegalPick) stuckByReason.no_legal_pick += 1;
                    if (res.stuckInfo.flags?.noRerollRemaining) stuckByReason.no_reroll_remaining += 1;
                    if (res.stuckInfo.flags?.duplicateOnly) stuckByReason.duplicate_only += 1;
                    if (res.stuckInfo.flags?.roleUnavailable) stuckByReason.role_unavailable += 1;
                    if (stuckExamples.length < 3) {
                        stuckExamples.push(res.stuckInfo);
                    }
                }
            }
        }

        const denom = Math.max(1, completed);
        draftStats[diff] = {
            difficulty: diff,
            runs,
            completed,
            stuck,
            completionRate: round4((completed / Math.max(1, runs)) * 100),
            stuckRate: round4((stuck / Math.max(1, runs)) * 100),
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
            stuckExamples,
        };
    }

    // Head-to-Head Match Simulation with Seat Swap
    const headToHead = {};
    const targetPairs = Math.min(matchupPairs, runs);

    for (const [leftDiff, rightDiff] of HEAD_TO_HEAD_PAIRINGS) {
        const key = `${leftDiff}_vs_${rightDiff}`;

        // Leg 1: leftDiff as Team A (seed i), rightDiff as Team B (seed j)
        const leg1 = { leftWins: 0, draws: 0, rightWins: 0, leftGoals: 0, rightGoals: 0, matches: 0 };
        // Leg 2 (seat swapped): rightDiff as Team A (seed i), leftDiff as Team B (seed j)
        const leg2 = { leftWins: 0, draws: 0, rightWins: 0, leftGoals: 0, rightGoals: 0, matches: 0 };

        for (let i = 0; i < targetPairs; i++) {
            const j = (i + 1) % runs;
            const leftRosterI = rostersByDiff[leftDiff][i];
            const rightRosterJ = rostersByDiff[rightDiff][j];
            const rightRosterI = rostersByDiff[rightDiff][i];
            const leftRosterJ = rostersByDiff[leftDiff][j];

            if (!leftRosterI || !rightRosterJ || !rightRosterI || !leftRosterJ) {
                continue;
            }

            const matchSeed = hashBotSeed(`match::${baseSeed}::${key}::${i}`);

            // Leg 1: A = leftDiff(i), B = rightDiff(j)
            const res1 = generateMatchScript(leftRosterI, rightRosterJ, matchSeed);
            leg1.matches += 1;
            leg1.leftGoals += res1.finalScore.A;
            leg1.rightGoals += res1.finalScore.B;
            if (res1.finalScore.A > res1.finalScore.B) leg1.leftWins += 1;
            else if (res1.finalScore.B > res1.finalScore.A) leg1.rightWins += 1;
            else leg1.draws += 1;

            // Leg 2 (Seat Swapped): A = rightDiff(i), B = leftDiff(j)
            const res2 = generateMatchScript(rightRosterI, leftRosterJ, matchSeed);
            leg2.matches += 1;
            leg2.rightGoals += res2.finalScore.A;
            leg2.leftGoals += res2.finalScore.B;
            if (res2.finalScore.B > res2.finalScore.A) leg2.leftWins += 1;
            else if (res2.finalScore.A > res2.finalScore.B) leg2.rightWins += 1;
            else leg2.draws += 1;
        }

        const totalMatches = leg1.matches + leg2.matches;
        const leftWins = leg1.leftWins + leg2.leftWins;
        const draws = leg1.draws + leg2.draws;
        const rightWins = leg1.rightWins + leg2.rightWins;
        const leftGoals = leg1.leftGoals + leg2.leftGoals;
        const rightGoals = leg1.rightGoals + leg2.rightGoals;

        headToHead[key] = {
            left: leftDiff,
            right: rightDiff,
            pairedSeeds: leg1.matches,
            totalMatchesWithSeatSwap: totalMatches,
            combined: {
                [`${leftDiff}Wins`]: leftWins,
                draws,
                [`${rightDiff}Wins`]: rightWins,
                [`${leftDiff}WinPct`]: round2((leftWins / Math.max(1, totalMatches)) * 100),
                drawPct: round2((draws / Math.max(1, totalMatches)) * 100),
                [`${rightDiff}WinPct`]: round2((rightWins / Math.max(1, totalMatches)) * 100),
                [`${leftDiff}AvgGoals`]: round2(leftGoals / Math.max(1, totalMatches)),
                [`${rightDiff}AvgGoals`]: round2(rightGoals / Math.max(1, totalMatches)),
                [`${rightDiff}PointsPct`]: round2(
                    ((rightWins * 3 + draws) / Math.max(1, totalMatches * 3)) * 100
                ),
            },
            seatNormal_LeftAsA_RightAsB: {
                matches: leg1.matches,
                [`${leftDiff}WinPct`]: round2((leg1.leftWins / Math.max(1, leg1.matches)) * 100),
                drawPct: round2((leg1.draws / Math.max(1, leg1.matches)) * 100),
                [`${rightDiff}WinPct`]: round2((leg1.rightWins / Math.max(1, leg1.matches)) * 100),
            },
            seatSwapped_RightAsA_LeftAsB: {
                matches: leg2.matches,
                [`${leftDiff}WinPct`]: round2((leg2.leftWins / Math.max(1, leg2.matches)) * 100),
                drawPct: round2((leg2.draws / Math.max(1, leg2.matches)) * 100),
                [`${rightDiff}WinPct`]: round2((leg2.rightWins / Math.max(1, leg2.matches)) * 100),
            },
        };
    }

    const elapsedSeconds = round2((Date.now() - startTime) / 1000);

    return {
        baseSeed,
        runsPerDifficulty: runs,
        matchupPairsPerHeadToHead: targetPairs,
        elapsedSeconds,
        draftStats,
        headToHead,
    };
}

function parseCliArgs(argv) {
    const args = {
        runs: 5000,
        matchups: 2500,
        baseSeed: 20261006,
    };

    for (const token of argv) {
        if (token.startsWith('--runs=')) {
            args.runs = Math.max(100, Number(token.slice('--runs='.length)) || 5000);
        } else if (token.startsWith('--matchups=')) {
            args.matchups = Math.max(100, Number(token.slice('--matchups='.length)) || 2500);
        } else if (token.startsWith('--base-seed=')) {
            args.baseSeed = Number(token.slice('--base-seed='.length)) || 20261006;
        }
    }
    if (args.matchups > args.runs) {
        args.matchups = args.runs;
    }
    return args;
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const { runs, matchups, baseSeed } = parseCliArgs(process.argv.slice(2));
    console.log(
        `[benchmark-bots] Running ${runs} drafts per difficulty + ${matchups}x2 seat-swapped matchups per pairing (baseSeed=${baseSeed})...`
    );
    const report = runBotBenchmark({
        runs,
        matchupPairs: matchups,
        baseSeed,
    });
    console.log(JSON.stringify(report, null, 2));
}

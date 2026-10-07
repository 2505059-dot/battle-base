// Core Bot Decision Engine — chooseDraftAction & Dead-Roll Diagnosis
// Pure logic, deterministic with decisionSeed, strictly non-cheating (never reads opponent or future RNG).

import { ROLES } from '../shared/constants.js';
import { canTeamRoll, canTeamPick, canTeamLock } from '../state.js';
import {
    getFirstAvailableSlotForRole,
    isPlayerInRoster,
    isPlayerEntityInRoster,
    isRosterComplete,
    getLegalPickActions,
    getLegalRerollActions,
    getLegalDraftActions,
    canFreeRedraw,
    isDeadRoll,
} from '../draft/rules.js';
import {
    BOT_DIFFICULTIES,
    BOT_DIFFICULTY_CONFIG,
    BOT_REASON_CODES,
    normalizeDifficulty,
} from './config.js';
import { createBotRng, deriveBotDecisionSeed } from './rng.js';
import { NEUTRAL_PERSONA, resolvePersona } from './personas.js';
import { scorePlayerForRole, scoreMarginalRosterGain, evaluateCandidatePick } from './scoring.js';
import { estimateRerollValue } from './reroll-value.js';

export {
    BOT_DIFFICULTIES,
    BOT_REASON_CODES,
    NEUTRAL_PERSONA,
    getLegalPickActions,
    getLegalRerollActions,
    getLegalDraftActions,
    canFreeRedraw,
    isDeadRoll,
    scorePlayerForRole,
    scoreMarginalRosterGain,
    estimateRerollValue,
};

export function diagnoseDeadRoll(team) {
    const roster = team?.roster ?? team ?? {};
    const currentRoll = team?.draft?.currentRoll ?? team?.currentRoll ?? null;
    const rerolls = team?.rerolls ?? { league: 0, club: 0, year: 0 };
    const legalPicks = getLegalPickActions(team);
    const legalRerolls = getLegalRerollActions(team);

    const openRoles = ROLES.filter((role) => getFirstAvailableSlotForRole(roster, role) !== null);
    const players = currentRoll?.players ?? [];

    const roleMatchingPlayers = players.filter(
        (p) => Array.isArray(p.positions) && p.positions.some((r) => openRoles.includes(r))
    );
    const duplicateRolePlayers = roleMatchingPlayers.filter((p) =>
        isPlayerEntityInRoster(roster, p)
    );
    const unpickedPlayers = players.filter((p) => !isPlayerEntityInRoster(roster, p));

    const noLegalPick = legalPicks.length === 0;
    const noRerollRemaining = legalRerolls.length === 0;
    const duplicateOnly =
        noLegalPick &&
        roleMatchingPlayers.length > 0 &&
        duplicateRolePlayers.length === roleMatchingPlayers.length;
    const roleUnavailable = noLegalPick && roleMatchingPlayers.length === 0;

    let primaryReason = 'no_legal_action';
    if (noLegalPick && noRerollRemaining) {
        if (duplicateOnly) {
            primaryReason = 'duplicate_only';
        } else if (roleUnavailable) {
            primaryReason = 'role_unavailable';
        } else {
            primaryReason = 'no_legal_pick';
        }
    } else if (noLegalPick) {
        primaryReason = 'no_legal_pick';
    } else if (noRerollRemaining) {
        primaryReason = 'no_reroll_remaining';
    }

    return {
        isStuck: noLegalPick && noRerollRemaining,
        primaryReason,
        flags: {
            noLegalPick,
            noRerollRemaining,
            duplicateOnly,
            roleUnavailable,
        },
        openRoles,
        remainingRerolls: {
            league: rerolls.league ?? 0,
            club: rerolls.club ?? 0,
            year: rerolls.year ?? 0,
        },
        currentRollId: currentRoll?.id ?? null,
    };
}

function attachDebugMetadata(action, debug, includeDebug = false) {
    if (includeDebug) {
        return {
            ...action,
            action: { ...action },
            debug,
        };
    }

    const result = { ...action };
    Object.defineProperty(result, 'debug', {
        value: debug,
        enumerable: false,
        configurable: true,
    });
    Object.defineProperty(result, 'action', {
        value: { ...action },
        enumerable: false,
        configurable: true,
    });
    return result;
}

export function toPublicDraftAction(actionOrDecision) {
    const raw = actionOrDecision?.action ?? actionOrDecision;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'roll') return { type: 'roll' };
    if (raw.type === 'lock') return { type: 'lock' };
    if (raw.type === 'reroll') return { type: 'reroll', rerollType: raw.rerollType };
    if (raw.type === 'redraw') return { type: 'redraw' };
    if (raw.type === 'pick') return { type: 'pick', playerId: raw.playerId, role: raw.role };
    if (raw.type === 'stuck') return { type: 'stuck', reason: raw.reason };
    return null;
}

export function chooseDraftAction({
    team,
    difficulty = 'smart',
    persona = 'neutral',
    decisionSeed = 1,
    includeDebug = false,
} = {}) {
    const normDifficulty = normalizeDifficulty(difficulty);
    const resolvedPersona = resolvePersona(persona);
    const diffCfg = BOT_DIFFICULTY_CONFIG[normDifficulty] ?? BOT_DIFFICULTY_CONFIG.smart;

    if (!team) {
        return attachDebugMetadata(
            { type: 'stuck', reason: 'missing_team' },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.STUCK_DEAD_ROLL,
            },
            includeDebug
        );
    }

    const phase =
        team?.draft?.phase ??
        (isRosterComplete(team)
            ? 'READY'
            : team?.draft?.currentRoll || team?.currentRoll
              ? 'PICK'
              : 'ROLL');

    // 1. ROLL phase
    if (canTeamRoll(team) || (!team.draft && phase === 'ROLL')) {
        return attachDebugMetadata(
            { type: 'roll' },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.ROLL_NEXT,
            },
            includeDebug
        );
    }

    // 2. READY phase -> LOCK
    if (canTeamLock(team) || (!team.draft && phase === 'READY' && isRosterComplete(team))) {
        return attachDebugMetadata(
            { type: 'lock' },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.LOCK_COMPLETE,
            },
            includeDebug
        );
    }

    // 3. PICK phase
    const currentRoll = team?.draft?.currentRoll ?? team?.currentRoll ?? null;
    const isPickAllowed =
        canTeamPick(team) || (!team.draft && phase === 'PICK' && currentRoll !== null);

    if (!isPickAllowed || !currentRoll) {
        return attachDebugMetadata(
            { type: 'stuck', reason: 'invalid_phase' },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.STUCK_DEAD_ROLL,
            },
            includeDebug
        );
    }

    const legalPicks = getLegalPickActions(team);
    const legalRerolls = getLegalRerollActions(team);

    if (legalPicks.length === 0 && legalRerolls.length === 0) {
        const diagnosis = diagnoseDeadRoll(team);
        if (canFreeRedraw(team)) {
            return attachDebugMetadata(
                { type: 'redraw' },
                {
                    candidateScore: null,
                    bestPickValue: null,
                    rerollValue: null,
                    reasonCode: BOT_REASON_CODES.DEAD_ROLL_FREE_REDRAW,
                    diagnosis,
                },
                includeDebug
            );
        }
        return attachDebugMetadata(
            { type: 'stuck', reason: diagnosis.primaryReason },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.STUCK_DEAD_ROLL,
                diagnosis,
            },
            includeDebug
        );
    }

    const derivedSeed = deriveBotDecisionSeed({
        decisionSeed,
        team,
        difficulty: normDifficulty,
        personaId: resolvedPersona.id,
    });
    const rng = createBotRng(derivedSeed);

    // ----- RANDOM DIFFICULTY -----
    if (normDifficulty === 'random') {
        if (legalPicks.length === 0) {
            const chosenReroll = rng.pickRandom(legalRerolls);
            return attachDebugMetadata(
                { type: 'reroll', rerollType: chosenReroll.rerollType },
                {
                    candidateScore: null,
                    bestPickValue: null,
                    rerollValue: null,
                    reasonCode: BOT_REASON_CODES.REROLL_NO_GOOD_PICK,
                },
                includeDebug
            );
        }

        if (legalRerolls.length > 0 && rng.random() < diffCfg.randomRerollProb) {
            const chosenReroll = rng.pickRandom(legalRerolls);
            return attachDebugMetadata(
                { type: 'reroll', rerollType: chosenReroll.rerollType },
                {
                    candidateScore: null,
                    bestPickValue: null,
                    rerollValue: null,
                    reasonCode: BOT_REASON_CODES.RANDOM_CHOICE,
                },
                includeDebug
            );
        }

        const chosenPick = rng.pickRandom(legalPicks);
        const candScore = scorePlayerForRole(chosenPick.player, chosenPick.role, {
            difficulty: 'random',
            persona: resolvedPersona,
        });
        return attachDebugMetadata(
            {
                type: 'pick',
                playerId: chosenPick.playerId,
                role: chosenPick.role,
            },
            {
                candidateScore: candScore,
                bestPickValue: candScore,
                rerollValue: null,
                reasonCode: BOT_REASON_CODES.RANDOM_CHOICE,
            },
            includeDebug
        );
    }

    // ----- CASUAL DIFFICULTY -----
    if (normDifficulty === 'casual') {
        if (legalPicks.length === 0) {
            const chosenReroll = rng.pickRandom(legalRerolls);
            return attachDebugMetadata(
                { type: 'reroll', rerollType: chosenReroll.rerollType },
                {
                    candidateScore: null,
                    bestPickValue: null,
                    rerollValue: null,
                    reasonCode: BOT_REASON_CODES.REROLL_NO_GOOD_PICK,
                },
                includeDebug
            );
        }

        let bestEntry = null;
        for (const action of legalPicks) {
            const evalRes = evaluateCandidatePick(team, action.player, action.role, {
                difficulty: 'casual',
                persona: resolvedPersona,
            });
            const noise = rng.randomNoise(diffCfg.noiseAmplitude);
            const noisyValue = evalRes.totalValue + noise;

            if (!bestEntry || noisyValue > bestEntry.noisyValue) {
                bestEntry = { action, evalRes, noisyValue };
            }
        }

        if (
            legalRerolls.length > 0 &&
            bestEntry.evalRes.candidateScore < diffCfg.rerollThreshold &&
            rng.random() < diffCfg.rerollChanceWhenBelow
        ) {
            const chosenReroll = rng.pickRandom(legalRerolls);
            return attachDebugMetadata(
                { type: 'reroll', rerollType: chosenReroll.rerollType },
                {
                    candidateScore: bestEntry.evalRes.candidateScore,
                    bestPickValue: bestEntry.evalRes.totalValue,
                    rerollValue: diffCfg.rerollThreshold,
                    reasonCode: BOT_REASON_CODES.REROLL_NO_GOOD_PICK,
                },
                includeDebug
            );
        }

        return attachDebugMetadata(
            {
                type: 'pick',
                playerId: bestEntry.action.playerId,
                role: bestEntry.action.role,
            },
            {
                candidateScore: bestEntry.evalRes.candidateScore,
                bestPickValue: bestEntry.evalRes.totalValue,
                rerollValue: null,
                reasonCode: bestEntry.evalRes.isUrgent
                    ? BOT_REASON_CODES.PICK_ROLE_URGENT
                    : BOT_REASON_CODES.PICK_BEST_VALUE,
            },
            includeDebug
        );
    }

    // ----- SMART & EXPERT DIFFICULTIES -----
    let bestPickEntry = null;
    for (const action of legalPicks) {
        const evalRes = evaluateCandidatePick(team, action.player, action.role, {
            difficulty: normDifficulty,
            persona: resolvedPersona,
        });
        const noise =
            diffCfg.noiseAmplitude > 0
                ? rng.randomNoise(diffCfg.noiseAmplitude)
                : (rng.random() - 0.5) * 1e-6;
        const decisionValue = evalRes.totalValue + noise;

        if (!bestPickEntry || decisionValue > bestPickEntry.decisionValue) {
            bestPickEntry = {
                action,
                evalRes,
                decisionValue,
            };
        }
    }

    // If no legal picks exist in currentRoll, must use best legal reroll
    if (!bestPickEntry) {
        let bestRerollEval = null;
        for (const rerollAction of legalRerolls) {
            const evRes = estimateRerollValue({
                team,
                currentRoll,
                rerollType: rerollAction.rerollType,
                bestCurrentPickValue: -Infinity,
                bestCurrentCandidateScore: 0,
                difficulty: normDifficulty,
                persona: resolvedPersona,
            });
            const tieBreak = (rng.random() - 0.5) * 1e-6;
            const score = evRes.netExpectedValue + tieBreak;
            if (!bestRerollEval || score > bestRerollEval.score) {
                bestRerollEval = { rerollAction, evRes, score };
            }
        }

        const chosenType = bestRerollEval?.rerollAction?.rerollType ?? legalRerolls[0].rerollType;
        return attachDebugMetadata(
            { type: 'reroll', rerollType: chosenType },
            {
                candidateScore: null,
                bestPickValue: null,
                rerollValue: bestRerollEval?.evRes?.netExpectedValue ?? null,
                reasonCode: BOT_REASON_CODES.REROLL_NO_GOOD_PICK,
            },
            includeDebug
        );
    }

    const bestCurrentPickValue = bestPickEntry.evalRes.totalValue;
    const bestCurrentCandidateScore = bestPickEntry.evalRes.candidateScore;

    // Evaluate legal rerolls against the best current pick
    let bestRerollChoice = null;
    if (legalRerolls.length > 0) {
        for (const rerollAction of legalRerolls) {
            const evRes = estimateRerollValue({
                team,
                currentRoll,
                rerollType: rerollAction.rerollType,
                bestCurrentPickValue,
                bestCurrentCandidateScore,
                difficulty: normDifficulty,
                persona: resolvedPersona,
            });
            if (!evRes.available) continue;

            const evNoise =
                normDifficulty === 'smart'
                    ? rng.randomNoise(0.55)
                    : (rng.random() - 0.5) * 1e-6;
            const effectiveNetGain = evRes.netGain + evNoise;

            if (!bestRerollChoice || effectiveNetGain > bestRerollChoice.effectiveNetGain) {
                bestRerollChoice = {
                    rerollType: rerollAction.rerollType,
                    evRes,
                    effectiveNetGain,
                };
            }
        }
    }

    if (
        bestRerollChoice &&
        bestRerollChoice.effectiveNetGain >= (diffCfg.rerollMinNetGain ?? 0.55)
    ) {
        const reasonCode =
            bestCurrentCandidateScore < 76.5
                ? BOT_REASON_CODES.REROLL_NO_GOOD_PICK
                : BOT_REASON_CODES.REROLL_EXPECTED_UPGRADE;

        return attachDebugMetadata(
            {
                type: 'reroll',
                rerollType: bestRerollChoice.rerollType,
            },
            {
                candidateScore: bestCurrentCandidateScore,
                bestPickValue: bestCurrentPickValue,
                rerollValue: bestRerollChoice.evRes.netExpectedValue,
                expectedValue: bestRerollChoice.evRes.expectedValue,
                opportunityCost: bestRerollChoice.evRes.opportunityCost,
                netGain: bestRerollChoice.evRes.netGain,
                reasonCode,
            },
            includeDebug
        );
    }

    return attachDebugMetadata(
        {
            type: 'pick',
            playerId: bestPickEntry.action.playerId,
            role: bestPickEntry.action.role,
        },
        {
            candidateScore: bestCurrentCandidateScore,
            bestPickValue: bestCurrentPickValue,
            rerollValue: bestRerollChoice?.evRes?.netExpectedValue ?? null,
            reasonCode: bestPickEntry.evalRes.isUrgent
                ? BOT_REASON_CODES.PICK_ROLE_URGENT
                : BOT_REASON_CODES.PICK_BEST_VALUE,
        },
        includeDebug
    );
}

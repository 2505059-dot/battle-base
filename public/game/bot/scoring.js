// Candidate role scoring, marginal roster value, and position scarcity evaluation

import { ROLES, SLOTS } from '../shared/constants.js';
import {
    getPlayerOverall,
    getFirstAvailableSlotForRole,
    isPlayerInRoster,
    isPlayerEntityInRoster,
    findPlayersByRole,
    getRoleProgress,
    getPickedCount,
} from '../draft/rules.js';
import {
    BOT_ROLE_VALUE_WEIGHTS,
    PUBLIC_ROLE_BASELINES,
    ROLE_SLOT_IMPACT,
    ROLE_SCARCITY_PRIOR,
    BOT_DIFFICULTY_CONFIG,
    normalizeDifficulty,
} from './config.js';
import { resolvePersona } from './personas.js';

export function scorePlayerRoleAttributes(player, role, personaInput = 'neutral') {
    if (!player || !ROLES.includes(role)) return 0;
    const weights = BOT_ROLE_VALUE_WEIGHTS[role];
    if (!weights) return 0;

    const persona = resolvePersona(personaInput);
    const mult = persona.attributeMultipliers;

    const atk = (Number(player.attack) || 0) * (mult.attack ?? 1.0);
    const cre = (Number(player.creation) || 0) * (mult.creation ?? 1.0);
    const def = (Number(player.defense) || 0) * (mult.defense ?? 1.0);
    const phy = (Number(player.physical) || 0) * (mult.physical ?? 1.0);
    const gk = (Number(player.goalkeeping) || 0) * (mult.goalkeeping ?? 1.0);

    const weightedSum =
        weights.attack * atk +
        weights.creation * cre +
        weights.defense * def +
        weights.physical * phy +
        weights.goalkeeping * gk;

    const weightNorm =
        weights.attack * (mult.attack ?? 1.0) +
        weights.creation * (mult.creation ?? 1.0) +
        weights.defense * (mult.defense ?? 1.0) +
        weights.physical * (mult.physical ?? 1.0) +
        weights.goalkeeping * (mult.goalkeeping ?? 1.0);

    return weightNorm > 0 ? weightedSum / weightNorm : 0;
}

export function scorePlayerForRole(player, role, context = {}) {
    if (!player || !ROLES.includes(role)) return 0;

    // Enforce legal position fit when player.positions is present
    if (
        Array.isArray(player.positions) &&
        player.positions.length > 0 &&
        !player.positions.includes(role)
    ) {
        return 0;
    }

    const difficulty = normalizeDifficulty(context.difficulty ?? 'expert');
    const diffCfg = BOT_DIFFICULTY_CONFIG[difficulty] ?? BOT_DIFFICULTY_CONFIG.expert;
    const persona = resolvePersona(context.persona);

    const roleAttrScore = scorePlayerRoleAttributes(player, role, persona);
    const overall = getPlayerOverall(player) * (persona.attributeMultipliers.overall ?? 1.0);

    const overallWeight = diffCfg.overallWeight ?? 0.08;
    const roleFitWeight = diffCfg.roleFitWeight ?? 0.92;

    let baseScore = roleFitWeight * roleAttrScore + overallWeight * overall;

    // Apply persona role weight and star preference (neutral: 1.0 and 0.0)
    const roleMult = persona.roleWeights?.[role] ?? 1.0;
    baseScore *= roleMult;

    if (persona.starPreference !== 0 && overall > 86) {
        baseScore += (overall - 86) * 0.25 * persona.starPreference;
    }

    return Number.isFinite(baseScore) ? baseScore : 0;
}

export function scoreRoleUrgency(team, role, context = {}) {
    if (!team || !ROLES.includes(role)) {
        return { urgencyBonus: 0, shareNeeded: 0, missing: 0, isUrgent: false };
    }

    const progress = getRoleProgress(team);
    const roleInfo = progress[role];
    if (!roleInfo || roleInfo.filled >= roleInfo.total) {
        return { urgencyBonus: 0, shareNeeded: 0, missing: 0, isUrgent: false };
    }

    const missing = roleInfo.total - roleInfo.filled;
    const pickedCount = getPickedCount(team);
    const remainingPicks = Math.max(1, SLOTS.length - pickedCount);
    const shareNeeded = missing / remainingPicks;

    const openRoleCount = ROLES.filter((r) => progress[r].filled < progress[r].total).length;
    const scarcityPrior = ROLE_SCARCITY_PRIOR[role] ?? 1.0;

    // Structural slot need + scarcity prior
    let urgencyBonus =
        (scarcityPrior - 1.0) * 1.6 + (missing / Math.max(1, roleInfo.total)) * 0.95;

    // Late-draft concentration pressure: rises sharply as missing slots approach remaining picks
    urgencyBonus += Math.pow(shareNeeded, 1.45) * 3.8;

    if (openRoleCount === 1) {
        urgencyBonus += 4.5;
    } else if (remainingPicks <= 3 && missing >= 1) {
        urgencyBonus += (4 - remainingPicks) * 0.75 * shareNeeded;
    }

    const isUrgent =
        openRoleCount === 1 ||
        shareNeeded >= 0.55 ||
        (remainingPicks <= 3 && missing >= 2) ||
        (remainingPicks === 1 && missing === 1);

    return {
        urgencyBonus: Number.isFinite(urgencyBonus) ? urgencyBonus : 0,
        shareNeeded,
        missing,
        isUrgent,
    };
}

export function evaluateCandidatePick(team, player, role, context = {}) {
    const roster = team?.roster ?? team;
    if (
        !roster ||
        !player ||
        !ROLES.includes(role) ||
        getFirstAvailableSlotForRole(roster, role) === null ||
        isPlayerEntityInRoster(roster, player) ||
        (Array.isArray(player.positions) && !player.positions.includes(role))
    ) {
        return {
            legal: false,
            candidateScore: 0,
            valueOverBaseline: -Infinity,
            roleWeaknessBonus: 0,
            urgencyBonus: 0,
            flexibilityBonus: 0,
            totalValue: -Infinity,
            isUrgent: false,
        };
    }

    const difficulty = normalizeDifficulty(context.difficulty ?? 'expert');
    const persona = resolvePersona(context.persona);
    const candidateScore = scorePlayerForRole(player, role, { difficulty, persona });

    // Casual uses raw overall-heavy score + simple last-slot completion nudge
    if (difficulty === 'casual') {
        const progress = getRoleProgress(roster);
        const roleInfo = progress[role];
        const missing = roleInfo.total - roleInfo.filled;
        const remainingPicks = Math.max(1, SLOTS.length - getPickedCount(roster));
        const simpleUrgency = remainingPicks <= 2 && missing >= 1 ? 2.0 : 0;
        const totalValue = candidateScore + simpleUrgency;
        return {
            legal: true,
            candidateScore,
            valueOverBaseline: candidateScore - (PUBLIC_ROLE_BASELINES[role] ?? 81.0),
            roleWeaknessBonus: 0,
            urgencyBonus: simpleUrgency,
            flexibilityBonus: 0,
            totalValue,
            isUrgent: simpleUrgency > 0,
        };
    }

    // Smart & Expert: Value Over Replacement + Role Weakness Stabilization + Role Urgency
    const baseline = PUBLIC_ROLE_BASELINES[role] ?? 81.0;
    const slotImpact = ROLE_SLOT_IMPACT[role] ?? 1.0;
    const valueOverBaseline = (candidateScore - baseline) * slotImpact;
    const normalizedQuality = 81.5 + valueOverBaseline;

    const existingInRole = findPlayersByRole(roster, role);
    let roleWeaknessBonus = 0;
    const balancePref = persona.balancePreference ?? 1.0;

    if (existingInRole.length === 0) {
        // Unfilled line bonus
        roleWeaknessBonus = 0.75 * balancePref;
    } else {
        const existingSum = existingInRole.reduce(
            (acc, p) => acc + scorePlayerForRole(p, role, { difficulty, persona }),
            0
        );
        const existingAvg = existingSum / existingInRole.length;
        const weaknessGap = Math.max(-3.0, Math.min(5.0, baseline - existingAvg));
        roleWeaknessBonus = weaknessGap * 0.26 * balancePref;
    }

    const { urgencyBonus, isUrgent } = scoreRoleUrgency(roster, role, context);

    // Multi-position & role scarcity awareness:
    // Slightly reward using a candidate to fill a structurally scarcer role (DF/FW)
    let flexibilityBonus = 0;
    if (Array.isArray(player.positions) && player.positions.length > 1) {
        const scarcity = ROLE_SCARCITY_PRIOR[role] ?? 1.0;
        flexibilityBonus = (scarcity - 1.0) * 0.6;
    }

    const totalValue =
        normalizedQuality + roleWeaknessBonus + urgencyBonus + flexibilityBonus;

    return {
        legal: true,
        candidateScore,
        valueOverBaseline,
        roleWeaknessBonus,
        urgencyBonus,
        flexibilityBonus,
        totalValue: Number.isFinite(totalValue) ? totalValue : 0,
        isUrgent,
    };
}

export function scoreMarginalRosterGain(team, player, role, context = {}) {
    const evalResult = evaluateCandidatePick(team, player, role, context);
    return evalResult.legal ? evalResult.totalValue : -Infinity;
}

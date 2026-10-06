// Pure Team Profile calculation from 11v11 (4-3-3) roster and role weights

import { SLOTS, getSlotRole } from '../shared/constants.js';
import { getPlayerOverall, findPlayerByRole } from '../draft/rules.js';
import { ROLE_WEIGHTS } from './config.js';

// Legacy helper retained only for backward export compatibility; not used in 11v11 rosters
export function resolveFlexRole(player) {
    if (!player || !Array.isArray(player.positions)) return 'MF';
    const candidateRoles = player.positions.filter((pos) => pos !== 'GK' && ROLE_WEIGHTS[pos]);
    if (candidateRoles.length === 0) return 'MF';
    if (candidateRoles.length === 1) return candidateRoles[0];

    let bestRole = candidateRoles[0];
    let bestScore = -Infinity;

    for (let i = 0; i < candidateRoles.length; i++) {
        const role = candidateRoles[i];
        const w = ROLE_WEIGHTS[role];
        const weightSum = w.attack + w.creation + w.defense + w.physical + w.goalkeeping;
        const rawScore =
            w.attack * (player.attack ?? 0) +
            w.creation * (player.creation ?? 0) +
            w.defense * (player.defense ?? 0) +
            w.physical * (player.physical ?? 0) +
            w.goalkeeping * (player.goalkeeping ?? 0);
        const normalizedScore = rawScore / (weightSum || 1) + (i === 0 ? 0.25 : 0);
        if (normalizedScore > bestScore) {
            bestScore = normalizedScore;
            bestRole = role;
        }
    }

    return bestRole;
}

export function getEffectiveSlotRole(slotId) {
    const role = getSlotRole(slotId);
    if (role && ROLE_WEIGHTS[role]) {
        return role;
    }
    return ROLE_WEIGHTS[slotId] ? slotId : 'MF';
}

export function calculateTeamProfile(teamOrRoster) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    const attrs = ['attack', 'creation', 'defense', 'physical', 'goalkeeping'];
    const weightedSums = {
        attack: 0,
        creation: 0,
        defense: 0,
        physical: 0,
        goalkeeping: 0,
    };
    const totalWeights = {
        attack: 0,
        creation: 0,
        defense: 0,
        physical: 0,
        goalkeeping: 0,
    };

    const activePlayers = [];

    for (const slot of SLOTS) {
        const player = roster?.[slot];
        if (!player) continue;
        const role = getEffectiveSlotRole(slot);
        const weights = ROLE_WEIGHTS[role];
        activePlayers.push({ slot, role, player });

        for (const attr of attrs) {
            const w = weights[attr] ?? 0;
            if (w > 0) {
                weightedSums[attr] += w * (Number(player[attr]) || 0);
                totalWeights[attr] += w;
            }
        }
    }

    if (activePlayers.length === 0) {
        return {
            attack: 0,
            creation: 0,
            defense: 0,
            physical: 0,
            goalkeeping: 0,
            overall: 0,
        };
    }

    const profile = {};
    for (const attr of attrs) {
        const avg = totalWeights[attr] > 0 ? weightedSums[attr] / totalWeights[attr] : 0;
        profile[attr] = Math.round(avg * 10) / 10;
    }

    // GK reflexes/command also slightly supported by GK physical & defense
    const gk = findPlayerByRole(roster, 'GK');
    if (gk) {
        const gkBlend =
            0.88 * (Number(gk.goalkeeping) || 0) +
            0.07 * (Number(gk.physical) || 0) +
            0.05 * (Number(gk.defense) || 0);
        profile.goalkeeping = Math.round(gkBlend * 10) / 10;
    }

    const overallSum = activePlayers.reduce((acc, item) => acc + getPlayerOverall(item.player), 0);
    profile.overall = Math.round((overallSum / activePlayers.length) * 10) / 10;

    return profile;
}


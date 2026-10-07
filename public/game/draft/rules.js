// Pure Draft rules, reroll validation, and roster slot helpers

import {
    ROLES,
    ROSTER_SLOTS,
    SLOTS,
    REROLL_TYPES,
    getSlotDefinition,
    getSlotRole,
    getSlotsForRole,
    formatSlotLabel,
} from '../shared/constants.js';
import {
    getRerollOutcomeDistribution,
    sampleOutcomeDistribution,
    isLegalRerollDestination,
} from '../roll-policy.js';
import {
    getPlayerEntityId,
    getPlayerIdentityKey,
    isSameCanonicalPlayer,
} from '../player-identity.js';

export {
    ROLES,
    ROSTER_SLOTS,
    SLOTS,
    REROLL_TYPES,
    getSlotDefinition,
    getSlotRole,
    getSlotsForRole,
    formatSlotLabel,
    getPlayerEntityId,
    getPlayerIdentityKey,
    isSameCanonicalPlayer,
};

export function hasRerollOption(currentRoll, type) {
    if (!currentRoll) return false;
    return getRerollOutcomeDistribution(currentRoll, type).length > 0;
}

export function generateRerollTeamSeason(currentRoll, type, randomFn = Math.random) {
    if (!currentRoll) return null;
    const distribution = getRerollOutcomeDistribution(currentRoll, type);
    return sampleOutcomeDistribution(distribution, randomFn);
}

export function isValidRerollTransition(prevRoll, nextRoll, type) {
    return isLegalRerollDestination(prevRoll, nextRoll, type);
}

export function createEmptyRoster() {
    return {
        GK1: null,

        DF1: null,
        DF2: null,
        DF3: null,
        DF4: null,

        MF1: null,
        MF2: null,
        MF3: null,

        FW1: null,
        FW2: null,
        FW3: null,
    };
}

export function createInitialRerolls() {
    return {
        league: 1,
        club: 1,
        year: 1,
    };
}

export function getPlayerOverall(player) {
    return player?.overall ?? player?.rating ?? 0;
}

export function canPlayerFitSlot(player, slotId) {
    if (!player || !Array.isArray(player.positions)) return false;
    const role = getSlotRole(slotId);
    if (!role) return false;
    return player.positions.includes(role);
}

export function isPlayerInRoster(teamOrRoster, playerOrId) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster) return false;
    const targetId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
    if (!targetId) return false;
    return SLOTS.some((slotId) => roster[slotId]?.id === targetId);
}

export function isPlayerEntityInRoster(teamOrRoster, playerOrId) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster) return false;
    const targetKey = getPlayerIdentityKey(playerOrId);
    if (!targetKey) return false;
    return SLOTS.some((slotId) => {
        const existing = roster[slotId];
        if (!existing) return false;
        return getPlayerIdentityKey(existing) === targetKey;
    });
}

export function getFirstAvailableSlotForRole(teamOrRoster, role) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster) return null;
    const slots = getSlotsForRole(role);
    for (const slotId of slots) {
        if (roster[slotId] === null) {
            return slotId;
        }
    }
    return null;
}

export function getAvailableRolesForPlayer(teamOrRoster, player) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster || !player || !Array.isArray(player.positions)) return [];
    if (isPlayerEntityInRoster(roster, player)) return [];
    return ROLES.filter(
        (role) =>
            player.positions.includes(role) &&
            getFirstAvailableSlotForRole(roster, role) !== null
    );
}

export function getAvailableSlotsForPlayer(teamOrRoster, player) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster || !player) return [];
    if (isPlayerEntityInRoster(roster, player)) return [];
    return SLOTS.filter((slot) => roster[slot] === null && canPlayerFitSlot(player, slot));
}

export function getLegalPickActions(team) {
    if (!team) return [];
    if (team.draft && (team.draft.locked || (team.draft.phase && team.draft.phase !== 'PICK'))) {
        return [];
    }
    const roster = team.roster ?? team;
    const currentRoll = team?.draft?.currentRoll ?? team?.currentRoll ?? null;
    if (!roster || !currentRoll || !Array.isArray(currentRoll.players)) return [];

    const actions = [];
    for (const player of currentRoll.players) {
        const availableRoles = getAvailableRolesForPlayer(roster, player);
        for (const role of availableRoles) {
            actions.push({
                type: 'pick',
                playerId: player.id,
                role,
                player,
            });
        }
    }
    return actions;
}

export function getLegalRerollActions(team) {
    if (!team) return [];
    if (team.draft && (team.draft.locked || (team.draft.phase && team.draft.phase !== 'PICK'))) {
        return [];
    }
    const currentRoll = team?.draft?.currentRoll ?? team?.currentRoll ?? null;
    const rerolls = team?.rerolls ?? null;
    if (!currentRoll || !rerolls) return [];

    const actions = [];
    for (const rerollType of REROLL_TYPES) {
        if ((rerolls[rerollType] ?? 0) > 0 && hasRerollOption(currentRoll, rerollType)) {
            actions.push({
                type: 'reroll',
                rerollType,
            });
        }
    }
    return actions;
}

export function canFreeRedraw(team) {
    if (!team) return false;
    const draft = team.draft;
    if (draft?.locked || draft?.phase === 'LOCKED') return false;

    const phase =
        draft?.phase ??
        (isRosterComplete(team)
            ? 'READY'
            : team?.currentRoll
              ? 'PICK'
              : 'ROLL');

    if (phase !== 'PICK') return false;

    const currentRoll = draft?.currentRoll ?? team?.currentRoll ?? null;
    if (!currentRoll || !Array.isArray(currentRoll.players)) return false;

    if (isRosterComplete(team)) return false;

    return getLegalPickActions(team).length === 0 && getLegalRerollActions(team).length === 0;
}

export const isDeadRoll = canFreeRedraw;

export function getLegalDraftActions(team) {
    if (!team) return [];
    const draft = team.draft;
    if (draft?.locked || draft?.phase === 'LOCKED') return [];

    const phase =
        draft?.phase ??
        (isRosterComplete(team)
            ? 'READY'
            : team?.currentRoll
              ? 'PICK'
              : 'ROLL');

    if (phase === 'ROLL') {
        return [{ type: 'roll' }];
    }
    if (phase === 'READY') {
        return isRosterComplete(team) ? [{ type: 'lock' }] : [];
    }
    if (phase === 'PICK') {
        const pickAndReroll = [...getLegalPickActions(team), ...getLegalRerollActions(team)];
        if (pickAndReroll.length > 0) {
            return pickAndReroll;
        }
        return canFreeRedraw(team) ? [{ type: 'redraw' }] : [];
    }
    return [];
}

export function findPlayersByRole(teamOrRoster, role) {
    const roster = teamOrRoster?.roster ?? teamOrRoster ?? {};
    return getSlotsForRole(role)
        .map((slotId) => roster[slotId])
        .filter(Boolean);
}

export function findPlayerByRole(teamOrRoster, role) {
    return findPlayersByRole(teamOrRoster, role)[0] ?? null;
}

export function getRoleProgress(teamOrRoster) {
    const roster = teamOrRoster?.roster ?? teamOrRoster ?? {};
    const progress = {};
    for (const role of ROLES) {
        const slots = getSlotsForRole(role);
        const filled = slots.filter((slotId) => Boolean(roster[slotId])).length;
        progress[role] = {
            role,
            filled,
            total: slots.length,
        };
    }
    return progress;
}

export function isRosterComplete(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return false;
    return SLOTS.every((slot) => Boolean(roster[slot]));
}

export function getPickedCount(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return 0;
    return SLOTS.filter((slot) => Boolean(roster[slot])).length;
}

export function calculateTeamRating(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return 0;
    const picked = SLOTS.map((slot) => roster[slot]).filter(Boolean);
    if (picked.length === 0) return 0;
    const sum = picked.reduce((acc, p) => acc + getPlayerOverall(p), 0);
    return Math.round(sum / picked.length);
}



// Pure Draft state transitions (shared by network controller and headless bot simulator)

import { TEAM_SEASON_MAP } from '../../data/team-seasons.js';
import { SLOTS, REROLL_TYPES } from '../shared/constants.js';
import {
    getTeamById,
    canTeamRoll,
    canTeamPick,
    canTeamLock,
    areBothTeamsLocked,
    pushTeamHistory,
} from '../state.js';
import { generateInitialRollTeamSeason } from './random.js';
import {
    generateRerollTeamSeason,
    isValidRerollTransition,
    canPlayerFitSlot,
    isPlayerInRoster,
    getFirstAvailableSlotForRole,
    isRosterComplete,
    canFreeRedraw,
} from './rules.js';

export function applyDraftRoll(state, actorId, teamSeasonId) {
    if (!state || state.phase !== 'DRAFT') {
        return { ok: false, reason: 'not_in_draft_phase' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam || !canTeamRoll(actorTeam)) {
        return { ok: false, reason: 'cannot_roll' };
    }

    const teamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
    if (!teamSeason) {
        return { ok: false, reason: 'unknown_team_season' };
    }

    actorTeam.draft.currentRoll = teamSeason;
    actorTeam.draft.phase = 'PICK';

    pushTeamHistory(actorTeam, {
        type: 'draft.roll',
        actorId: actorTeam.id,
        actorName: actorTeam.name,
        club: teamSeason.club,
        year: teamSeason.year,
    });

    return { ok: true, team: actorTeam, teamSeason };
}

export function applyDraftReroll(state, actorId, type, teamSeasonId) {
    if (!state || state.phase !== 'DRAFT') {
        return { ok: false, reason: 'not_in_draft_phase' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam || !canTeamPick(actorTeam)) {
        return { ok: false, reason: 'cannot_reroll' };
    }

    if (!REROLL_TYPES.includes(type)) {
        return { ok: false, reason: 'invalid_reroll_type' };
    }
    if ((actorTeam.rerolls?.[type] ?? 0) <= 0) {
        return { ok: false, reason: 'no_reroll_remaining' };
    }

    const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
    if (!nextTeamSeason) {
        return { ok: false, reason: 'unknown_team_season' };
    }

    if (!isValidRerollTransition(actorTeam.draft.currentRoll, nextTeamSeason, type)) {
        return { ok: false, reason: 'invalid_reroll_transition' };
    }

    actorTeam.rerolls[type] -= 1;
    actorTeam.draft.currentRoll = nextTeamSeason;

    pushTeamHistory(actorTeam, {
        type: 'draft.reroll',
        actorId: actorTeam.id,
        actorName: actorTeam.name,
        rerollType: type,
        club: nextTeamSeason.club,
        year: nextTeamSeason.year,
    });

    return { ok: true, team: actorTeam, teamSeason: nextTeamSeason };
}

export function applyDraftRedraw(state, actorId, teamSeasonId) {
    if (!state || state.phase !== 'DRAFT') {
        return { ok: false, reason: 'not_in_draft_phase' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam || !canTeamPick(actorTeam)) {
        return { ok: false, reason: 'cannot_redraw_phase' };
    }
    if (!canFreeRedraw(actorTeam)) {
        return { ok: false, reason: 'free_redraw_not_allowed' };
    }
    if (typeof teamSeasonId !== 'string') {
        return { ok: false, reason: 'invalid_team_season_id' };
    }

    const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
    if (!nextTeamSeason) {
        return { ok: false, reason: 'unknown_team_season' };
    }

    const prevRoll = actorTeam.draft.currentRoll;
    actorTeam.draft.currentRoll = nextTeamSeason;
    actorTeam.draft.phase = 'PICK';

    pushTeamHistory(actorTeam, {
        type: 'draft.redraw',
        actorId: actorTeam.id,
        actorName: actorTeam.name,
        club: nextTeamSeason.club,
        year: nextTeamSeason.year,
        previousClub: prevRoll?.club ?? null,
        previousYear: prevRoll?.year ?? null,
    });

    return { ok: true, team: actorTeam, teamSeason: nextTeamSeason };
}

export function applyDraftPick(state, actorId, playerId, slot) {
    if (!state || state.phase !== 'DRAFT') {
        return { ok: false, reason: 'not_in_draft_phase' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam || !canTeamPick(actorTeam)) {
        return { ok: false, reason: 'cannot_pick' };
    }

    if (!SLOTS.includes(slot)) {
        return { ok: false, reason: 'invalid_slot' };
    }
    if (actorTeam.roster[slot] !== null) {
        return { ok: false, reason: 'slot_already_filled' };
    }

    const candidate = actorTeam.draft.currentRoll.players.find((p) => p.id === playerId);
    if (!candidate) {
        return { ok: false, reason: 'candidate_not_in_roll' };
    }
    if (isPlayerInRoster(actorTeam.roster, candidate)) {
        return { ok: false, reason: 'duplicate_player' };
    }
    if (!canPlayerFitSlot(candidate, slot)) {
        return { ok: false, reason: 'role_mismatch' };
    }

    actorTeam.roster[slot] = candidate;
    actorTeam.draft.currentRoll = null;

    if (isRosterComplete(actorTeam)) {
        actorTeam.draft.phase = 'READY';
    } else {
        actorTeam.draft.phase = 'ROLL';
    }

    pushTeamHistory(actorTeam, {
        type: 'draft.pick',
        actorId: actorTeam.id,
        actorName: actorTeam.name,
        playerId: candidate.id,
        playerName: candidate.name,
        slot,
    });

    return { ok: true, team: actorTeam, player: candidate, slot };
}

export function applyDraftLock(state, actorId) {
    if (!state || state.phase !== 'DRAFT') {
        return { ok: false, reason: 'not_in_draft_phase' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam || !canTeamLock(actorTeam)) {
        return { ok: false, reason: 'cannot_lock' };
    }

    actorTeam.draft.locked = true;
    actorTeam.draft.phase = 'LOCKED';
    actorTeam.draft.currentRoll = null;

    pushTeamHistory(actorTeam, {
        type: 'draft.lock',
        actorId: actorTeam.id,
        actorName: actorTeam.name,
    });

    if (areBothTeamsLocked(state)) {
        state.phase = 'REVEAL';
    }

    return { ok: true, team: actorTeam };
}

export function resolveBotPickSlot(teamOrRoster, action) {
    if (!action || action.type !== 'pick') return null;
    if (action.slot && SLOTS.includes(action.slot)) {
        return action.slot;
    }
    return getFirstAvailableSlotForRole(teamOrRoster, action.role);
}

export function applyBotDraftAction(state, actorId, action, randomFn = Math.random) {
    if (!state || !action || typeof action !== 'object') {
        return { ok: false, reason: 'invalid_action' };
    }
    const actorTeam = getTeamById(state, actorId);
    if (!actorTeam) {
        return { ok: false, reason: 'unknown_actor' };
    }

    if (action.type === 'roll') {
        const rolled = generateInitialRollTeamSeason(randomFn);
        if (!rolled) {
            return { ok: false, reason: 'roll_generation_failed' };
        }
        return applyDraftRoll(state, actorId, rolled.id);
    }

    if (action.type === 'reroll') {
        const nextSeason = generateRerollTeamSeason(
            actorTeam.draft.currentRoll,
            action.rerollType,
            randomFn
        );
        if (!nextSeason) {
            return { ok: false, reason: 'reroll_generation_failed' };
        }
        return applyDraftReroll(state, actorId, action.rerollType, nextSeason.id);
    }

    if (action.type === 'redraw') {
        const redrawnSeason = generateInitialRollTeamSeason(randomFn);
        if (!redrawnSeason) {
            return { ok: false, reason: 'redraw_generation_failed' };
        }
        return applyDraftRedraw(state, actorId, redrawnSeason.id);
    }

    if (action.type === 'pick') {
        const slot = resolveBotPickSlot(actorTeam.roster, action);
        if (!slot) {
            return { ok: false, reason: 'no_available_slot_for_role' };
        }
        return applyDraftPick(state, actorId, action.playerId, slot);
    }

    if (action.type === 'lock') {
        return applyDraftLock(state, actorId);
    }

    if (action.type === 'stuck') {
        return { ok: false, reason: action.reason || 'stuck' };
    }

    return { ok: false, reason: 'unknown_action_type' };
}

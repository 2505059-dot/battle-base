// Game State initialization and shared per-team concurrent draft selectors/helpers

import { MAX_HISTORY_ITEMS } from './shared/constants.js';
import { createEmptyRoster, createInitialRerolls, isRosterComplete } from './draft/rules.js';

export function createInitialState(ctx) {
    const teams = ctx.order.map((id, idx) => ({
        id,
        label: idx === 0 ? 'TEAM A' : 'TEAM B',
        shortTag: idx === 0 ? 'A' : 'B',
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: {
            phase: 'ROLL',          // 'ROLL' | 'PICK' | 'READY' | 'LOCKED'
            currentRoll: null,      // teamSeason object when team.draft.phase === 'PICK'
            locked: false,
            history: [],            // per-team structured action logs (up to MAX_HISTORY_ITEMS)
        },
    }));

    return {
        seed: ctx.seed,
        teams,
        phase: 'DRAFT',             // 'DRAFT' | 'REVEAL' | 'MATCH' | 'RESULT'
        match: null,                // { matchSeed, script, revealedCount, currentMinute, liveScore, liveStats }
        opponentLeft: false,
    };
}

export function isDraftPhase(state) {
    return state?.phase === 'DRAFT';
}

export function getTeamById(state, id) {
    if (!state || !Array.isArray(state.teams)) return null;
    return state.teams.find((t) => t.id === id) ?? null;
}

export function getMyTeam(state, meId) {
    return getTeamById(state, meId);
}

export function getOpponentTeam(state, meId) {
    if (!state || !Array.isArray(state.teams)) return null;
    return state.teams.find((t) => t.id !== meId) ?? null;
}

export function isTeamDraftActive(team) {
    return Boolean(team?.draft && !team.draft.locked && team.draft.phase !== 'LOCKED');
}

export function canTeamRoll(team) {
    return Boolean(team?.draft && !team.draft.locked && team.draft.phase === 'ROLL');
}

export function canTeamPick(team) {
    return Boolean(
        team?.draft &&
            !team.draft.locked &&
            team.draft.phase === 'PICK' &&
            team.draft.currentRoll !== null
    );
}

export function canTeamLock(team) {
    return Boolean(
        team?.draft &&
            !team.draft.locked &&
            team.draft.phase === 'READY' &&
            isRosterComplete(team)
    );
}

export function areBothTeamsLocked(state) {
    return Boolean(
        state &&
            Array.isArray(state.teams) &&
            state.teams.length === 2 &&
            state.teams.every(
                (team) =>
                    Boolean(
                        team?.draft?.locked &&
                            team?.draft?.phase === 'LOCKED' &&
                            isRosterComplete(team)
                    )
            )
    );
}

export function pushTeamHistory(team, entry) {
    if (!team?.draft || !Array.isArray(team.draft.history)) return;
    team.draft.history.push(entry);
    if (team.draft.history.length > MAX_HISTORY_ITEMS) {
        team.draft.history = team.draft.history.slice(-MAX_HISTORY_ITEMS);
    }
}


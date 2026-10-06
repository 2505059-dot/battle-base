// Game State initialization and shared state selectors/helpers

import { MAX_HISTORY_ITEMS } from './shared/constants.js';
import { createEmptyRoster, createInitialRerolls } from './draft/rules.js';

export function createInitialState(ctx) {
    const teams = ctx.order.map((id, idx) => ({
        id,
        label: idx === 0 ? 'TEAM A' : 'TEAM B',
        shortTag: idx === 0 ? 'A' : 'B',
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
    }));

    return {
        seed: ctx.seed,
        teams,
        turnIndex: 0,           // 0 or 1 (index into state.teams)
        roundCount: 1,          // 1..10
        phase: 'ROLL',          // 'ROLL' | 'PICK' | 'COMPLETE' | 'MATCH' | 'RESULT'
        currentRoll: null,      // teamSeason object when phase === 'PICK'
        selectedPlayerId: null, // local UI selection during 'PICK'
        history: [],            // recent 5~8 synchronized action logs
        match: null,            // { matchSeed, script, revealedCount, currentMinute, liveScore, liveStats }
        opponentLeft: false,
    };
}

export function getCurrentTeam(state) {
    return state.teams[state.turnIndex];
}

export function isDraftPhase(state) {
    return state.phase === 'ROLL' || state.phase === 'PICK';
}

export function pushHistory(state, entryText) {
    state.history.push(entryText);
    if (state.history.length > MAX_HISTORY_ITEMS) {
        state.history = state.history.slice(-MAX_HISTORY_ITEMS);
    }
}

// 11v11 Football Fantasy Draft (Abstract 4-3-3) + Match Simulation v0 — Public Entry Point
// Keeps full backward compatibility with public/main.js and browser console debug helpers.

import { startGame } from './game/controller.js';
import {
    getLocale,
    setLocale,
    t,
    subscribeLocaleChange,
    formatLeagueName,
} from './i18n/i18n.js';
import {
    ROLES,
    ROSTER_SLOTS,
    SLOTS,
    getSlotDefinition,
    getSlotRole,
    getSlotsForRole,
} from './game/shared/constants.js';
import {
    formatHistoryEvent,
    formatMatchEvent,
    formatMatchEventBadge,
} from './game/shared/event-formatters.js';
import { createRng } from './game/match/rng.js';
import {
    ROLE_WEIGHTS,
    SHOT_ROLE_WEIGHTS,
    ASSIST_ROLE_WEIGHTS,
    DEFENSE_ROLE_WEIGHTS,
    MATCH_SIM_CONFIG,
} from './game/match/config.js';
import {
    resolveFlexRole,
    getEffectiveSlotRole,
    calculateTeamProfile,
} from './game/match/team-profile.js';
import { generateMatchScript, getRosterEntries } from './game/match/engine.js';
import {
    buildSample11PlayerRoster,
    buildSampleRosterFromPool,
    buildSampleRosterFromSeason,
    simulateManyMatches,
} from './game/match/simulator.js';

if (typeof window !== 'undefined') {
    Object.assign(window, {
        getLocale,
        setLocale,
        t,
        createRng,
        calculateTeamProfile,
        generateMatchScript,
        simulateManyMatches,
        buildSample11PlayerRoster,
        buildSampleRosterFromPool,
        formatHistoryEvent,
        formatMatchEvent,
        formatMatchEventBadge,
    });
}

export {
    startGame,
    getLocale,
    setLocale,
    t,
    subscribeLocaleChange,
    formatLeagueName,
    ROLES,
    ROSTER_SLOTS,
    SLOTS,
    getSlotDefinition,
    getSlotRole,
    getSlotsForRole,
    formatHistoryEvent,
    formatMatchEvent,
    formatMatchEventBadge,
    createRng,
    ROLE_WEIGHTS,
    SHOT_ROLE_WEIGHTS,
    ASSIST_ROLE_WEIGHTS,
    DEFENSE_ROLE_WEIGHTS,
    MATCH_SIM_CONFIG,
    resolveFlexRole,
    getEffectiveSlotRole,
    calculateTeamProfile,
    getRosterEntries,
    generateMatchScript,
    buildSample11PlayerRoster,
    buildSampleRosterFromPool,
    buildSampleRosterFromSeason,
    simulateManyMatches,
};


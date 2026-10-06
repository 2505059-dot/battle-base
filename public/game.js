// 5-a-side Football Fantasy Draft + Match Simulation v0 — Public Entry Point
// Keeps full backward compatibility with public/main.js and browser console debug helpers.

import { startGame } from './game/controller.js';
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
import { generateMatchScript } from './game/match/engine.js';
import { simulateManyMatches } from './game/match/simulator.js';

if (typeof window !== 'undefined') {
    Object.assign(window, {
        createRng,
        calculateTeamProfile,
        generateMatchScript,
        simulateManyMatches,
    });
}

export {
    startGame,
    createRng,
    ROLE_WEIGHTS,
    SHOT_ROLE_WEIGHTS,
    ASSIST_ROLE_WEIGHTS,
    DEFENSE_ROLE_WEIGHTS,
    MATCH_SIM_CONFIG,
    resolveFlexRole,
    getEffectiveSlotRole,
    calculateTeamProfile,
    generateMatchScript,
    simulateManyMatches,
};

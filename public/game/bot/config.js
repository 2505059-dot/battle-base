// Bot Framework v1 configuration, role weights, and difficulty parameters

import { ROLE_WEIGHTS } from '../match/config.js';

export const BOT_DIFFICULTIES = Object.freeze(['random', 'casual', 'smart', 'expert']);

export const DEFAULT_BOT_DIFFICULTY = 'smart';

export const BOT_REASON_CODES = Object.freeze({
    ROLL_NEXT: 'roll_next',
    PICK_BEST_VALUE: 'pick_best_value',
    PICK_ROLE_URGENT: 'pick_role_urgent',
    REROLL_EXPECTED_UPGRADE: 'reroll_expected_upgrade',
    REROLL_NO_GOOD_PICK: 'reroll_no_good_pick',
    LOCK_COMPLETE: 'lock_complete',
    RANDOM_CHOICE: 'random_choice',
    STUCK_DEAD_ROLL: 'stuck_dead_roll',
});

// Normalized role attribute weights aligned with Match Simulation v1 ROLE_WEIGHTS & event selectors
export const BOT_ROLE_VALUE_WEIGHTS = Object.freeze({
    GK: Object.freeze({
        goalkeeping: 0.85,
        physical: 0.08,
        defense: 0.05,
        creation: 0.02,
        attack: 0.0,
    }),
    DF: Object.freeze({
        defense: 0.56,
        physical: 0.30,
        creation: 0.09,
        attack: 0.05,
        goalkeeping: 0.0,
    }),
    MF: Object.freeze({
        creation: 0.45,
        attack: 0.22,
        physical: 0.20,
        defense: 0.13,
        goalkeeping: 0.0,
    }),
    FW: Object.freeze({
        attack: 0.57,
        creation: 0.20,
        physical: 0.21,
        defense: 0.02,
        goalkeeping: 0.0,
    }),
});

// Reference re-export of Match v1 ROLE_WEIGHTS for transparency
export { ROLE_WEIGHTS };

// Public dataset baseline best-in-roll expectations per role (used for value-over-replacement)
export const PUBLIC_ROLE_BASELINES = Object.freeze({
    GK: 79.3,
    DF: 81.8,
    MF: 80.9,
    FW: 83.1,
});

// Slot impact weights reflecting 11v11 Match Engine contribution per slot
export const ROLE_SLOT_IMPACT = Object.freeze({
    GK: 1.06,
    DF: 1.06,
    MF: 1.08,
    FW: 1.05,
});

// Structural scarcity priors (4 DF slots & 3 FW slots with median 2 FWs per TeamSeason)
export const ROLE_SCARCITY_PRIOR = Object.freeze({
    GK: 0.94,
    DF: 1.16,
    MF: 1.02,
    FW: 1.15,
});

export const BOT_DIFFICULTY_CONFIG = Object.freeze({
    random: Object.freeze({
        id: 'random',
        randomRerollProb: 0.24,
        noiseAmplitude: 0,
    }),
    casual: Object.freeze({
        id: 'casual',
        overallWeight: 0.78,
        roleFitWeight: 0.22,
        noiseAmplitude: 5.8,
        rerollThreshold: 81.5,
        rerollChanceWhenBelow: 0.45,
    }),
    smart: Object.freeze({
        id: 'smart',
        overallWeight: 0.12,
        roleFitWeight: 0.88,
        noiseAmplitude: 1.6,
        evMode: 'simple',
        rerollMinNetGain: 1.35,
    }),
    expert: Object.freeze({
        id: 'expert',
        overallWeight: 0.08,
        roleFitWeight: 0.92,
        noiseAmplitude: 0.0,
        evMode: 'exact',
        rerollMinNetGain: 0.55,
    }),
});

export function normalizeDifficulty(difficulty = DEFAULT_BOT_DIFFICULTY) {
    if (typeof difficulty === 'string') {
        const lower = difficulty.trim().toLowerCase();
        if (BOT_DIFFICULTIES.includes(lower)) return lower;
    }
    return DEFAULT_BOT_DIFFICULTY;
}

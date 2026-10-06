// Position weights and probability parameters for Match Simulation v0

// Role contribution weights toward the 5 team functional dimensions
export const ROLE_WEIGHTS = {
    GK: {
        goalkeeping: 1.0,
        defense: 0.08,
        physical: 0.10,
        creation: 0.10,
        attack: 0.0,
    },
    DF: {
        defense: 0.48,
        physical: 0.30,
        creation: 0.14,
        attack: 0.04,
        goalkeeping: 0.0,
    },
    MF: {
        creation: 0.44,
        attack: 0.28,
        defense: 0.24,
        physical: 0.26,
        goalkeeping: 0.0,
    },
    FW: {
        attack: 0.56,
        creation: 0.24,
        physical: 0.24,
        defense: 0.04,
        goalkeeping: 0.0,
    },
};

// Base role multipliers when selecting who takes a shot
export const SHOT_ROLE_WEIGHTS = {
    FW: 3.5,
    MF: 1.85,
    DF: 0.70,
    GK: 0.02,
};

// Base role multipliers when selecting who creates a chance / assists
export const ASSIST_ROLE_WEIGHTS = {
    MF: 3.2,
    FW: 1.85,
    DF: 1.15,
    GK: 0.18,
};

// Base role multipliers when selecting who makes a defensive intervention
export const DEFENSE_ROLE_WEIGHTS = {
    DF: 3.2,
    MF: 2.0,
    FW: 0.55,
    GK: 0.15,
};

// Centralized probability & pacing parameters for Match Simulation v0
export const MATCH_SIM_CONFIG = {
    halfEventsMin: 11,
    halfEventsMax: 15,
    // Step 1: Attacking opportunity allocation
    baseAttackShare: 0.5,
    initiativeDiffScale: 0.011,
    minAttackShare: 0.30,
    maxAttackShare: 0.70,
    // Step 2: Build-up progression to shot
    baseShotProb: 0.74,
    progressionDiffScale: 0.009,
    minShotProb: 0.48,
    maxShotProb: 0.88,
    // Step 4: Shot accuracy (on target)
    baseOnTargetProb: 0.47,
    onTargetDiffScale: 0.007,
    minOnTargetProb: 0.25,
    maxOnTargetProb: 0.65,
    // Off-target split between blocked ('shot') and wide/over ('miss')
    blockedOffTargetShare: 0.42,
    // Step 5 & 6: Goal vs GK Save when shot is on target
    baseGoalOnTargetProb: 0.33,
    goalDiffScale: 0.008,
    minGoalOnTargetProb: 0.13,
    maxGoalOnTargetProb: 0.50,
    // Assist probability on a goal
    assistedGoalProb: 0.86,
    // Possession model
    possessionDiffScale: 0.75,
    possessionNoiseMax: 3,
    minPossession: 32,
    maxPossession: 68,
    // Playback speed: ~1.25s per event => ~32-42 seconds per 90-min match
    playbackIntervalMs: 1250,
};

export const PITCH_ZONES = ['left', 'center', 'right'];

// Draft random selection & uniform TeamSeason initial roll helpers

import {
    getInitialRollOutcomeDistribution,
    sampleOutcomeDistribution,
} from '../roll-policy.js';

function resolveRandomFn(randomFn) {
    if (typeof randomFn === 'function') return randomFn;
    if (randomFn && typeof randomFn.random === 'function') return () => randomFn.random();
    return Math.random;
}

export function pickRandomDraft(arr, randomFn = Math.random) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const rng = resolveRandomFn(randomFn);
    const r = Math.min(0.999999999, Math.max(0, Number(rng()) || 0));
    const index = Math.floor(r * arr.length);
    return arr[index];
}

export function pickRandomExceptDraft(arr, current, randomFn = Math.random) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const candidates = arr.filter((item) => item !== current);
    return pickRandomDraft(candidates, randomFn);
}

// Uniform TeamSeason Roll via shared roll policy (P = 1 / TEAM_SEASONS.length)
export function generateInitialRollTeamSeason(randomFn = Math.random) {
    return sampleOutcomeDistribution(getInitialRollOutcomeDistribution(), randomFn);
}



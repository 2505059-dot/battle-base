// Independent deterministic PRNG for Bot decision noise and tie-breaking
// Never uses Math.random() and never shares state with Match RNG

import { SLOTS } from '../shared/constants.js';

export function hashBotSeed(input, initialHash = 0x811c9dc5) {
    let h = (Number(initialHash) || 0x811c9dc5) >>> 0;
    const str =
        typeof input === 'string'
            ? input
            : typeof input === 'number' && Number.isFinite(input)
              ? String(Math.trunc(input))
              : JSON.stringify(input ?? 0);

    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }

    // Final avalanche mix
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;

    return (h >>> 0) || 0x6d2b79f5;
}

export function createBotRng(seed = 1) {
    let state =
        typeof seed === 'number' && Number.isFinite(seed) && (seed >>> 0) !== 0
            ? hashBotSeed(seed >>> 0)
            : hashBotSeed(seed);
    if (state === 0) state = 0x6d2b79f5;

    function random() {
        let t = (state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function randomInt(min, max) {
        const lo = Math.ceil(Math.min(min, max));
        const hi = Math.floor(Math.max(min, max));
        return Math.floor(random() * (hi - lo + 1)) + lo;
    }

    // Bounded symmetric zero-mean triangular noise in [-amplitude, +amplitude]
    function randomNoise(amplitude = 0) {
        const amp = Number(amplitude) || 0;
        if (amp <= 0) return 0;
        return (random() - random()) * amp;
    }

    function pickRandom(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        return arr[randomInt(0, arr.length - 1)];
    }

    function fork(salt = 0) {
        const nextSeed = hashBotSeed(`${state}:${String(salt)}`);
        return createBotRng(nextSeed);
    }

    return {
        random,
        randomInt,
        randomNoise,
        pickRandom,
        fork,
    };
}

export function deriveBotDecisionSeed({
    decisionSeed = 1,
    team = null,
    difficulty = 'expert',
    personaId = 'neutral',
} = {}) {
    const roster = team?.roster ?? {};
    const rosterSig = SLOTS.map((slot) => `${slot}:${roster[slot]?.id ?? '_'}`).join('|');
    const rerolls = team?.rerolls ?? {};
    const rerollSig = `${rerolls.league ?? 0},${rerolls.club ?? 0},${rerolls.year ?? 0}`;
    const phaseSig = team?.draft?.phase ?? 'UNKNOWN';
    const rollSig = team?.draft?.currentRoll?.id ?? team?.currentRoll?.id ?? 'NONE';
    const key = `${String(decisionSeed)}::${difficulty}::${personaId}::${phaseSig}::${rollSig}::${rerollSig}::${rosterSig}`;
    return hashBotSeed(key);
}

// Deterministic Seeded RNG (Mulberry32) for Match Simulation

export function createRng(seed) {
    let state = (Number(seed) || 0) >>> 0;
    if (state === 0) state = 0x6d2b79f5;

    function random() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function randomInt(min, max) {
        const lo = Math.ceil(Math.min(min, max));
        const hi = Math.floor(Math.max(min, max));
        if (hi <= lo) return lo;
        return lo + Math.floor(random() * (hi - lo + 1));
    }

    function pickRandom(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const idx = Math.floor(random() * arr.length);
        return arr[idx];
    }

    function weightedPick(items, weightSelector) {
        if (!Array.isArray(items) || items.length === 0) return null;
        const weights = items.map((item, idx) => {
            let w = 1;
            if (typeof weightSelector === 'function') {
                w = Number(weightSelector(item, idx));
            } else if (Array.isArray(weightSelector)) {
                w = Number(weightSelector[idx]);
            } else if (item && typeof item === 'object' && 'weight' in item) {
                w = Number(item.weight);
            }
            return Number.isFinite(w) && w > 0 ? w : 0;
        });

        const total = weights.reduce((acc, w) => acc + w, 0);
        if (total <= 0) {
            return pickRandom(items);
        }

        let threshold = random() * total;
        for (let i = 0; i < items.length; i++) {
            threshold -= weights[i];
            if (threshold <= 0) {
                return items[i];
            }
        }
        return items[items.length - 1];
    }

    return {
        random,
        randomInt,
        pickRandom,
        weightedPick,
    };
}

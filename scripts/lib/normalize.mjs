// Shared normalization, alias resolution, attribute aggregation, and CSV parsing utilities
// for the football historical data pipeline.

/**
 * Fold diacritics and special European characters to ASCII equivalents
 * while preserving base letters, numbers, spaces, hyphens, and apostrophes.
 */
export function foldAscii(input) {
    if (typeof input !== 'string') return '';
    return input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[łŁ]/g, (m) => (m === 'ł' ? 'l' : 'L'))
        .replace(/[øØ]/g, (m) => (m === 'ø' ? 'o' : 'O'))
        .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
        .replace(/[æÆ]/g, (m) => (m === 'æ' ? 'ae' : 'AE'))
        .replace(/[œŒ]/g, (m) => (m === 'œ' ? 'oe' : 'OE'))
        .replace(/ß/g, 'ss')
        .replace(/[’‘`´]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalize key for case-insensitive, diacritic-insensitive lookup.
 */
export function normalizeLookupKey(input) {
    return foldAscii(input).toLowerCase();
}

/**
 * Build a validated lookup map from an alias dictionary { canonicalName: [alias1, alias2, ...] }.
 * Also detects any alias conflicts where two different canonical names claim the same normalized alias.
 */
export function buildAliasIndex(aliasDict, knownCanonicals = []) {
    const exactMap = new Map();
    const foldedMap = new Map();
    const conflicts = [];

    for (const canonical of knownCanonicals) {
        exactMap.set(canonical.trim(), canonical);
        foldedMap.set(normalizeLookupKey(canonical), canonical);
    }

    for (const [canonical, aliases] of Object.entries(aliasDict || {})) {
        if (canonical.startsWith('_')) continue;
        const list = Array.isArray(aliases) ? [canonical, ...aliases] : [canonical];
        for (const alias of list) {
            const trimmed = String(alias).trim();
            if (!trimmed) continue;
            const folded = normalizeLookupKey(trimmed);

            if (foldedMap.has(folded) && foldedMap.get(folded) !== canonical) {
                conflicts.push({
                    alias: trimmed,
                    normalizedAlias: folded,
                    canonicalA: foldedMap.get(folded),
                    canonicalB: canonical,
                });
            } else {
                exactMap.set(trimmed, canonical);
                foldedMap.set(folded, canonical);
            }
        }
    }

    return { exactMap, foldedMap, conflicts };
}

/**
 * Canonicalize a club name using data/manual/club-aliases.json.
 * Returns the canonical game club name or null if unrecognized.
 */
export function canonicalizeClubName(rawClub, clubAliasIndex) {
    if (!rawClub || typeof rawClub !== 'string') return null;
    const trimmed = rawClub.trim();
    if (!trimmed) return null;

    if (clubAliasIndex.exactMap.has(trimmed)) {
        return clubAliasIndex.exactMap.get(trimmed);
    }
    const folded = normalizeLookupKey(trimmed);
    if (clubAliasIndex.foldedMap.has(folded)) {
        return clubAliasIndex.foldedMap.get(folded);
    }

    // Some historical FIFA rows append a 2-digit roster year suffix (e.g. "Manchester United 11")
    const strippedYearSuffix = trimmed.replace(/\s+\d{2}$/, '').trim();
    if (strippedYearSuffix !== trimmed) {
        const foldedStripped = normalizeLookupKey(strippedYearSuffix);
        if (clubAliasIndex.foldedMap.has(foldedStripped)) {
            return clubAliasIndex.foldedMap.get(foldedStripped);
        }
    }

    return null;
}

/**
 * Compute token-aware similarity score [0, 1] between two normalized player names.
 * Used strictly as a last-resort check; uncertain fuzzy matches are rejected and sent to unresolved.json.
 */
export function computeNameSimilarity(nameA, nameB) {
    const a = normalizeLookupKey(nameA);
    const b = normalizeLookupKey(nameB);
    if (!a || !b) return 0;
    if (a === b) return 1;

    const tokensA = a.split(/[\s-]+/).filter(Boolean);
    const tokensB = b.split(/[\s-]+/).filter(Boolean);

    // Check if all tokens of the shorter name appear as exact tokens in the longer name
    // (e.g. "Cristiano Ronaldo" inside "Cristiano Ronaldo dos Santos Aveiro", minimum 2 tokens)
    if (tokensA.length >= 2 && tokensB.length >= 2) {
        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        const allAInB = tokensA.every((t) => setB.has(t));
        const allBInA = tokensB.every((t) => setA.has(t));
        if (allAInB || allBInA) {
            return 0.94;
        }
    }

    // Levenshtein distance
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    const maxLen = Math.max(m, n);
    return maxLen === 0 ? 1 : 1 - dp[m][n] / maxLen;
}

/**
 * Canonicalize a player name using:
 * 1. Exact canonical match (including pure ASCII diacritic fold of canonical name)
 * 2. Alias lookup via data/manual/player-aliases.json
 * 3. Optional candidate fuzzy check (only reported, never auto-guessed if below strict threshold or ambiguous)
 */
export function canonicalizePlayerName(rawName, playerAliasIndex, candidateCanonicals = null) {
    if (!rawName || typeof rawName !== 'string') {
        return { canonicalName: null, matchType: 'none', confidence: 0 };
    }
    const trimmed = rawName.trim();
    if (!trimmed) {
        return { canonicalName: null, matchType: 'none', confidence: 0 };
    }

    if (playerAliasIndex.exactMap.has(trimmed)) {
        const mapped = playerAliasIndex.exactMap.get(trimmed);
        return {
            canonicalName: mapped,
            matchType: mapped === trimmed ? 'exact' : 'alias',
            confidence: 1.0,
        };
    }

    const folded = normalizeLookupKey(trimmed);
    if (playerAliasIndex.foldedMap.has(folded)) {
        const mapped = playerAliasIndex.foldedMap.get(folded);
        const isDiacriticExact = normalizeLookupKey(mapped) === folded;
        return {
            canonicalName: mapped,
            matchType: isDiacriticExact ? 'exact-folded' : 'alias',
            confidence: 1.0,
        };
    }

    if (Array.isArray(candidateCanonicals) && candidateCanonicals.length > 0) {
        let bestCandidate = null;
        let bestScore = 0;
        let secondBestScore = 0;

        for (const candidate of candidateCanonicals) {
            const score = computeNameSimilarity(trimmed, candidate);
            if (score > bestScore) {
                secondBestScore = bestScore;
                bestScore = score;
                bestCandidate = candidate;
            } else if (score > secondBestScore) {
                secondBestScore = score;
            }
        }

        if (bestCandidate && bestScore >= 0.93 && bestScore - secondBestScore >= 0.08) {
            return {
                canonicalName: bestCandidate,
                matchType: 'fuzzy-high',
                confidence: Number(bestScore.toFixed(3)),
            };
        }

        if (bestCandidate && bestScore >= 0.75) {
            return {
                canonicalName: null,
                suggestedCanonical: bestCandidate,
                matchType: 'fuzzy-uncertain',
                confidence: Number(bestScore.toFixed(3)),
            };
        }
    }

    return { canonicalName: null, matchType: 'none', confidence: 0 };
}

/**
 * Normalize season string or number to the game's canonical season-end year.
 * Examples:
 * - "1998-99" -> 1999
 * - "1999-00" -> 2000
 * - "2003-04" -> 2004
 * - "2015-16" -> 2016
 * - "1998-1999" / "1998/1999" -> 1999
 * - "FIFA 07" -> 2007
 * - "FIFA 24" -> 2024
 * - 5 (FIFA 05 in lbenz730/fifa_model) -> 2005
 * - 2008 -> 2008
 */
export function normalizeSeasonYear(rawSeason) {
    if (typeof rawSeason === 'number' && Number.isInteger(rawSeason)) {
        if (rawSeason >= 1900 && rawSeason <= 2100) return rawSeason;
        if (rawSeason >= 5 && rawSeason <= 99) {
            return rawSeason >= 90 ? 1900 + rawSeason : 2000 + rawSeason;
        }
        return null;
    }
    if (typeof rawSeason !== 'string') return null;
    const s = rawSeason.trim();
    if (!s) return null;

    // Pattern: "1998-1999" or "1998/1999"
    const fullRange = s.match(/^(\d{4})\s*[-/]\s*(\d{4})$/);
    if (fullRange) {
        return Number(fullRange[2]);
    }

    // Pattern: "1998-99" or "1999-00" or "2003/04"
    const shortRange = s.match(/^(\d{4})\s*[-/]\s*(\d{2})$/);
    if (shortRange) {
        const startYear = Number(shortRange[1]);
        const endTwoDigit = Number(shortRange[2]);
        const century = Math.floor(startYear / 100) * 100;
        const candidate = century + endTwoDigit;
        return candidate < startYear ? candidate + 100 : candidate;
    }

    // Pattern: "FIFA 07", "FIFA 24", "EA FC 24", "players_15"
    const fifaMatch = s.match(/(?:fifa|fc|players_)\s*(\d{2})\b/i);
    if (fifaMatch) {
        const twoDigit = Number(fifaMatch[1]);
        return twoDigit >= 90 ? 1900 + twoDigit : 2000 + twoDigit;
    }

    // Pattern: plain 4-digit year "2008"
    const fourDigit = s.match(/^(\d{4})$/);
    if (fourDigit) {
        return Number(fourDigit[1]);
    }

    // Pattern: plain 1-2 digit FIFA year ("5".."24")
    const shortDigit = s.match(/^(\d{1,2})$/);
    if (shortDigit) {
        const num = Number(shortDigit[1]);
        if (num >= 5 && num <= 30) return 2000 + num;
    }

    return null;
}

/**
 * Mapping table from external granular positions to the 4 canonical game positions:
 * GK, DF, MF, FW
 */
export const POSITION_MAP = {
    // Goalkeeper
    GK: 'GK',
    G: 'GK',
    GOALKEEPER: 'GK',

    // Defender
    DF: 'DF',
    D: 'DF',
    CB: 'DF',
    LCB: 'DF',
    RCB: 'DF',
    SW: 'DF',
    LB: 'DF',
    RB: 'DF',
    LWB: 'DF',
    RWB: 'DF',
    'CENTRE-BACK': 'DF',
    'CENTER-BACK': 'DF',
    'LEFT-BACK': 'DF',
    'RIGHT-BACK': 'DF',
    SWEEPER: 'DF',
    DEFENDER: 'DF',

    // Midfielder
    MF: 'MF',
    M: 'MF',
    CDM: 'MF',
    LDM: 'MF',
    RDM: 'MF',
    CM: 'MF',
    LCM: 'MF',
    RCM: 'MF',
    CAM: 'MF',
    LAM: 'MF',
    RAM: 'MF',
    LM: 'MF',
    RM: 'MF',
    WM: 'MF',
    'DEFENSIVE MIDFIELD': 'MF',
    'CENTRAL MIDFIELD': 'MF',
    'ATTACKING MIDFIELD': 'MF',
    'LEFT MIDFIELD': 'MF',
    'RIGHT MIDFIELD': 'MF',
    MIDFIELD: 'MF',
    MIDFIELDER: 'MF',

    // Forward
    FW: 'FW',
    F: 'FW',
    LW: 'FW',
    RW: 'FW',
    LF: 'FW',
    RF: 'FW',
    CF: 'FW',
    ST: 'FW',
    LS: 'FW',
    RS: 'FW',
    SS: 'FW',
    'LEFT WINGER': 'FW',
    'RIGHT WINGER': 'FW',
    'SECOND STRIKER': 'FW',
    'CENTRE-FORWARD': 'FW',
    'CENTER-FORWARD': 'FW',
    STRIKER: 'FW',
    FORWARD: 'FW',
};

/**
 * Normalize one or more raw position strings/arrays into deduplicated canonical positions ['GK' | 'DF' | 'MF' | 'FW'].
 */
export function normalizePositions(rawPositions) {
    if (!rawPositions) return [];
    const items = Array.isArray(rawPositions)
        ? rawPositions.flatMap((p) => String(p).split(/[,/]+/))
        : String(rawPositions).split(/[,/]+/);

    const result = [];
    for (const rawItem of items) {
        const cleaned = rawItem.trim().toUpperCase();
        if (!cleaned) continue;
        if (POSITION_MAP[cleaned]) {
            const mapped = POSITION_MAP[cleaned];
            if (!result.includes(mapped)) result.push(mapped);
            continue;
        }
        // Fallback: split by whitespace if multiple short codes were space-delimited
        for (const token of cleaned.split(/\s+/)) {
            const mapped = POSITION_MAP[token];
            if (mapped && !result.includes(mapped)) {
                result.push(mapped);
            }
        }
    }

    // Goalkeepers should only have ['GK']
    if (result.includes('GK') && result.length > 1) {
        return result[0] === 'GK' ? ['GK'] : result.filter((p) => p !== 'GK');
    }

    return result;
}

/**
 * Centralized attribute aggregation weights.
 *
 * Design rationale:
 * - Rather than a naive unweighted average, each composite rating weights the underlying
 *   FIFA technical attributes by their direct impact on 5-a-side tactical roles:
 *   1. attack: finishing (0.35) and attacking positioning (0.25) dominate goal conversion,
 *      supported by shot_power (0.15), long_shots (0.15), and heading_accuracy (0.10).
 *   2. creation: vision (0.22), short_passing (0.22), ball_control (0.20), and dribbling (0.20)
 *      drive tight-space combination and 1v1 creation, with long_passing (0.08) and crossing (0.08) secondary.
 *   3. defense: standing_tackle (0.35) and defensive_awareness/marking (0.30) anchor 1v1 and
 *      positional defending, supported by interceptions (0.20) and sliding_tackle (0.15).
 *   4. physical: stamina (0.25) and strength (0.25) balance endurance and duel power,
 *      paired with sprint_speed (0.20), acceleration (0.20), and aggression (0.10).
 *   5. goalkeeping: gk_reflexes (0.30), gk_diving (0.25), and gk_positioning (0.25) are weighted
 *      highest for close-range shot stopping, followed by gk_handling (0.12) and gk_kicking (0.08).
 */
export const ATTRIBUTE_WEIGHTS = {
    attack: {
        finishing: 0.35,
        positioning: 0.25,
        shot_power: 0.15,
        long_shots: 0.15,
        heading_accuracy: 0.10,
    },
    creation: {
        vision: 0.22,
        short_passing: 0.22,
        ball_control: 0.20,
        dribbling: 0.20,
        long_passing: 0.08,
        crossing: 0.08,
    },
    defense: {
        standing_tackle: 0.35,
        defensive_awareness_or_marking: 0.30,
        interceptions: 0.20,
        sliding_tackle: 0.15,
    },
    physical: {
        stamina: 0.25,
        strength: 0.25,
        sprint_speed: 0.20,
        acceleration: 0.20,
        aggression: 0.10,
    },
    goalkeeping: {
        gk_reflexes: 0.30,
        gk_diving: 0.25,
        gk_positioning: 0.25,
        gk_handling: 0.12,
        gk_kicking: 0.08,
    },
};

export function clampStat(val) {
    const rounded = Math.round(Number(val));
    if (!Number.isFinite(rounded)) return null;
    return Math.max(1, Math.min(99, rounded));
}

function isValidStat(val) {
    const n = Number(val);
    return Number.isFinite(n) && n >= 1 && n <= 99;
}

/**
 * Aggregate normalized FIFA technical attributes into the 6 game stats:
 * { overall, attack, creation, defense, physical, goalkeeping }
 * Returns null if required technical attributes are missing.
 */
export function aggregateAttributes(rawTech) {
    if (!rawTech || typeof rawTech !== 'object') return null;

    if (!isValidStat(rawTech.overall)) return null;

    // Resolve defensive_awareness / marking
    let defAwareness = null;
    if (isValidStat(rawTech.defensive_awareness) && isValidStat(rawTech.marking)) {
        defAwareness = (Number(rawTech.defensive_awareness) + Number(rawTech.marking)) / 2;
    } else if (isValidStat(rawTech.defensive_awareness)) {
        defAwareness = Number(rawTech.defensive_awareness);
    } else if (isValidStat(rawTech.marking)) {
        defAwareness = Number(rawTech.marking);
    }

    const enriched = {
        ...rawTech,
        defensive_awareness_or_marking: defAwareness,
    };

    const result = {
        overall: clampStat(rawTech.overall),
    };

    for (const [category, weights] of Object.entries(ATTRIBUTE_WEIGHTS)) {
        let weightedSum = 0;
        let weightTotal = 0;

        for (const [field, weight] of Object.entries(weights)) {
            const val = Number(enriched[field]);
            if (!isValidStat(val)) {
                return null; // Do not fabricate if technical attributes are incomplete
            }
            weightedSum += val * weight;
            weightTotal += weight;
        }

        result[category] = clampStat(weightedSum / weightTotal);
    }

    return result;
}

/**
 * Parse CSV text (RFC 4180 compliant: handles quoted fields, embedded commas, escaped quotes)
 * and return an array of objects keyed by header names.
 */
export function parseCsvRecords(csvText, filterRowFn = null) {
    const rows = [];
    let headers = null;
    let currentField = '';
    let currentRow = [];
    let inQuotes = false;
    const len = csvText.length;

    for (let i = 0; i < len; i++) {
        const ch = csvText[i];

        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < len && csvText[i + 1] === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                currentField += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                currentRow.push(currentField);
                currentField = '';
            } else if (ch === '\r' || ch === '\n') {
                if (ch === '\r' && i + 1 < len && csvText[i + 1] === '\n') {
                    i++;
                }
                currentRow.push(currentField);
                currentField = '';

                if (!headers) {
                    headers = currentRow.map((h) => h.replace(/^\uFEFF/, '').trim());
                } else if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
                    const obj = {};
                    for (let c = 0; c < headers.length; c++) {
                        obj[headers[c]] = currentRow[c] !== undefined ? currentRow[c] : '';
                    }
                    if (!filterRowFn || filterRowFn(obj)) {
                        rows.push(obj);
                    }
                }
                currentRow = [];
            } else {
                currentField += ch;
            }
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        if (headers && (currentRow.length > 1 || currentRow[0] !== '')) {
            const obj = {};
            for (let c = 0; c < headers.length; c++) {
                obj[headers[c]] = currentRow[c] !== undefined ? currentRow[c] : '';
            }
            if (!filterRowFn || filterRowFn(obj)) {
                rows.push(obj);
            }
        }
    }

    return rows;
}

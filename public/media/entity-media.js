// public/media/entity-media.js
// Runtime media helper for club crests and league emblems.

import {
    CLUB_MEDIA,
    LEAGUE_MEDIA,
    CLUB_CANONICAL_TO_ID,
    LEAGUE_CANONICAL_TO_ID,
} from '../data/club-league-media.js';

/**
 * Returns the crest object for a given club (by canonicalName or entity ID), or null if not found.
 * Never throws on unexpected, null, or malformed inputs.
 * @param {string} input - Canonical club name (e.g. "Arsenal") or club slug ID (e.g. "arsenal")
 * @returns {{ url: string, provider: string, licenseStatus: string } | null}
 */
export function getClubCrest(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    // 1. Direct entity ID lookup
    if (CLUB_MEDIA[trimmed]?.crest) {
        return CLUB_MEDIA[trimmed].crest;
    }
    // 2. Canonical name lookup
    const idFromCanonical = CLUB_CANONICAL_TO_ID[trimmed];
    if (idFromCanonical && CLUB_MEDIA[idFromCanonical]?.crest) {
        return CLUB_MEDIA[idFromCanonical].crest;
    }
    return null;
}

/**
 * Returns the emblem object for a given league (by canonicalName or entity ID), or null if not found.
 * Never throws on unexpected, null, or malformed inputs.
 * @param {string} input - Canonical league name (e.g. "Premier League") or league slug ID (e.g. "premier-league")
 * @returns {{ url: string, provider: string, licenseStatus: string } | null}
 */
export function getLeagueEmblem(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    // 1. Direct entity ID lookup
    if (LEAGUE_MEDIA[trimmed]?.emblem) {
        return LEAGUE_MEDIA[trimmed].emblem;
    }
    // 2. Canonical name lookup
    const idFromCanonical = LEAGUE_CANONICAL_TO_ID[trimmed];
    if (idFromCanonical && LEAGUE_MEDIA[idFromCanonical]?.emblem) {
        return LEAGUE_MEDIA[idFromCanonical].emblem;
    }
    return null;
}

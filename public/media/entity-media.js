// public/media/entity-media.js
// Runtime media helper for club crests, league emblems, and player portraits.

import {
    CLUB_MEDIA,
    LEAGUE_MEDIA,
    CLUB_CANONICAL_TO_ID,
    LEAGUE_CANONICAL_TO_ID,
} from '../data/club-league-media.js';
import {
    PLAYER_SILHOUETTE_URL,
    PLAYER_SEASON_MEDIA,
    PLAYER_ENTITY_DEFAULT_MEDIA,
} from '../data/player-media.js';

export { PLAYER_SILHOUETTE_URL };

const SILHOUETTE_FALLBACK_MEDIA = Object.freeze({
    imageUrl: PLAYER_SILHOUETTE_URL,
    provider: 'local-fallback',
    resolutionType: 'silhouette',
    sourceYear: null,
    targetYear: null,
    licenseStatus: 'project-generated',
});

/**
 * Returns a fresh copy of the silhouette fallback media descriptor.
 * @param {number | null} [targetYear]
 * @returns {{ imageUrl: string, provider: string, resolutionType: string, sourceYear: number | null, targetYear: number | null, licenseStatus: string }}
 */
export function getSilhouetteFallbackMedia(targetYear = null) {
    return {
        imageUrl: SILHOUETTE_FALLBACK_MEDIA.imageUrl,
        provider: SILHOUETTE_FALLBACK_MEDIA.provider,
        resolutionType: SILHOUETTE_FALLBACK_MEDIA.resolutionType,
        sourceYear: null,
        targetYear: typeof targetYear === 'number' && Number.isFinite(targetYear) ? targetYear : null,
        licenseStatus: SILHOUETTE_FALLBACK_MEDIA.licenseStatus,
    };
}

/**
 * Returns the resolved media object for a given PlayerSeason (by player object or playerSeasonId string).
 * Prioritizes PlayerSeason ID (`player.id`) so multi-season entities resolve to season-specific media.
 * Returns a safe local silhouette fallback object if unknown or malformed; never throws.
 * @param {string | { id?: string, year?: number } | null | undefined} playerOrPlayerSeasonId
 * @returns {{ imageUrl: string, provider: string, resolutionType: string, sourceYear: number | null, targetYear: number | null, licenseStatus: string }}
 */
export function getPlayerMedia(playerOrPlayerSeasonId) {
    if (!playerOrPlayerSeasonId) {
        return getSilhouetteFallbackMedia(null);
    }

    let seasonId = null;
    let fallbackTargetYear = null;

    if (typeof playerOrPlayerSeasonId === 'string') {
        seasonId = playerOrPlayerSeasonId.trim();
    } else if (typeof playerOrPlayerSeasonId === 'object') {
        if (typeof playerOrPlayerSeasonId.id === 'string') {
            seasonId = playerOrPlayerSeasonId.id.trim();
        }
        if (typeof playerOrPlayerSeasonId.year === 'number') {
            fallbackTargetYear = playerOrPlayerSeasonId.year;
        }
    }

    if (seasonId && PLAYER_SEASON_MEDIA[seasonId]) {
        const entry = PLAYER_SEASON_MEDIA[seasonId];
        return {
            imageUrl: entry.imageUrl || PLAYER_SILHOUETTE_URL,
            provider: entry.provider || 'local-fallback',
            resolutionType: entry.resolutionType || 'silhouette',
            sourceYear: entry.sourceYear ?? null,
            targetYear: entry.targetYear ?? fallbackTargetYear,
            licenseStatus: entry.licenseStatus || 'project-generated',
        };
    }

    return getSilhouetteFallbackMedia(fallbackTargetYear);
}

/**
 * Returns entity-level default media for non-PlayerSeason contexts (e.g., future search/legend views).
 * Never overrides PlayerSeason resolution in gameplay UI; returns silhouette fallback if unknown.
 * @param {string} entityId
 * @returns {{ imageUrl: string, provider: string, resolutionType: string, sourceYear: number | null, targetYear: number | null, licenseStatus: string }}
 */
export function getPlayerEntityDefaultMedia(entityId) {
    if (!entityId || typeof entityId !== 'string') {
        return getSilhouetteFallbackMedia(null);
    }
    const trimmed = entityId.trim();
    const entry = PLAYER_ENTITY_DEFAULT_MEDIA[trimmed];
    if (entry) {
        return {
            imageUrl: entry.imageUrl || PLAYER_SILHOUETTE_URL,
            provider: entry.provider || 'local-fallback',
            resolutionType: entry.resolutionType || 'silhouette',
            sourceYear: entry.sourceYear ?? null,
            targetYear: entry.targetYear ?? null,
            licenseStatus: entry.licenseStatus || 'project-generated',
        };
    }
    return getSilhouetteFallbackMedia(null);
}

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


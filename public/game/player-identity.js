// Lightweight gameplay player identity resolver
// Resolves PlayerSeason objects or IDs to canonical Player Entity IDs via public/data/player-identities.js.
// Independent of media and localization subsystems; never compares display/canonical name strings.

import { PLAYER_ENTITY_BY_SEASON_ID } from '../data/player-identities.js';

function extractPlayerSeasonId(playerOrPlayerSeasonId) {
    if (typeof playerOrPlayerSeasonId === 'string') {
        const trimmed = playerOrPlayerSeasonId.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (playerOrPlayerSeasonId && typeof playerOrPlayerSeasonId === 'object') {
        if (typeof playerOrPlayerSeasonId.id === 'string') {
            const trimmed = playerOrPlayerSeasonId.id.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
    }
    return null;
}

/**
 * Returns the canonical Player Entity ID (e.g. "lionel-messi") for a PlayerSeason object or ID,
 * or null if the PlayerSeason ID is unknown.
 */
export function getPlayerEntityId(playerOrPlayerSeasonId) {
    const seasonId = extractPlayerSeasonId(playerOrPlayerSeasonId);
    if (seasonId && Object.prototype.hasOwnProperty.call(PLAYER_ENTITY_BY_SEASON_ID, seasonId)) {
        return PLAYER_ENTITY_BY_SEASON_ID[seasonId];
    }
    if (
        playerOrPlayerSeasonId &&
        typeof playerOrPlayerSeasonId === 'object' &&
        typeof playerOrPlayerSeasonId.entityId === 'string'
    ) {
        const explicitEntityId = playerOrPlayerSeasonId.entityId.trim();
        if (explicitEntityId.length > 0) {
            return explicitEntityId;
        }
    }
    return null;
}

/**
 * Returns a collision-safe identity key for gameplay uniqueness checks:
 * - Mapped canonical player: "entity:<entityId>"
 * - Unknown PlayerSeason fallback: "season:<playerSeasonId>"
 * - Invalid/empty input: null
 */
export function getPlayerIdentityKey(playerOrPlayerSeasonId) {
    const entityId = getPlayerEntityId(playerOrPlayerSeasonId);
    if (entityId) {
        return `entity:${entityId}`;
    }
    const seasonId = extractPlayerSeasonId(playerOrPlayerSeasonId);
    if (seasonId) {
        return `season:${seasonId}`;
    }
    return null;
}

/**
 * Returns true if and only if `a` and `b` resolve to the same non-null canonical identity key.
 * Never compares player names.
 */
export function isSameCanonicalPlayer(a, b) {
    const keyA = getPlayerIdentityKey(a);
    if (!keyA) return false;
    const keyB = getPlayerIdentityKey(b);
    if (!keyB) return false;
    return keyA === keyB;
}

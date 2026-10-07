// public/media/media-ui.js
// Lightweight DOM media helpers for player portraits, club crests, and league emblems.
// Handles runtime image load failures gracefully without infinite onerror loops.

import {
    PLAYER_SILHOUETTE_URL,
    getPlayerMedia,
    getClubCrest,
    getLeagueEmblem,
} from './entity-media.js';

export { PLAYER_SILHOUETTE_URL };

/**
 * Attaches a one-shot runtime error fallback to a player portrait <img> element.
 * Switches failed external URLs to `/assets/player-silhouette.svg` and prevents infinite onerror loops.
 * @param {HTMLImageElement} imgEl
 * @param {string} [fallbackUrl]
 * @returns {HTMLImageElement}
 */
export function applyImageFallback(imgEl, fallbackUrl = PLAYER_SILHOUETTE_URL) {
    if (!imgEl) return imgEl;

    const handleError = () => {
        if (imgEl.dataset?.fallbackApplied === '1') {
            imgEl.onerror = null;
            imgEl.classList?.add('fd-media-img--broken');
            return;
        }
        if (imgEl.dataset) {
            imgEl.dataset.fallbackApplied = '1';
        }
        imgEl.classList?.add('fd-player-img--fallback');
        if (imgEl.getAttribute('src') !== fallbackUrl) {
            imgEl.src = fallbackUrl;
        } else {
            imgEl.onerror = null;
        }
    };

    imgEl.onerror = handleError;
    return imgEl;
}

/**
 * Attaches a one-shot runtime error handler to a club crest or league emblem <img> element.
 * Hides broken logo images cleanly without using player silhouette or showing broken-image icons.
 * @param {HTMLImageElement} imgEl
 * @param {HTMLElement | null} [wrapperEl]
 * @returns {HTMLImageElement}
 */
export function applyLogoFallback(imgEl, wrapperEl = null) {
    if (!imgEl) return imgEl;

    imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.hidden = true;
        if (imgEl.style) {
            imgEl.style.display = 'none';
        }
        imgEl.classList?.add('fd-logo-img--hidden');
        if (wrapperEl) {
            wrapperEl.classList?.add('fd-logo-wrap--empty');
        }
    };

    return imgEl;
}

/**
 * Creates a semantic <img> element for a player portrait with safe fallback and async decoding.
 * @param {string | { id?: string, year?: number } | null | undefined} playerOrPlayerSeasonId
 * @param {{ className?: string, loading?: 'lazy' | 'eager', alt?: string }} [options]
 * @returns {HTMLImageElement}
 */
export function createPlayerImage(playerOrPlayerSeasonId, options = {}) {
    const media = getPlayerMedia(playerOrPlayerSeasonId);
    const img = document.createElement('img');
    img.className = options.className || 'fd-player-img';
    img.alt = options.alt ?? '';
    img.decoding = 'async';
    img.loading = options.loading || 'lazy';
    img.draggable = false;

    const isSilhouette =
        media.resolutionType === 'silhouette' || media.imageUrl === PLAYER_SILHOUETTE_URL;
    if (isSilhouette) {
        img.classList.add('fd-player-img--silhouette');
        if (img.dataset) {
            img.dataset.fallbackApplied = '1';
        }
    }

    applyImageFallback(img, PLAYER_SILHOUETTE_URL);
    img.src = media.imageUrl || PLAYER_SILHOUETTE_URL;
    return img;
}

export const createPlayerPortrait = createPlayerImage;

/**
 * Creates a semantic <img> element for a club crest, or returns null if no crest is available.
 * @param {string} clubNameOrId
 * @param {{ className?: string, loading?: 'lazy' | 'eager', alt?: string, wrapperEl?: HTMLElement | null }} [options]
 * @returns {HTMLImageElement | null}
 */
export function createClubCrest(clubNameOrId, options = {}) {
    const crest = getClubCrest(clubNameOrId);
    if (!crest || !crest.url) return null;

    const img = document.createElement('img');
    img.className = options.className || 'fd-club-crest-img';
    img.alt = options.alt ?? '';
    img.decoding = 'async';
    img.loading = options.loading || 'lazy';
    img.draggable = false;

    applyLogoFallback(img, options.wrapperEl || null);
    img.src = crest.url;
    return img;
}

/**
 * Creates a semantic <img> element for a league emblem, or returns null if no emblem is available.
 * @param {string} leagueNameOrId
 * @param {{ className?: string, loading?: 'lazy' | 'eager', alt?: string, wrapperEl?: HTMLElement | null }} [options]
 * @returns {HTMLImageElement | null}
 */
export function createLeagueEmblem(leagueNameOrId, options = {}) {
    const emblem = getLeagueEmblem(leagueNameOrId);
    if (!emblem || !emblem.url) return null;

    const img = document.createElement('img');
    img.className = options.className || 'fd-league-emblem-img';
    img.alt = options.alt ?? '';
    img.decoding = 'async';
    img.loading = options.loading || 'lazy';
    img.draggable = false;

    applyLogoFallback(img, options.wrapperEl || null);
    img.src = emblem.url;
    return img;
}

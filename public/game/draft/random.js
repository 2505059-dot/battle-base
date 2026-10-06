// Draft random selection & 3-stage uniform hierarchical roll helpers

import {
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from '../../data/team-seasons.js';

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

// 3-Stage Uniform Roll: League -> Club -> Year
export function generateInitialRollTeamSeason(randomFn = Math.random) {
    const league = pickRandomDraft(getLeagues(), randomFn);
    if (!league) return null;

    const club = pickRandomDraft(getClubsByLeague(league), randomFn);
    if (!club) return null;

    const year = pickRandomDraft(getYearsByLeagueAndClub(league, club), randomFn);
    if (year === null) return null;

    return findTeamSeason(league, club, year);
}


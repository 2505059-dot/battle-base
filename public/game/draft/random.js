// Draft random selection & 3-stage uniform hierarchical roll helpers

import {
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from '../../data/team-seasons.js';

export function pickRandomDraft(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const index = Math.floor(Math.random() * arr.length);
    return arr[index];
}

export function pickRandomExceptDraft(arr, current) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const candidates = arr.filter((item) => item !== current);
    return pickRandomDraft(candidates);
}

// 3-Stage Uniform Roll: League -> Club -> Year
export function generateInitialRollTeamSeason() {
    const league = pickRandomDraft(getLeagues());
    if (!league) return null;

    const club = pickRandomDraft(getClubsByLeague(league));
    if (!club) return null;

    const year = pickRandomDraft(getYearsByLeagueAndClub(league, club));
    if (year === null) return null;

    return findTeamSeason(league, club, year);
}

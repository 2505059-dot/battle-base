// Pure Draft rules, reroll validation, and roster slot helpers

import {
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from '../../data/team-seasons.js';
import { SLOTS } from '../shared/constants.js';
import { pickRandomDraft, pickRandomExceptDraft } from './random.js';

export function hasRerollOption(currentRoll, type) {
    if (!currentRoll) return false;
    if (type === 'league') {
        return getLeagues().some((l) => l !== currentRoll.league);
    }
    if (type === 'club') {
        return getClubsByLeague(currentRoll.league).some((c) => c !== currentRoll.club);
    }
    if (type === 'year') {
        return getYearsByLeagueAndClub(currentRoll.league, currentRoll.club).some(
            (y) => y !== currentRoll.year
        );
    }
    return false;
}

export function generateRerollTeamSeason(currentRoll, type) {
    if (!currentRoll) return null;

    if (type === 'league') {
        const newLeague = pickRandomExceptDraft(getLeagues(), currentRoll.league);
        if (!newLeague) return null;
        const newClub = pickRandomDraft(getClubsByLeague(newLeague));
        if (!newClub) return null;
        const newYear = pickRandomDraft(getYearsByLeagueAndClub(newLeague, newClub));
        if (newYear === null) return null;
        return findTeamSeason(newLeague, newClub, newYear);
    }

    if (type === 'club') {
        const newClub = pickRandomExceptDraft(getClubsByLeague(currentRoll.league), currentRoll.club);
        if (!newClub) return null;
        const newYear = pickRandomDraft(getYearsByLeagueAndClub(currentRoll.league, newClub));
        if (newYear === null) return null;
        return findTeamSeason(currentRoll.league, newClub, newYear);
    }

    if (type === 'year') {
        const newYear = pickRandomExceptDraft(
            getYearsByLeagueAndClub(currentRoll.league, currentRoll.club),
            currentRoll.year
        );
        if (newYear === null) return null;
        return findTeamSeason(currentRoll.league, currentRoll.club, newYear);
    }

    return null;
}

export function isValidRerollTransition(prevRoll, nextRoll, type) {
    if (!prevRoll || !nextRoll) return false;
    if (type === 'league') {
        return nextRoll.league !== prevRoll.league;
    }
    if (type === 'club') {
        return nextRoll.league === prevRoll.league && nextRoll.club !== prevRoll.club;
    }
    if (type === 'year') {
        return (
            nextRoll.league === prevRoll.league &&
            nextRoll.club === prevRoll.club &&
            nextRoll.year !== prevRoll.year
        );
    }
    return false;
}

export function createEmptyRoster() {
    return {
        GK: null,
        DF: null,
        MF: null,
        FW: null,
        FLEX: null,
    };
}

export function createInitialRerolls() {
    return {
        league: 1,
        club: 1,
        year: 1,
    };
}

export function getPlayerOverall(player) {
    return player?.overall ?? player?.rating ?? 0;
}

export function canPlayerFitSlot(player, slot) {
    if (!player || !Array.isArray(player.positions)) return false;
    switch (slot) {
        case 'GK':
            return player.positions.includes('GK');
        case 'DF':
            return player.positions.includes('DF');
        case 'MF':
            return player.positions.includes('MF');
        case 'FW':
            return player.positions.includes('FW');
        case 'FLEX':
            return !player.positions.includes('GK');
        default:
            return false;
    }
}

export function getAvailableSlotsForPlayer(roster, player) {
    return SLOTS.filter((slot) => roster[slot] === null && canPlayerFitSlot(player, slot));
}

export function isRosterComplete(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return false;
    return SLOTS.every((slot) => Boolean(roster[slot]));
}

export function getPickedCount(teamState) {
    return SLOTS.filter((slot) => teamState.roster[slot] !== null).length;
}

export function calculateTeamRating(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return 0;
    const picked = SLOTS.map((slot) => roster[slot]).filter(Boolean);
    if (picked.length === 0) return 0;
    const sum = picked.reduce((acc, p) => acc + getPlayerOverall(p), 0);
    return Math.round(sum / picked.length);
}

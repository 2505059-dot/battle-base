// Shared Draft Roll Policy v2 — Balanced TeamSeason Roll + Semantic Dice
// Single source of truth for Quick Duel, Play vs Bot, and future Golden Run.

import {
    TEAM_SEASONS,
    LEAGUES,
    getClubsByLeague,
    findTeamSeason,
} from '../data/team-seasons.js';
import { REROLL_TYPES } from './shared/constants.js';

export const DRAFT_ROLL_POLICY_VERSION = 'teamseason-semantic-v2';

export const LEAGUE_REROLL_MAX_YEAR_DRIFT = 3;
export const CLUB_REROLL_MAX_YEAR_DRIFT = 3;

const TEAM_SEASON_ORDER_INDEX = new Map(
    TEAM_SEASONS.map((ts, index) => [ts.id, index])
);

let INITIAL_DISTRIBUTION_CACHE = null;
const REROLL_DISTRIBUTION_CACHE = new Map();

function resolveRandomFn(randomFn) {
    if (typeof randomFn === 'function') return randomFn;
    if (randomFn && typeof randomFn.random === 'function') return () => randomFn.random();
    return Math.random;
}

function sortOutcomesDeterministically(outcomes) {
    return outcomes.sort((a, b) => {
        const idxA = TEAM_SEASON_ORDER_INDEX.get(a.teamSeason?.id) ?? Number.MAX_SAFE_INTEGER;
        const idxB = TEAM_SEASON_ORDER_INDEX.get(b.teamSeason?.id) ?? Number.MAX_SAFE_INTEGER;
        if (idxA !== idxB) return idxA - idxB;
        return String(a.teamSeason?.id ?? '').localeCompare(String(b.teamSeason?.id ?? ''));
    });
}

/**
 * Returns the initial roll outcome distribution across all TeamSeasons.
 * Every TeamSeason has uniform probability 1 / TEAM_SEASONS.length.
 * Ordering is deterministic (TEAM_SEASONS dataset order).
 * Does NOT consume any RNG.
 */
export function getInitialRollOutcomeDistribution() {
    if (INITIAL_DISTRIBUTION_CACHE) {
        return INITIAL_DISTRIBUTION_CACHE;
    }

    const total = TEAM_SEASONS.length;
    if (total === 0) {
        INITIAL_DISTRIBUTION_CACHE = [];
        return INITIAL_DISTRIBUTION_CACHE;
    }

    const probability = 1 / total;
    INITIAL_DISTRIBUTION_CACHE = TEAM_SEASONS.map((teamSeason) => ({
        teamSeason,
        probability,
    }));

    return INITIAL_DISTRIBUTION_CACHE;
}

/**
 * Returns the exact outcome distribution for a semantic reroll die:
 * - 'league': change league, preserve era (nearest year across other leagues, max drift ±3).
 *             Fairness: uniform over eligible target leagues -> uniform over eligible nearest years -> uniform over TeamSeasons.
 * - 'club':   keep league, change club, preserve era (nearest year across other clubs in same league, max drift ±3).
 *             Fairness: uniform over eligible target clubs -> uniform over eligible nearest years -> uniform over TeamSeasons.
 * - 'year':   keep club identity, change to any other season year of the same club (uniform over other club TeamSeasons).
 *
 * Ordering is deterministic (TEAM_SEASONS dataset order).
 * Does NOT consume any RNG.
 */
export function getRerollOutcomeDistribution(currentRoll, rerollType) {
    if (!currentRoll || !REROLL_TYPES.includes(rerollType)) {
        return [];
    }

    const currentLeague = currentRoll.league;
    const currentClub = currentRoll.club;
    const currentYear = Number(currentRoll.year);
    if (!currentLeague || !currentClub || !Number.isFinite(currentYear)) {
        return [];
    }

    const cacheKey = `${currentLeague}::${currentClub}::${currentYear}::${rerollType}`;
    if (REROLL_DISTRIBUTION_CACHE.has(cacheKey)) {
        return REROLL_DISTRIBUTION_CACHE.get(cacheKey);
    }

    const outcomes = [];

    if (rerollType === 'league') {
        const otherLeagues = LEAGUES.filter((league) => league !== currentLeague);
        const leagueRecords = [];

        for (const league of otherLeagues) {
            const seasonsInLeague = TEAM_SEASONS.filter((ts) => ts.league === league);
            if (seasonsInLeague.length === 0) continue;

            let nearestDistance = Infinity;
            for (const ts of seasonsInLeague) {
                const dist = Math.abs(ts.year - currentYear);
                if (dist < nearestDistance) {
                    nearestDistance = dist;
                }
            }

            if (Number.isFinite(nearestDistance)) {
                leagueRecords.push({
                    league,
                    nearestDistance,
                    seasonsInLeague,
                });
            }
        }

        if (leagueRecords.length === 0) {
            REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
            return outcomes;
        }

        const globalMinDistance = Math.min(...leagueRecords.map((r) => r.nearestDistance));
        if (
            !Number.isFinite(globalMinDistance) ||
            globalMinDistance > LEAGUE_REROLL_MAX_YEAR_DRIFT
        ) {
            REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
            return outcomes;
        }

        const eligibleLeagueRecords = leagueRecords.filter(
            (r) => r.nearestDistance === globalMinDistance
        );
        const leagueProb = 1 / eligibleLeagueRecords.length;

        for (const { seasonsInLeague } of eligibleLeagueRecords) {
            const nearestSeasons = seasonsInLeague.filter(
                (ts) => Math.abs(ts.year - currentYear) === globalMinDistance
            );
            const seasonsByYear = new Map();
            for (const ts of nearestSeasons) {
                if (!seasonsByYear.has(ts.year)) {
                    seasonsByYear.set(ts.year, []);
                }
                seasonsByYear.get(ts.year).push(ts);
            }

            if (seasonsByYear.size === 0) continue;
            const yearProb = leagueProb / seasonsByYear.size;

            for (const [, seasonsInYear] of seasonsByYear) {
                const tsProb = yearProb / seasonsInYear.length;
                for (const ts of seasonsInYear) {
                    outcomes.push({
                        teamSeason: ts,
                        probability: tsProb,
                    });
                }
            }
        }
    } else if (rerollType === 'club') {
        const otherClubs = getClubsByLeague(currentLeague).filter(
            (club) => club !== currentClub
        );
        const clubRecords = [];

        for (const club of otherClubs) {
            const seasonsInClub = TEAM_SEASONS.filter(
                (ts) => ts.league === currentLeague && ts.club === club
            );
            if (seasonsInClub.length === 0) continue;

            let nearestDistance = Infinity;
            for (const ts of seasonsInClub) {
                const dist = Math.abs(ts.year - currentYear);
                if (dist < nearestDistance) {
                    nearestDistance = dist;
                }
            }

            if (Number.isFinite(nearestDistance)) {
                clubRecords.push({
                    club,
                    nearestDistance,
                    seasonsInClub,
                });
            }
        }

        if (clubRecords.length === 0) {
            REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
            return outcomes;
        }

        const globalMinDistance = Math.min(...clubRecords.map((r) => r.nearestDistance));
        if (
            !Number.isFinite(globalMinDistance) ||
            globalMinDistance > CLUB_REROLL_MAX_YEAR_DRIFT
        ) {
            REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
            return outcomes;
        }

        const eligibleClubRecords = clubRecords.filter(
            (r) => r.nearestDistance === globalMinDistance
        );
        const clubProb = 1 / eligibleClubRecords.length;

        for (const { seasonsInClub } of eligibleClubRecords) {
            const nearestSeasons = seasonsInClub.filter(
                (ts) => Math.abs(ts.year - currentYear) === globalMinDistance
            );
            const seasonsByYear = new Map();
            for (const ts of nearestSeasons) {
                if (!seasonsByYear.has(ts.year)) {
                    seasonsByYear.set(ts.year, []);
                }
                seasonsByYear.get(ts.year).push(ts);
            }

            if (seasonsByYear.size === 0) continue;
            const yearProb = clubProb / seasonsByYear.size;

            for (const [, seasonsInYear] of seasonsByYear) {
                const tsProb = yearProb / seasonsInYear.length;
                for (const ts of seasonsInYear) {
                    outcomes.push({
                        teamSeason: ts,
                        probability: tsProb,
                    });
                }
            }
        }
    } else if (rerollType === 'year') {
        const otherClubSeasons = TEAM_SEASONS.filter(
            (ts) => ts.club === currentClub && ts.year !== currentYear
        );
        if (otherClubSeasons.length > 0) {
            const tsProb = 1 / otherClubSeasons.length;
            for (const ts of otherClubSeasons) {
                outcomes.push({
                    teamSeason: ts,
                    probability: tsProb,
                });
            }
        }
    }

    sortOutcomesDeterministically(outcomes);
    REROLL_DISTRIBUTION_CACHE.set(cacheKey, outcomes);
    return outcomes;
}

/**
 * Samples a single TeamSeason from a non-empty outcome distribution `{ teamSeason, probability }[]`.
 * Consumes `randomFn` exactly once when `distribution` is non-empty.
 */
export function sampleOutcomeDistribution(distribution, randomFn = Math.random) {
    if (!Array.isArray(distribution) || distribution.length === 0) {
        return null;
    }

    let totalProbability = 0;
    for (const entry of distribution) {
        const p = Number(entry?.probability) || 0;
        if (p > 0) {
            totalProbability += p;
        }
    }
    if (totalProbability <= 0) {
        return null;
    }

    const rng = resolveRandomFn(randomFn);
    const raw = Number(rng());
    const r = Math.min(0.999999999999, Math.max(0, Number.isFinite(raw) ? raw : 0));
    const target = r * totalProbability;

    let cumulative = 0;
    let lastValidTeamSeason = null;

    for (let i = 0; i < distribution.length; i++) {
        const entry = distribution[i];
        const p = Number(entry?.probability) || 0;
        if (p <= 0 || !entry?.teamSeason) continue;
        lastValidTeamSeason = entry.teamSeason;
        cumulative += p;
        if (target < cumulative) {
            return entry.teamSeason;
        }
    }

    return lastValidTeamSeason;
}

/**
 * Checks whether `nextRoll` (a TeamSeason object or a teamSeasonId string) is a legal
 * destination from `currentRoll` under `rerollType` according to the shared roll policy.
 */
export function isLegalRerollDestination(currentRoll, nextRoll, rerollType) {
    if (!currentRoll || !nextRoll) return false;

    const outcomes = getRerollOutcomeDistribution(currentRoll, rerollType);
    if (outcomes.length === 0) return false;

    if (typeof nextRoll === 'string') {
        return outcomes.some((entry) => entry.teamSeason.id === nextRoll);
    }

    if (typeof nextRoll === 'object') {
        const targetId =
            typeof nextRoll.id === 'string'
                ? nextRoll.id
                : findTeamSeason(nextRoll.league, nextRoll.club, nextRoll.year)?.id ?? null;
        if (!targetId) return false;

        const matched = outcomes.find((entry) => entry.teamSeason.id === targetId);
        if (!matched) return false;

        const ts = matched.teamSeason;
        if (nextRoll.league !== undefined && nextRoll.league !== ts.league) return false;
        if (nextRoll.club !== undefined && nextRoll.club !== ts.club) return false;
        if (nextRoll.year !== undefined && Number(nextRoll.year) !== ts.year) return false;

        return true;
    }

    return false;
}

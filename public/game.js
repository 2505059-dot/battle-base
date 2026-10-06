// 5-a-side Football Fantasy Draft Prototype (2 Players) + Match Simulation v0
// Uses Battle Base ctx: ctx.me, ctx.players, ctx.order, ctx.seed, ctx.send(), ctx.onMessage()

import {
    TEAM_SEASONS,
    TEAM_SEASON_MAP,
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from './data/team-seasons.js';

const SLOTS = ['GK', 'DF', 'MF', 'FW', 'FLEX'];
const REROLL_TYPES = ['league', 'club', 'year'];
const REROLL_LABELS = {
    league: 'League Reroll',
    club: 'Club Reroll',
    year: 'Year Reroll',
};
const MAX_HISTORY_ITEMS = 8;

// ---------- Position & Team Profile Configuration ----------

// Role contribution weights toward the 5 team functional dimensions
export const ROLE_WEIGHTS = {
    GK: {
        goalkeeping: 1.0,
        defense: 0.08,
        physical: 0.10,
        creation: 0.10,
        attack: 0.0,
    },
    DF: {
        defense: 0.48,
        physical: 0.30,
        creation: 0.14,
        attack: 0.04,
        goalkeeping: 0.0,
    },
    MF: {
        creation: 0.44,
        attack: 0.28,
        defense: 0.24,
        physical: 0.26,
        goalkeeping: 0.0,
    },
    FW: {
        attack: 0.56,
        creation: 0.24,
        physical: 0.24,
        defense: 0.04,
        goalkeeping: 0.0,
    },
};

// Base role multipliers when selecting who takes a shot
export const SHOT_ROLE_WEIGHTS = {
    FW: 3.5,
    MF: 1.85,
    DF: 0.70,
    GK: 0.02,
};

// Base role multipliers when selecting who creates a chance / assists
export const ASSIST_ROLE_WEIGHTS = {
    MF: 3.2,
    FW: 1.85,
    DF: 1.15,
    GK: 0.18,
};

// Base role multipliers when selecting who makes a defensive intervention
export const DEFENSE_ROLE_WEIGHTS = {
    DF: 3.2,
    MF: 2.0,
    FW: 0.55,
    GK: 0.15,
};

// Centralized probability & pacing parameters for Match Simulation v0
export const MATCH_SIM_CONFIG = {
    halfEventsMin: 11,
    halfEventsMax: 15,
    // Step 1: Attacking opportunity allocation
    baseAttackShare: 0.5,
    initiativeDiffScale: 0.011,
    minAttackShare: 0.30,
    maxAttackShare: 0.70,
    // Step 2: Build-up progression to shot
    baseShotProb: 0.74,
    progressionDiffScale: 0.009,
    minShotProb: 0.48,
    maxShotProb: 0.88,
    // Step 4: Shot accuracy (on target)
    baseOnTargetProb: 0.47,
    onTargetDiffScale: 0.007,
    minOnTargetProb: 0.25,
    maxOnTargetProb: 0.65,
    // Off-target split between blocked ('shot') and wide/over ('miss')
    blockedOffTargetShare: 0.42,
    // Step 5 & 6: Goal vs GK Save when shot is on target
    baseGoalOnTargetProb: 0.33,
    goalDiffScale: 0.008,
    minGoalOnTargetProb: 0.13,
    maxGoalOnTargetProb: 0.50,
    // Assist probability on a goal
    assistedGoalProb: 0.86,
    // Possession model
    possessionDiffScale: 0.75,
    possessionNoiseMax: 3,
    minPossession: 32,
    maxPossession: 68,
    // Playback speed: ~1.25s per event => ~32-42 seconds per 90-min match
    playbackIntervalMs: 1250,
};

const PITCH_ZONES = ['left', 'center', 'right'];

// ---------- Deterministic Seeded RNG (Mulberry32) ----------

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

function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

// ---------- Draft Random Selection & Hierarchical Roll Helpers ----------

function pickRandomDraft(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const index = Math.floor(Math.random() * arr.length);
    return arr[index];
}

function pickRandomExceptDraft(arr, current) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const candidates = arr.filter((item) => item !== current);
    return pickRandomDraft(candidates);
}

// 3-Stage Uniform Roll: League -> Club -> Year
function generateInitialRollTeamSeason() {
    const league = pickRandomDraft(getLeagues());
    if (!league) return null;

    const club = pickRandomDraft(getClubsByLeague(league));
    if (!club) return null;

    const year = pickRandomDraft(getYearsByLeagueAndClub(league, club));
    if (year === null) return null;

    return findTeamSeason(league, club, year);
}

function hasRerollOption(currentRoll, type) {
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

function generateRerollTeamSeason(currentRoll, type) {
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

function isValidRerollTransition(prevRoll, nextRoll, type) {
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

// ---------- Pure Rule & Team Profile Helpers ----------

function createEmptyRoster() {
    return {
        GK: null,
        DF: null,
        MF: null,
        FW: null,
        FLEX: null,
    };
}

function createInitialRerolls() {
    return {
        league: 1,
        club: 1,
        year: 1,
    };
}

function getPlayerOverall(player) {
    return player?.overall ?? player?.rating ?? 0;
}

function canPlayerFitSlot(player, slot) {
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

function getAvailableSlotsForPlayer(roster, player) {
    return SLOTS.filter((slot) => roster[slot] === null && canPlayerFitSlot(player, slot));
}

function isRosterComplete(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return false;
    return SLOTS.every((slot) => Boolean(roster[slot]));
}

function getPickedCount(teamState) {
    return SLOTS.filter((slot) => teamState.roster[slot] !== null).length;
}

function calculateTeamRating(teamState) {
    const roster = teamState?.roster ?? teamState;
    if (!roster) return 0;
    const picked = SLOTS.map((slot) => roster[slot]).filter(Boolean);
    if (picked.length === 0) return 0;
    const sum = picked.reduce((acc, p) => acc + getPlayerOverall(p), 0);
    return Math.round(sum / picked.length);
}

// Choose the best non-GK role for a FLEX player based on their actual positions and stats
export function resolveFlexRole(player) {
    if (!player || !Array.isArray(player.positions)) return 'MF';
    const candidateRoles = player.positions.filter((pos) => pos !== 'GK' && ROLE_WEIGHTS[pos]);
    if (candidateRoles.length === 0) return 'MF';
    if (candidateRoles.length === 1) return candidateRoles[0];

    let bestRole = candidateRoles[0];
    let bestScore = -Infinity;

    for (let i = 0; i < candidateRoles.length; i++) {
        const role = candidateRoles[i];
        const w = ROLE_WEIGHTS[role];
        const weightSum = w.attack + w.creation + w.defense + w.physical + w.goalkeeping;
        const rawScore =
            w.attack * (player.attack ?? 0) +
            w.creation * (player.creation ?? 0) +
            w.defense * (player.defense ?? 0) +
            w.physical * (player.physical ?? 0) +
            w.goalkeeping * (player.goalkeeping ?? 0);
        // Primary listed position gets a tiny tie-break preference
        const normalizedScore = rawScore / (weightSum || 1) + (i === 0 ? 0.25 : 0);
        if (normalizedScore > bestScore) {
            bestScore = normalizedScore;
            bestRole = role;
        }
    }

    return bestRole;
}

export function getEffectiveSlotRole(slot, player) {
    if (slot === 'FLEX') {
        return resolveFlexRole(player);
    }
    return ROLE_WEIGHTS[slot] ? slot : 'MF';
}

export function calculateTeamProfile(teamOrRoster) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    const attrs = ['attack', 'creation', 'defense', 'physical', 'goalkeeping'];
    const weightedSums = {
        attack: 0,
        creation: 0,
        defense: 0,
        physical: 0,
        goalkeeping: 0,
    };
    const totalWeights = {
        attack: 0,
        creation: 0,
        defense: 0,
        physical: 0,
        goalkeeping: 0,
    };

    const activePlayers = [];

    for (const slot of SLOTS) {
        const player = roster?.[slot];
        if (!player) continue;
        const role = getEffectiveSlotRole(slot, player);
        const weights = ROLE_WEIGHTS[role];
        activePlayers.push({ slot, role, player });

        for (const attr of attrs) {
            const w = weights[attr] ?? 0;
            if (w > 0) {
                weightedSums[attr] += w * (Number(player[attr]) || 0);
                totalWeights[attr] += w;
            }
        }
    }

    if (activePlayers.length === 0) {
        return {
            attack: 0,
            creation: 0,
            defense: 0,
            physical: 0,
            goalkeeping: 0,
            overall: 0,
        };
    }

    const profile = {};
    for (const attr of attrs) {
        const avg = totalWeights[attr] > 0 ? weightedSums[attr] / totalWeights[attr] : 0;
        profile[attr] = Math.round(avg * 10) / 10;
    }

    // GK reflexes/command also slightly supported by GK physical & defense
    if (roster?.GK) {
        const gk = roster.GK;
        const gkBlend =
            0.88 * (Number(gk.goalkeeping) || 0) +
            0.07 * (Number(gk.physical) || 0) +
            0.05 * (Number(gk.defense) || 0);
        profile.goalkeeping = Math.round(gkBlend * 10) / 10;
    }

    const overallSum = activePlayers.reduce((acc, item) => acc + getPlayerOverall(item.player), 0);
    profile.overall = Math.round((overallSum / activePlayers.length) * 10) / 10;

    return profile;
}

// ---------- Match Simulation v0 Pure Engine ----------

function getRosterEntries(teamOrRoster) {
    const roster = teamOrRoster?.roster ?? teamOrRoster ?? {};
    return SLOTS.map((slot) => {
        const player = roster[slot];
        if (!player) return null;
        return {
            slot,
            role: getEffectiveSlotRole(slot, player),
            player,
        };
    }).filter(Boolean);
}

function selectCreator(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = ASSIST_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const cre = Math.max(20, Number(entry.player.creation) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow(cre / 80, 2.0) * (0.85 + 0.15 * (phy / 80));
    });
}

function selectShooter(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = SHOT_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const atk = Math.max(15, Number(entry.player.attack) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow(atk / 80, 2.1) * (0.82 + 0.18 * (phy / 80));
    });
}

function selectAssister(entries, shooterPlayerId, rng) {
    const candidates = entries.filter((e) => e.player.id !== shooterPlayerId);
    if (candidates.length === 0) return null;
    return rng.weightedPick(candidates, (entry) => {
        const roleMult = ASSIST_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const cre = Math.max(20, Number(entry.player.creation) || 50);
        return roleMult * Math.pow(cre / 80, 2.1);
    });
}

function selectDefender(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = DEFENSE_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const def = Math.max(20, Number(entry.player.defense) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow((0.65 * def + 0.35 * phy) / 80, 2.0);
    });
}

function sampleSortedMinutes(startMin, endMin, count, rng) {
    const pool = [];
    for (let m = startMin; m <= endMin; m++) {
        pool.push(m);
    }
    const chosen = [];
    const targetCount = Math.min(count, pool.length);
    for (let i = 0; i < targetCount; i++) {
        const idx = rng.randomInt(0, pool.length - 1);
        chosen.push(pool[idx]);
        pool.splice(idx, 1);
    }
    chosen.sort((a, b) => a - b);
    return chosen;
}

function cloneStatsSnapshot(stats, score) {
    return {
        score: { A: score.A, B: score.B },
        stats: {
            A: { ...stats.A },
            B: { ...stats.B },
        },
    };
}

export function generateMatchScript(teamA, teamB, matchSeed) {
    const normalizedSeed = (Number(matchSeed) || 1) >>> 0;
    const rng = createRng(normalizedSeed);

    const profileA = calculateTeamProfile(teamA);
    const profileB = calculateTeamProfile(teamB);
    const entriesA = getRosterEntries(teamA);
    const entriesB = getRosterEntries(teamB);

    const gkA = (teamA?.roster ?? teamA)?.GK ?? entriesA[0]?.player ?? { id: 'gk-a', name: 'Team A GK' };
    const gkB = (teamB?.roster ?? teamB)?.GK ?? entriesB[0]?.player ?? { id: 'gk-b', name: 'Team B GK' };

    // Calculate baseline possession from creation, physical, and attack
    const controlA = 0.55 * profileA.creation + 0.30 * profileA.physical + 0.15 * profileA.attack;
    const controlB = 0.55 * profileB.creation + 0.30 * profileB.physical + 0.15 * profileB.attack;
    const controlDiff = controlA - controlB;
    const noise = (rng.random() * 2 - 1) * MATCH_SIM_CONFIG.possessionNoiseMax;

    const rawPossessionA = 50 + controlDiff * MATCH_SIM_CONFIG.possessionDiffScale + noise;
    const possessionA = clamp(
        Math.round(rawPossessionA),
        MATCH_SIM_CONFIG.minPossession,
        MATCH_SIM_CONFIG.maxPossession
    );
    const possessionB = 100 - possessionA;

    const score = { A: 0, B: 0 };
    const stats = {
        A: {
            goals: 0,
            shots: 0,
            shotsOnTarget: 0,
            saves: 0,
            possession: possessionA,
        },
        B: {
            goals: 0,
            shots: 0,
            shotsOnTarget: 0,
            saves: 0,
            possession: possessionB,
        },
    };

    const events = [];

    // 01' KICK OFF
    events.push({
        minute: 1,
        type: 'kick_off',
        badge: 'KICK OFF',
        team: null,
        zone: 'center',
        phase: 'kick_off',
        text: 'KICK OFF — Match underway!',
        ...cloneStatsSnapshot(stats, score),
    });

    const firstHalfCount = rng.randomInt(
        MATCH_SIM_CONFIG.halfEventsMin,
        MATCH_SIM_CONFIG.halfEventsMax
    );
    const secondHalfCount = rng.randomInt(
        MATCH_SIM_CONFIG.halfEventsMin,
        MATCH_SIM_CONFIG.halfEventsMax
    );

    const firstHalfMinutes = sampleSortedMinutes(2, 44, firstHalfCount, rng);
    const secondHalfMinutes = sampleSortedMinutes(46, 89, secondHalfCount, rng);

    // Step 1 probability: Who wins each attacking sequence
    const initiativeA =
        0.45 * profileA.creation + 0.30 * profileA.physical + 0.25 * profileA.attack;
    const initiativeB =
        0.45 * profileB.creation + 0.30 * profileB.physical + 0.25 * profileB.attack;
    const probAttackA = clamp(
        MATCH_SIM_CONFIG.baseAttackShare +
            (initiativeA - initiativeB) * MATCH_SIM_CONFIG.initiativeDiffScale,
        MATCH_SIM_CONFIG.minAttackShare,
        MATCH_SIM_CONFIG.maxAttackShare
    );

    function simulateAttackSequence(minute) {
        const isTeamA = rng.random() < probAttackA;
        const attTag = isTeamA ? 'A' : 'B';
        const defTag = isTeamA ? 'B' : 'A';
        const attProfile = isTeamA ? profileA : profileB;
        const defProfile = isTeamA ? profileB : profileA;
        const attEntries = isTeamA ? entriesA : entriesB;
        const defEntries = isTeamA ? entriesB : entriesA;
        const defGk = isTeamA ? gkB : gkA;

        const zone = rng.pickRandom(PITCH_ZONES) ?? 'center';
        const creatorEntry = selectCreator(attEntries, rng);
        const defenderEntry = selectDefender(defEntries, rng);

        const creatorName = creatorEntry?.player?.name ?? `Team ${attTag}`;
        const creatorId = creatorEntry?.player?.id ?? null;
        const defenderName = defenderEntry?.player?.name ?? `Team ${defTag} Defense`;
        const defenderId = defenderEntry?.player?.id ?? null;

        // Step 2: Does the attack progress to a shot?
        const attackBuild =
            0.45 * attProfile.creation +
            0.35 * attProfile.attack +
            0.20 * attProfile.physical;
        const defenseStop = 0.60 * defProfile.defense + 0.40 * defProfile.physical;
        const progressionDiff = attackBuild - defenseStop;
        const probShot = clamp(
            MATCH_SIM_CONFIG.baseShotProb +
                progressionDiff * MATCH_SIM_CONFIG.progressionDiffScale,
            MATCH_SIM_CONFIG.minShotProb,
            MATCH_SIM_CONFIG.maxShotProb
        );

        if (rng.random() >= probShot) {
            // Attack broken up or chance created without a clean shot
            const attackTemplates = [
                `${creatorName} creates a chance on the ${zone} — broken up by ${defenderName}`,
                `${creatorName} drives into the final third, intercepted by ${defenderName}`,
                `${creatorName} creates a dangerous build-up (${zone})`,
            ];
            const text = rng.pickRandom(attackTemplates);
            events.push({
                minute,
                type: 'attack',
                badge: 'ATTACK',
                team: attTag,
                zone,
                phase: 'build_up',
                playerId: creatorId,
                playerName: creatorName,
                defenderId,
                defenderName,
                text,
                ...cloneStatsSnapshot(stats, score),
            });
            return;
        }

        // Step 3: Select shooter
        const shooterEntry = selectShooter(attEntries, rng);
        const shooter = shooterEntry?.player ?? creatorEntry?.player ?? { id: null, name: `Team ${attTag}` };
        const shooterAtk = Number(shooter.attack) || attProfile.attack;

        stats[attTag].shots += 1;

        // Step 4: Is the shot on target?
        const shotQuality =
            0.55 * shooterAtk + 0.25 * attProfile.attack + 0.20 * attProfile.creation;
        const shotPressure = 0.60 * defProfile.defense + 0.40 * defProfile.physical;
        const probOnTarget = clamp(
            MATCH_SIM_CONFIG.baseOnTargetProb +
                (shotQuality - shotPressure) * MATCH_SIM_CONFIG.onTargetDiffScale,
            MATCH_SIM_CONFIG.minOnTargetProb,
            MATCH_SIM_CONFIG.maxOnTargetProb
        );

        const onTarget = rng.random() < probOnTarget;

        if (!onTarget) {
            const isBlockedShot = rng.random() < MATCH_SIM_CONFIG.blockedOffTargetShare;
            if (isBlockedShot) {
                events.push({
                    minute,
                    type: 'shot',
                    badge: 'SHOT',
                    team: attTag,
                    zone,
                    phase: 'shot',
                    playerId: shooter.id,
                    playerName: shooter.name,
                    defenderId,
                    defenderName,
                    onTarget: false,
                    text: `${shooter.name} shoots — blocked by ${defenderName}`,
                    ...cloneStatsSnapshot(stats, score),
                });
            } else {
                const missPhrases = [
                    `${shooter.name} shoots — misses wide`,
                    `${shooter.name} fires just over the bar`,
                ];
                events.push({
                    minute,
                    type: 'miss',
                    badge: 'MISS',
                    team: attTag,
                    zone,
                    phase: 'shot',
                    playerId: shooter.id,
                    playerName: shooter.name,
                    onTarget: false,
                    text: rng.pickRandom(missPhrases),
                    ...cloneStatsSnapshot(stats, score),
                });
            }
            return;
        }

        // Shot is on target
        stats[attTag].shotsOnTarget += 1;

        // Step 5 & 6: GK Save vs Goal
        const finishRating =
            0.55 * shooterAtk + 0.25 * attProfile.attack + 0.20 * attProfile.creation;
        const gkRating =
            0.72 * defProfile.goalkeeping +
            0.18 * defProfile.defense +
            0.10 * defProfile.physical;
        const probGoal = clamp(
            MATCH_SIM_CONFIG.baseGoalOnTargetProb +
                (finishRating - gkRating) * MATCH_SIM_CONFIG.goalDiffScale,
            MATCH_SIM_CONFIG.minGoalOnTargetProb,
            MATCH_SIM_CONFIG.maxGoalOnTargetProb
        );

        if (rng.random() < probGoal) {
            // GOAL!
            score[attTag] += 1;
            stats[attTag].goals += 1;

            let assistEntry = null;
            if (rng.random() < MATCH_SIM_CONFIG.assistedGoalProb) {
                assistEntry = selectAssister(attEntries, shooter.id, rng);
            }
            const assistName = assistEntry?.player?.name ?? null;
            const assistId = assistEntry?.player?.id ?? null;

            const goalText = assistName
                ? `GOAL — ${shooter.name} (Assist: ${assistName})`
                : `GOAL — ${shooter.name}`;

            events.push({
                minute,
                type: 'goal',
                badge: 'GOAL',
                team: attTag,
                zone,
                phase: 'shot',
                playerId: shooter.id,
                playerName: shooter.name,
                scorerId: shooter.id,
                scorerName: shooter.name,
                assistId,
                assistName,
                goalkeeperId: defGk.id ?? null,
                goalkeeperName: defGk.name ?? null,
                onTarget: true,
                text: goalText,
                ...cloneStatsSnapshot(stats, score),
            });
        } else {
            // SAVED by Goalkeeper
            stats[defTag].saves += 1;

            events.push({
                minute,
                type: 'save',
                badge: 'SAVE',
                team: attTag,
                defendingTeam: defTag,
                zone,
                phase: 'shot',
                playerId: shooter.id,
                playerName: shooter.name,
                goalkeeperId: defGk.id ?? null,
                goalkeeperName: defGk.name ?? 'Goalkeeper',
                onTarget: true,
                text: `${shooter.name} shoots — SAVED by ${defGk.name ?? 'GK'}`,
                ...cloneStatsSnapshot(stats, score),
            });
        }
    }

    for (const min of firstHalfMinutes) {
        simulateAttackSequence(min);
    }

    // 45' HALF TIME
    events.push({
        minute: 45,
        type: 'half_time',
        badge: 'HALF TIME',
        team: null,
        zone: 'center',
        phase: 'half_time',
        text: `HALF TIME — TEAM A ${score.A} - ${score.B} TEAM B`,
        ...cloneStatsSnapshot(stats, score),
    });

    for (const min of secondHalfMinutes) {
        simulateAttackSequence(min);
    }

    // 90' FULL TIME
    events.push({
        minute: 90,
        type: 'full_time',
        badge: 'FULL TIME',
        team: null,
        zone: 'center',
        phase: 'full_time',
        text: `FULL TIME — TEAM A ${score.A} - ${score.B} TEAM B`,
        ...cloneStatsSnapshot(stats, score),
    });

    return {
        matchSeed: normalizedSeed,
        profiles: {
            A: profileA,
            B: profileB,
        },
        events,
        finalScore: {
            A: score.A,
            B: score.B,
        },
        stats: {
            A: { ...stats.A },
            B: { ...stats.B },
        },
    };
}

// ---------- Batch Simulation Debug Helper ----------

function buildSampleRosterFromSeason(teamSeason) {
    const roster = createEmptyRoster();
    if (!teamSeason || !Array.isArray(teamSeason.players)) return roster;

    const sortedPlayers = [...teamSeason.players].sort(
        (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
    );
    const usedIds = new Set();

    // First fill GK, DF, MF, FW preferring primary position match, then any valid fit
    for (const slot of ['GK', 'DF', 'MF', 'FW']) {
        let candidate = sortedPlayers.find(
            (p) => !usedIds.has(p.id) && p.positions?.[0] === slot
        );
        if (!candidate) {
            candidate = sortedPlayers.find(
                (p) => !usedIds.has(p.id) && canPlayerFitSlot(p, slot)
            );
        }
        if (candidate) {
            roster[slot] = candidate;
            usedIds.add(candidate.id);
        }
    }

    // Fill FLEX with highest-rated remaining outfield player
    const flexCandidate = sortedPlayers.find(
        (p) => !usedIds.has(p.id) && canPlayerFitSlot(p, 'FLEX')
    );
    if (flexCandidate) {
        roster.FLEX = flexCandidate;
        usedIds.add(flexCandidate.id);
    }

    return roster;
}

function normalizeTeamInput(teamInput, fallbackSeason) {
    if (!teamInput) return buildSampleRosterFromSeason(fallbackSeason);
    if (Array.isArray(teamInput.players)) return buildSampleRosterFromSeason(teamInput);
    return teamInput;
}

export function simulateManyMatches(teamA, teamB, count = 1000, baseSeed = 10001) {
    const resolvedTeamA = normalizeTeamInput(teamA, TEAM_SEASONS[0]);
    const resolvedTeamB = normalizeTeamInput(teamB, TEAM_SEASONS[1] ?? TEAM_SEASONS[0]);
    const totalMatches = Math.max(1, Number(count) || 1000);
    const startSeed = (Number(baseSeed) || 10001) >>> 0;

    let winsA = 0;
    let draws = 0;
    let winsB = 0;
    let totalGoalsA = 0;
    let totalGoalsB = 0;
    let totalShotsA = 0;
    let totalShotsB = 0;
    let totalOnTargetA = 0;
    let totalOnTargetB = 0;
    let totalSavesA = 0;
    let totalSavesB = 0;
    let totalPossessionA = 0;
    const scoreHistogram = {};

    for (let i = 0; i < totalMatches; i++) {
        const seed = (startSeed + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
        const result = generateMatchScript(resolvedTeamA, resolvedTeamB, seed);
        const gA = result.finalScore.A;
        const gB = result.finalScore.B;

        if (gA > gB) winsA++;
        else if (gB > gA) winsB++;
        else draws++;

        totalGoalsA += gA;
        totalGoalsB += gB;
        totalShotsA += result.stats.A.shots;
        totalShotsB += result.stats.B.shots;
        totalOnTargetA += result.stats.A.shotsOnTarget;
        totalOnTargetB += result.stats.B.shotsOnTarget;
        totalSavesA += result.stats.A.saves;
        totalSavesB += result.stats.B.saves;
        totalPossessionA += result.stats.A.possession;

        const key = `${gA}-${gB}`;
        scoreHistogram[key] = (scoreHistogram[key] || 0) + 1;
    }

    const summary = {
        matches: totalMatches,
        baseSeed: startSeed,
        'A win %': Number(((winsA / totalMatches) * 100).toFixed(2)),
        'Draw %': Number(((draws / totalMatches) * 100).toFixed(2)),
        'B win %': Number(((winsB / totalMatches) * 100).toFixed(2)),
        'Average goals A': Number((totalGoalsA / totalMatches).toFixed(2)),
        'Average goals B': Number((totalGoalsB / totalMatches).toFixed(2)),
        avgShotsA: Number((totalShotsA / totalMatches).toFixed(2)),
        avgShotsB: Number((totalShotsB / totalMatches).toFixed(2)),
        avgOnTargetA: Number((totalOnTargetA / totalMatches).toFixed(2)),
        avgOnTargetB: Number((totalOnTargetB / totalMatches).toFixed(2)),
        avgSavesA: Number((totalSavesA / totalMatches).toFixed(2)),
        avgSavesB: Number((totalSavesB / totalMatches).toFixed(2)),
        avgPossessionA: Number((totalPossessionA / totalMatches).toFixed(1)),
        avgPossessionB: Number((100 - totalPossessionA / totalMatches).toFixed(1)),
        profiles: {
            A: calculateTeamProfile(resolvedTeamA),
            B: calculateTeamProfile(resolvedTeamB),
        },
        topScorelines: Object.entries(scoreHistogram)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([scoreline, cnt]) => ({
                scoreline,
                count: cnt,
                pct: `${((cnt / totalMatches) * 100).toFixed(1)}%`,
            })),
    };

    console.log(
        `[Match Simulation v0] Simulated ${totalMatches} matches (baseSeed=${startSeed}):`,
        summary
    );
    return summary;
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        createRng,
        calculateTeamProfile,
        generateMatchScript,
        simulateManyMatches,
    });
}

// ---------- Game State Initialization ----------

function createInitialState(ctx) {
    const teams = ctx.order.map((id, idx) => ({
        id,
        label: idx === 0 ? 'TEAM A' : 'TEAM B',
        shortTag: idx === 0 ? 'A' : 'B',
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
    }));

    return {
        seed: ctx.seed,
        teams,
        turnIndex: 0,           // 0 or 1 (index into state.teams)
        roundCount: 1,          // 1..10
        phase: 'ROLL',          // 'ROLL' | 'PICK' | 'COMPLETE' | 'MATCH' | 'RESULT'
        currentRoll: null,      // teamSeason object when phase === 'PICK'
        selectedPlayerId: null, // local UI selection during 'PICK'
        history: [],            // recent 5~8 synchronized action logs
        match: null,            // { matchSeed, script, revealedCount, currentMinute, liveScore, liveStats }
        opponentLeft: false,
    };
}

// ---------- Game Entry Point ----------

export function startGame(ctx) {
    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    // 2-player only check
    if (!Array.isArray(ctx.order) || ctx.order.length !== 2 || ctx.players.length !== 2) {
        const notice = el('div', 'fd-only-two', 'このプロトタイプは2人対戦専用です');
        ctx.area.append(notice);
        return;
    }

    const state = createInitialState(ctx);
    let playbackTimer = null;

    const root = el('div', 'fd-root');
    ctx.area.append(root);

    function stopPlaybackTimer() {
        if (playbackTimer !== null) {
            clearInterval(playbackTimer);
            playbackTimer = null;
        }
    }

    function getCurrentTeam() {
        return state.teams[state.turnIndex];
    }

    function isDraftPhase() {
        return state.phase === 'ROLL' || state.phase === 'PICK';
    }

    function isMyTurn() {
        return isDraftPhase() && getCurrentTeam().id === ctx.me;
    }

    function isTeamAPlayer() {
        return ctx.me === ctx.order[0];
    }

    function pushHistory(entryText) {
        state.history.push(entryText);
        if (state.history.length > MAX_HISTORY_ITEMS) {
            state.history = state.history.slice(-MAX_HISTORY_ITEMS);
        }
    }

    // ----- State Transitions (Synced across both clients) -----

    function applyRoll(actorId, teamSeasonId) {
        if (state.phase !== 'ROLL') return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        const teamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!teamSeason) return;

        state.currentRoll = teamSeason;
        state.selectedPlayerId = null;
        state.phase = 'PICK';
        pushHistory(`${currentTeam.name} rolled ${teamSeason.club} ${teamSeason.year}`);
        render();
    }

    function applyReroll(actorId, type, teamSeasonId) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        if (!REROLL_TYPES.includes(type)) return;
        if (currentTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!nextTeamSeason) return;

        if (!isValidRerollTransition(state.currentRoll, nextTeamSeason, type)) return;

        currentTeam.rerolls[type] -= 1;
        state.currentRoll = nextTeamSeason;
        state.selectedPlayerId = null;

        pushHistory(`${currentTeam.name} used ${REROLL_LABELS[type]}`);
        pushHistory(`${currentTeam.name} rolled ${nextTeamSeason.club} ${nextTeamSeason.year}`);
        render();
    }

    function applyPick(actorId, playerId, slot) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        if (!SLOTS.includes(slot)) return;
        if (currentTeam.roster[slot] !== null) return;

        const candidate = state.currentRoll.players.find((p) => p.id === playerId);
        if (!candidate) return;
        if (!canPlayerFitSlot(candidate, slot)) return;

        currentTeam.roster[slot] = candidate;
        state.currentRoll = null;
        state.selectedPlayerId = null;
        pushHistory(`${currentTeam.name} picked ${candidate.name} → ${slot}`);

        if (state.teams.every((t) => isRosterComplete(t))) {
            state.phase = 'COMPLETE';
        } else {
            state.turnIndex = (state.turnIndex + 1) % 2;
            state.roundCount += 1;
            state.phase = 'ROLL';
        }

        render();
    }

    function applyMatchStart(actorId, matchSeed) {
        // Validate:
        // 1. Draft is complete
        // 2. actorId === ctx.order[0] (Team A)
        // 3. Match has not started yet
        // 4. matchSeed is a valid integer
        if (state.phase !== 'COMPLETE') return;
        if (!state.teams.every((t) => isRosterComplete(t))) return;
        if (actorId !== ctx.order[0]) return;
        if (state.match !== null) return;
        if (typeof matchSeed !== 'number' || !Number.isInteger(matchSeed) || !Number.isSafeInteger(matchSeed)) {
            return;
        }

        const script = generateMatchScript(state.teams[0], state.teams[1], matchSeed);
        const firstEvent = script.events[0];

        state.phase = 'MATCH';
        state.match = {
            matchSeed,
            script,
            revealedCount: 1,
            currentMinute: firstEvent?.minute ?? 1,
            liveScore: { ...(firstEvent?.score ?? { A: 0, B: 0 }) },
            liveStats: {
                A: { ...(firstEvent?.stats?.A ?? script.stats.A) },
                B: { ...(firstEvent?.stats?.B ?? script.stats.B) },
            },
        };

        render();
        startMatchPlayback();
    }

    function startMatchPlayback() {
        stopPlaybackTimer();

        playbackTimer = setInterval(() => {
            if (!root.isConnected || !state.match) {
                stopPlaybackTimer();
                return;
            }

            const { script } = state.match;
            if (state.match.revealedCount < script.events.length) {
                const nextEvent = script.events[state.match.revealedCount];
                state.match.revealedCount += 1;
                state.match.currentMinute = nextEvent.minute;
                state.match.liveScore = { ...nextEvent.score };
                state.match.liveStats = {
                    A: { ...nextEvent.stats.A },
                    B: { ...nextEvent.stats.B },
                };

                if (state.match.revealedCount >= script.events.length) {
                    state.phase = 'RESULT';
                    stopPlaybackTimer();
                }

                render();
                scrollFeedToBottom();
            } else {
                state.phase = 'RESULT';
                stopPlaybackTimer();
                render();
            }
        }, MATCH_SIM_CONFIG.playbackIntervalMs);
    }

    function scrollFeedToBottom() {
        const feedEl = root.querySelector('.fd-match-feed-list');
        if (feedEl) {
            feedEl.scrollTop = feedEl.scrollHeight;
        }
    }

    // ----- User Actions -----

    function handleRollClick() {
        if (!isMyTurn() || state.phase !== 'ROLL') return;
        const chosen = generateInitialRollTeamSeason();
        if (!chosen) return;
        ctx.send({ kind: 'roll', teamSeasonId: chosen.id });
        applyRoll(ctx.me, chosen.id);
    }

    function handleRerollClick(type) {
        if (!isMyTurn() || state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam();
        if (!REROLL_TYPES.includes(type) || currentTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = generateRerollTeamSeason(state.currentRoll, type);
        if (!nextTeamSeason) return;

        ctx.send({ kind: 'reroll', type, teamSeasonId: nextTeamSeason.id });
        applyReroll(ctx.me, type, nextTeamSeason.id);
    }

    function handleSelectCandidate(playerId) {
        if (!isMyTurn() || state.phase !== 'PICK') return;
        state.selectedPlayerId = state.selectedPlayerId === playerId ? null : playerId;
        render();
    }

    function handlePickSlot(playerId, slot) {
        if (!isMyTurn() || state.phase !== 'PICK') return;
        ctx.send({ kind: 'pick', playerId, slot });
        applyPick(ctx.me, playerId, slot);
    }

    function handleMatchStartClick() {
        if (state.phase !== 'COMPLETE' || !isTeamAPlayer() || state.match !== null) return;
        const baseSeed = Number(ctx.seed) || 0;
        const timePart = Date.now() % 1000000000;
        const matchSeed = Math.trunc((baseSeed + timePart) % 2147483647) || 1;

        ctx.send({
            kind: 'match_start',
            matchSeed,
        });
        applyMatchStart(ctx.me, matchSeed);
    }

    // ----- Rendering -----

    function render() {
        root.replaceChildren();

        root.append(renderHeader());

        if (state.opponentLeft) {
            root.append(el('div', 'fd-alert', '対戦相手が退出しました。'));
        }

        const mainGrid = el('div', 'fd-main');
        const teamAPanel = renderTeamPanel(state.teams[0], 0);
        let centerZone;
        if (state.phase === 'COMPLETE') {
            centerZone = renderCompleteZone();
        } else if (state.phase === 'MATCH' || state.phase === 'RESULT') {
            centerZone = renderMatchZone();
        } else {
            centerZone = renderDraftZone();
        }
        const teamBPanel = renderTeamPanel(state.teams[1], 1);

        mainGrid.append(teamAPanel, centerZone, teamBPanel);
        root.append(mainGrid);
    }

    function renderHeader() {
        const header = el('div', 'fd-header');
        const [teamA, teamB] = state.teams;

        const vsRow = el('div', 'fd-vs-row');

        const pA = el(
            'div',
            'fd-vs-player' + (isDraftPhase() && state.turnIndex === 0 ? ' fd-vs-player--active' : '')
        );
        pA.append(
            el('span', 'fd-vs-tag', 'Player A'),
            el('span', 'fd-vs-name', teamA.name + (teamA.id === ctx.me ? ' (YOU)' : ''))
        );

        const vsBadge = el('span', 'fd-vs-badge', 'vs');

        const pB = el(
            'div',
            'fd-vs-player' + (isDraftPhase() && state.turnIndex === 1 ? ' fd-vs-player--active' : '')
        );
        pB.append(
            el('span', 'fd-vs-tag', 'Player B'),
            el('span', 'fd-vs-name', teamB.name + (teamB.id === ctx.me ? ' (YOU)' : ''))
        );

        vsRow.append(pA, vsBadge, pB);

        const turnBar = el('div', 'fd-turn-bar');
        if (state.phase === 'COMPLETE') {
            turnBar.classList.add('fd-turn-bar--complete');
            turnBar.textContent = 'DRAFT COMPLETE — MATCH READY';
        } else if (state.phase === 'MATCH') {
            turnBar.classList.add('fd-turn-bar--match');
            turnBar.textContent = `LIVE MATCH IN PROGRESS — ${state.match?.currentMinute ?? 1}'`;
        } else if (state.phase === 'RESULT') {
            turnBar.classList.add('fd-turn-bar--complete');
            turnBar.textContent = 'FULL TIME — MATCH RESULT';
        } else {
            const cur = getCurrentTeam();
            const stepText = state.phase === 'ROLL' ? 'Step 1: ROLL' : 'Step 2: REROLL OR PICK PLAYER';
            if (cur.id === ctx.me) {
                turnBar.classList.add('fd-turn-bar--mine');
                turnBar.textContent = `あなたのターン (${cur.label}: ${cur.name}) — ${stepText}`;
            } else {
                turnBar.textContent = `${cur.name} (${cur.label}) のターン — ${stepText}`;
            }
        }

        header.append(vsRow, turnBar);
        return header;
    }

    function renderRerollControls(curTeam, currentRoll, myTurn) {
        const box = el('div', 'fd-reroll-box');
        const btnRow = el('div', 'fd-reroll-row');
        let noYearHint = false;

        for (const type of REROLL_TYPES) {
            const remaining = curTeam.rerolls[type];
            const used = remaining <= 0;
            const hasOption = hasRerollOption(currentRoll, type);

            let btnText = `${REROLL_LABELS[type]} ×${remaining}`;
            if (used) {
                btnText = `${REROLL_LABELS[type]} — USED`;
            }

            let btnClass = 'fd-reroll-btn';
            if (used) btnClass += ' fd-reroll-btn--used';
            else if (!hasOption) btnClass += ' fd-reroll-btn--no-option';

            const btn = el('button', btnClass, btnText);
            btn.disabled = !myTurn || used || !hasOption;

            if (!used && !hasOption && type === 'year') {
                noYearHint = true;
            }

            btn.addEventListener('click', () => handleRerollClick(type));
            btnRow.append(btn);
        }

        box.append(btnRow);

        if (noYearHint) {
            box.append(
                el(
                    'div',
                    'fd-reroll-hint',
                    `※ ${currentRoll.club} は他年度のシーズンデータが登録されていないため Year Reroll できません`
                )
            );
        }

        return box;
    }

    function renderHistoryBox() {
        const box = el('div', 'fd-history');
        box.append(el('div', 'fd-history-title', 'RECENT HISTORY'));

        if (state.history.length === 0) {
            box.append(el('div', 'fd-history-empty', 'No actions yet.'));
            return box;
        }

        const list = el('div', 'fd-history-list');
        for (const item of state.history) {
            list.append(el('div', 'fd-history-item', item));
        }
        box.append(list);
        return box;
    }

    function renderPlayerMiniStats(player) {
        const statsRow = el('div', 'fd-card-stats');
        if (player.positions.includes('GK')) {
            statsRow.append(
                el('span', 'fd-stat', `GK ${player.goalkeeping}`),
                el('span', 'fd-stat', `DEF ${player.defense}`),
                el('span', 'fd-stat', `PHY ${player.physical}`),
                el('span', 'fd-stat', `CRE ${player.creation}`)
            );
        } else {
            statsRow.append(
                el('span', 'fd-stat', `ATK ${player.attack}`),
                el('span', 'fd-stat', `CRE ${player.creation}`),
                el('span', 'fd-stat', `DEF ${player.defense}`),
                el('span', 'fd-stat', `PHY ${player.physical}`)
            );
        }
        return statsRow;
    }

    function renderDraftZone() {
        const zone = el('div', 'fd-center');
        const cur = getCurrentTeam();
        const myTurn = isMyTurn();

        const pickCounter = el('div', 'fd-pick-counter', `PICK ${state.roundCount} / 10`);
        zone.append(pickCounter);

        if (state.phase === 'ROLL') {
            const rollBox = el('div', 'fd-roll-box');
            const promptText = myTurn
                ? 'ROLLボタンを押してクラブとシーズンを抽選してください'
                : `${cur.name} が ROLL するのを待っています...`;
            rollBox.append(el('p', 'fd-roll-prompt', promptText));

            const rollBtn = el('button', 'fd-roll-btn', 'ROLL');
            rollBtn.disabled = !myTurn;
            rollBtn.addEventListener('click', handleRollClick);
            rollBox.append(rollBtn);

            zone.append(rollBox, renderHistoryBox());
            return zone;
        }

        // Phase === 'PICK'
        const roll = state.currentRoll;
        const rollInfo = el('div', 'fd-roll-result');

        const leagueItem = el('div', 'fd-roll-meta');
        leagueItem.append(el('span', 'fd-meta-label', 'LEAGUE'), el('strong', 'fd-meta-val', roll.league));

        const clubItem = el('div', 'fd-roll-meta');
        clubItem.append(el('span', 'fd-meta-label', 'CLUB'), el('strong', 'fd-meta-val', roll.club));

        const yearItem = el('div', 'fd-roll-meta');
        yearItem.append(el('span', 'fd-meta-label', 'YEAR'), el('strong', 'fd-meta-val', String(roll.year)));

        rollInfo.append(leagueItem, clubItem, yearItem);
        zone.append(rollInfo);

        // Reroll Controls right under Roll Result
        zone.append(renderRerollControls(cur, roll, myTurn));

        const guide = el(
            'div',
            'fd-pick-guide',
            myTurn
                ? '選手カードを選択し、配置するポジションボタンを押してください'
                : `${cur.name} が選手を選択しています...`
        );
        zone.append(guide);

        const cardsGrid = el('div', 'fd-cards-grid');
        for (const player of roll.players) {
            const availableSlots = getAvailableSlotsForPlayer(cur.roster, player);
            const isSelected = state.selectedPlayerId === player.id;
            const hasSlots = availableSlots.length > 0;
            const ovr = getPlayerOverall(player);

            let cardClass = 'fd-card';
            if (isSelected) cardClass += ' fd-card--selected';
            if (!hasSlots) cardClass += ' fd-card--disabled';
            if (myTurn && hasSlots) cardClass += ' fd-card--interactive';

            const card = el('div', cardClass);
            const topRow = el('div', 'fd-card-top');
            topRow.append(
                el('span', 'fd-card-pos', player.positions.join(' / ')),
                el('span', 'fd-card-rating', `Rating ${ovr}`)
            );

            const nameEl = el('div', 'fd-card-name', player.name);
            card.append(topRow, nameEl, renderPlayerMiniStats(player));

            if (myTurn && hasSlots) {
                card.addEventListener('click', () => handleSelectCandidate(player.id));
            } else if (!hasSlots) {
                card.append(el('div', 'fd-card-noslot', '空き枠なし'));
            }

            if (myTurn && isSelected && hasSlots) {
                const slotBar = el('div', 'fd-slot-actions');
                slotBar.append(el('span', 'fd-slot-prompt', '配置枠を選択:'));
                const btnGroup = el('div', 'fd-slot-btns');
                for (const slot of availableSlots) {
                    const slotBtn = el('button', 'fd-slot-btn', slot);
                    slotBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        handlePickSlot(player.id, slot);
                    });
                    btnGroup.append(slotBtn);
                }
                slotBar.append(btnGroup);
                card.append(slotBar);
            }

            cardsGrid.append(card);
        }

        zone.append(cardsGrid, renderHistoryBox());
        return zone;
    }

    function renderProfileCard(team, rating, profile) {
        const card = el('div', 'fd-complete-rating-card');
        card.append(
            el('div', 'fd-complete-team-name', `${team.label} (${team.name})`),
            el('div', 'fd-complete-rating-text', `Overall Rating: ${rating}`)
        );

        const metrics = el('div', 'fd-profile-metrics');
        const items = [
            ['ATK', profile.attack],
            ['CRE', profile.creation],
            ['DEF', profile.defense],
            ['PHY', profile.physical],
            ['GK', profile.goalkeeping],
        ];
        for (const [label, val] of items) {
            const chip = el('span', 'fd-profile-chip', `${label} ${Math.round(val)}`);
            metrics.append(chip);
        }
        card.append(metrics);
        return card;
    }

    function renderCompleteZone() {
        const zone = el('div', 'fd-center fd-complete-zone');
        const [teamA, teamB] = state.teams;
        const ratingA = calculateTeamRating(teamA);
        const ratingB = calculateTeamRating(teamB);
        const profileA = calculateTeamProfile(teamA);
        const profileB = calculateTeamProfile(teamB);

        const banner = el('h2', 'fd-complete-title', 'DRAFT COMPLETE');
        const sub = el('p', 'fd-complete-sub', 'MATCH READY — 両チームの5人制ロスターが確定しました');

        const summaryBox = el('div', 'fd-complete-ratings');
        summaryBox.append(
            renderProfileCard(teamA, ratingA, profileA),
            renderProfileCard(teamB, ratingB, profileB)
        );

        zone.append(banner, sub, summaryBox);

        if (isTeamAPlayer()) {
            const matchBtn = el('button', 'fd-match-btn', 'MATCH');
            matchBtn.addEventListener('click', handleMatchStartClick);
            zone.append(matchBtn);
        } else {
            const waitNotice = el(
                'div',
                'fd-match-wait',
                `等待 Team A (${teamA.name}) 开始比赛...`
            );
            zone.append(waitNotice);
        }

        zone.append(renderHistoryBox());
        return zone;
    }

    function renderMatchZone() {
        const zone = el('div', 'fd-center fd-match-zone');
        const [teamA, teamB] = state.teams;
        const match = state.match;
        if (!match) return zone;

        const isFinished = state.phase === 'RESULT';
        const score = isFinished ? match.script.finalScore : match.liveScore;
        const stats = isFinished ? match.script.stats : match.liveStats;
        const minute = isFinished ? 90 : match.currentMinute;
        const minuteStr = String(minute).padStart(2, '0') + "'";

        // 1. Scoreboard Header
        const scoreboard = el('div', 'fd-scoreboard');

        const sideA = el('div', 'fd-score-team fd-score-team--a');
        sideA.append(
            el('div', 'fd-score-label', 'TEAM A'),
            el('div', 'fd-score-player', teamA.name)
        );

        const scoreCenter = el('div', 'fd-score-center');
        const scoreNumbers = el('div', 'fd-score-numbers', `${score.A} - ${score.B}`);
        const clockWrap = el('div', 'fd-clock-wrap');
        clockWrap.append(
            el('span', 'fd-clock-label', isFinished ? 'FULL TIME' : 'MATCH CLOCK'),
            el('span', 'fd-clock-val' + (isFinished ? ' fd-clock-val--ft' : ''), minuteStr)
        );
        scoreCenter.append(scoreNumbers, clockWrap);

        const sideB = el('div', 'fd-score-team fd-score-team--b');
        sideB.append(
            el('div', 'fd-score-label', 'TEAM B'),
            el('div', 'fd-score-player', teamB.name)
        );

        scoreboard.append(sideA, scoreCenter, sideB);
        zone.append(scoreboard);

        // Progress Bar
        const progressTrack = el('div', 'fd-clock-progress');
        const progressFill = el('div', 'fd-clock-progress-fill');
        progressFill.style.width = `${clamp((minute / 90) * 100, 0, 100)}%`;
        progressTrack.append(progressFill);
        zone.append(progressTrack);

        // 2. Result Winner Banner + Full Statistics Table when FULL TIME
        if (isFinished) {
            let resultText = 'DRAW';
            let resultClass = 'fd-winner-banner fd-winner-banner--draw';
            if (score.A > score.B) {
                resultText = `WINNER: TEAM A (${teamA.name})`;
                resultClass = 'fd-winner-banner fd-winner-banner--win';
            } else if (score.B > score.A) {
                resultText = `WINNER: TEAM B (${teamB.name})`;
                resultClass = 'fd-winner-banner fd-winner-banner--win';
            }
            zone.append(el('div', resultClass, resultText));
            zone.append(renderMatchStatsBox(stats, score, true));
        }

        // 3. Match Center Event Feed
        const feedBox = el('div', 'fd-match-center');
        const feedHeader = el('div', 'fd-match-center-head');
        feedHeader.append(
            el('span', 'fd-match-center-title', 'MATCH CENTER'),
            el(
                'span',
                'fd-match-center-sub',
                isFinished
                    ? `All ${match.script.events.length} events completed`
                    : `Live Feed (${match.revealedCount}/${match.script.events.length})`
            )
        );
        feedBox.append(feedHeader);

        const feedList = el('div', 'fd-match-feed-list');
        const visibleEvents = match.script.events.slice(0, match.revealedCount);

        for (let i = 0; i < visibleEvents.length; i++) {
            const ev = visibleEvents[i];
            const isLatest = !isFinished && i === visibleEvents.length - 1;
            let itemClass = `fd-feed-item fd-feed-item--${ev.type}`;
            if (isLatest) itemClass += ' fd-feed-item--latest';

            const row = el('div', itemClass);
            const minTag = el('span', 'fd-feed-min', `${String(ev.minute).padStart(2, '0')}'`);
            const badge = el('span', `fd-feed-badge fd-feed-badge--${ev.type}`, ev.badge);

            const body = el('div', 'fd-feed-body');
            if (ev.team) {
                const teamChip = el(
                    'span',
                    `fd-feed-team fd-feed-team--${ev.team.toLowerCase()}`,
                    `TEAM ${ev.team}`
                );
                body.append(teamChip);
            }
            body.append(el('span', 'fd-feed-text', ev.text));

            row.append(minTag, badge, body);
            feedList.append(row);
        }

        feedBox.append(feedList);
        zone.append(feedBox);

        // Live compact stats during MATCH phase
        if (!isFinished) {
            zone.append(renderMatchStatsBox(stats, score, false));
        }

        return zone;
    }

    function renderMatchStatsBox(stats, score, isFullTime) {
        const box = el('div', 'fd-stats-box' + (isFullTime ? ' fd-stats-box--ft' : ''));
        box.append(
            el('div', 'fd-stats-title', isFullTime ? 'MATCH STATISTICS' : 'LIVE STATS')
        );

        const headerRow = el('div', 'fd-stats-row fd-stats-row--head');
        headerRow.append(
            el('span', 'fd-stats-val fd-stats-val--a', 'TEAM A'),
            el('span', 'fd-stats-label', ''),
            el('span', 'fd-stats-val fd-stats-val--b', 'TEAM B')
        );
        box.append(headerRow);

        const rows = [
            ['Goals', score.A, score.B],
            ['Possession', `${stats.A.possession}%`, `${stats.B.possession}%`],
            ['Shots', stats.A.shots, stats.B.shots],
            ['On Target', stats.A.shotsOnTarget, stats.B.shotsOnTarget],
            ['Saves', stats.A.saves, stats.B.saves],
        ];

        for (const [label, valA, valB] of rows) {
            const row = el('div', 'fd-stats-row');
            row.append(
                el('span', 'fd-stats-val fd-stats-val--a', String(valA)),
                el('span', 'fd-stats-label', label),
                el('span', 'fd-stats-val fd-stats-val--b', String(valB))
            );
            box.append(row);
        }

        return box;
    }

    function renderTeamPanel(teamState, idx) {
        const isCurrent = isDraftPhase() && state.turnIndex === idx;
        const panel = el('div', 'fd-team-panel' + (isCurrent ? ' fd-team-panel--active' : ''));

        const head = el('div', 'fd-team-head');
        const titleWrap = el('div', 'fd-team-title-wrap');
        titleWrap.append(
            el('div', 'fd-team-label', teamState.label),
            el('div', 'fd-team-player', teamState.name + (teamState.id === ctx.me ? ' (YOU)' : ''))
        );

        const ratingVal = calculateTeamRating(teamState);
        const ratingBadge = el(
            'div',
            'fd-team-rating',
            `Team Rating: ${ratingVal > 0 ? ratingVal : '---'} (${getPickedCount(teamState)}/5)`
        );

        const rerollChips = el('div', 'fd-team-rerolls');
        for (const type of REROLL_TYPES) {
            const left = teamState.rerolls[type];
            const shortName = type.charAt(0).toUpperCase() + type.slice(1);
            const chip = el(
                'span',
                'fd-reroll-chip' + (left <= 0 ? ' fd-reroll-chip--used' : ''),
                left > 0 ? `${shortName} ×1` : `${shortName}: USED`
            );
            rerollChips.append(chip);
        }

        head.append(titleWrap, ratingBadge, rerollChips);
        panel.append(head);

        const slotList = el('div', 'fd-slot-list');
        for (const slot of SLOTS) {
            const p = teamState.roster[slot];
            const row = el('div', 'fd-slot-row' + (p ? ' fd-slot-row--filled' : ''));
            row.append(el('span', 'fd-slot-tag', slot));

            if (p) {
                const info = el('div', 'fd-slot-player');
                info.append(
                    el('span', 'fd-slot-player-name', p.name),
                    el('span', 'fd-slot-player-meta', `${p.club} '${String(p.year).slice(-2)}`)
                );
                row.append(info, el('span', 'fd-slot-player-rating', String(getPlayerOverall(p))));
            } else {
                row.append(el('span', 'fd-slot-empty', '---'));
            }
            slotList.append(row);
        }

        panel.append(slotList);
        return panel;
    }

    // ----- Network Handlers -----

    ctx.onMessage(({ from, payload }) => {
        if (!payload || typeof payload !== 'object') return;

        if (payload.kind === 'roll' && typeof payload.teamSeasonId === 'string') {
            applyRoll(from, payload.teamSeasonId);
            return;
        }

        if (
            payload.kind === 'reroll' &&
            typeof payload.type === 'string' &&
            typeof payload.teamSeasonId === 'string'
        ) {
            applyReroll(from, payload.type, payload.teamSeasonId);
            return;
        }

        if (
            payload.kind === 'pick' &&
            typeof payload.playerId === 'string' &&
            typeof payload.slot === 'string'
        ) {
            applyPick(from, payload.playerId, payload.slot);
            return;
        }

        if (payload.kind === 'match_start') {
            applyMatchStart(from, payload.matchSeed);
        }
    });

    ctx.onPlayers((list) => {
        const stillHere = state.teams.every((t) => list.some((p) => p.id === t.id));
        if (!stillHere) {
            state.opponentLeft = true;
            render();
        }
    });

    render();
}

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

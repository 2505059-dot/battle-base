// Pure Match Simulation v0 Engine (deterministic, no DOM or network side effects)

import { SLOTS } from '../shared/constants.js';
import { clamp } from '../shared/math.js';
import { createRng } from './rng.js';
import {
    SHOT_ROLE_WEIGHTS,
    ASSIST_ROLE_WEIGHTS,
    DEFENSE_ROLE_WEIGHTS,
    MATCH_SIM_CONFIG,
    PITCH_ZONES,
} from './config.js';
import { getEffectiveSlotRole, calculateTeamProfile } from './team-profile.js';

export function getRosterEntries(teamOrRoster) {
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

export function selectCreator(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = ASSIST_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const cre = Math.max(20, Number(entry.player.creation) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow(cre / 80, 2.0) * (0.85 + 0.15 * (phy / 80));
    });
}

export function selectShooter(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = SHOT_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const atk = Math.max(15, Number(entry.player.attack) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow(atk / 80, 2.1) * (0.82 + 0.18 * (phy / 80));
    });
}

export function selectAssister(entries, shooterPlayerId, rng) {
    const candidates = entries.filter((e) => e.player.id !== shooterPlayerId);
    if (candidates.length === 0) return null;
    return rng.weightedPick(candidates, (entry) => {
        const roleMult = ASSIST_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const cre = Math.max(20, Number(entry.player.creation) || 50);
        return roleMult * Math.pow(cre / 80, 2.1);
    });
}

export function selectDefender(entries, rng) {
    return rng.weightedPick(entries, (entry) => {
        const roleMult = DEFENSE_ROLE_WEIGHTS[entry.role] ?? 1.0;
        const def = Math.max(20, Number(entry.player.defense) || 50);
        const phy = Math.max(20, Number(entry.player.physical) || 50);
        return roleMult * Math.pow((0.65 * def + 0.35 * phy) / 80, 2.0);
    });
}

export function sampleSortedMinutes(startMin, endMin, count, rng) {
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

export function cloneStatsSnapshot(stats, score) {
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

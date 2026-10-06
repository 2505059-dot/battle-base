// Permanent Bot Framework v1 Smoke & Unit Test Suite
// Validates legal actions, determinism, no-cheating invariants, scoring monotonicity,
// multi-position evaluation, hierarchical reroll EV, and full draft completion.

import assert from 'node:assert/strict';
import { TEAM_SEASONS, findTeamSeason } from '../public/data/team-seasons.js';
import { ROLES, SLOTS, REROLL_TYPES } from '../public/game/shared/constants.js';
import { createInitialState } from '../public/game/state.js';
import {
    createEmptyRoster,
    createInitialRerolls,
    getFirstAvailableSlotForRole,
    isPlayerInRoster,
    isRosterComplete,
    getLegalPickActions,
    getLegalRerollActions,
    getLegalDraftActions,
} from '../public/game/draft/rules.js';
import {
    applyDraftRoll,
    applyDraftReroll,
    applyDraftPick,
    applyDraftLock,
    resolveBotPickSlot,
    applyBotDraftAction,
} from '../public/game/draft/transitions.js';
import {
    BOT_DIFFICULTIES,
    BOT_REASON_CODES,
    NEUTRAL_PERSONA,
    chooseDraftAction,
    toPublicDraftAction,
    scorePlayerForRole,
    scoreMarginalRosterGain,
    estimateRerollValue,
} from '../public/game/bot/decision.js';
import { getRerollOutcomeDistribution } from '../public/game/bot/reroll-value.js';
import { createPersona, resolvePersona } from '../public/game/bot/personas.js';
import { simulateSingleBotDraft } from './simulate-bot-drafts.mjs';

console.log('[smoke-bot-framework] Running Bot Framework v1 verification suite...');

// ---------------------------------------------------------------------------
// 1. Scoring Unit Tests (Section 49) & No-NaN across entire dataset
// ---------------------------------------------------------------------------
{
    const fw95 = {
        id: 'test-fw-95',
        positions: ['FW'],
        overall: 92,
        attack: 95,
        creation: 82,
        defense: 35,
        physical: 84,
        goalkeeping: 10,
    };
    const fw70 = {
        id: 'test-fw-70',
        positions: ['FW'],
        overall: 75,
        attack: 70,
        creation: 82,
        defense: 35,
        physical: 84,
        goalkeeping: 10,
    };
    assert(
        scorePlayerForRole(fw95, 'FW') > scorePlayerForRole(fw70, 'FW'),
        '95 ATK FW must score higher than 70 ATK FW'
    );

    const mf95 = {
        id: 'test-mf-95',
        positions: ['MF'],
        overall: 91,
        attack: 78,
        creation: 95,
        defense: 70,
        physical: 80,
        goalkeeping: 10,
    };
    const mf70 = {
        id: 'test-mf-70',
        positions: ['MF'],
        overall: 76,
        attack: 78,
        creation: 70,
        defense: 70,
        physical: 80,
        goalkeeping: 10,
    };
    assert(
        scorePlayerForRole(mf95, 'MF') > scorePlayerForRole(mf70, 'MF'),
        '95 CRE MF must score higher than 70 CRE MF'
    );

    const df95 = {
        id: 'test-df-95',
        positions: ['DF'],
        overall: 91,
        attack: 45,
        creation: 68,
        defense: 95,
        physical: 86,
        goalkeeping: 10,
    };
    const df70 = {
        id: 'test-df-70',
        positions: ['DF'],
        overall: 76,
        attack: 45,
        creation: 68,
        defense: 70,
        physical: 86,
        goalkeeping: 10,
    };
    assert(
        scorePlayerForRole(df95, 'DF') > scorePlayerForRole(df70, 'DF'),
        '95 DEF DF must score higher than 70 DEF DF'
    );

    const gk95 = {
        id: 'test-gk-95',
        positions: ['GK'],
        overall: 92,
        attack: 15,
        creation: 40,
        defense: 48,
        physical: 82,
        goalkeeping: 95,
    };
    const gk70 = {
        id: 'test-gk-70',
        positions: ['GK'],
        overall: 74,
        attack: 15,
        creation: 40,
        defense: 48,
        physical: 82,
        goalkeeping: 70,
    };
    assert(
        scorePlayerForRole(gk95, 'GK') > scorePlayerForRole(gk70, 'GK'),
        '95 GK must score higher than 70 GK'
    );

    // Multi-position DF/MF player has distinct scores in DF and MF
    const multiDfMf = {
        id: 'test-multi-df-mf',
        positions: ['DF', 'MF'],
        overall: 88,
        attack: 62,
        creation: 74,
        defense: 92,
        physical: 88,
        goalkeeping: 12,
    };
    const scoreAsDf = scorePlayerForRole(multiDfMf, 'DF');
    const scoreAsMf = scorePlayerForRole(multiDfMf, 'MF');
    assert.notEqual(scoreAsDf, scoreAsMf, 'DF/MF multi-position player should have distinct role scores');
    assert(scoreAsDf > scoreAsMf, 'Defensive multi-position player should score higher in DF than MF');

    // Illegal role returns 0
    assert.equal(
        scorePlayerForRole(fw95, 'DF'),
        0,
        '90+ OVR FW must score 0 for an illegal DF role'
    );

    // Verify no NaN across all 554 players in dataset and all difficulties
    for (const ts of TEAM_SEASONS) {
        for (const p of ts.players) {
            for (const role of ROLES) {
                for (const diff of BOT_DIFFICULTIES) {
                    const s = scorePlayerForRole(p, role, { difficulty: diff, persona: 'neutral' });
                    assert(!Number.isNaN(s), `NaN score detected for ${p.id} in ${role} (${diff})`);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Reroll EV Unit Tests & Hierarchical Probability Tree (Sections 23-27, 50)
// ---------------------------------------------------------------------------
{
    const sampleRoll = TEAM_SEASONS[0];
    for (const rerollType of REROLL_TYPES) {
        const dist = getRerollOutcomeDistribution(sampleRoll, rerollType);
        if (dist.length > 0) {
            const probSum = dist.reduce((acc, item) => acc + item.probability, 0);
            assert(
                Math.abs(probSum - 1.0) < 1e-9,
                `Reroll distribution for ${rerollType} must sum to 1.0 (got ${probSum})`
            );
        }
    }

    // Scenario A: Extremely strong current candidate -> Expert MUST pick, not reroll
    const eliteRoll = {
        id: 'synthetic-elite-roll',
        league: sampleRoll.league,
        club: sampleRoll.club,
        year: sampleRoll.year,
        players: [
            {
                id: 'superstar-fw',
                name: 'Superstar FW',
                positions: ['FW'],
                overall: 96,
                attack: 97,
                creation: 92,
                defense: 45,
                physical: 90,
                goalkeeping: 10,
            },
        ],
    };
    const teamWithEliteCandidate = {
        id: 'bot-a',
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: {
            phase: 'PICK',
            currentRoll: eliteRoll,
            locked: false,
            history: [],
        },
    };
    const decisionA = chooseDraftAction({
        team: teamWithEliteCandidate,
        difficulty: 'expert',
        persona: 'neutral',
        decisionSeed: 42,
    });
    assert.equal(decisionA.type, 'pick', 'Expert should pick when holding an elite 96 OVR candidate');
    assert.equal(decisionA.playerId, 'superstar-fw');
    assert.equal(decisionA.role, 'FW');
    assert.equal(decisionA.debug.reasonCode, BOT_REASON_CODES.PICK_BEST_VALUE);

    // Scenario B: Very weak current candidate + high-EV reroll available -> Expert MUST reroll
    const weakRoll = {
        id: 'synthetic-weak-roll',
        league: sampleRoll.league,
        club: sampleRoll.club,
        year: sampleRoll.year,
        players: [
            {
                id: 'weak-fw',
                name: 'Weak FW',
                positions: ['FW'],
                overall: 60,
                attack: 58,
                creation: 55,
                defense: 30,
                physical: 60,
                goalkeeping: 10,
            },
        ],
    };
    const teamWithWeakCandidate = {
        id: 'bot-a',
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: {
            phase: 'PICK',
            currentRoll: weakRoll,
            locked: false,
            history: [],
        },
    };
    const decisionB = chooseDraftAction({
        team: teamWithWeakCandidate,
        difficulty: 'expert',
        persona: 'neutral',
        decisionSeed: 42,
    });
    assert.equal(
        decisionB.type,
        'reroll',
        'Expert should reroll when best candidate is 60 OVR and rerolls are available'
    );
    assert(REROLL_TYPES.includes(decisionB.rerollType));

    // Scenario C: Late draft (10/11), only GK missing, current roll has a decent 82 OVR GK -> Expert picks!
    const roster10of11 = createEmptyRoster();
    const fillPlayers = TEAM_SEASONS.slice(0, 4).flatMap((t) => t.players);
    for (const slot of SLOTS) {
        if (slot === 'GK1') continue;
        const role = slot.slice(0, 2);
        const match = fillPlayers.find(
            (p) => p.positions.includes(role) && !isPlayerInRoster(roster10of11, p)
        );
        roster10of11[slot] = match;
    }

    const decentGkRoll = {
        id: 'synthetic-decent-gk-roll',
        league: sampleRoll.league,
        club: sampleRoll.club,
        year: sampleRoll.year,
        players: [
            {
                id: 'decent-gk-82',
                name: 'Decent GK',
                positions: ['GK'],
                overall: 82,
                attack: 18,
                creation: 42,
                defense: 48,
                physical: 80,
                goalkeeping: 83,
            },
        ],
    };
    const team10of11 = {
        id: 'bot-a',
        roster: roster10of11,
        rerolls: { league: 1, club: 1, year: 1 },
        draft: {
            phase: 'PICK',
            currentRoll: decentGkRoll,
            locked: false,
            history: [],
        },
    };
    const decisionC = chooseDraftAction({
        team: team10of11,
        difficulty: 'expert',
        persona: 'neutral',
        decisionSeed: 99,
    });
    assert.equal(
        decisionC.type,
        'pick',
        'Expert at 10/11 missing only GK must pick a decent 82 OVR GK rather than gambling a reroll'
    );
    assert.equal(decisionC.playerId, 'decent-gk-82');
    assert.equal(decisionC.role, 'GK');
    assert.equal(decisionC.debug.reasonCode, BOT_REASON_CODES.PICK_ROLE_URGENT);
}

// ---------------------------------------------------------------------------
// 3. Determinism, Seed Sensitivity, Role-not-Slot, Duplicate & Full-Role Guards
// ---------------------------------------------------------------------------
{
    const roll = TEAM_SEASONS[2];
    const team = {
        id: 'bot-a',
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: {
            phase: 'PICK',
            currentRoll: roll,
            locked: false,
            history: [],
        },
    };

    for (const diff of BOT_DIFFICULTIES) {
        const a1 = chooseDraftAction({
            team,
            difficulty: diff,
            persona: 'neutral',
            decisionSeed: 20261006,
        });
        const a2 = chooseDraftAction({
            team,
            difficulty: diff,
            persona: 'neutral',
            decisionSeed: 20261006,
        });
        assert.deepStrictEqual(
            a1,
            a2,
            `Deterministic decisionSeed must produce identical action for difficulty=${diff}`
        );
        assert.equal(a1.debug.reasonCode, a2.debug.reasonCode);

        // Verify public payload has no debug leak when serialized
        const serialized = JSON.parse(JSON.stringify(a1));
        assert(!('debug' in serialized), 'Serialized action must not leak debug metadata');
        assert.deepStrictEqual(serialized, toPublicDraftAction(a1));
    }

    // Verify different decisionSeeds can produce different choices on random & casual
    const randomChoices = new Set();
    const casualChoices = new Set();
    for (let seed = 1; seed <= 50; seed++) {
        const rAct = chooseDraftAction({
            team,
            difficulty: 'random',
            persona: 'neutral',
            decisionSeed: seed,
        });
        randomChoices.add(JSON.stringify(rAct));

        const cAct = chooseDraftAction({
            team,
            difficulty: 'casual',
            persona: 'neutral',
            decisionSeed: seed,
        });
        casualChoices.add(JSON.stringify(cAct));
    }
    assert(randomChoices.size > 1, 'Random bot should vary choices across different decisionSeeds');
    assert(casualChoices.size > 1, 'Casual bot should vary choices across different decisionSeeds');

    // Verify Bot cannot pick duplicate or full role, and 10/11 does not lock while 11/11 locks
    const rosterWithFullGk = createEmptyRoster();
    const gkPlayer = roll.players.find((p) => p.positions.includes('GK'));
    rosterWithFullGk.GK1 = gkPlayer;

    const teamFullGk = {
        id: 'bot-a',
        roster: rosterWithFullGk,
        rerolls: { league: 0, club: 0, year: 0 },
        draft: {
            phase: 'PICK',
            currentRoll: roll,
            locked: false,
            history: [],
        },
    };

    for (const diff of BOT_DIFFICULTIES) {
        const act = chooseDraftAction({
            team: teamFullGk,
            difficulty: diff,
            persona: 'neutral',
            decisionSeed: 777,
        });
        assert.equal(act.type, 'pick');
        assert.notEqual(act.playerId, gkPlayer.id, 'Bot must never pick a duplicate player');
        assert.notEqual(act.role, 'GK', 'Bot must never pick a role whose slots are all full');
        assert(ROLES.includes(act.role), 'Bot pick must return abstract role (GK/DF/MF/FW)');
        assert(!('slot' in act), 'Bot pick must not return concrete slot');

        const concreteSlot = resolveBotPickSlot(teamFullGk.roster, act);
        assert(SLOTS.includes(concreteSlot), 'Driver must resolve concrete slot from role');
    }

    // 10/11 cannot lock; 11/11 READY must lock
    const roster11 = { ...rosterWithFullGk };
    const pool = TEAM_SEASONS.flatMap((t) => t.players);
    for (const slot of SLOTS) {
        if (slot === 'GK1') continue;
        const role = slot.slice(0, 2);
        roster11[slot] = pool.find(
            (p) => p.positions.includes(role) && !isPlayerInRoster(roster11, p)
        );
    }
    const roster10 = { ...roster11, FW3: null };
    const team10 = {
        id: 'bot-a',
        roster: roster10,
        rerolls: createInitialRerolls(),
        draft: { phase: 'ROLL', currentRoll: null, locked: false, history: [] },
    };
    const act10 = chooseDraftAction({ team: team10, difficulty: 'expert', decisionSeed: 1 });
    assert.notEqual(act10.type, 'lock', 'Bot at 10/11 must not lock');
    assert.equal(act10.type, 'roll');

    const team11Ready = {
        id: 'bot-a',
        roster: roster11,
        rerolls: createInitialRerolls(),
        draft: { phase: 'READY', currentRoll: null, locked: false, history: [] },
    };
    assert(isRosterComplete(team11Ready));
    for (const diff of BOT_DIFFICULTIES) {
        const lockAct = chooseDraftAction({
            team: team11Ready,
            difficulty: diff,
            decisionSeed: 1,
        });
        assert.deepStrictEqual(lockAct, { type: 'lock' });
        assert.equal(lockAct.debug.reasonCode, BOT_REASON_CODES.LOCK_COMPLETE);
    }
}

// ---------------------------------------------------------------------------
// 4. No-Cheating Invariants (No Opponent Access, No Math.random / Future Roll Peek)
// ---------------------------------------------------------------------------
{
    const state = createInitialState({
        seed: 12345,
        order: ['bot-a', 'human-b'],
        players: [
            { id: 'bot-a', name: 'Bot A' },
            { id: 'human-b', name: 'Human B' },
        ],
    });
    applyDraftRoll(state, 'bot-a', TEAM_SEASONS[0].id);

    // Trap opponent team with a Proxy that throws on any property read
    const trappedOpponent = new Proxy(state.teams[1], {
        get() {
            throw new Error('CHEAT DETECTED: Bot attempted to access opponent team state!');
        },
    });
    state.teams[1] = trappedOpponent;

    // Trap Math.random to verify chooseDraftAction never invokes Math.random()
    const origMathRandom = Math.random;
    Math.random = () => {
        throw new Error('NON-DETERMINISM DETECTED: Bot called Math.random() during decision!');
    };

    try {
        for (const diff of BOT_DIFFICULTIES) {
            const action = chooseDraftAction({
                team: state.teams[0],
                difficulty: diff,
                persona: 'neutral',
                decisionSeed: 98765,
            });
            assert(action && (action.type === 'pick' || action.type === 'reroll'));
        }
    } finally {
        Math.random = origMathRandom;
    }
}

// ---------------------------------------------------------------------------
// 5. Persona Neutral & Extensibility Check + Full Draft Completion
// ---------------------------------------------------------------------------
{
    assert.equal(resolvePersona('neutral'), NEUTRAL_PERSONA);
    const customPersona = createPersona({
        id: 'test-attack-coach',
        name: 'Test Attack Coach',
        roleWeights: { GK: 1.0, DF: 0.95, MF: 1.05, FW: 1.1 },
        attributeMultipliers: {
            attack: 1.15,
            creation: 1.1,
            defense: 0.95,
            physical: 1.0,
            goalkeeping: 1.0,
            overall: 1.0,
        },
        balancePreference: 0.9,
        riskPreference: 0.2,
        starPreference: 0.3,
    });
    assert.equal(customPersona.id, 'test-attack-coach');

    for (const diff of BOT_DIFFICULTIES) {
        const res = simulateSingleBotDraft({
            seed: 20261006,
            difficulty: diff,
            persona: 'neutral',
        });
        assert(res.completed, `Full draft must complete for difficulty=${diff}`);
        assert.equal(res.duplicateViolations, 0, `0 duplicates required for difficulty=${diff}`);
        assert.equal(res.invalidActions, 0, `0 invalid actions required for difficulty=${diff}`);
    }
}

console.log(
    '[smoke-bot-framework] PASS — All legal action, determinism, no-cheating, scoring, reroll EV, persona, and full draft checks succeeded.'
);

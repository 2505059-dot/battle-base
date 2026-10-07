// Comprehensive regression & smoke test for Concurrent Blind Draft (11v11 Abstract 4-3-3)
// Simulates two connected clients (Client A & Client B) through:
// - Concurrent ROLL / REROLL / PICK in different phases simultaneously
// - Blind UI verification (no opponent player/club/year/rating/reroll/history leakage in DOM before REVEAL; compact role progress shown)
// - Asymmetric completion (A reaches 11/11 READY & LOCKED while B is at 6/11 and continues drafting remaining 5 players)
// - Security & validation guards (unknown sender, premature lock at <11/11, post-lock actions, filled slot overwrite, duplicate player.id)
// - Dual LOCK -> automatic REVEAL transition with full 22-player disclosure on both clients
// - Per-team structured history consistency (with actorId) across both clients
// - Match start validation (Team B rejected, Team A accepted) + deterministic Match Script + multi-locale switching
// - Opponent left handling during Draft

import assert from 'node:assert/strict';
import { TEAM_SEASONS, TEAM_SEASON_MAP } from '../public/data/team-seasons.js';
import { setLocale, getLocale, t } from '../public/i18n/i18n.js';
import { ROSTER_SLOTS, SLOTS, getSlotRole } from '../public/game/shared/constants.js';
import {
    getFirstAvailableSlotForRole,
    isPlayerInRoster,
    isPlayerEntityInRoster,
} from '../public/game/draft/rules.js';
import { startGame } from '../public/game/controller.js';
import { generateMatchScript } from '../public/game/match/engine.js';
import { buildSample11PlayerRoster } from '../public/game/match/simulator.js';

// ----- Minimal Headless DOM Shim for Controller & UI Rendering -----

class FakeClassList {
    constructor(owner) {
        this.owner = owner;
        this.set = new Set();
    }
    syncFromClassName(cls) {
        this.set = new Set(String(cls || '').split(/\s+/).filter(Boolean));
    }
    syncToClassName() {
        this.owner._className = Array.from(this.set).join(' ');
    }
    add(...tokens) {
        for (const tok of tokens) {
            for (const part of String(tok).split(/\s+/).filter(Boolean)) {
                this.set.add(part);
            }
        }
        this.syncToClassName();
    }
    contains(tok) {
        return this.set.has(tok);
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this._className = '';
        this.classList = new FakeClassList(this);
        this._textContent = '';
        this.children = [];
        this.parentNode = null;
        this.listeners = new Map();
        this.disabled = false;
        this.hidden = false;
        this.style = {};
        this.scrollTop = 0;
        this.scrollHeight = 100;
    }

    get className() {
        return this._className;
    }
    set className(val) {
        this._className = String(val || '');
        this.classList.syncFromClassName(this._className);
    }

    get textContent() {
        if (this.children.length === 0) return this._textContent;
        return this._textContent + this.children.map((c) => c.textContent).join('');
    }
    set textContent(val) {
        this.children = [];
        this._textContent = String(val ?? '');
    }

    get isConnected() {
        let cur = this;
        while (cur.parentNode) {
            cur = cur.parentNode;
        }
        return Boolean(cur._isRootContainer);
    }

    append(...nodes) {
        for (const node of nodes) {
            if (!node) continue;
            if (typeof node === 'string') {
                const span = new FakeElement('#text');
                span.textContent = node;
                span.parentNode = this;
                this.children.push(span);
            } else {
                node.parentNode = this;
                this.children.push(node);
            }
        }
    }

    replaceChildren(...nodes) {
        for (const child of this.children) {
            child.parentNode = null;
        }
        this.children = [];
        this._textContent = '';
        this.append(...nodes);
    }

    addEventListener(type, fn) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(fn);
    }

    click() {
        if (this.disabled) return;
        const handlers = this.listeners.get('click') || [];
        let stopped = false;
        const event = {
            stopPropagation() {
                stopped = true;
            },
        };
        for (const fn of handlers) {
            fn(event);
        }
        if (!stopped && this.parentNode && typeof this.parentNode.click === 'function') {
            // Only bubble when needed
        }
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector) {
        const results = [];
        const matchSimple = (el, sel) => {
            if (sel.startsWith('.')) {
                const cls = sel.slice(1);
                return el.classList && el.classList.contains(cls);
            }
            return el.tagName === sel.toUpperCase();
        };

        const visit = (node) => {
            for (const child of node.children) {
                if (matchSimple(child, selector)) {
                    results.push(child);
                }
                visit(child);
            }
        };
        visit(this);
        return results;
    }

    dumpText() {
        const parts = [];
        const walk = (node) => {
            if (node._textContent) parts.push(node._textContent);
            for (const c of node.children) walk(c);
        };
        walk(this);
        return parts.join(' | ');
    }
}

globalThis.document = {
    documentElement: { lang: 'ja' },
    createElement(tag) {
        return new FakeElement(tag);
    },
};

// ----- Two-Client Harness & Reusable 11v11 Draft Helpers -----

function createTwoClientHarness(seed = 123456) {
    const players = [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
    ];
    const order = ['p1', 'p2'];

    const areaA = new FakeElement('div');
    areaA._isRootContainer = true;
    const areaB = new FakeElement('div');
    areaB._isRootContainer = true;

    const handlersA = { message: [], players: [] };
    const handlersB = { message: [], players: [] };
    const sentLog = [];

    const ctxA = {
        area: areaA,
        me: 'p1',
        players,
        order,
        seed,
        send(payload) {
            sentLog.push({ from: 'p1', payload });
            for (const fn of handlersB.message) {
                fn({ from: 'p1', payload: structuredClone(payload) });
            }
        },
        onMessage(fn) {
            handlersA.message.push(fn);
        },
        onPlayers(fn) {
            handlersA.players.push(fn);
        },
    };

    const ctxB = {
        area: areaB,
        me: 'p2',
        players,
        order,
        seed,
        send(payload) {
            sentLog.push({ from: 'p2', payload });
            for (const fn of handlersA.message) {
                fn({ from: 'p2', payload: structuredClone(payload) });
            }
        },
        onMessage(fn) {
            handlersB.message.push(fn);
        },
        onPlayers(fn) {
            handlersB.players.push(fn);
        },
    };

    const controllerA = startGame(ctxA);
    const controllerB = startGame(ctxB);

    function dispatchAction(from, payload) {
        for (const fn of handlersA.message) {
            fn({ from, payload: structuredClone(payload) });
        }
        for (const fn of handlersB.message) {
            fn({ from, payload: structuredClone(payload) });
        }
    }

    function notifyPlayers(nextPlayers) {
        for (const fn of handlersA.players) fn(nextPlayers);
        for (const fn of handlersB.players) fn(nextPlayers);
    }

    function getTeamState(actorId) {
        const state = controllerA.getState();
        return state.teams.find((tm) => tm.id === actorId);
    }

    return {
        areaA,
        areaB,
        ctxA,
        ctxB,
        controllerA,
        controllerB,
        handlersA,
        handlersB,
        sentLog,
        dispatchAction,
        notifyPlayers,
        getTeamState,
    };
}

function findCandidateForRole(teamSeason, role, rosterOrUsedIds = {}) {
    const isUsed = (player) => {
        if (rosterOrUsedIds instanceof Set) return rosterOrUsedIds.has(player.id);
        return isPlayerEntityInRoster(rosterOrUsedIds, player);
    };
    for (const p of teamSeason.players) {
        if (isUsed(p)) continue;
        if (p.positions.includes(role)) return p;
    }
    return null;
}

function pickForRole(harness, actorId, teamSeason, role) {
    const team = harness.getTeamState(actorId);
    const slot = getFirstAvailableSlotForRole(team.roster, role);
    assert.ok(slot, `Expected an empty slot for role ${role} on ${actorId}`);

    if (team.draft.phase === 'ROLL') {
        harness.dispatchAction(actorId, { kind: 'roll', teamSeasonId: teamSeason.id });
    }
    const activeRoll = harness.getTeamState(actorId).draft.currentRoll;
    const candidate = findCandidateForRole(activeRoll, role, team.roster);
    assert.ok(candidate, `No candidate for role ${role} in ${activeRoll.id}`);

    harness.dispatchAction(actorId, {
        kind: 'pick',
        playerId: candidate.id,
        slot,
    });
    return { candidate, slot, teamSeason: activeRoll };
}

function fillTeamRoster(harness, actorId, seasonCursorStart = 0, maxCount = SLOTS.length) {
    const pickedRecords = [];
    let cursor = seasonCursorStart;

    for (const slotDef of ROSTER_SLOTS) {
        const team = harness.getTeamState(actorId);
        const currentPicked = SLOTS.filter((s) => Boolean(team.roster[s])).length;
        if (currentPicked >= maxCount) break;
        if (team.roster[slotDef.id] !== null) continue;

        // Find next season in pool that has an unused player for slotDef.role
        let chosenSeason = null;
        for (let attempt = 0; attempt < TEAM_SEASONS.length; attempt++) {
            const candidateSeason = TEAM_SEASONS[(cursor + attempt) % TEAM_SEASONS.length];
            if (findCandidateForRole(candidateSeason, slotDef.role, team.roster)) {
                chosenSeason = candidateSeason;
                cursor = (cursor + attempt + 1) % TEAM_SEASONS.length;
                break;
            }
        }
        assert.ok(chosenSeason, `Could not find season for role ${slotDef.role}`);
        const rec = pickForRole(harness, actorId, chosenSeason, slotDef.role);
        pickedRecords.push(rec);
    }

    return pickedRecords;
}

// ----- Run Smoke & Regression Suite -----

console.log('[smoke-concurrent-draft] Starting 11v11 test suite...');

setLocale('en', { persist: false });

const harness = createTwoClientHarness(90210);
const { areaA, areaB, dispatchAction, notifyPlayers } = harness;

// 1. Initial state verification
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('0 / 11'), 'Client A should show 0 / 11 progress');
    assert.ok(textB.includes('0 / 11'), 'Client B should show 0 / 11 progress');
    assert.ok(textA.includes('HIDDEN'), 'Client A should render blind opponent panel');
    assert.ok(textB.includes('HIDDEN'), 'Client B should render blind opponent panel');
    assert.ok(textA.includes('GK 0 / 1') && textA.includes('DF 0 / 4'), 'Blind panel shows role counts');
    assert.ok(!textA.includes('Your Turn'), 'No turn-based text should exist on Client A');
    assert.ok(!textB.includes('Your Turn'), 'No turn-based text should exist on Client B');
}

// 2. Concurrent Roll & Reroll + Blindness Test (Lionel Messi on A, Kaká on B)
const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');
const barca2015 = TEAM_SEASON_MAP.get('barcelona-2015');
const milan2007 = TEAM_SEASON_MAP.get('ac-milan-2007');
const madrid2017 = TEAM_SEASON_MAP.get('real-madrid-2017');
const juve2017 = TEAM_SEASON_MAP.get('juventus-2017');
const bvb2013 = TEAM_SEASON_MAP.get('borussia-dortmund-2013');
const liv2005 = TEAM_SEASON_MAP.get('liverpool-2005');
const city2023 = TEAM_SEASON_MAP.get('manchester-city-2023');
const chelsea2005 = TEAM_SEASON_MAP.get('chelsea-2005');

assert.ok(
    barca2011 &&
        barca2015 &&
        milan2007 &&
        madrid2017 &&
        juve2017 &&
        bvb2013 &&
        liv2005 &&
        city2023 &&
        chelsea2005
);

// Both A and B roll simultaneously!
dispatchAction('p1', { kind: 'roll', teamSeasonId: barca2015.id });
dispatchAction('p2', { kind: 'roll', teamSeasonId: milan2007.id });

// Verify A is in PICK (seeing Barcelona 2015) while B is simultaneously in PICK (seeing AC Milan 2007)
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('Barcelona') && textA.includes('2015'), 'A sees own roll Barcelona 2015');
    assert.ok(!textA.includes('AC Milan'), 'A must NOT see B current roll AC Milan');
    assert.ok(textB.includes('AC Milan') && textB.includes('2007'), 'B sees own roll AC Milan 2007');
    assert.ok(!textB.includes('Barcelona'), 'B must NOT see A current roll Barcelona');
}

// While B is in PICK, A uses Year Reroll (barcelona-2015 -> barcelona-2011)
dispatchAction('p1', { kind: 'reroll', type: 'year', teamSeasonId: barca2011.id });

// Local card selection isolation test + role buttons verification: Client A clicks a candidate card locally
{
    const firstCardA = areaA.querySelector('.fd-card--interactive');
    assert.ok(firstCardA, 'Client A should have interactive candidate cards');
    firstCardA.click();
    assert.ok(areaA.querySelector('.fd-card--selected'), 'Client A has a selected card');
    assert.equal(areaB.querySelector('.fd-card--selected'), null, 'Client B must NOT have a selected card when A clicks');

    const roleBtns = areaA.querySelectorAll('.fd-slot-btn');
    assert.ok(roleBtns.length > 0, 'Selected candidate card renders role buttons');
    for (const btn of roleBtns) {
        assert.ok(
            ['GK', 'DF', 'MF', 'FW'].includes(btn.textContent),
            `Role button must show role (GK/DF/MF/FW), got ${btn.textContent}`
        );
    }
}

// A picks Lionel Messi into FW1 while B is still in PICK
const messi = barca2011.players.find((p) => p.name === 'Lionel Messi');
assert.ok(messi, 'Lionel Messi must exist in barcelona-2011');
dispatchAction('p1', { kind: 'pick', playerId: messi.id, slot: 'FW1' });

// Verify Blindness on Client B: B's DOM must NOT contain Lionel Messi, Barcelona, 2011, or Messi's rating
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('Lionel Messi'), 'Client A sees own picked player Lionel Messi');
    assert.ok(!textB.includes('Lionel Messi'), 'BLINDNESS VIOLATION: Client B DOM leaked Lionel Messi');
    assert.ok(!textB.includes('Barcelona'), 'BLINDNESS VIOLATION: Client B DOM leaked Barcelona');
    assert.ok(!textB.includes('2011'), 'BLINDNESS VIOLATION: Client B DOM leaked 2011');
    assert.ok(textB.includes('1 / 11'), 'Client B sees that Team A has 1 / 11 selected');
    assert.ok(textB.includes('FW 1 / 3'), 'Client B sees Team A role progress FW 1 / 3');
}

// Now B picks Kaká into MF1 while A is in ROLL
const kaka = milan2007.players.find((p) => p.positions.includes('MF'));
assert.ok(kaka);
dispatchAction('p2', { kind: 'pick', playerId: kaka.id, slot: 'MF1' });

// Verify Blindness on Client A: A's DOM must NOT contain Kaká or AC Milan
{
    const textA = areaA.dumpText();
    assert.ok(!textA.includes(kaka.name), `BLINDNESS VIOLATION: Client A DOM leaked ${kaka.name}`);
    assert.ok(!textA.includes('AC Milan'), 'BLINDNESS VIOLATION: Client A DOM leaked AC Milan');
    assert.ok(textA.includes('MF 1 / 3'), 'Client A sees Team B role progress MF 1 / 3');
}

// 3. Security & Validation Guard Checks
// - Unknown sender 'p999' is ignored
// - Premature draft_lock when A only has 1/11 is ignored
// - Picking into already filled slot 'FW1' for A is ignored
// - Duplicate exact player.id is rejected
dispatchAction('p999', { kind: 'roll', teamSeasonId: madrid2017.id });
dispatchAction('p1', { kind: 'draft_lock' }); // premature lock (1/11)

// A rolls barca2011 again and tries to pick Lionel Messi into FW2 (duplicate player.id!)
dispatchAction('p1', { kind: 'roll', teamSeasonId: barca2011.id });
dispatchAction('p1', { kind: 'pick', playerId: messi.id, slot: 'FW2' }); // must be rejected!
assert.equal(harness.getTeamState('p1').roster.FW2, null, 'Duplicate player.id must be rejected by applyPick');

// A tries to overwrite filled FW1 slot with another FW from barca2011
const otherBarcaFw = barca2011.players.find((p) => p.id !== messi.id && p.positions.includes('FW'));
assert.ok(otherBarcaFw);
dispatchAction('p1', { kind: 'pick', playerId: otherBarcaFw.id, slot: 'FW1' }); // must be rejected!
assert.equal(harness.getTeamState('p1').roster.FW1.id, messi.id, 'Filled FW1 slot must not be overwritten');

// Now A validly picks otherBarcaFw into FW2 (A is now at 2/11)
dispatchAction('p1', { kind: 'pick', playerId: otherBarcaFw.id, slot: 'FW2' });

// 4. Asymmetric Progression:
// B uses League Reroll and Club Reroll and advances to 6/11, while A fills all 11/11 -> READY -> LOCKED
dispatchAction('p2', { kind: 'roll', teamSeasonId: juve2017.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, juve2017.id);
const prevLeagueRerolls = harness.getTeamState('p2').rerolls.league;

// Policy v2 Check: Illegal League jump juve2017 -> bvb2013 (year drift 4 > 0 exact-year) must be rejected
dispatchAction('p2', { kind: 'reroll', type: 'league', teamSeasonId: bvb2013.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, juve2017.id, 'Illegal league jump must be rejected');
assert.equal(harness.getTeamState('p2').rerolls.league, prevLeagueRerolls, 'Rejected reroll must not consume token');

// Legal League Reroll: juve2017 (Serie A 2017) -> madrid2017 (La Liga 2017, exact same year)
dispatchAction('p2', { kind: 'reroll', type: 'league', teamSeasonId: madrid2017.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, madrid2017.id, 'Legal league reroll must update currentRoll');
assert.equal(harness.getTeamState('p2').rerolls.league, prevLeagueRerolls - 1, 'Legal league reroll consumes token');

const bDf1 = findCandidateForRole(madrid2017, 'DF', harness.getTeamState('p2').roster);
assert.ok(bDf1, 'DF candidate must exist in real-madrid-2017');
dispatchAction('p2', { kind: 'pick', playerId: bDf1.id, slot: 'DF1' }); // B: 2/11
assert.equal(harness.getTeamState('p2').roster.DF1.id, bDf1.id);

dispatchAction('p2', { kind: 'roll', teamSeasonId: liv2005.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, liv2005.id);
const prevClubRerolls = harness.getTeamState('p2').rerolls.club;

// Policy v2 Check: Illegal Club jump liv2005 -> city2023 (drift 18 > 3) must be rejected
dispatchAction('p2', { kind: 'reroll', type: 'club', teamSeasonId: city2023.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, liv2005.id, 'Illegal club jump must be rejected');
assert.equal(harness.getTeamState('p2').rerolls.club, prevClubRerolls, 'Rejected reroll must not consume token');

// Legal Club Reroll: liv2005 (Premier League 2005) -> chelsea2005 (Premier League 2005, exact same year)
dispatchAction('p2', { kind: 'reroll', type: 'club', teamSeasonId: chelsea2005.id });
assert.equal(harness.getTeamState('p2').draft.currentRoll.id, chelsea2005.id, 'Legal club reroll must update currentRoll');
assert.equal(harness.getTeamState('p2').rerolls.club, prevClubRerolls - 1, 'Legal club reroll consumes token');

const bFw1 = findCandidateForRole(chelsea2005, 'FW', harness.getTeamState('p2').roster);
assert.ok(bFw1, 'FW candidate must exist in chelsea-2005');
dispatchAction('p2', { kind: 'pick', playerId: bFw1.id, slot: 'FW1' }); // B: 3/11
assert.equal(harness.getTeamState('p2').roster.FW1.id, bFw1.id);

// Fill B up to 6/11 using helper
fillTeamRoster(harness, 'p2', 5, 6);
assert.equal(
    SLOTS.filter((s) => Boolean(harness.getTeamState('p2').roster[s])).length,
    6,
    'Team B should be at 6/11'
);

// Fill A up to 10/11 first and verify premature lock at 10/11 is rejected
fillTeamRoster(harness, 'p1', 10, 10);
assert.equal(
    SLOTS.filter((s) => Boolean(harness.getTeamState('p1').roster[s])).length,
    10,
    'Team A should be at 10/11'
);
dispatchAction('p1', { kind: 'draft_lock' }); // premature lock at 10/11 must be rejected!
assert.equal(harness.getTeamState('p1').draft.locked, false, '10/11 must NOT allow draft_lock');

// Fill A's final 11th slot -> 11/11 READY
fillTeamRoster(harness, 'p1', 25, 11);

// Verify A is now in READY (11/11) with LOCK IN button, while B is at 6/11
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('11 / 11'), 'A shows 11 / 11');
    assert.ok(textA.includes('READY'), 'A shows READY state');
    assert.ok(areaA.querySelector('.fd-lock-btn'), 'A renders LOCK IN button');
    assert.ok(textB.includes('11 / 11') && textB.includes('READY'), 'B sees that A is 11 / 11 READY');
    assert.ok(textB.includes('6 / 11'), 'B sees own progress 6 / 11');
    assert.ok(!textB.includes('Lionel Messi'), 'B still cannot see Lionel Messi while A is READY');
}

// A clicks LOCK IN (`draft_lock`) while B is at 6/11
dispatchAction('p1', { kind: 'draft_lock' });

// Verify A is LOCKED and waiting for opponent, and post-lock actions by A are ignored
dispatchAction('p1', { kind: 'roll', teamSeasonId: barca2011.id }); // must be ignored
dispatchAction('p1', { kind: 'draft_lock' }); // duplicate lock must be ignored

{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('LOCKED ✓'), 'A shows LOCKED ✓');
    assert.ok(textA.includes(t('draft.waitingOpponent')), 'A shows waiting for opponent notice');
    assert.ok(!textB.includes('Lionel Messi'), 'B STILL cannot see A roster when only A is locked');
}

// 5. B continues drafting remaining 5 players (from 6/11 to 11/11) while A is LOCKED
fillTeamRoster(harness, 'p2', 40, 11);
assert.equal(harness.getTeamState('p2').draft.phase, 'READY', 'Team B reaches READY at 11/11');

// Before B locks in, verify A still cannot see ANY of B's 11 players
{
    const textA = areaA.dumpText();
    const teamBRoster = harness.getTeamState('p2').roster;
    for (const slot of SLOTS) {
        const p = teamBRoster[slot];
        assert.ok(p, `Team B slot ${slot} must be filled`);
        assert.ok(!textA.includes(p.name), `A must not see B player ${p.name} before B locks in`);
    }
}

// 6. B locks in -> Both teams locked -> Automatic transition to REVEAL!
dispatchAction('p2', { kind: 'draft_lock' });

{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();

    // Both clients must now be in REVEAL and display ROSTER REVEAL
    assert.ok(textA.includes('ROSTER REVEAL'), 'Client A displays ROSTER REVEAL');
    assert.ok(textB.includes('ROSTER REVEAL'), 'Client B displays ROSTER REVEAL');

    const stateA = harness.controllerA.getState();
    const stateB = harness.controllerB.getState();

    // Both clients must now see ALL 22 players from both Team A and Team B!
    for (const team of stateA.teams) {
        for (const slot of SLOTS) {
            const player = team.roster[slot];
            assert.ok(player, `Expected filled slot ${slot} on ${team.id}`);
            assert.ok(textA.includes(player.name), `REVEAL: Client A should see ${player.name}`);
            assert.ok(textB.includes(player.name), `REVEAL: Client B should see ${player.name}`);
        }
    }

    // Team A sees MATCH button; Team B sees waiting notice
    assert.ok(areaA.querySelector('.fd-match-btn'), 'Team A sees START MATCH button in REVEAL');
    assert.equal(areaB.querySelector('.fd-match-btn'), null, 'Team B does not see START MATCH button');
    assert.ok(areaB.querySelector('.fd-match-wait'), 'Team B sees waiting notice in REVEAL');

    // Verify internal state parity between Client A and Client B
    assert.equal(stateA.phase, 'REVEAL');
    assert.equal(stateB.phase, 'REVEAL');
    assert.deepEqual(stateA.teams[0].roster, stateB.teams[0].roster, 'Team A rosters identical on both clients');
    assert.deepEqual(stateA.teams[1].roster, stateB.teams[1].roster, 'Team B rosters identical on both clients');
    assert.deepEqual(stateA.teams[0].rerolls, stateB.teams[0].rerolls, 'Team A rerolls identical on both clients');
    assert.deepEqual(stateA.teams[1].rerolls, stateB.teams[1].rerolls, 'Team B rerolls identical on both clients');
    assert.equal(stateA.teams[0].draft.locked, true);
    assert.equal(stateA.teams[1].draft.locked, true);
    assert.equal(stateA.teams[0].draft.phase, 'LOCKED');
    assert.equal(stateA.teams[1].draft.phase, 'LOCKED');

    // Per-team history consistency + actorId presence
    assert.deepEqual(
        stateA.teams[0].draft.history,
        stateB.teams[0].draft.history,
        'Team A per-team history must be identical on both clients'
    );
    assert.deepEqual(
        stateA.teams[1].draft.history,
        stateB.teams[1].draft.history,
        'Team B per-team history must be identical on both clients'
    );
    assert.ok(
        stateA.teams[0].draft.history.every((ev) => ev.actorId === 'p1'),
        'All Team A history entries must have actorId === p1'
    );
    assert.ok(
        stateA.teams[1].draft.history.every((ev) => ev.actorId === 'p2'),
        'All Team B history entries must have actorId === p2'
    );
    assert.equal(
        stateA.teams[0].draft.history.at(-1)?.type,
        'draft.lock',
        'Last entry of Team A history must be draft.lock'
    );
    assert.equal(
        stateA.teams[1].draft.history.at(-1)?.type,
        'draft.lock',
        'Last entry of Team B history must be draft.lock'
    );
}

// 7. Match Start Validation & Multi-Locale Match Regression
// Team B attempts to start match -> must be ignored!
dispatchAction('p2', { kind: 'match_start', matchSeed: 777777 });
assert.equal(areaA.querySelector('.fd-scoreboard'), null, 'Team B match_start must be rejected');

// Set Client A to zh-CN, Client B to ja, then Team A starts match
setLocale('zh-CN', { persist: false });
assert.equal(getLocale(), 'zh-CN');
assert.ok(areaA.dumpText().includes('阵容揭晓'), 'Client A renders REVEAL in zh-CN');

setLocale('ja', { persist: false });
assert.equal(getLocale(), 'ja');
assert.ok(areaB.dumpText().includes('両チームの先発メンバーが公開されました'), 'Client B renders REVEAL in ja');

// Team A sends match_start
const matchSeed = 20261006;
dispatchAction('p1', { kind: 'match_start', matchSeed });

{
    assert.ok(areaA.querySelector('.fd-scoreboard'), 'Client A entered MATCH phase');
    assert.ok(areaB.querySelector('.fd-scoreboard'), 'Client B entered MATCH phase');

    const stateA = harness.controllerA.getState();
    const stateB = harness.controllerB.getState();
    assert.equal(stateA.phase, 'MATCH');
    assert.equal(stateB.phase, 'MATCH');
    assert.deepEqual(
        stateA.match.script,
        stateB.match.script,
        'Both clients must generate the exact same deterministic Match Script'
    );

    // Switch locale to 'en' during live match and verify in-place re-render without state loss
    setLocale('en', { persist: false });
    assert.ok(areaA.dumpText().includes('MATCH CENTER'), 'Live match re-rendered in en');

    harness.controllerA.stop();
    harness.controllerB.stop();
}

// 8. Opponent Left Handling during Draft
{
    const h2 = createTwoClientHarness(55555);
    h2.notifyPlayers([{ id: 'p1', name: 'Alice' }]); // p2 left
    assert.ok(
        h2.areaA.querySelector('.fd-alert'),
        'Opponent leaving during Draft must display .fd-alert banner'
    );
    h2.controllerA.stop();
    h2.controllerB.stop();
}

// 9. Deterministic Match Engine Verification on 11v11 Rosters
{
    const teamA = {
        id: 'p1',
        label: 'TEAM A',
        shortTag: 'A',
        name: 'Alice',
        roster: buildSample11PlayerRoster(TEAM_SEASONS.slice(0, 4)),
    };
    const teamB = {
        id: 'p2',
        label: 'TEAM B',
        shortTag: 'B',
        name: 'Bob',
        roster: buildSample11PlayerRoster(TEAM_SEASONS.slice(4, 8)),
    };
    const s1 = generateMatchScript(teamA, teamB, 20261006);
    const s2 = generateMatchScript(teamA, teamB, 20261006);
    assert.deepEqual(s1, s2, 'generateMatchScript must be 100% deterministic for 11v11 rosters');
}

// 10. Draft UI Polish v1 Verification (Pitch View 4-3-3, View Toggle, Compact Activity Feed)
{
    const h3 = createTwoClientHarness(77777);
    const barca = TEAM_SEASON_MAP.get('barcelona-2011');
    const madrid = TEAM_SEASON_MAP.get('real-madrid-2017');

    // Verify default squad view is Pitch View (.fd-pitch with 4 rows and 11 empty nodes) on own panel
    // while opponent panel is blind (.fd-team-panel--blind) and does NOT render .fd-pitch
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch').length,
        1,
        'Client A should render exactly 1 Pitch View (for own team) during blind draft'
    );
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch-row').length,
        4,
        '4-3-3 Pitch View must have 4 tactical rows (FW, MF, DF, GK)'
    );
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch-node--empty').length,
        11,
        'Initial Pitch View must show 11 empty slot cards'
    );
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch-node--filled').length,
        0,
        'Initial Pitch View must have 0 filled slot cards'
    );

    // Perform 5 actions on Client A so history has 5 entries, and verify compact activity feed renders at most 3 items
    h3.dispatchAction('p1', { kind: 'roll', teamSeasonId: barca.id });
    const p1Fw = barca.players.find((p) => p.positions.includes('FW'));
    h3.dispatchAction('p1', { kind: 'pick', playerId: p1Fw.id, slot: 'FW1' });
    h3.dispatchAction('p1', { kind: 'roll', teamSeasonId: madrid.id });
    const p1Mf = madrid.players.find((p) => p.positions.includes('MF'));
    h3.dispatchAction('p1', { kind: 'pick', playerId: p1Mf.id, slot: 'MF2' });
    h3.dispatchAction('p1', { kind: 'roll', teamSeasonId: barca.id });

    assert.equal(
        h3.getTeamState('p1').draft.history.length,
        5,
        'Underlying team draft history state retains all 5 events'
    );
    const historyItemsDom = h3.areaA.querySelectorAll('.fd-history-item');
    assert.equal(
        historyItemsDom.length,
        3,
        'Compact Recent Activity feed must cap rendered items to 3'
    );
    assert.ok(
        historyItemsDom[0].classList.contains('fd-history-item--latest'),
        'Newest activity item must have .fd-history-item--latest'
    );

    // Verify Pitch View updated to 2 filled nodes and 9 empty nodes
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch-node--filled').length,
        2,
        'Pitch View must show 2 filled player nodes after 2 picks'
    );
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch-node--empty').length,
        9,
        'Pitch View must show 9 empty placeholder nodes after 2 picks'
    );

    // Verify View Toggle switches between Pitch View (.fd-pitch) and List View (.fd-slot-list)
    const toggleBtns = h3.areaA.querySelectorAll('.fd-view-toggle-btn');
    assert.equal(toggleBtns.length, 2, 'Own team panel must render Pitch / List toggle buttons');
    const [pitchToggleBtn, listToggleBtn] = toggleBtns;
    listToggleBtn.click();
    assert.equal(
        h3.areaA.querySelectorAll('.fd-slot-list').length,
        1,
        'Clicking List toggle button must switch to .fd-slot-list'
    );
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch').length,
        0,
        'Clicking List toggle button must unmount .fd-pitch'
    );
    pitchToggleBtn.click();
    assert.equal(
        h3.areaA.querySelectorAll('.fd-pitch').length,
        1,
        'Clicking Pitch toggle button must restore .fd-pitch'
    );

    h3.controllerA.stop();
    h3.controllerB.stop();
}

console.log('[smoke-concurrent-draft] PASS — All 11v11 Concurrent Blind Draft, Reveal, Security, i18n, Match, and Draft UI Polish v1 tests succeeded.');
process.exit(0);


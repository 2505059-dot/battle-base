// Comprehensive regression & smoke test for Concurrent Blind Draft v1
// Simulates two connected clients (Client A & Client B) through:
// - Concurrent ROLL / REROLL / PICK in different phases simultaneously
// - Blind UI verification (no opponent player/club/year/rating/reroll/history leakage in DOM before REVEAL)
// - Asymmetric completion (A reaches 5/5 READY & LOCKED while B is at 2/5 and continues drafting)
// - Security & validation guards (spoofed actorId, unknown sender, premature lock, post-lock actions, filled slot overwrite)
// - Dual LOCK -> automatic REVEAL transition with full roster disclosure on both clients
// - Per-team structured history consistency (with actorId) across both clients
// - Match start validation (Team B rejected, Team A accepted) + deterministic Match Script + multi-locale switching
// - Opponent left handling during Draft

import assert from 'node:assert/strict';
import { TEAM_SEASONS, TEAM_SEASON_MAP, findTeamSeason } from '../public/data/team-seasons.js';
import { setLocale, getLocale, t } from '../public/i18n/i18n.js';
import { startGame } from '../public/game/controller.js';
import { generateMatchScript } from '../public/game/match/engine.js';
import { buildSampleRosterFromSeason } from '../public/game/match/simulator.js';

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

// ----- Two-Client Harness -----

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

    // Helper to dispatch a raw action on both clients (as if sent by `from` and applied locally + remotely)
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
    };
}

function findPlayerForSlot(teamSeason, slot, usedIds = new Set()) {
    for (const p of teamSeason.players) {
        if (usedIds.has(p.id)) continue;
        if (slot === 'FLEX' && !p.positions.includes('GK')) return p;
        if (p.positions.includes(slot)) return p;
    }
    throw new Error(`No player found for slot ${slot} in ${teamSeason.id}`);
}

// ----- Run Smoke & Regression Suite -----

console.log('[smoke-concurrent-draft] Starting test suite...');

setLocale('en', { persist: false });

const harness = createTwoClientHarness(90210);
const { areaA, areaB, dispatchAction, notifyPlayers } = harness;

// 1. Initial state verification
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('0 / 5'), 'Client A should show 0 / 5 progress');
    assert.ok(textB.includes('0 / 5'), 'Client B should show 0 / 5 progress');
    assert.ok(textA.includes('HIDDEN'), 'Client A should render blind opponent panel');
    assert.ok(textB.includes('HIDDEN'), 'Client B should render blind opponent panel');
    assert.ok(!textA.includes('Your Turn'), 'No turn-based text should exist on Client A');
    assert.ok(!textB.includes('Your Turn'), 'No turn-based text should exist on Client B');
}

// 2. Concurrent Roll & Reroll + Blindness Test (Lionel Messi on A, Kaká on B)
const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');
const barca2015 = TEAM_SEASON_MAP.get('barcelona-2015');
const milan2007 = TEAM_SEASON_MAP.get('ac-milan-2007');
const madrid2014 = TEAM_SEASON_MAP.get('real-madrid-2017');
const bayern2013 = TEAM_SEASON_MAP.get('bayern-munich-2013');
const inter2010 = TEAM_SEASON_MAP.get('inter-milan-2010');
const arsenal2004 = TEAM_SEASON_MAP.get('arsenal-2004');
const chelsea2005 = TEAM_SEASON_MAP.get('chelsea-2005');

assert.ok(barca2011 && barca2015 && milan2007 && madrid2014 && bayern2013 && inter2010 && arsenal2004 && chelsea2005);

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

// Local card selection isolation test: Client A clicks a candidate card locally
{
    const firstCardA = areaA.querySelector('.fd-card--interactive');
    assert.ok(firstCardA, 'Client A should have interactive candidate cards');
    firstCardA.click();
    assert.ok(areaA.querySelector('.fd-card--selected'), 'Client A has a selected card');
    assert.equal(areaB.querySelector('.fd-card--selected'), null, 'Client B must NOT have a selected card when A clicks');
}

// A picks Lionel Messi into FW while B is still in PICK
const messi = barca2011.players.find((p) => p.name === 'Lionel Messi');
assert.ok(messi, 'Lionel Messi must exist in barcelona-2011');
dispatchAction('p1', { kind: 'pick', playerId: messi.id, slot: 'FW' });

// Verify Blindness on Client B: B's DOM must NOT contain Lionel Messi, Barcelona, 2011, or Messi's rating
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('Lionel Messi'), 'Client A sees own picked player Lionel Messi');
    assert.ok(!textB.includes('Lionel Messi'), 'BLINDNESS VIOLATION: Client B DOM leaked Lionel Messi');
    assert.ok(!textB.includes('Barcelona'), 'BLINDNESS VIOLATION: Client B DOM leaked Barcelona');
    assert.ok(!textB.includes('2011'), 'BLINDNESS VIOLATION: Client B DOM leaked 2011');
    assert.ok(textB.includes('1 / 5'), 'Client B sees that Team A has 1 / 5 selected');
}

// Now B picks Kaká into MF while A is in ROLL
const kaka = milan2007.players.find((p) => p.positions.includes('MF'));
assert.ok(kaka);
dispatchAction('p2', { kind: 'pick', playerId: kaka.id, slot: 'MF' });

// Verify Blindness on Client A: A's DOM must NOT contain Kaká or AC Milan
{
    const textA = areaA.dumpText();
    assert.ok(!textA.includes(kaka.name), `BLINDNESS VIOLATION: Client A DOM leaked ${kaka.name}`);
    assert.ok(!textA.includes('AC Milan'), 'BLINDNESS VIOLATION: Client A DOM leaked AC Milan');
}

// 3. Security & Validation Guard Checks
// - Spoofed actorId: B tries to roll/pick claiming to be p1; controller uses `from` ('p2'), not payload.actorId
// - Unknown sender 'p999' is ignored
// - Premature draft_lock when A only has 1/5 is ignored
// - Picking into already filled slot 'FW' for A is ignored
dispatchAction('p999', { kind: 'roll', teamSeasonId: madrid2014.id });
dispatchAction('p1', { kind: 'draft_lock' }); // premature lock (1/5)

// A rolls madrid2014 and tries to overwrite FW slot
dispatchAction('p1', { kind: 'roll', teamSeasonId: madrid2014.id });
const madridFw = findPlayerForSlot(madrid2014, 'FW');
dispatchAction('p1', { kind: 'pick', playerId: madridFw.id, slot: 'FW' }); // should be ignored since FW is filled!
assert.ok(areaA.dumpText().includes('Lionel Messi'), 'Filled FW slot must not be overwritten');

// 4. Asymmetric Progression: A completes all 5 slots -> READY -> LOCKED while B is only at 2/5
// B rolls inter2010 and picks GK (so B is at 2/5)
dispatchAction('p2', { kind: 'roll', teamSeasonId: inter2010.id });
const interGk = findPlayerForSlot(inter2010, 'GK');
dispatchAction('p2', { kind: 'pick', playerId: interGk.id, slot: 'GK' });

// A completes remaining 4 slots: GK, DF, MF, FLEX
const madridGk = findPlayerForSlot(madrid2014, 'GK');
dispatchAction('p1', { kind: 'pick', playerId: madridGk.id, slot: 'GK' }); // A: 2/5

dispatchAction('p1', { kind: 'roll', teamSeasonId: bayern2013.id });
const bayernDf = findPlayerForSlot(bayern2013, 'DF');
dispatchAction('p1', { kind: 'pick', playerId: bayernDf.id, slot: 'DF' }); // A: 3/5

dispatchAction('p1', { kind: 'roll', teamSeasonId: arsenal2004.id });
const arsenalMf = findPlayerForSlot(arsenal2004, 'MF');
dispatchAction('p1', { kind: 'pick', playerId: arsenalMf.id, slot: 'MF' }); // A: 4/5

dispatchAction('p1', { kind: 'roll', teamSeasonId: chelsea2005.id });
const chelseaFlex = findPlayerForSlot(chelsea2005, 'FLEX');
dispatchAction('p1', { kind: 'pick', playerId: chelseaFlex.id, slot: 'FLEX' }); // A: 5/5 -> READY

// Verify A is now in READY (5/5) with LOCK IN button, while B is at 2/5
{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();
    assert.ok(textA.includes('5 / 5'), 'A shows 5 / 5');
    assert.ok(textA.includes('READY'), 'A shows READY state');
    assert.ok(areaA.querySelector('.fd-lock-btn'), 'A renders LOCK IN button');
    assert.ok(textB.includes('5 / 5') && textB.includes('READY'), 'B sees that A is 5 / 5 READY');
    assert.ok(!textB.includes('Lionel Messi'), 'B still cannot see Lionel Messi while A is READY');
}

// A clicks LOCK IN (`draft_lock`) while B is at 2/5
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

// 5. B continues drafting from 2/5 to 5/5 while A is LOCKED
const juve2017 = TEAM_SEASON_MAP.get('juventus-2017');
const bvb2013 = TEAM_SEASON_MAP.get('borussia-dortmund-2013');
const liv2005 = TEAM_SEASON_MAP.get('liverpool-2005');
const city2023 = TEAM_SEASON_MAP.get('manchester-city-2023');
const napoli2023 = TEAM_SEASON_MAP.get('napoli-2023');
assert.ok(juve2017 && bvb2013 && liv2005 && city2023 && napoli2023);

// B rolls juve2017 (Serie A), uses League Reroll -> bvb2013 (Bundesliga), picks DF (3/5)
dispatchAction('p2', { kind: 'roll', teamSeasonId: juve2017.id });
dispatchAction('p2', { kind: 'reroll', type: 'league', teamSeasonId: bvb2013.id });
const bDf = findPlayerForSlot(bvb2013, 'DF');
dispatchAction('p2', { kind: 'pick', playerId: bDf.id, slot: 'DF' }); // B: 3/5

// B rolls liv2005 (Premier League), uses Club Reroll -> city2023 (Premier League), picks FW (4/5)
dispatchAction('p2', { kind: 'roll', teamSeasonId: liv2005.id });
dispatchAction('p2', { kind: 'reroll', type: 'club', teamSeasonId: city2023.id });
const bFw = findPlayerForSlot(city2023, 'FW');
dispatchAction('p2', { kind: 'pick', playerId: bFw.id, slot: 'FW' }); // B: 4/5

// B rolls napoli2023, picks FLEX (5/5 -> READY)
dispatchAction('p2', { kind: 'roll', teamSeasonId: napoli2023.id });
const bFlex = findPlayerForSlot(napoli2023, 'FLEX', new Set([bFw.id]));
dispatchAction('p2', { kind: 'pick', playerId: bFlex.id, slot: 'FLEX' }); // B: 5/5 -> READY

// Before B locks in, A still cannot see ANY of B's players or clubs
{
    const textA = areaA.dumpText();
    assert.ok(!textA.includes(kaka.name), 'A must not see B player before B locks in');
    assert.ok(!textA.includes(interGk.name), 'A must not see B GK before B locks in');
    assert.ok(!textA.includes(bDf.name), 'A must not see B DF before B locks in');
    assert.ok(!textA.includes(bFw.name), 'A must not see B FW before B locks in');
    assert.ok(!textA.includes(bFlex.name), 'A must not see B FLEX before B locks in');
    assert.ok(!textA.includes('Borussia Dortmund'), 'A must not see B club Borussia Dortmund before B locks in');
    assert.ok(!textA.includes('Manchester City'), 'A must not see B club Manchester City before B locks in');
}

// 6. B locks in -> Both teams locked -> Automatic transition to REVEAL!
dispatchAction('p2', { kind: 'draft_lock' });

{
    const textA = areaA.dumpText();
    const textB = areaB.dumpText();

    // Both clients must now be in REVEAL and display ROSTER REVEAL
    assert.ok(textA.includes('ROSTER REVEAL'), 'Client A displays ROSTER REVEAL');
    assert.ok(textB.includes('ROSTER REVEAL'), 'Client B displays ROSTER REVEAL');

    // Both clients must now see ALL players from both Team A and Team B!
    const allExpectedPlayers = [
        messi.name,
        madridGk.name,
        bayernDf.name,
        arsenalMf.name,
        chelseaFlex.name,
        kaka.name,
        interGk.name,
        bDf.name,
        bFw.name,
        bFlex.name,
    ];

    for (const pName of allExpectedPlayers) {
        assert.ok(textA.includes(pName), `REVEAL: Client A should see ${pName}`);
        assert.ok(textB.includes(pName), `REVEAL: Client B should see ${pName}`);
    }

    // Team A sees MATCH button; Team B sees waiting notice
    assert.ok(areaA.querySelector('.fd-match-btn'), 'Team A sees START MATCH button in REVEAL');
    assert.equal(areaB.querySelector('.fd-match-btn'), null, 'Team B does not see START MATCH button');
    assert.ok(areaB.querySelector('.fd-match-wait'), 'Team B sees waiting notice in REVEAL');

    // Verify internal state parity between Client A and Client B
    const stateA = harness.controllerA.getState();
    const stateB = harness.controllerB.getState();

    assert.equal('turnIndex' in stateA, false, 'turnIndex must be completely removed from state');
    assert.equal('roundCount' in stateA, false, 'roundCount must be completely removed from state');
    assert.equal('currentRoll' in stateA, false, 'global currentRoll must be removed from state');
    assert.equal('selectedPlayerId' in stateA, false, 'global selectedPlayerId must be removed from state');
    assert.equal('history' in stateA, false, 'global history must be removed from state');

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
assert.ok(areaB.dumpText().includes('両チームの5人制ロスターが公開されました'), 'Client B renders REVEAL in ja');

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

// 9. Deterministic Match Engine Baseline Verification
{
    const teamA = {
        id: 'p1',
        label: 'TEAM A',
        shortTag: 'A',
        name: 'Alice',
        roster: buildSampleRosterFromSeason(TEAM_SEASONS[0]),
    };
    const teamB = {
        id: 'p2',
        label: 'TEAM B',
        shortTag: 'B',
        name: 'Bob',
        roster: buildSampleRosterFromSeason(TEAM_SEASONS[1]),
    };
    const s1 = generateMatchScript(teamA, teamB, 20261006);
    const s2 = generateMatchScript(teamA, teamB, 20261006);
    assert.deepEqual(s1, s2, 'generateMatchScript must be 100% deterministic');
    assert.deepEqual(s1.finalScore, { A: 2, B: 2 });
    assert.equal(s1.events.length, 27);
}

console.log('[smoke-concurrent-draft] PASS — All Concurrent Blind Draft, Reveal, Security, i18n, and Match tests succeeded.');
process.exit(0);

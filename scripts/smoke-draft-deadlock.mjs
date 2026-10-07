// Permanent Draft Deadlock Safety v1 Smoke & Regression Test Suite
// Validates:
// 1. Positive Case 1: Single-Year Club + Duplicate Role Deadlock -> Free Redraw
// 2. Positive Case 2: Repeated Consecutive Dead Roll Recovery -> 11/11 -> READY -> LOCKED
// 3. Negative Guards: Legal pick exists, legal league/club/year reroll exists, wrong phase, unknown teamSeasonId
// 4. Two-Client Controller: Human UI (.fd-deadroll-box / .fd-redraw-btn), forged network redraw rejection, actorId spoofing guard, and Blind Draft non-leakage
// 5. Historical Stuck Seeds Regression: All 5 seeds from 100k Bot Framework v1 run now complete 100%

import assert from 'node:assert/strict';
import { TEAM_SEASONS, TEAM_SEASON_MAP } from '../public/data/team-seasons.js';
import { setLocale, t, formatClubName } from '../public/i18n/i18n.js';
import { ROLES, SLOTS } from '../public/game/shared/constants.js';
import { formatHistoryEvent } from '../public/game/shared/event-formatters.js';
import { createInitialState } from '../public/game/state.js';
import {
    createEmptyRoster,
    createInitialRerolls,
    isPlayerInRoster,
    isRosterComplete,
    getLegalPickActions,
    getLegalRerollActions,
    getLegalDraftActions,
    canFreeRedraw,
    isDeadRoll,
} from '../public/game/draft/rules.js';
import {
    applyDraftRoll,
    applyDraftRedraw,
    applyDraftPick,
    applyDraftLock,
} from '../public/game/draft/transitions.js';
import {
    BOT_DIFFICULTIES,
    BOT_REASON_CODES,
    chooseDraftAction,
    toPublicDraftAction,
} from '../public/game/bot/decision.js';
import { startGame } from '../public/game/controller.js';
import { simulateSingleBotDraft } from './simulate-bot-drafts.mjs';

console.log('[smoke-draft-deadlock] Running Draft Deadlock Safety v1 verification suite...');

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
        const event = { stopPropagation() {} };
        for (const fn of handlers) {
            fn(event);
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
    documentElement: { lang: 'en' },
    createElement(tag) {
        return new FakeElement(tag);
    },
};

function build10Of11RosterWithTwoFws(fw1, fw2) {
    const pool = TEAM_SEASONS.flatMap((ts) => ts.players);
    const roster = createEmptyRoster();
    roster.FW1 = fw1;
    roster.FW2 = fw2;
    roster.FW3 = null;
    for (const slot of SLOTS) {
        if (slot.startsWith('FW')) continue;
        const role = slot.slice(0, 2);
        roster[slot] = pool.find(
            (p) => p.positions.includes(role) && !isPlayerInRoster(roster, p)
        );
    }
    return roster;
}

// ---------------------------------------------------------------------------
// 1. Positive Test 1: Single-Year Club + Duplicate Role Deadlock (ajax-2019)
// ---------------------------------------------------------------------------
{
    const ajax2019 = TEAM_SEASON_MAP.get('ajax-2019');
    const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');
    const ajaxFws = ajax2019.players.filter((p) => p.positions.includes('FW'));
    assert.equal(ajaxFws.length, 2);

    const state = createInitialState({
        seed: 20261006,
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' },
        ],
    });

    const team = state.teams[0];
    team.roster = build10Of11RosterWithTwoFws(ajaxFws[0], ajaxFws[1]);
    team.rerolls = { league: 0, club: 0, year: 1 };
    team.draft.phase = 'PICK';
    team.draft.currentRoll = ajax2019;

    assert.equal(getLegalPickActions(team).length, 0, 'Must have 0 legal picks');
    assert.equal(
        getLegalRerollActions(team).length,
        0,
        'Must have 0 legal rerolls (Ajax only has 2019)'
    );
    assert.equal(canFreeRedraw(team), true, 'canFreeRedraw must be true on dead roll');
    assert.equal(isDeadRoll(team), true, 'isDeadRoll alias must match canFreeRedraw');
    assert.deepStrictEqual(getLegalDraftActions(team), [{ type: 'redraw' }]);

    for (const diff of BOT_DIFFICULTIES) {
        const decision = chooseDraftAction({
            team,
            difficulty: diff,
            persona: 'neutral',
            decisionSeed: 12345,
        });
        assert.deepStrictEqual(decision, { type: 'redraw' });
        assert.equal(decision.debug.reasonCode, BOT_REASON_CODES.DEAD_ROLL_FREE_REDRAW);
        assert.deepStrictEqual(toPublicDraftAction(decision), { type: 'redraw' });
    }

    const rosterSnapshotBefore = structuredClone(team.roster);
    const redrawRes = applyDraftRedraw(state, 'p1', barca2011.id);
    assert.equal(redrawRes.ok, true, 'applyDraftRedraw must succeed on dead roll');
    assert.equal(team.draft.phase, 'PICK', 'Phase must remain PICK after free redraw');
    assert.equal(team.draft.currentRoll.id, barca2011.id);
    assert.deepStrictEqual(
        team.rerolls,
        { league: 0, club: 0, year: 1 },
        'Free redraw must not consume or modify rerolls'
    );
    assert.deepStrictEqual(
        team.roster,
        rosterSnapshotBefore,
        'Free redraw must not modify roster'
    );
    assert.equal(team.draft.history.length, 1);
    const histEvent = team.draft.history[0];
    assert.equal(histEvent.type, 'draft.redraw');
    assert.equal(histEvent.actorId, 'p1');
    assert.equal(histEvent.actorName, 'Alice');
    assert.equal(histEvent.club, 'Barcelona');
    assert.equal(histEvent.year, 2011);
    assert.equal(histEvent.previousClub, 'Ajax');
    assert.equal(histEvent.previousYear, 2019);

    for (const locale of ['en', 'ja', 'zh-CN']) {
        setLocale(locale);
        const formatted = formatHistoryEvent(histEvent);
        assert(
            formatted.includes('Alice') &&
                formatted.includes(formatClubName('Barcelona')) &&
                formatted.includes('2011'),
            `Formatted redraw history must include actor, localized club, and year in locale=${locale}`
        );
    }
}

// ---------------------------------------------------------------------------
// 2. Positive Test 2: Repeated Consecutive Dead Roll Recovery -> 11/11 -> READY -> LOCKED
// ---------------------------------------------------------------------------
{
    const ajax2019 = TEAM_SEASON_MAP.get('ajax-2019');
    const benfica2014 = TEAM_SEASON_MAP.get('benfica-2014');
    const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');

    const ajaxFws = ajax2019.players.filter((p) => p.positions.includes('FW'));
    const benficaFws = benfica2014.players.filter((p) => p.positions.includes('FW'));
    assert.equal(ajaxFws.length, 2);
    assert.equal(benficaFws.length, 2);

    const state = createInitialState({
        seed: 8888,
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' },
        ],
    });

    const team = state.teams[0];
    team.roster = build10Of11RosterWithTwoFws(ajaxFws[0], ajaxFws[1]);
    team.rerolls = { league: 0, club: 0, year: 1 };
    team.draft.phase = 'PICK';
    team.draft.currentRoll = ajax2019;

    // First dead roll -> redraw into ajax-2019 again (still dead!)
    assert.equal(canFreeRedraw(team), true);
    const r1 = applyDraftRedraw(state, 'p1', ajax2019.id);
    assert.equal(r1.ok, true);
    assert.equal(canFreeRedraw(team), true, 'Must still allow free redraw on consecutive dead roll');
    assert.equal(team.rerolls.year, 1, 'Year reroll must still remain 1');

    // Second consecutive dead roll -> redraw into barcelona-2011 (has legal FWs)
    const r2 = applyDraftRedraw(state, 'p1', barca2011.id);
    assert.equal(r2.ok, true);
    assert.equal(canFreeRedraw(team), false, 'barcelona-2011 has legal FW picks so not a dead roll');
    assert.equal(team.draft.history.length, 2);

    const legalPicks = getLegalPickActions(team);
    assert(legalPicks.length > 0, 'Must have legal FW picks after second redraw');

    const pickRes = applyDraftPick(state, 'p1', legalPicks[0].playerId, 'FW3');
    assert.equal(pickRes.ok, true);
    assert.equal(isRosterComplete(team), true);
    assert.equal(team.draft.phase, 'READY');

    const lockRes = applyDraftLock(state, 'p1');
    assert.equal(lockRes.ok, true);
    assert.equal(team.draft.phase, 'LOCKED');
    assert.equal(team.draft.locked, true);
}

// ---------------------------------------------------------------------------
// 3. Negative Tests: Must Reject Free Redraw in All Non-Dead-Roll States
// ---------------------------------------------------------------------------
{
    const ajax2019 = TEAM_SEASON_MAP.get('ajax-2019');
    const barca2009 = TEAM_SEASON_MAP.get('barcelona-2009');
    const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');
    const ajaxFws = ajax2019.players.filter((p) => p.positions.includes('FW'));
    const barca2009Fws = barca2009.players.filter((p) => p.positions.includes('FW'));

    const state = createInitialState({
        seed: 9999,
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' },
        ],
    });
    const team = state.teams[0];

    // Case 5a: Wrong phase — ROLL
    assert.equal(team.draft.phase, 'ROLL');
    assert.equal(canFreeRedraw(team), false);
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);

    // Roll into ajax-2019 with empty roster -> Case 1: Legal Pick Exists
    applyDraftRoll(state, 'p1', ajax2019.id);
    team.rerolls = { league: 0, club: 0, year: 0 };
    assert(getLegalPickActions(team).length > 0);
    assert.equal(canFreeRedraw(team), false, 'Must reject free redraw when legal pick exists');
    const resLegalPick = applyDraftRedraw(state, 'p1', barca2011.id);
    assert.equal(resLegalPick.ok, false);
    assert.equal(resLegalPick.reason, 'free_redraw_not_allowed');

    // Set 10/11 roster where 0 legal picks exist on ajax-2019
    team.roster = build10Of11RosterWithTwoFws(ajaxFws[0], ajaxFws[1]);
    assert.equal(getLegalPickActions(team).length, 0);

    // Case 2: Legal League Reroll Exists
    team.rerolls = { league: 1, club: 0, year: 0 };
    assert.equal(getLegalRerollActions(team).length, 1);
    assert.equal(canFreeRedraw(team), false, 'Must reject free redraw when league reroll is legal');
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);

    // Case 3: Legal Club Reroll Exists (use barca2009 in La Liga where multiple clubs exist)
    team.draft.currentRoll = barca2009;
    team.roster = build10Of11RosterWithTwoFws(barca2009Fws[0], barca2009Fws[1]);
    assert.equal(getLegalPickActions(team).length, 0);
    team.rerolls = { league: 0, club: 1, year: 0 };
    assert.equal(getLegalRerollActions(team).length, 1);
    assert.equal(canFreeRedraw(team), false, 'Must reject free redraw when club reroll is legal');
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);

    // Case 4: Legal Year Reroll Exists (Barcelona has 2009, 2011, 2015)
    team.rerolls = { league: 0, club: 0, year: 1 };
    assert.equal(getLegalRerollActions(team).length, 1);
    assert.equal(canFreeRedraw(team), false, 'Must reject free redraw when year reroll is legal');
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);

    // Case 6: Unknown teamSeasonId on a real dead roll
    team.draft.currentRoll = ajax2019;
    team.roster = build10Of11RosterWithTwoFws(ajaxFws[0], ajaxFws[1]);
    team.rerolls = { league: 0, club: 0, year: 1 };
    assert.equal(canFreeRedraw(team), true);
    const resUnknown = applyDraftRedraw(state, 'p1', 'invalid-club-9999');
    assert.equal(resUnknown.ok, false);
    assert.equal(resUnknown.reason, 'unknown_team_season');
    assert.equal(team.draft.currentRoll.id, ajax2019.id);

    // Case 5b: Wrong phase — READY & LOCKED
    const legalFw = barca2011.players.find((p) => p.positions.includes('FW'));
    team.roster.FW3 = legalFw;
    team.draft.phase = 'READY';
    team.draft.currentRoll = null;
    assert.equal(canFreeRedraw(team), false);
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);

    applyDraftLock(state, 'p1');
    assert.equal(team.draft.phase, 'LOCKED');
    assert.equal(canFreeRedraw(team), false);
    assert.equal(applyDraftRedraw(state, 'p1', barca2011.id).ok, false);
}

// ---------------------------------------------------------------------------
// 4. Two-Client Controller, Human UI, Forged Network Action & Blind Draft Non-Leakage
// ---------------------------------------------------------------------------
{
    setLocale('en');
    const ajax2019 = TEAM_SEASON_MAP.get('ajax-2019');
    const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011');
    const ajaxFws = ajax2019.players.filter((p) => p.positions.includes('FW'));

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
        seed: 424242,
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
        seed: 424242,
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

    function dispatchNetwork(from, payload) {
        for (const fn of handlersA.message) {
            fn({ from, payload: structuredClone(payload) });
        }
        for (const fn of handlersB.message) {
            fn({ from, payload: structuredClone(payload) });
        }
    }

    // Normal roll on p1: .fd-deadroll-box must NOT appear
    dispatchNetwork('p1', { kind: 'roll', teamSeasonId: ajax2019.id });
    assert.equal(areaA.querySelector('.fd-deadroll-box'), null);
    assert.equal(areaA.querySelector('.fd-redraw-btn'), null);

    // Forged network redraw when not in dead roll must be rejected
    dispatchNetwork('p1', { kind: 'redraw', teamSeasonId: barca2011.id });
    assert.equal(controllerA.getState().teams[0].draft.currentRoll.id, ajax2019.id);
    assert.equal(controllerB.getState().teams[0].draft.currentRoll.id, ajax2019.id);

    // Put Team A (p1) into the exact dead roll state on both clients and re-render via an ignored/no-op or state sync
    for (const ctrl of [controllerA, controllerB]) {
        const st = ctrl.getState();
        const tA = st.teams[0];
        tA.roster = build10Of11RosterWithTwoFws(ajaxFws[0], ajaxFws[1]);
        tA.rerolls = { league: 0, club: 0, year: 1 };
        tA.draft.phase = 'ROLL';
        tA.draft.currentRoll = null;
    }

    // Now p1 rolls ajax-2019 into the 10/11 state -> dead roll!
    dispatchNetwork('p1', { kind: 'roll', teamSeasonId: ajax2019.id });

    // Verify Client A sees .fd-deadroll-box and .fd-redraw-btn
    const deadrollBoxA = areaA.querySelector('.fd-deadroll-box');
    const redrawBtnA = areaA.querySelector('.fd-redraw-btn');
    assert(deadrollBoxA !== null, 'Client A must render .fd-deadroll-box on dead roll');
    assert(redrawBtnA !== null, 'Client A must render .fd-redraw-btn on dead roll');
    assert(deadrollBoxA.dumpText().includes(t('draft.noValidPick')));
    assert(deadrollBoxA.dumpText().includes(t('draft.freeRedrawExplain')));
    assert.equal(redrawBtnA.textContent, t('draft.freeRedrawBtn'));

    // Verify Client B (Blind Draft opponent view) does NOT see .fd-deadroll-box or Ajax 2019
    assert.equal(
        areaB.querySelector('.fd-deadroll-box'),
        null,
        'Opponent client must not render .fd-deadroll-box for blind opponent'
    );
    const textB = areaB.dumpText();
    assert(!textB.includes('Ajax'), 'Opponent client must not leak Ajax club name during blind draft');

    // Forged actorId spoofing: p2 tries to send redraw claiming actorId: 'p1'
    dispatchNetwork('p2', {
        kind: 'redraw',
        actorId: 'p1',
        teamSeasonId: barca2011.id,
    });
    assert.equal(
        controllerA.getState().teams[0].draft.currentRoll.id,
        ajax2019.id,
        'Controller must use WebSocket from (p2), ignoring forged payload.actorId (p1)'
    );

    // Click Free Redraw button on Client A -> broadcasts { kind: 'redraw', teamSeasonId }
    redrawBtnA.click();
    const lastSent = sentLog[sentLog.length - 1];
    assert.equal(lastSent.from, 'p1');
    assert.equal(lastSent.payload.kind, 'redraw');
    assert(typeof lastSent.payload.teamSeasonId === 'string');

    // Dispatch the sent redraw back to Client A as well (matching standard room broadcast)
    for (const fn of handlersA.message) {
        fn({ from: 'p1', payload: structuredClone(lastSent.payload) });
    }

    assert.equal(
        controllerA.getState().teams[0].draft.currentRoll.id,
        lastSent.payload.teamSeasonId
    );
    assert.equal(
        controllerB.getState().teams[0].draft.currentRoll.id,
        lastSent.payload.teamSeasonId
    );
    assert.equal(controllerA.getState().teams[0].rerolls.year, 1);

    // Verify Client B still does not leak redraw history during blind draft
    const textBAfterRedraw = areaB.dumpText();
    assert(
        !textBAfterRedraw.includes('Free Redraw'),
        'Blind opponent panel must not leak Free Redraw history before REVEAL'
    );
}

// ---------------------------------------------------------------------------
// 5. Historical Stuck Seeds Regression Test (5 Historical v1 Seeds + Policy v2 Stuck Recovery Seeds)
// ---------------------------------------------------------------------------
{
    // Under Policy v2, historical seeds complete 100% cleanly (stuck === false)
    const historicalStuckSeeds = [
        { difficulty: 'random', seed: 2154022250 },
        { difficulty: 'casual', seed: 2446731682 },
        { difficulty: 'smart', seed: 3503798806 },
        { difficulty: 'expert', seed: 1764790880 },
        { difficulty: 'expert', seed: 691322844 },
    ];

    for (const { difficulty, seed } of historicalStuckSeeds) {
        const res = simulateSingleBotDraft({
            seed,
            difficulty,
            persona: 'neutral',
        });
        assert.equal(
            res.completed,
            true,
            `Historical seed ${seed} (${difficulty}) must complete 11/11 -> READY -> LOCKED`
        );
        assert.equal(res.stuck, false);
        assert.equal(res.duplicateViolations, 0);
        assert.equal(res.invalidActions, 0);
        assert.equal(res.team.draft.phase, 'LOCKED');
        assert.equal(res.team.draft.locked, true);
        assert.equal(isRosterComplete(res.team), true);
    }

    // Policy v2 Deadlock Recovery Seeds: Discovered in 100k Bot Draft simulation,
    // these seeds actually trigger a dead roll and recover via freeRedrawCount >= 1!
    const policyV2StuckRecoverySeeds = [
        { difficulty: 'random', seed: 4119464685 },
        { difficulty: 'random', seed: 1752298874 },
        { difficulty: 'random', seed: 3439136925 },
    ];

    for (const { difficulty, seed } of policyV2StuckRecoverySeeds) {
        const res = simulateSingleBotDraft({
            seed,
            difficulty,
            persona: 'neutral',
        });
        assert.equal(
            res.completed,
            true,
            `Policy v2 recovery seed ${seed} (${difficulty}) must complete 11/11 -> READY -> LOCKED`
        );
        assert.equal(res.stuck, false);
        assert(
            res.freeRedrawCount >= 1,
            `Policy v2 recovery seed ${seed} (${difficulty}) must use at least 1 free redraw (got ${res.freeRedrawCount})`
        );
        assert.equal(res.duplicateViolations, 0);
        assert.equal(res.invalidActions, 0);
        assert.equal(res.team.draft.phase, 'LOCKED');
        assert.equal(res.team.draft.locked, true);
        assert.equal(isRosterComplete(res.team), true);
    }
}

console.log(
    '[smoke-draft-deadlock] PASS — All positive, negative, repeated redraw, UI/network security, blind draft, and 5 historical stuck seed checks succeeded.'
);

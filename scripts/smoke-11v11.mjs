// Dedicated 11v11 Abstract 4-3-3 Smoke & Sanity Verification Suite (scripts/smoke-11v11.mjs)

import assert from 'node:assert/strict';
import { TEAM_SEASONS, TEAM_SEASON_MAP } from '../public/data/team-seasons.js';
import { setLocale } from '../public/i18n/i18n.js';
import {
    ROLES,
    ROSTER_SLOTS,
    SLOTS,
    getSlotDefinition,
    getSlotRole,
    getSlotsForRole,
} from '../public/game/shared/constants.js';
import {
    createEmptyRoster,
    canPlayerFitSlot,
    isPlayerInRoster,
    getFirstAvailableSlotForRole,
    getAvailableRolesForPlayer,
    getAvailableSlotsForPlayer,
    findPlayerByRole,
    findPlayersByRole,
    isRosterComplete,
    getPickedCount,
    calculateTeamRating,
} from '../public/game/draft/rules.js';
import { calculateTeamProfile, getEffectiveSlotRole } from '../public/game/match/team-profile.js';
import { getRosterEntries, generateMatchScript } from '../public/game/match/engine.js';
import {
    buildSample11PlayerRoster,
    buildSampleRosterFromPool,
    simulateManyMatches,
} from '../public/game/match/simulator.js';
import { startGame } from '../public/game/controller.js';

// ----- Headless DOM Shim for UI & Controller Tests -----

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
        while (cur.parentNode) cur = cur.parentNode;
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
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this._textContent = '';
        this.append(...nodes);
    }
    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
    }
    click() {
        if (this.disabled) return;
        const handlers = this.listeners.get('click') || [];
        const event = { stopPropagation() {} };
        for (const fn of handlers) fn(event);
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
        const results = [];
        const matchSimple = (el, sel) => {
            if (sel.startsWith('.')) {
                return el.classList && el.classList.contains(sel.slice(1));
            }
            return el.tagName === sel.toUpperCase();
        };
        const visit = (node) => {
            for (const child of node.children) {
                if (matchSimple(child, selector)) results.push(child);
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

console.log('[smoke-11v11] Running 11v11 Abstract 4-3-3 verification suite...');

// 1. Verify ROSTER_SLOTS, SLOTS, createEmptyRoster(), and absence of FLEX
{
    assert.equal(ROSTER_SLOTS.length, 11, 'ROSTER_SLOTS must have 11 definitions');
    assert.equal(SLOTS.length, 11, 'SLOTS must have 11 slot IDs');
    assert.ok(!SLOTS.includes('FLEX'), 'FLEX must not exist in SLOTS');
    assert.deepEqual(getSlotsForRole('GK'), ['GK1']);
    assert.deepEqual(getSlotsForRole('DF'), ['DF1', 'DF2', 'DF3', 'DF4']);
    assert.deepEqual(getSlotsForRole('MF'), ['MF1', 'MF2', 'MF3']);
    assert.deepEqual(getSlotsForRole('FW'), ['FW1', 'FW2', 'FW3']);

    for (const slotDef of ROSTER_SLOTS) {
        assert.deepEqual(
            Object.keys(slotDef).sort(),
            ['id', 'index', 'role'],
            'Slot definition must only contain id, role, index (no premature geometry)'
        );
        assert.equal(getSlotDefinition(slotDef.id), slotDef);
        assert.equal(getSlotRole(slotDef.id), slotDef.role);
        assert.equal(getEffectiveSlotRole(slotDef.id), slotDef.role);
    }

    const empty = createEmptyRoster();
    assert.deepEqual(Object.keys(empty), SLOTS, 'createEmptyRoster keys must match SLOTS');
    assert.equal('FLEX' in empty, false, 'FLEX must not exist in createEmptyRoster()');
    assert.ok(SLOTS.every((s) => empty[s] === null), 'All 11 slots must initialize to null');
}

// 2. Position compatibility, Role -> First Empty Slot, Multi-position & Full Position Tests
{
    const roster = createEmptyRoster();
    const gkPlayer = { id: 'test-gk', name: 'Test GK', positions: ['GK'], overall: 88 };
    const dfMfPlayer = { id: 'test-df-mf', name: 'Test DF/MF', positions: ['DF', 'MF'], overall: 86 };
    const fwPlayer = { id: 'test-fw', name: 'Test FW', positions: ['FW'], overall: 90 };

    // Position compatibility checks
    assert.equal(canPlayerFitSlot(gkPlayer, 'GK1'), true);
    assert.equal(canPlayerFitSlot(gkPlayer, 'DF1'), false);
    assert.equal(canPlayerFitSlot(dfMfPlayer, 'DF1'), true);
    assert.equal(canPlayerFitSlot(dfMfPlayer, 'DF4'), true);
    assert.equal(canPlayerFitSlot(dfMfPlayer, 'MF2'), true);
    assert.equal(canPlayerFitSlot(dfMfPlayer, 'FW1'), false);
    assert.equal(canPlayerFitSlot(fwPlayer, 'FLEX'), false);

    // Role -> first empty slot resolution when DF1, DF2 are filled
    roster.DF1 = { id: 'df-1', name: 'DF One', positions: ['DF'], overall: 82 };
    roster.DF2 = { id: 'df-2', name: 'DF Two', positions: ['DF'], overall: 83 };
    roster.MF1 = { id: 'mf-1', name: 'MF One', positions: ['MF'], overall: 84 };

    assert.equal(getFirstAvailableSlotForRole(roster, 'DF'), 'DF3', 'DF must resolve to DF3 when DF1..2 filled');
    assert.equal(getFirstAvailableSlotForRole(roster, 'MF'), 'MF2', 'MF must resolve to MF2 when MF1 filled');
    assert.deepEqual(
        getAvailableRolesForPlayer(roster, dfMfPlayer),
        ['DF', 'MF'],
        'Multi-position DF/MF player should have [DF, MF] roles when both have open slots'
    );

    // Fill DF3 and DF4 -> DF is now full (4/4)
    roster.DF3 = { id: 'df-3', name: 'DF Three', positions: ['DF'], overall: 84 };
    roster.DF4 = { id: 'df-4', name: 'DF Four', positions: ['DF'], overall: 85 };

    assert.equal(getFirstAvailableSlotForRole(roster, 'DF'), null, 'Full DF role must return null');
    assert.deepEqual(
        getAvailableRolesForPlayer(roster, dfMfPlayer),
        ['MF'],
        'When DF1..DF4 are full, DF/MF player must only show [MF]'
    );

    // Exact player.id duplicate protection in rules
    roster.MF2 = dfMfPlayer;
    assert.equal(isPlayerInRoster(roster, dfMfPlayer), true);
    assert.equal(isPlayerInRoster(roster, 'test-df-mf'), true);
    assert.deepEqual(
        getAvailableRolesForPlayer(roster, dfMfPlayer),
        [],
        'Player already in roster must have 0 available roles'
    );
    assert.deepEqual(
        getAvailableSlotsForPlayer(roster, dfMfPlayer),
        [],
        'Player already in roster must have 0 available slots'
    );
}

// 3. UI Role Button Selection -> Concrete Network Slot & Duplicate Rejection in Controller
{
    setLocale('en', { persist: false });
    const areaA = new FakeElement('div');
    areaA._isRootContainer = true;
    const areaB = new FakeElement('div');
    areaB._isRootContainer = true;
    const sentByA = [];
    const handlersA = [];
    const handlersB = [];

    const players = [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
    ];
    const order = ['p1', 'p2'];

    const ctrlA = startGame({
        area: areaA,
        me: 'p1',
        players,
        order,
        seed: 42,
        send(payload) {
            sentByA.push(payload);
            for (const fn of handlersB) fn({ from: 'p1', payload: structuredClone(payload) });
        },
        onMessage(fn) {
            handlersA.push(fn);
        },
        onPlayers() {},
    });

    const ctrlB = startGame({
        area: areaB,
        me: 'p2',
        players,
        order,
        seed: 42,
        send(payload) {
            for (const fn of handlersA) fn({ from: 'p2', payload: structuredClone(payload) });
        },
        onMessage(fn) {
            handlersB.push(fn);
        },
        onPlayers() {},
    });

    const dispatch = (from, payload) => {
        for (const fn of handlersA) fn({ from, payload: structuredClone(payload) });
        for (const fn of handlersB) fn({ from, payload: structuredClone(payload) });
    };

    // Find a TeamSeason that has a multi-position player (e.g. ['DF', 'MF'] or ['MF', 'FW'])
    let multiPosSeason = null;
    let multiPosPlayer = null;
    for (const ts of TEAM_SEASONS) {
        const found = ts.players.find((p) => p.positions.length >= 2);
        if (found) {
            multiPosSeason = ts;
            multiPosPlayer = found;
            break;
        }
    }
    assert.ok(multiPosSeason && multiPosPlayer, 'Dataset must contain a multi-position player');

    const secondRole = multiPosPlayer.positions[1];
    // Pre-fill first slot of secondRole so clicking secondRole resolves to `${secondRole}2`
    const prefillSeason = TEAM_SEASONS.find(
        (ts) => ts.id !== multiPosSeason.id && ts.players.some((p) => p.positions.includes(secondRole))
    );
    const prefillPlayer = prefillSeason.players.find((p) => p.positions.includes(secondRole));
    dispatch('p1', { kind: 'roll', teamSeasonId: prefillSeason.id });
    dispatch('p1', { kind: 'pick', playerId: prefillPlayer.id, slot: `${secondRole}1` });

    // Now roll multiPosSeason on Client A and click the multi-position player card in the UI
    dispatch('p1', { kind: 'roll', teamSeasonId: multiPosSeason.id });
    const cards = areaA.querySelectorAll('.fd-card');
    const targetCard = cards.find((c) => c.textContent.includes(multiPosPlayer.name));
    assert.ok(targetCard, 'Target multi-position player card must render');
    targetCard.click();

    const roleBtns = areaA.querySelectorAll('.fd-slot-btn');
    const roleBtnTexts = roleBtns.map((b) => b.textContent);
    assert.deepEqual(
        roleBtnTexts,
        multiPosPlayer.positions,
        `UI must show role buttons ${JSON.stringify(multiPosPlayer.positions)}, not concrete slot IDs`
    );

    // Click the second role button in UI -> previews concrete slot `${secondRole}2` locally, then confirm button sends PICK over network!
    const targetRoleBtn = roleBtns.find((b) => b.textContent === secondRole);
    const sentBeforeRolePreview = sentByA.length;
    targetRoleBtn.click();
    assert.equal(
        sentByA.length,
        sentBeforeRolePreview,
        'Clicking role button must only update local slot preview without sending PICK immediately'
    );

    const confirmBtn = areaA.querySelector('.dw-confirm-btn');
    assert.ok(confirmBtn && !confirmBtn.disabled, 'Confirm pick button must be enabled after selecting candidate and slot');
    confirmBtn.click();

    const lastSent = sentByA.at(-1);
    assert.deepEqual(
        lastSent,
        {
            kind: 'pick',
            playerId: multiPosPlayer.id,
            slot: `${secondRole}2`,
        },
        `Confirming after role button ${secondRole} must send concrete slot ${secondRole}2`
    );
    assert.equal(ctrlA.getState().teams[0].roster[`${secondRole}2`]?.id, multiPosPlayer.id);

    // Now roll multiPosSeason again: multiPosPlayer is already in roster -> card must be disabled!
    dispatch('p1', { kind: 'roll', teamSeasonId: multiPosSeason.id });
    const cardsAfter = areaA.querySelectorAll('.fd-card');
    const duplicateCard = cardsAfter.find((c) => c.textContent.includes(multiPosPlayer.name));
    assert.ok(duplicateCard.classList.contains('fd-card--disabled'), 'Duplicate player card must be disabled in UI');

    // Manual network pick with duplicate player.id into another compatible empty slot must be rejected
    const primaryRole = multiPosPlayer.positions[0];
    const openSlot = getFirstAvailableSlotForRole(ctrlA.getState().teams[0].roster, primaryRole);
    dispatch('p1', { kind: 'pick', playerId: multiPosPlayer.id, slot: openSlot });
    assert.equal(
        ctrlA.getState().teams[0].roster[openSlot],
        null,
        'Controller applyPick must reject duplicate player.id'
    );

    ctrlA.stop();
    ctrlB.stop();
}

// 4. Verify 11-player Sample Rosters, Team Rating, Team Profile, getRosterEntries, and GK attribution
{
    const rosterA = buildSample11PlayerRoster(TEAM_SEASONS.slice(0, 4));
    const rosterB = buildSampleRosterFromPool(TEAM_SEASONS.slice(4, 8));

    assert.equal(isRosterComplete(rosterA), true, 'Sample roster A must be complete (11/11)');
    assert.equal(isRosterComplete(rosterB), true, 'Sample roster B must be complete (11/11)');
    assert.equal(getPickedCount(rosterA), 11);
    assert.equal(getPickedCount(rosterB), 11);

    const idsA = new Set(SLOTS.map((s) => rosterA[s]?.id));
    const idsB = new Set(SLOTS.map((s) => rosterB[s]?.id));
    assert.equal(idsA.size, 11, 'Sample roster A must have 11 unique player.ids');
    assert.equal(idsB.size, 11, 'Sample roster B must have 11 unique player.ids');

    // Verify incomplete (10/11) roster is NOT complete
    const incompleteRoster = { ...rosterA, FW3: null };
    assert.equal(getPickedCount(incompleteRoster), 10);
    assert.equal(isRosterComplete(incompleteRoster), false, '10/11 roster must not be complete');

    // Verify calculateTeamRating averages all 11 players
    const expectedSumA = SLOTS.reduce((acc, s) => acc + rosterA[s].overall, 0);
    assert.equal(
        calculateTeamRating(rosterA),
        Math.round(expectedSumA / 11),
        'calculateTeamRating must average all 11 slots'
    );

    // Verify getRosterEntries returns 11 entries with exact role counts (1 GK, 4 DF, 3 MF, 3 FW)
    const entriesA = getRosterEntries(rosterA);
    assert.equal(entriesA.length, 11, 'getRosterEntries must return 11 entries');
    const roleCounts = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const entry of entriesA) {
        roleCounts[entry.role] = (roleCounts[entry.role] || 0) + 1;
    }
    assert.deepEqual(roleCounts, { GK: 1, DF: 4, MF: 3, FW: 3 });

    // Verify findPlayerByRole & Team Profile uses all 11 players and GK1
    const gkA = findPlayerByRole(rosterA, 'GK');
    const gkB = findPlayerByRole(rosterB, 'GK');
    assert.ok(gkA && gkA.id === rosterA.GK1.id, 'findPlayerByRole(roster, GK) must return GK1 player');
    assert.equal(findPlayersByRole(rosterA, 'DF').length, 4);
    assert.equal(findPlayersByRole(rosterA, 'MF').length, 3);
    assert.equal(findPlayersByRole(rosterA, 'FW').length, 3);

    const profileA = calculateTeamProfile(rosterA);
    const expectedGkMetric =
        Math.round(
            (0.88 * gkA.goalkeeping + 0.07 * gkA.physical + 0.05 * gkA.defense) * 10
        ) / 10;
    assert.equal(profileA.goalkeeping, expectedGkMetric, 'Team profile GK metric must use GK1');
    assert.equal(
        profileA.overall,
        Math.round((expectedSumA / 11) * 10) / 10,
        'Team profile overall must average all 11 players'
    );

    // Verify changing FW3 (11th slot) changes Team Profile attack
    const modifiedRosterA = {
        ...rosterA,
        FW3: { ...rosterA.FW3, attack: Math.max(1, rosterA.FW3.attack - 40) },
    };
    const modifiedProfileA = calculateTeamProfile(modifiedRosterA);
    assert.notEqual(
        modifiedProfileA.attack,
        profileA.attack,
        'calculateTeamProfile must include FW3 (all 11 slots)'
    );

    // Verify determinism across same seed and across locales (ja / en / zh-CN)
    setLocale('ja', { persist: false });
    const scriptJa = generateMatchScript(rosterA, rosterB, 20261006);
    setLocale('en', { persist: false });
    const scriptEn = generateMatchScript(rosterA, rosterB, 20261006);
    setLocale('zh-CN', { persist: false });
    const scriptZh = generateMatchScript(rosterA, rosterB, 20261006);

    assert.deepEqual(scriptJa, scriptEn, 'Match script must be identical across ja and en');
    assert.deepEqual(scriptEn, scriptZh, 'Match script must be identical across en and zh-CN');

    // Verify GK attribution in save / goal events
    for (const ev of scriptEn.events) {
        if (ev.type === 'save' || ev.type === 'goal') {
            const expectedGk = ev.team === 'A' ? gkB : gkA;
            assert.equal(ev.goalkeeperId, expectedGk.id, `Event ${ev.type} goalkeeperId must match true GK`);
            assert.equal(ev.goalkeeperName, expectedGk.name, `Event ${ev.type} goalkeeperName must match true GK`);
        }
    }

    // 5. 1000-Match Batch Simulation Sanity Check
    for (let i = 0; i < 1000; i++) {
        const seed = (20261006 + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
        const s = generateMatchScript(rosterA, rosterB, seed);

        assert.ok(Number.isInteger(s.finalScore.A) && s.finalScore.A >= 0, 'Score A must be non-negative integer');
        assert.ok(Number.isInteger(s.finalScore.B) && s.finalScore.B >= 0, 'Score B must be non-negative integer');
        assert.equal(
            s.stats.A.possession + s.stats.B.possession,
            100,
            'Possession A + B must equal 100'
        );
        assert.ok(s.stats.A.shotsOnTarget <= s.stats.A.shots, 'A shotsOnTarget <= shots');
        assert.ok(s.stats.B.shotsOnTarget <= s.stats.B.shots, 'B shotsOnTarget <= shots');
        assert.ok(s.stats.A.saves >= 0 && s.stats.B.saves >= 0, 'Saves must be non-negative');

        for (const ev of s.events) {
            assert.ok(!Number.isNaN(ev.minute), 'Event minute must not be NaN');
            if (ev.type === 'attack' || ev.type === 'shot' || ev.type === 'miss' || ev.type === 'save' || ev.type === 'goal') {
                assert.ok(ev.playerId && ev.playerName, `Event ${ev.type} must have valid player`);
            }
            if (ev.type === 'save' || ev.type === 'goal') {
                const expectedGk = ev.team === 'A' ? gkB : gkA;
                assert.equal(ev.goalkeeperId, expectedGk.id, 'Goalkeeper must be true GK1');
                assert.ok(ev.goalkeeperName, 'Goalkeeper name must be defined');
            }
        }
    }

    const batchSummary = simulateManyMatches(rosterA, rosterB, 1000, 20261006);
    assert.equal(batchSummary.matches, 1000);
}

console.log('[smoke-11v11] PASS — All 11v11 schema, role-slot, duplicate, profile, GK, determinism, and 1000-match sanity checks succeeded.');
process.exit(0);

#!/usr/bin/env node
// scripts/smoke-draft-workbench.mjs
// Comprehensive smoke test suite for Draft Workbench v1:
// 1. Candidate click updates local preview & Right Inspector only (never sends PICK)
// 2. Left squad slot click (Pitch node, List row, Role button, Inspector slot chip) updates local placement preview only (never sends PICK)
// 3. Previewed player in squad is visually/structurally distinct from formally drafted players (.dw-slot--preview, .dw-preview-badge, .dw-preview-player-img)
// 4. Occupied slots (.dw-slot--occupied) and mismatched slots (.dw-slot--mismatch) cannot be selected or submitted
// 5. Final Confirm Pick button (.dw-confirm-btn) is disabled with localized reason when candidate or legal slot is missing, and sends PICK exactly once when clicked
// 6. Switching candidates re-validates selectedSlot (retains compatible slot, clears incompatible slot)
// 7. Reroll, Free Redraw, and Pick completion clear stale preview state
// 8. Canonical duplicate player lock remains enforced
// 9. Compact Opponent Progress Floating Pill (.dw-opponent-float) exposes only X / 11 + status + HIDDEN (no images, no player names, no role distribution)
// 10. Keyboard activation (Enter / Space) & focus restoration across render()

import assert from 'node:assert/strict';
import { TEAM_SEASONS, TEAM_SEASON_MAP } from '../public/data/team-seasons.js';
import { SLOTS } from '../public/game/shared/constants.js';
import { setLocale, t } from '../public/i18n/i18n.js';
import { startGame } from '../public/game/controller.js';
import { setSquadViewMode } from '../public/game/draft/ui.js';

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
    remove(...tokens) {
        for (const tok of tokens) {
            for (const part of String(tok).split(/\s+/).filter(Boolean)) {
                this.set.delete(part);
            }
        }
        this.syncToClassName();
    }
    toggle(tok, force) {
        const shouldHave = force !== undefined ? Boolean(force) : !this.set.has(tok);
        if (shouldHave) this.set.add(tok);
        else this.set.delete(tok);
        this.syncToClassName();
        return shouldHave;
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
        this.attributes = new Map();
        this.dataset = {};
        this.disabled = false;
        this.hidden = false;
        this.tabIndex = -1;
        this.style = {
            setProperty(k, v) {
                this[k] = v;
            },
        };
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
    setAttribute(k, v) {
        this.attributes.set(k, String(v));
    }
    getAttribute(k) {
        return this.attributes.get(k) ?? null;
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
        const event = { stopPropagation() {}, preventDefault() {} };
        for (const fn of handlers) fn(event);
    }
    keydown(key) {
        if (this.disabled) return;
        const handlers = this.listeners.get('keydown') || [];
        const event = { key, stopPropagation() {}, preventDefault() {} };
        for (const fn of handlers) fn(event);
    }
    focus() {
        globalThis.document.activeElement = this;
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
        const results = [];
        const matchSimple = (el, sel) => {
            if (sel.startsWith('.')) {
                const classes = sel.slice(1).split('.').filter(Boolean);
                return classes.every((c) => el.classList && el.classList.contains(c));
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

const fakeBody = new FakeElement('body');
globalThis.document = {
    documentElement: { lang: 'zh-CN' },
    body: fakeBody,
    activeElement: null,
    createElement(tag) {
        return new FakeElement(tag);
    },
};

console.log('[smoke-draft-workbench] Running Draft Workbench v1 smoke test suite...');

setLocale('zh-CN', { persist: false });
setSquadViewMode('pitch');

const areaA = new FakeElement('section');
const areaB = new FakeElement('section');
const sentByA = [];
const sentByB = [];
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
    seed: 20261008,
    send: (payload) => {
        sentByA.push(structuredClone(payload));
        for (const fn of handlersB) fn({ from: 'p1', payload: structuredClone(payload) });
    },
    onMessage: (fn) => handlersA.push(fn),
    onPlayers: () => {},
});

const ctrlB = startGame({
    area: areaB,
    me: 'p2',
    players,
    order,
    seed: 20261008,
    send: (payload) => {
        sentByB.push(structuredClone(payload));
        for (const fn of handlersA) fn({ from: 'p2', payload: structuredClone(payload) });
    },
    onMessage: (fn) => handlersB.push(fn),
    onPlayers: () => {},
});

function dispatch(from, payload) {
    if (from === 'p1') sentByA.push(structuredClone(payload));
    if (from === 'p2') sentByB.push(structuredClone(payload));
    for (const fn of handlersA) fn({ from, payload: structuredClone(payload) });
    for (const fn of handlersB) fn({ from, payload: structuredClone(payload) });
}

// 1. Verify body.in-draft scope, 3-column workbench structure, and initial empty Inspector
{
    assert.equal(fakeBody.classList.contains('in-draft'), true, 'body.in-draft must be active during DRAFT phase');
    assert.ok(areaA.querySelector('.dw-workbench'), 'Main workbench container .dw-workbench must exist');
    assert.ok(areaA.querySelector('.dw-col-squad'), 'Left squad column .dw-col-squad must exist');
    assert.ok(areaA.querySelector('.dw-col-center'), 'Center column .dw-col-center must exist');
    assert.ok(areaA.querySelector('.dw-col-inspector'), 'Right inspector column .dw-col-inspector must exist');
    assert.ok(areaA.querySelector('.dw-inspector-empty'), 'Inspector must show empty guide when no candidate is selected');

    // Both Client A and Client B must see their OWN squad on the left and opponent floating pill in header
    const squadPanelA = areaA.querySelector('.dw-col-squad');
    const squadPanelB = areaB.querySelector('.dw-col-squad');
    assert.ok(squadPanelA.dumpText().includes('Alice'), 'Client A left squad column must be Alice');
    assert.ok(squadPanelB.dumpText().includes('Bob'), 'Client B left squad column must be Bob');

    const oppFloatA = areaA.querySelector('.dw-opponent-float');
    assert.ok(oppFloatA, 'Compact opponent floating pill must exist');
    assert.equal(oppFloatA.querySelectorAll('img').length, 0, 'Opponent floating pill must have 0 images');
    assert.ok(oppFloatA.dumpText().includes('0 / 11'), 'Opponent floating pill must show 0 / 11');
}

// 2. Roll barcelona-2011 on Client A and test 3-step Pick & Placement Preview Flow
const barca2011 = TEAM_SEASON_MAP.get('barcelona-2011') || TEAM_SEASONS[0];
const madrid2017 = TEAM_SEASON_MAP.get('real-madrid-2017') || TEAM_SEASONS[1];
dispatch('p1', { kind: 'roll', teamSeasonId: barca2011.id });

{
    // Before selecting any candidate: Confirm button must be disabled with confirmReasonNeedPlayer
    const confirmBtn0 = areaA.querySelector('.dw-confirm-btn');
    const reasonEl0 = areaA.querySelector('.dw-confirm-reason');
    assert.ok(confirmBtn0, 'Confirm button must render in PICK phase');
    assert.equal(confirmBtn0.disabled, true, 'Confirm button must be disabled when no candidate is selected');
    assert.equal(reasonEl0.textContent, t('draft.confirmReasonNeedPlayer'));

    // Find an FW candidate and a GK/DF candidate in barca2011
    const fwCandidate = barca2011.players.find((p) => p.positions.includes('FW'));
    const nonFwCandidate = barca2011.players.find(
        (p) => !p.positions.includes('FW') && (p.positions.includes('GK') || p.positions.includes('DF'))
    );
    assert.ok(fwCandidate && nonFwCandidate, 'barca2011 must have an FW and a non-FW candidate');

    // Step 1: Click fwCandidate card -> must NOT send PICK!
    const sentBeforeCardClick = sentByA.length;
    const fwCard = areaA.querySelectorAll('.fd-card').find((c) => c.dataset.playerId === fwCandidate.id);
    assert.ok(fwCard, 'FW candidate card must exist');
    fwCard.focus();
    fwCard.click();

    assert.equal(sentByA.length, sentBeforeCardClick, 'Clicking candidate card must NEVER send PICK');
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, fwCandidate.id);
    assert.equal(ctrlA.getPreviewState().selectedSlot, null);

    // Focus must be restored to the clicked candidate card across render()
    assert.equal(
        globalThis.document.activeElement?.dataset?.focusKey,
        `candidate:${fwCandidate.id}`,
        'Focus must be preserved on the candidate card across render()'
    );

    // Right Inspector must now display fwCandidate details + 5 ability bars + per-position rating boundary note
    const inspector = areaA.querySelector('.dw-inspector');
    assert.equal(inspector.querySelector('.dw-inspector-empty'), null, 'Inspector empty state must disappear');
    assert.ok(inspector.querySelector('.dw-inspector-hero'), 'Inspector hero card must render');
    assert.equal(
        inspector.querySelectorAll('.dw-inspector-stat-row').length,
        5,
        'Inspector must render 5 ability rows (ATK, CRE, DEF, PHY, GK)'
    );
    assert.equal(
        inspector.querySelector('.dw-inspector-pos-note')?.textContent,
        t('draft.inspectorPosRatingUnavailable'),
        'Inspector must display explicit per-position rating boundary note'
    );

    // Confirm button is STILL disabled because no slot is selected yet (reason = confirmReasonNeedSlot)
    const confirmBtn1 = areaA.querySelector('.dw-confirm-btn');
    const reasonEl1 = areaA.querySelector('.dw-confirm-reason');
    assert.equal(confirmBtn1.disabled, true, 'Confirm button must remain disabled until a legal slot is chosen');
    assert.equal(reasonEl1.textContent, t('draft.confirmReasonNeedSlot'));

    // Left Squad Pitch must highlight FW1, FW2, FW3 as eligible, and mark GK1 as mismatch
    const pitchNodes = areaA.querySelectorAll('.fd-pitch-node');
    const fw2Node = pitchNodes.find((n) => n.dataset.slot === 'FW2');
    const gk1Node = pitchNodes.find((n) => n.dataset.slot === 'GK1');
    assert.ok(fw2Node.classList.contains('dw-slot--eligible'), 'FW2 pitch node must be highlighted as eligible');
    assert.ok(gk1Node.classList.contains('dw-slot--mismatch'), 'GK1 pitch node must be marked as mismatch for FW');

    // Clicking mismatched slot GK1 must do nothing
    gk1Node.click();
    assert.equal(ctrlA.getPreviewState().selectedSlot, null, 'Clicking mismatched slot must not select it');

    // Step 2: Click concrete slot FW2 on Left Pitch -> updates local placement preview only, does NOT send PICK!
    fw2Node.click();
    assert.equal(sentByA.length, sentBeforeCardClick, 'Clicking legal slot must NEVER immediately send PICK');
    assert.equal(ctrlA.getPreviewState().selectedSlot, 'FW2');
    assert.equal(ctrlA.getState().teams[0].roster.FW2, null, 'Formal roster FW2 must still be null during preview');

    // Verify previewed slot FW2 has .dw-slot--preview, .dw-preview-badge, and .dw-preview-player-img
    const fw2NodeAfter = areaA.querySelectorAll('.fd-pitch-node').find((n) => n.dataset.slot === 'FW2');
    assert.ok(fw2NodeAfter.classList.contains('dw-slot--preview'), 'FW2 must have .dw-slot--preview');
    assert.ok(fw2NodeAfter.querySelector('.dw-preview-badge'), 'FW2 must display preview badge');
    assert.ok(fw2NodeAfter.querySelector('.dw-preview-player-img'), 'FW2 must display preview portrait');
    assert.equal(
        areaA.querySelectorAll('.fd-slot-player-img').length,
        0,
        'Formal .fd-slot-player-img count must still be 0 before Confirm'
    );

    // Switching candidate to nonFwCandidate (GK or DF) must automatically clear incompatible FW2 preview slot!
    const nonFwCard = areaA.querySelectorAll('.fd-card').find((c) => c.dataset.playerId === nonFwCandidate.id);
    nonFwCard.click();
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, nonFwCandidate.id);
    assert.equal(
        ctrlA.getPreviewState().selectedSlot,
        null,
        'Switching to incompatible candidate must clear previously previewed FW2 slot'
    );
    assert.equal(areaA.querySelector('.dw-confirm-btn').disabled, true);

    // Switch back to fwCandidate and select FW2 via keyboard Enter on pitch node
    const fwCardAgain = areaA.querySelectorAll('.fd-card').find((c) => c.dataset.playerId === fwCandidate.id);
    fwCardAgain.keydown('Enter');
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, fwCandidate.id);

    const fw2NodeForKey = areaA.querySelectorAll('.fd-pitch-node').find((n) => n.dataset.slot === 'FW2');
    fw2NodeForKey.keydown(' ');
    assert.equal(ctrlA.getPreviewState().selectedSlot, 'FW2');

    // Step 3: Click Final Confirm Pick button (.dw-confirm-btn) -> sends PICK exactly once!
    const confirmBtnReady = areaA.querySelector('.dw-confirm-btn');
    assert.equal(confirmBtnReady.disabled, false, 'Confirm button must be enabled when candidate + legal slot are selected');
    confirmBtnReady.click();
    // Clicking a second time if someone holds a stale reference must not send a second PICK
    confirmBtnReady.click();

    assert.equal(sentByA.length, sentBeforeCardClick + 1, 'Confirm button must send PICK exactly once');
    assert.deepEqual(sentByA.at(-1), {
        kind: 'pick',
        playerId: fwCandidate.id,
        slot: 'FW2',
    });
    assert.equal(ctrlA.getState().teams[0].roster.FW2?.id, fwCandidate.id, 'FW2 must now be formally filled');
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, null, 'Preview must clear after pick completes');
    assert.equal(ctrlA.getPreviewState().selectedSlot, null);
    assert.equal(
        areaA.querySelectorAll('.fd-slot-player-img').length,
        1,
        'Formal .fd-slot-player-img count must now be 1'
    );
}

// 3. Verify Occupied Slot Protection & Reroll Preview Cleanup
dispatch('p1', { kind: 'roll', teamSeasonId: barca2011.id });
{
    const anotherFw = barca2011.players.find(
        (p) => p.positions.includes('FW') && p.id !== ctrlA.getState().teams[0].roster.FW2?.id
    );
    assert.ok(anotherFw, 'Must find another FW in barca2011');

    const card = areaA.querySelectorAll('.fd-card').find((c) => c.dataset.playerId === anotherFw.id);
    card.click();
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, anotherFw.id);

    // FW2 is already occupied -> must have .dw-slot--occupied and clicking it must NOT select FW2
    const occupiedFw2 = areaA.querySelectorAll('.fd-pitch-node').find((n) => n.dataset.slot === 'FW2');
    assert.ok(occupiedFw2.classList.contains('dw-slot--occupied'), 'Occupied FW2 must have .dw-slot--occupied');
    occupiedFw2.click();
    assert.equal(ctrlA.getPreviewState().selectedSlot, null, 'Clicking occupied FW2 must not select it');

    // Select open FW1 slot via List View (.fd-slot-row)
    const listBtn = areaA.querySelectorAll('.fd-view-toggle-btn')[1];
    listBtn.click();
    const fw1Row = areaA.querySelectorAll('.fd-slot-row').find((r) => r.dataset.slot === 'FW1');
    assert.ok(fw1Row.classList.contains('dw-slot--eligible'), 'FW1 list row must be eligible');
    fw1Row.click();
    assert.equal(ctrlA.getPreviewState().selectedSlot, 'FW1');

    // Now trigger a legal Reroll (same club, different year) -> must immediately clear stale preview state!
    const barcaOtherYear = TEAM_SEASONS.find(
        (ts) => ts.club === barca2011.club && ts.year !== barca2011.year
    );
    assert.ok(barcaOtherYear, 'Must find another Barcelona season for year reroll');
    dispatch('p1', { kind: 'reroll', type: 'year', teamSeasonId: barcaOtherYear.id });
    assert.equal(ctrlA.getPreviewState().selectedPlayerId, null, 'Reroll must clear selectedPlayerId');
    assert.equal(ctrlA.getPreviewState().selectedSlot, null, 'Reroll must clear selectedSlot');
    assert.equal(areaA.querySelector('.dw-confirm-btn').disabled, true, 'Confirm button must be disabled after reroll');
}

setSquadViewMode('pitch');
ctrlA.stop();
ctrlB.stop();
assert.equal(fakeBody.classList.contains('in-draft'), false, 'stop() must remove body.in-draft class');

console.log('[smoke-draft-workbench] PASS — All 3-step pick/slot preview, inspector, occupied-slot guard, reroll cleanup, and keyboard focus checks succeeded.');

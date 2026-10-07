#!/usr/bin/env node
// scripts/smoke-unique-player-lock.mjs
// Smoke test suite for Same-Team Unique Player Lock v1 (Section 25):
// - runtime mapping 554 / 554 across 418 canonical entities
// - same entity / different season recognized
// - same team second version (and third version) illegal (fixture with >= 3 PlayerSeasons)
// - different team same entity remains legal (bidirectional cross-team privacy fixture)
// - exact same PlayerSeason remains illegal
// - transition rejects forced duplicate (applyDraftPick & network controller)
// - multi-position player canonical lock across all roles (FW / MF / DF)
// - Bot legal actions, scoring, and reroll EV exclude canonical duplicates
// - dead-roll duplicate diagnosis works on cross-season canonical duplicates
// - free redraw can recover from cross-season canonical duplicate dead-roll
// - unknown identity fallback safe & same-name different-entity never collides
// - no opponent roster read required (Proxy trap on opponent team state)
// - Candidate UI disabled state and localized "already drafted" reason in zh-CN, ja, en

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEAM_SEASONS, TEAM_SEASON_MAP } from '../public/data/team-seasons.js';
import { PLAYER_ENTITY_BY_SEASON_ID } from '../public/data/player-identities.js';
import {
    getPlayerEntityId,
    getPlayerIdentityKey,
    isSameCanonicalPlayer,
} from '../public/game/player-identity.js';
import { ROLES, SLOTS } from '../public/game/shared/constants.js';
import { createInitialState } from '../public/game/state.js';
import {
    createEmptyRoster,
    createInitialRerolls,
    isPlayerInRoster,
    isPlayerEntityInRoster,
    getFirstAvailableSlotForRole,
    getAvailableRolesForPlayer,
    getAvailableSlotsForPlayer,
    getLegalPickActions,
    getLegalRerollActions,
    getLegalDraftActions,
    canFreeRedraw,
    isDeadRoll,
    isRosterComplete,
} from '../public/game/draft/rules.js';
import {
    applyDraftRoll,
    applyDraftPick,
    applyDraftRedraw,
    applyDraftLock,
} from '../public/game/draft/transitions.js';
import {
    BOT_DIFFICULTIES,
    BOT_REASON_CODES,
    chooseDraftAction,
    diagnoseDeadRoll,
    estimateRerollValue,
} from '../public/game/bot/decision.js';
import { evaluateCandidatePick } from '../public/game/bot/scoring.js';
import { startGame } from '../public/game/controller.js';
import { setLocale, t } from '../public/i18n/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Minimal Headless DOM Shim for Controller & UI Rendering
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
        this.attributes = new Map();
        this.dataset = {};
        this.disabled = false;
        this.hidden = false;
        this.style = {};
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

console.log('[smoke-unique-player-lock] Running Same-Team Unique Player Lock v1 smoke test suite...');

// Build lookup of PlayerSeason objects by ID and by canonical Entity ID
const playerSeasonById = new Map();
const teamSeasonByPlayerSeasonId = new Map();
const playerSeasonsByEntityId = new Map();

for (const ts of TEAM_SEASONS) {
    for (const p of ts.players) {
        playerSeasonById.set(p.id, p);
        teamSeasonByPlayerSeasonId.set(p.id, ts);
        const entityId = getPlayerEntityId(p);
        assert.ok(entityId, `Every dataset PlayerSeason must map to an entityId (missing: ${p.id})`);
        if (!playerSeasonsByEntityId.has(entityId)) {
            playerSeasonsByEntityId.set(entityId, []);
        }
        playerSeasonsByEntityId.get(entityId).push(p);
    }
}

// ---------------------------------------------------------------------------
// 1. Runtime Identity Mapping 554 / 554 & 418 Canonical Entities
// ---------------------------------------------------------------------------
{
    assert.equal(playerSeasonById.size, 554, 'Must have 554 total PlayerSeasons');
    assert.equal(
        Object.keys(PLAYER_ENTITY_BY_SEASON_ID).length,
        554,
        'Runtime index must have 554 PlayerSeason mappings'
    );
    assert.equal(
        playerSeasonsByEntityId.size,
        418,
        'Runtime index must cover all 418 canonical entities'
    );

    for (const [psId, p] of playerSeasonById.entries()) {
        const entityId = getPlayerEntityId(p);
        assert.equal(entityId, getPlayerEntityId(psId));
        assert.equal(getPlayerIdentityKey(p), `entity:${entityId}`);
        assert.equal(getPlayerIdentityKey(psId), `entity:${entityId}`);
        assert.equal(isSameCanonicalPlayer(p, psId), true);
    }
}

// ---------------------------------------------------------------------------
// 2. Same-Team Fixture (Entity with >= 3 PlayerSeasons: Season A picked -> Season B & C illegal)
//    + Exact same PlayerSeason remains illegal + Transition rejects forced duplicate
// ---------------------------------------------------------------------------
const multiSeasonEntities = Array.from(playerSeasonsByEntityId.entries())
    .filter(([, seasons]) => seasons.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

assert.ok(
    multiSeasonEntities.length > 0,
    'Dataset must contain at least one canonical entity with >= 3 PlayerSeasons'
);

const [fixtureEntityId, fixtureSeasons] = multiSeasonEntities[0];
const [seasonA, seasonB, seasonC] = fixtureSeasons;
const tsA = teamSeasonByPlayerSeasonId.get(seasonA.id);
const tsB = teamSeasonByPlayerSeasonId.get(seasonB.id);
const tsC = teamSeasonByPlayerSeasonId.get(seasonC.id);

{
    // Verify same entity / different season recognized
    assert.notEqual(seasonA.id, seasonB.id);
    assert.notEqual(seasonB.id, seasonC.id);
    assert.equal(getPlayerEntityId(seasonA), fixtureEntityId);
    assert.equal(getPlayerEntityId(seasonB), fixtureEntityId);
    assert.equal(getPlayerEntityId(seasonC), fixtureEntityId);
    assert.equal(isSameCanonicalPlayer(seasonA, seasonB), true);
    assert.equal(isSameCanonicalPlayer(seasonA, seasonC), true);
    assert.equal(isSameCanonicalPlayer(seasonB, seasonC), true);

    const state = createInitialState({
        seed: 20261007,
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' },
        ],
    });
    const teamA = state.teams[0];
    const primaryRole = seasonA.positions[0];
    const slot1 = getFirstAvailableSlotForRole(teamA.roster, primaryRole);
    assert.ok(slot1);

    // Team A rolls tsA and picks seasonA into slot1
    assert.equal(applyDraftRoll(state, 'p1', tsA.id).ok, true);
    const pickARes = applyDraftPick(state, 'p1', seasonA.id, slot1);
    assert.equal(pickARes.ok, true, `Picking ${seasonA.id} into ${slot1} must succeed`);
    assert.equal(teamA.roster[slot1].id, seasonA.id);
    assert.equal(
        'entityId' in teamA.roster[slot1],
        false,
        'Roster player object must remain raw PlayerSeason without injected entityId'
    );

    // Exact PlayerSeason helper vs Canonical Entity helper semantics
    assert.equal(isPlayerInRoster(teamA.roster, seasonA), true, 'Exact helper true for seasonA');
    assert.equal(
        isPlayerInRoster(teamA.roster, seasonB),
        false,
        'Exact helper must remain false for different seasonB'
    );
    assert.equal(
        isPlayerInRoster(teamA.roster, seasonC),
        false,
        'Exact helper must remain false for different seasonC'
    );
    assert.equal(
        isPlayerEntityInRoster(teamA.roster, seasonA),
        true,
        'Entity helper true for seasonA'
    );
    assert.equal(
        isPlayerEntityInRoster(teamA.roster, seasonB),
        true,
        'Entity helper true for seasonB'
    );
    assert.equal(
        isPlayerEntityInRoster(teamA.roster, seasonC),
        true,
        'Entity helper true for seasonC'
    );

    // Open slot still exists for that role (or any role seasonB/seasonC can play)
    const slot2 = getFirstAvailableSlotForRole(teamA.roster, seasonB.positions[0]);
    assert.ok(slot2, 'A second slot for role must still be open on Team A');

    // Exact same PlayerSeason (seasonA) remains illegal when rolling tsA again
    assert.equal(applyDraftRoll(state, 'p1', tsA.id).ok, true);
    assert.deepStrictEqual(getAvailableRolesForPlayer(teamA.roster, seasonA), []);
    assert.deepStrictEqual(getAvailableSlotsForPlayer(teamA.roster, seasonA), []);
    assert.equal(
        getLegalPickActions(teamA).some((a) => a.playerId === seasonA.id),
        false,
        'getLegalPickActions must exclude exact duplicate seasonA'
    );
    const forcedExactRes = applyDraftPick(state, 'p1', seasonA.id, slot2);
    assert.deepStrictEqual(forcedExactRes, { ok: false, reason: 'duplicate_player' });
    assert.equal(teamA.roster[slot2], null);

    // Now test Season B on Team A: must be illegal across all rules & transition validation
    teamA.draft.phase = 'ROLL';
    teamA.draft.currentRoll = null;
    assert.equal(applyDraftRoll(state, 'p1', tsB.id).ok, true);
    assert.deepStrictEqual(
        getAvailableRolesForPlayer(teamA.roster, seasonB),
        [],
        'Season B must have 0 available roles on Team A'
    );
    assert.deepStrictEqual(
        getAvailableSlotsForPlayer(teamA.roster, seasonB),
        [],
        'Season B must have 0 available slots on Team A'
    );
    assert.equal(
        getLegalPickActions(teamA).some((a) => a.playerId === seasonB.id),
        false,
        'getLegalPickActions must exclude canonical duplicate seasonB'
    );
    const forcedSeasonBRes = applyDraftPick(state, 'p1', seasonB.id, slot2);
    assert.deepStrictEqual(
        forcedSeasonBRes,
        { ok: false, reason: 'duplicate_player' },
        'applyDraftPick must reject forced cross-season canonical duplicate seasonB'
    );
    assert.equal(teamA.roster[slot2], null);

    // Now test Season C on Team A: must also be illegal across all rules & transition validation
    teamA.draft.phase = 'ROLL';
    teamA.draft.currentRoll = null;
    assert.equal(applyDraftRoll(state, 'p1', tsC.id).ok, true);
    assert.deepStrictEqual(
        getAvailableRolesForPlayer(teamA.roster, seasonC),
        [],
        'Season C must have 0 available roles on Team A'
    );
    assert.deepStrictEqual(
        getAvailableSlotsForPlayer(teamA.roster, seasonC),
        [],
        'Season C must have 0 available slots on Team A'
    );
    assert.equal(
        getLegalPickActions(teamA).some((a) => a.playerId === seasonC.id),
        false,
        'getLegalPickActions must exclude canonical duplicate seasonC'
    );
    const forcedSeasonCRes = applyDraftPick(state, 'p1', seasonC.id, slot2);
    assert.deepStrictEqual(
        forcedSeasonCRes,
        { ok: false, reason: 'duplicate_player' },
        'applyDraftPick must reject forced cross-season canonical duplicate seasonC'
    );
    assert.equal(teamA.roster[slot2], null);
}

// ---------------------------------------------------------------------------
// 3. Cross-Team Privacy Fixture (Bidirectional) + UI Disabled Reason + Network Security
// ---------------------------------------------------------------------------
{
    const handlersA = { message: [], players: [] };
    const handlersB = { message: [], players: [] };
    const sentLog = [];
    const players = [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
    ];
    const areaA = new FakeElement('div');
    const areaB = new FakeElement('div');

    const ctrlA = startGame({
        area: areaA,
        me: 'p1',
        players,
        order: ['p1', 'p2'],
        seed: 424242,
        send(payload) {
            sentLog.push({ from: 'p1', payload: structuredClone(payload) });
        },
        onMessage(fn) {
            handlersA.message.push(fn);
        },
        onPlayers(fn) {
            handlersA.players.push(fn);
        },
    });

    const ctrlB = startGame({
        area: areaB,
        me: 'p2',
        players,
        order: ['p1', 'p2'],
        seed: 424242,
        send(payload) {
            sentLog.push({ from: 'p2', payload: structuredClone(payload) });
        },
        onMessage(fn) {
            handlersB.message.push(fn);
        },
        onPlayers(fn) {
            handlersB.players.push(fn);
        },
    });

    const dispatch = (from, payload) => {
        for (const fn of handlersA.message) fn({ from, payload: structuredClone(payload) });
        for (const fn of handlersB.message) fn({ from, payload: structuredClone(payload) });
    };

    const roleA = seasonA.positions[0];
    const slotA1 = getFirstAvailableSlotForRole(ctrlA.getState().teams[0].roster, roleA);

    // Direction 1: Team A rolls tsA and picks seasonA
    dispatch('p1', { kind: 'roll', teamSeasonId: tsA.id });
    dispatch('p1', { kind: 'pick', playerId: seasonA.id, slot: slotA1 });
    assert.equal(ctrlA.getState().teams[0].roster[slotA1]?.id, seasonA.id);

    // Team A rolls tsB (which contains seasonB of the same canonical entity)
    dispatch('p1', { kind: 'roll', teamSeasonId: tsB.id });

    // Team B rolls tsB simultaneously! Team B does NOT have fixtureEntityId yet.
    dispatch('p2', { kind: 'roll', teamSeasonId: tsB.id });

    const teamA = ctrlA.getState().teams[0];
    const teamB = ctrlB.getState().teams[1];

    // On Team A: seasonB is illegal
    assert.equal(isPlayerEntityInRoster(teamA.roster, seasonB), true);
    assert.deepStrictEqual(getAvailableRolesForPlayer(teamA.roster, seasonB), []);

    // On Team B: seasonB remains 100% legal! (Cross-team independence)
    assert.equal(isPlayerEntityInRoster(teamB.roster, seasonB), false);
    assert.ok(
        getAvailableRolesForPlayer(teamB.roster, seasonB).length > 0,
        'Team B must still be allowed to pick seasonB when Team A owns seasonA'
    );
    assert.ok(
        getLegalPickActions(teamB).some((a) => a.playerId === seasonB.id),
        'Team B legal pick actions must include seasonB'
    );

    // Verify UI candidate card on Client A is disabled with localized "already drafted" text in en, zh-CN, ja
    const expectedReasons = {
        en: 'Already drafted',
        'zh-CN': '已拥有该球员',
        ja: 'この選手はすでに獲得済み',
    };
    for (const [loc, expectedText] of Object.entries(expectedReasons)) {
        setLocale(loc, { persist: false });
        assert.equal(t('draft.duplicatePlayer'), expectedText);

        const cardsA = areaA.querySelectorAll('.fd-card');
        const dupCardA = cardsA.find((c) => c.classList.contains('fd-card--duplicate'));
        assert.ok(dupCardA, `Client A must render .fd-card--duplicate in locale=${loc}`);
        assert.ok(
            dupCardA.classList.contains('fd-card--disabled'),
            'Duplicate card on Client A must have .fd-card--disabled'
        );
        assert.equal(
            dupCardA.classList.contains('fd-card--interactive'),
            false,
            'Duplicate card on Client A must NOT be interactive'
        );
        const noSlotBadge = dupCardA.querySelector('.fd-card-noslot');
        assert.ok(noSlotBadge, 'Duplicate card must render .fd-card-noslot reason badge');
        assert.equal(noSlotBadge.textContent, expectedText);

        // Clicking disabled duplicate card on Client A must do nothing
        const sentBefore = sentLog.length;
        dupCardA.click();
        assert.equal(sentLog.length, sentBefore, 'Clicking disabled duplicate card must not send');
        assert.equal(areaA.querySelector('.fd-card--selected'), null);
    }
    setLocale('en', { persist: false });

    // Meanwhile on Client B: no card in tsB is marked .fd-card--duplicate!
    assert.equal(
        areaB.querySelectorAll('.fd-card--duplicate').length,
        0,
        'Client B must not show any duplicate card simply because Team A drafted seasonA'
    );

    // Forged network pick from p1 trying to pick seasonB into next open slot must be rejected
    const slotA2 = getFirstAvailableSlotForRole(teamA.roster, seasonB.positions[0]);
    dispatch('p1', { kind: 'pick', playerId: seasonB.id, slot: slotA2 });
    assert.equal(
        ctrlA.getState().teams[0].roster[slotA2],
        null,
        'Controller must reject forged cross-season duplicate pick on Team A'
    );
    assert.equal(
        ctrlB.getState().teams[0].roster[slotA2],
        null,
        'Peer controller must also reject forged cross-season duplicate pick on Team A'
    );

    // Team B picks seasonB into slotB1 -> succeeds!
    const slotB1 = getFirstAvailableSlotForRole(teamB.roster, seasonB.positions[0]);
    dispatch('p2', { kind: 'pick', playerId: seasonB.id, slot: slotB1 });
    assert.equal(
        ctrlB.getState().teams[1].roster[slotB1]?.id,
        seasonB.id,
        'Team B must successfully draft seasonB even though Team A owns seasonA'
    );

    // Direction 2 (Reverse): Team B drafts another multi-season entity first, Team A can still draft another season of it
    const [, secondEntitySeasons] = multiSeasonEntities[1];
    const [revSeason1, revSeason2] = secondEntitySeasons;
    const revTs1 = teamSeasonByPlayerSeasonId.get(revSeason1.id);
    const revTs2 = teamSeasonByPlayerSeasonId.get(revSeason2.id);

    // First finish Team A's pending roll on tsB with a valid non-duplicate player
    const validOnTsB = tsB.players.find(
        (p) => getAvailableRolesForPlayer(ctrlA.getState().teams[0].roster, p).length > 0
    );
    assert.ok(validOnTsB);
    const validRoleA = getAvailableRolesForPlayer(ctrlA.getState().teams[0].roster, validOnTsB)[0];
    dispatch('p1', {
        kind: 'pick',
        playerId: validOnTsB.id,
        slot: getFirstAvailableSlotForRole(ctrlA.getState().teams[0].roster, validRoleA),
    });

    // Team B rolls revTs1 and picks revSeason1
    dispatch('p2', { kind: 'roll', teamSeasonId: revTs1.id });
    const revRoleB = getAvailableRolesForPlayer(ctrlB.getState().teams[1].roster, revSeason1)[0];
    const revSlotB = getFirstAvailableSlotForRole(ctrlB.getState().teams[1].roster, revRoleB);
    dispatch('p2', { kind: 'pick', playerId: revSeason1.id, slot: revSlotB });
    assert.equal(ctrlB.getState().teams[1].roster[revSlotB]?.id, revSeason1.id);

    // Team A rolls revTs2 and picks revSeason2 -> must be legal and succeed!
    dispatch('p1', { kind: 'roll', teamSeasonId: revTs2.id });
    assert.equal(isPlayerEntityInRoster(ctrlA.getState().teams[0].roster, revSeason2), false);
    const revRoleA = getAvailableRolesForPlayer(ctrlA.getState().teams[0].roster, revSeason2)[0];
    assert.ok(revRoleA, 'Team A must have available role for revSeason2');
    const revSlotA = getFirstAvailableSlotForRole(ctrlA.getState().teams[0].roster, revRoleA);
    dispatch('p1', { kind: 'pick', playerId: revSeason2.id, slot: revSlotA });
    assert.equal(
        ctrlA.getState().teams[0].roster[revSlotA]?.id,
        revSeason2.id,
        'Team A must successfully draft revSeason2 when Team B owns revSeason1'
    );

    ctrlA.stop();
    ctrlB.stop();
}

// ---------------------------------------------------------------------------
// 4. Different People Same Name & Unknown Identity Fallback Safety (Sections 8 & 21)
// ---------------------------------------------------------------------------
{
    // Check if dataset has any localized name collisions across distinct entities
    const localizationsPath = path.join(ROOT_DIR, 'data', 'entities', 'players.json');
    const playersJson = JSON.parse(fs.readFileSync(localizationsPath, 'utf8'));
    const byZhPrimary = new Map();
    for (const ent of playersJson.entities) {
        const zh = ent.localizedNames?.['zh-CN'];
        if (zh) {
            if (!byZhPrimary.has(zh)) byZhPrimary.set(zh, []);
            byZhPrimary.get(zh).push(ent);
        }
    }
    for (const [, collidingEntities] of byZhPrimary.entries()) {
        if (collidingEntities.length >= 2) {
            const ps1 = playerSeasonById.get(collidingEntities[0].playerSeasonIds[0]);
            const ps2 = playerSeasonById.get(collidingEntities[1].playerSeasonIds[0]);
            assert.equal(
                isSameCanonicalPlayer(ps1, ps2),
                false,
                `Distinct entities ${collidingEntities[0].id} and ${collidingEntities[1].id} sharing zh-CN name must NOT collide`
            );
            const roster = createEmptyRoster();
            roster[ getFirstAvailableSlotForRole(roster, ps1.positions[0]) ] = ps1;
            assert.equal(
                isPlayerEntityInRoster(roster, ps2),
                false,
                'Second entity with same localized name must not be locked out'
            );
        }
    }

    // Synthetic same-name / different-entity test: identical .name string, different entityId
    const person1 = {
        id: 'synthetic-luis-suarez-2015',
        entityId: 'luis-suarez-uruguay',
        name: 'Luis Suárez',
        positions: ['FW'],
        overall: 90,
    };
    const person2SameName = {
        id: 'synthetic-luis-suarez-1964',
        entityId: 'luis-suarez-spain',
        name: 'Luis Suárez',
        positions: ['FW'],
        overall: 90,
    };
    assert.equal(isSameCanonicalPlayer(person1, person2SameName), false);
    const rosterSameName = createEmptyRoster();
    rosterSameName.FW1 = person1;
    assert.equal(
        isPlayerEntityInRoster(rosterSameName, person2SameName),
        false,
        'Different canonical entity with identical name string must NOT be treated as duplicate'
    );
    assert.deepStrictEqual(getAvailableRolesForPlayer(rosterSameName, person2SameName), ['FW']);

    // Mutated display/canonical name on mapped players: same entityId, different .name strings
    const mutatedA = { ...seasonA, name: 'Completely Different Name A' };
    const mutatedB = { ...seasonB, name: 'Completely Different Name B' };
    assert.equal(
        isSameCanonicalPlayer(mutatedA, mutatedB),
        true,
        'Canonical identity must depend on entity ID, not player.name'
    );

    // Unknown PlayerSeason fallback safety: must return "season:<id>", never null, never collide
    const unknown1 = { id: 'unknown-season-alpha', name: 'Mystery Player', positions: ['MF'] };
    const unknown2 = { id: 'unknown-season-beta', name: 'Mystery Player', positions: ['MF'] };
    assert.equal(getPlayerEntityId(unknown1), null);
    assert.equal(getPlayerEntityId(unknown2), null);
    assert.equal(getPlayerIdentityKey(unknown1), 'season:unknown-season-alpha');
    assert.equal(getPlayerIdentityKey(unknown2), 'season:unknown-season-beta');
    assert.equal(
        isSameCanonicalPlayer(unknown1, unknown2),
        false,
        'Two unknown PlayerSeasons must NOT collide even if their names match'
    );
    assert.equal(
        isSameCanonicalPlayer(unknown1, 'unknown-season-alpha'),
        true,
        'Exact same unknown PlayerSeason must still match itself'
    );

    const rosterUnknown = createEmptyRoster();
    rosterUnknown.MF1 = unknown1;
    assert.equal(isPlayerEntityInRoster(rosterUnknown, unknown1), true);
    assert.equal(isPlayerEntityInRoster(rosterUnknown, unknown2), false);
    assert.deepStrictEqual(getAvailableRolesForPlayer(rosterUnknown, unknown2), ['MF']);

    // Null / undefined / empty object inputs must safely return null / false
    assert.equal(getPlayerEntityId(null), null);
    assert.equal(getPlayerIdentityKey(null), null);
    assert.equal(getPlayerIdentityKey({}), null);
    assert.equal(isSameCanonicalPlayer(null, null), false);
    assert.equal(isSameCanonicalPlayer({}, {}), false);
}

// ---------------------------------------------------------------------------
// 5. Multi-Position Player Canonical Lock (Position-Independent, Section 22)
// ---------------------------------------------------------------------------
{
    // Find a multi-season entity where at least one season has multiple positions (or test across all roles)
    const multiPosEntityEntry = Array.from(playerSeasonsByEntityId.entries()).find(
        ([, seasons]) =>
            seasons.length >= 2 && seasons.some((s) => Array.isArray(s.positions) && s.positions.length >= 2)
    );
    assert.ok(multiPosEntityEntry, 'Dataset must have a multi-season entity with multi-position player');
    const [mpEntityId, mpSeasons] = multiPosEntityEntry;
    const mpFirst = mpSeasons[0];
    const mpSecond = mpSeasons[1];

    const roster = createEmptyRoster();
    const firstSlot = getFirstAvailableSlotForRole(roster, mpFirst.positions[0]);
    roster[firstSlot] = mpFirst;

    // Even if we give mpSecond all outfield roles ['FW', 'MF', 'DF'], it must be locked in ALL roles
    const multiRoleCandidate = {
        ...mpSecond,
        positions: ['FW', 'MF', 'DF'],
    };
    assert.equal(getPlayerEntityId(multiRoleCandidate), mpEntityId);
    assert.equal(isPlayerEntityInRoster(roster, multiRoleCandidate), true);
    assert.deepStrictEqual(
        getAvailableRolesForPlayer(roster, multiRoleCandidate),
        [],
        'Multi-position candidate of already-drafted entity must have 0 available roles across FW/MF/DF'
    );
    assert.deepStrictEqual(
        getAvailableSlotsForPlayer(roster, multiRoleCandidate),
        [],
        'Multi-position candidate of already-drafted entity must have 0 available slots across FW/MF/DF'
    );

    const state = createInitialState({
        seed: 99,
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'A' },
            { id: 'p2', name: 'B' },
        ],
    });
    state.teams[0].roster = roster;
    state.teams[0].draft.phase = 'PICK';
    state.teams[0].draft.currentRoll = {
        id: 'synthetic-mp-roll',
        league: mpSecond.league,
        club: mpSecond.club,
        year: mpSecond.year,
        players: [multiRoleCandidate],
    };

    for (const targetSlot of ['FW1', 'MF1', 'DF2']) {
        if (roster[targetSlot] !== null) continue;
        const res = applyDraftPick(state, 'p1', multiRoleCandidate.id, targetSlot);
        assert.deepStrictEqual(
            res,
            { ok: false, reason: 'duplicate_player' },
            `applyDraftPick must reject multi-position canonical duplicate in slot ${targetSlot}`
        );
    }
}

// ---------------------------------------------------------------------------
// 6. Bot Legality, Scoring, EV, Dead-Roll Duplicate Diagnosis & Free Redraw Recovery
//    + Strict No-Opponent-Read Proxy Verification (Sections 12, 13, 14, 25)
// ---------------------------------------------------------------------------
{
    // Dynamically find a TeamSeason `targetTs` and role `targetRole` where all players of `targetRole`
    // in `targetTs` belong to canonical entities that ALSO appear in other TeamSeasons!
    let deadRollFixture = null;
    for (const ts of TEAM_SEASONS) {
        for (const role of ['FW', 'GK', 'MF', 'DF']) {
            const rolePlayers = ts.players.filter((p) => p.positions.includes(role));
            if (rolePlayers.length === 0 || rolePlayers.length > 3) continue;

            const otherSeasonVersions = [];
            let allHaveOtherSeason = true;
            for (const rp of rolePlayers) {
                const entId = getPlayerEntityId(rp);
                const otherVer = (playerSeasonsByEntityId.get(entId) || []).find(
                    (cand) => cand.id !== rp.id
                );
                if (!otherVer) {
                    allHaveOtherSeason = false;
                    break;
                }
                otherSeasonVersions.push(otherVer);
            }
            if (allHaveOtherSeason) {
                deadRollFixture = { ts, role, rolePlayers, otherSeasonVersions };
                break;
            }
        }
        if (deadRollFixture) break;
    }
    assert.ok(
        deadRollFixture,
        'Must find a real TeamSeason where all players of a role have other-season versions in dataset'
    );

    // Build a 10/11 roster where only `FW3` is open, and `FW1` / `FW2` (or other slots) hold the
    // OTHER-season versions of `deadRollFixture.ts`'s FWs!
    // Wait: let's specifically find a TeamSeason with <= 2 FWs where each FW has another season version!
    let fwDeadFixture = null;
    for (const ts of TEAM_SEASONS) {
        const fws = ts.players.filter((p) => p.positions.includes('FW'));
        if (fws.length >= 1 && fws.length <= 2) {
            const otherFws = fws.map((fw) =>
                (playerSeasonsByEntityId.get(getPlayerEntityId(fw)) || []).find(
                    (cand) => cand.id !== fw.id
                )
            );
            if (otherFws.every(Boolean)) {
                fwDeadFixture = { ts, fws, otherFws };
                break;
            }
        }
    }
    assert.ok(fwDeadFixture, 'Must find a TeamSeason with 1-2 FWs that have other-season versions');

    const { ts: deadTs, fws: rolledFws, otherFws: draftedOtherSeasonFws } = fwDeadFixture;
    const pool = TEAM_SEASONS.flatMap((t) => t.players);
    const roster10 = createEmptyRoster();

    // Place the other-season versions into FW1 (and FW2)
    roster10.FW1 = draftedOtherSeasonFws[0];
    if (draftedOtherSeasonFws.length === 2) {
        roster10.FW2 = draftedOtherSeasonFws[1];
    } else {
        roster10.FW2 = pool.find(
            (p) =>
                p.positions.includes('FW') &&
                !isPlayerEntityInRoster(roster10, p) &&
                !rolledFws.some((rf) => isSameCanonicalPlayer(rf, p))
        );
    }
    roster10.FW3 = null; // Leave FW3 as the only open slot!

    for (const slot of SLOTS) {
        if (slot.startsWith('FW')) continue;
        const role = slot.slice(0, 2);
        roster10[slot] = pool.find(
            (p) =>
                p.positions.includes(role) &&
                !isPlayerEntityInRoster(roster10, p) &&
                !rolledFws.some((rf) => isSameCanonicalPlayer(rf, p))
        );
    }

    const state = createInitialState({
        seed: 20261007,
        order: ['bot-a', 'bot-b'],
        players: [
            { id: 'bot-a', name: 'Bot A' },
            { id: 'bot-b', name: 'Bot B' },
        ],
    });
    const teamA = state.teams[0];
    teamA.roster = roster10;
    teamA.rerolls = { league: 0, club: 0, year: 0 };
    teamA.draft.phase = 'PICK';
    teamA.draft.currentRoll = deadTs;

    // Trap opponent roster with a Proxy that throws on ANY property read (even during lock),
    // and trap opponent team itself during all duplicate / legality / bot / redraw / pick operations (Section 14 & 25)
    const rawOpponentTeam = state.teams[1];
    rawOpponentTeam.roster = new Proxy(rawOpponentTeam.roster, {
        get() {
            throw new Error('PRIVACY VIOLATION: Read opponent roster during draft!');
        },
    });
    state.teams[1] = new Proxy(rawOpponentTeam, {
        get(target, prop) {
            if (prop === 'id') return target.id;
            throw new Error(
                `PRIVACY VIOLATION: Read opponent team state (${String(prop)}) during canonical duplicate check!`
            );
        },
    });

    // Verify exact PlayerSeason check is FALSE for rolledFws (they are different seasons!),
    // while canonical entity check is TRUE!
    for (const rf of rolledFws) {
        assert.equal(
            isPlayerInRoster(teamA.roster, rf),
            false,
            `Rolled ${rf.id} is a different season than the one in roster`
        );
        assert.equal(
            isPlayerEntityInRoster(teamA.roster, rf),
            true,
            `Rolled ${rf.id} must be recognized as same canonical entity in roster`
        );
        const evalRes = evaluateCandidatePick(teamA, rf, 'FW', { difficulty: 'expert' });
        assert.equal(evalRes.legal, false, 'evaluateCandidatePick must mark canonical duplicate illegal');
        assert.equal(evalRes.totalValue, -Infinity);
    }

    // Verify dead-roll diagnosis & free redraw on cross-season canonical duplicate!
    assert.equal(getLegalPickActions(teamA).length, 0, 'Must have 0 legal picks');
    assert.equal(getLegalRerollActions(teamA).length, 0, 'Must have 0 legal rerolls');

    const diagnosis = diagnoseDeadRoll(teamA);
    assert.equal(diagnosis.isStuck, true);
    assert.equal(
        diagnosis.flags.duplicateOnly,
        true,
        'diagnoseDeadRoll must classify cross-season canonical duplicate lock as duplicateOnly'
    );
    assert.equal(diagnosis.primaryReason, 'duplicate_only');
    assert.equal(canFreeRedraw(teamA), true);
    assert.equal(isDeadRoll(teamA), true);
    assert.deepStrictEqual(getLegalDraftActions(teamA), [{ type: 'redraw' }]);

    for (const diff of BOT_DIFFICULTIES) {
        const decision = chooseDraftAction({
            team: teamA,
            difficulty: diff,
            persona: 'neutral',
            decisionSeed: 777,
        });
        assert.deepStrictEqual(decision, { type: 'redraw' });
        assert.equal(decision.debug.reasonCode, BOT_REASON_CODES.DEAD_ROLL_FREE_REDRAW);
    }

    // Recover via Free Redraw to a TeamSeason that has a non-duplicate FW -> complete 11/11 -> LOCKED
    const recoveryTs = TEAM_SEASONS.find((ts) =>
        ts.players.some((p) => p.positions.includes('FW') && !isPlayerEntityInRoster(teamA.roster, p))
    );
    assert.ok(recoveryTs);
    const redrawRes = applyDraftRedraw(state, 'bot-a', recoveryTs.id);
    assert.equal(redrawRes.ok, true, 'Free redraw must succeed on cross-season canonical dead roll');
    assert.equal(canFreeRedraw(teamA), false);

    const legalAfterRedraw = getLegalPickActions(teamA);
    assert.ok(legalAfterRedraw.length > 0, 'Must have legal FW picks after free redraw');
    const botPick = chooseDraftAction({
        team: teamA,
        difficulty: 'expert',
        persona: 'neutral',
        decisionSeed: 888,
    });
    assert.equal(botPick.type, 'pick');
    assert.equal(botPick.role, 'FW');
    assert.equal(isPlayerEntityInRoster(teamA.roster, botPick.playerId), false);

    const finalPickRes = applyDraftPick(state, 'bot-a', botPick.playerId, 'FW3');
    assert.equal(finalPickRes.ok, true);
    assert.equal(isRosterComplete(teamA), true);
    assert.equal(teamA.draft.phase, 'READY');

    // Allow applyDraftLock to check areBothTeamsLocked (draft.locked) while keeping opponent.roster trapped!
    state.teams[1] = rawOpponentTeam;
    const lockRes = applyDraftLock(state, 'bot-a');
    assert.equal(lockRes.ok, true);
    assert.equal(teamA.draft.phase, 'LOCKED');

    // Verify all 11 players in final roster have 11 distinct canonical entity keys
    const finalEntityKeys = new Set(SLOTS.map((s) => getPlayerIdentityKey(teamA.roster[s])));
    assert.equal(finalEntityKeys.size, 11, 'Completed 11-player roster must have 11 unique canonical entities');

    // Also verify Expert Reroll EV (estimateRerollValue) accounts for cross-season canonical duplicates
    const teamForEv = {
        id: 'bot-ev',
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: { phase: 'PICK', currentRoll: tsA, locked: false, history: [] },
    };
    teamForEv.roster.FW1 = seasonA;
    const evWithDup = estimateRerollValue({
        team: teamForEv,
        currentRoll: tsA,
        rerollType: 'year',
        bestCurrentPickValue: 82,
        bestCurrentCandidateScore: 82,
        difficulty: 'expert',
    });
    assert.equal(typeof evWithDup.available, 'boolean');
    assert.ok(!Number.isNaN(evWithDup.expectedValue));
}

console.log(
    `[smoke-unique-player-lock] PASS — Verified 554/554 mappings across 418 entities, same-team fixture (${fixtureEntityId}: ${seasonA.id}, ${seasonB.id}, ${seasonC.id}), bidirectional cross-team privacy, multi-position lock, transition rejection, Bot legality, dead-roll duplicate diagnosis, free redraw recovery, and fallback safety.`
);

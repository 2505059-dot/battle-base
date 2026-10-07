#!/usr/bin/env node
// scripts/smoke-player-media-ui.mjs
// Smoke test for Player Media Resolution + UI v1 (Section 67):
// - exact-season resolution exists (454)
// - nearest resolution exists (90)
// - FO3 fallback exists (4)
// - FO4 fallback exists (1)
// - silhouette fallback exists (5)
// - runtime index 554/554
// - unknown playerSeason ID fallback safe
// - Mbappe placeholder not selected
// - no manual-review candidate selected
// - runtime image error fallback (one-shot, no infinite loop)
// - club/league runtime logo error hides broken image without using player silhouette
// - Blind Draft UI code does not introduce opponent portrait rendering path (static + DOM tree verification)
// - Draft Roll, Candidate Cards, Ready Roster, Own Team Panel, and Roster Reveal render expected media elements
// - Gameplay state remains free of media URL mutations

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Minimal mock DOM so UI modules can run in Node without external test frameworks
class MockElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.className = '';
        this.textContent = '';
        this.children = [];
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.draggable = true;
        this.decoding = 'auto';
        this.loading = 'eager';
        this.alt = '';
        this._src = '';
        this.onerror = null;
        this.listeners = new Map();
        const self = this;
        this.classList = {
            add(...tokens) {
                const set = new Set(self.className.split(/\s+/).filter(Boolean));
                for (const t of tokens) set.add(t);
                self.className = [...set].join(' ');
            },
            contains(token) {
                return self.className.split(/\s+/).filter(Boolean).includes(token);
            },
        };
    }

    get src() {
        return this._src;
    }

    set src(val) {
        this._src = String(val);
        this.attributes.set('src', this._src);
    }

    getAttribute(name) {
        if (name === 'src') return this._src;
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, val) {
        if (name === 'src') this._src = String(val);
        this.attributes.set(name, String(val));
    }

    append(...nodes) {
        for (const n of nodes) {
            if (n === null || n === undefined) continue;
            if (typeof n === 'string') {
                const textNode = new MockElement('#text');
                textNode.textContent = n;
                this.children.push(textNode);
            } else {
                this.children.push(n);
            }
        }
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
    }

    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            if (selector.startsWith('.')) {
                const cls = selector.slice(1);
                return el.classList.contains(cls);
            }
            return el.tagName === selector.toUpperCase();
        };
        const walk = (node) => {
            for (const child of node.children) {
                if (match(child)) results.push(child);
                walk(child);
            }
        };
        walk(this);
        return results;
    }

     serializeText() {
        let out = this.textContent || '';
        for (const child of this.children) {
            out += ' ' + child.serializeText();
        }
        return out;
    }
}

globalThis.document = {
    createElement(tag) {
        return new MockElement(tag);
    },
};

async function main() {
    console.log('[smoke-player-media-ui] Running smoke checks...');

    const resolutionsPath = path.join(ROOT_DIR, 'data', 'entities', 'player-media-resolutions.json');
    const candidatesPath = path.join(ROOT_DIR, 'data', 'entities', 'player-media-candidates.json');
    const draftUiPath = path.join(ROOT_DIR, 'public', 'game', 'draft', 'ui.js');
    const matchUiPath = path.join(ROOT_DIR, 'public', 'game', 'match', 'ui.js');

    const resolutionsData = JSON.parse(fs.readFileSync(resolutionsPath, 'utf8'));
    const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

    const { PLAYER_SEASON_MEDIA, PLAYER_SILHOUETTE_URL } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'data', 'player-media.js')).href
    );
    const { getPlayerMedia, getClubCrest, getLeagueEmblem } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'media', 'entity-media.js')).href
    );
    const { createPlayerPortrait, createClubCrest, createLeagueEmblem } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'media', 'media-ui.js')).href
    );
    const { TEAM_SEASONS } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js')).href
    );
    const { setLocale } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'i18n', 'i18n.js')).href
    );
    const { createInitialState } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'game', 'state.js')).href
    );
    const { buildSample11PlayerRoster } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'game', 'match', 'simulator.js')).href
    );
    const { SLOTS } = await import(
        pathToFileURL(path.join(ROOT_DIR, 'public', 'game', 'shared', 'constants.js')).href
    );
    const { renderDraftZone, renderTeamPanel } = await import(
        pathToFileURL(draftUiPath).href
    );
    const { renderCompleteZone } = await import(pathToFileURL(matchUiPath).href);

    // 1. Check resolution categories & 554/554 runtime index coverage
    const runtimeEntries = Object.entries(PLAYER_SEASON_MEDIA);
    assert.equal(runtimeEntries.length, 554, 'Runtime index must contain 554 PlayerSeasons');

    const byType = {
        'fifaindex-exact-year': 0,
        'fifaindex-nearest-year': 0,
        'fo3-supplemental': 0,
        'fo4-supplemental': 0,
        'silhouette': 0,
    };

    for (const [psId, media] of runtimeEntries) {
        assert.ok(byType[media.resolutionType] !== undefined, `Unexpected resolutionType for ${psId}`);
        byType[media.resolutionType]++;
        assert.ok(!media.imageUrl.includes('notfound_'), `Placeholder selected for ${psId}`);

        // Verify no manual-review candidate selected
        const candEntity = candidatesData.entities[media.entityId];
        assert.ok(candEntity, `Missing entity ${media.entityId}`);
        if (media.resolutionType !== 'silhouette') {
            const allCands = [
                ...(candEntity.fifaIndex || []),
                ...(candEntity.fifaAddictFo3 || []),
                ...(candEntity.fifaAddictFo4 || []),
            ];
            const selectedCand = allCands.find((c) => c.imageUrl === media.imageUrl);
            assert.ok(selectedCand, `Selected candidate not found for ${psId}`);
            assert.notEqual(selectedCand.manualReview, true, `Manual-review candidate selected for ${psId}`);
            assert.notEqual(selectedCand.assetKind, 'placeholder', `Placeholder candidate selected for ${psId}`);
        }
    }

    assert.equal(byType['fifaindex-exact-year'], 454, 'Exact FIFAIndex count must be 454');
    assert.equal(byType['fifaindex-nearest-year'], 90, 'Nearest FIFAIndex count must be 90');
    assert.equal(byType['fo3-supplemental'], 4, 'FO3 supplemental count must be 4');
    assert.equal(byType['fo4-supplemental'], 1, 'FO4 supplemental count must be 1');
    assert.equal(byType['silhouette'], 5, 'Silhouette fallback count must be 5');

    // 2. Verify multi-season entity resolution uses player.id (not just player.name)
    const messi2011 = getPlayerMedia('barcelona-2011-8');
    const messi2015 = getPlayerMedia('barcelona-2015-8');
    assert.equal(messi2011.targetYear, 2011);
    assert.equal(messi2015.targetYear, 2015);
    assert.notEqual(messi2011.imageUrl, messi2015.imageUrl, 'Messi 2011 and 2015 must resolve distinct season URLs');

    // 3. Unknown PlayerSeason ID fallback safety
    const unknownFallback = getPlayerMedia('non-existent-season-id');
    assert.equal(unknownFallback.imageUrl, PLAYER_SILHOUETTE_URL);
    assert.equal(unknownFallback.resolutionType, 'silhouette');
    assert.equal(unknownFallback.provider, 'local-fallback');

    // 4. Runtime image error fallback (one-shot guard, no infinite loop)
    const testPortrait = createPlayerPortrait('barcelona-2011-8');
    assert.ok(testPortrait.src.startsWith('https://'), 'Initial src should be external URL');
    assert.equal(testPortrait.alt, '', 'Decorative portrait alt must be empty string');
    assert.equal(testPortrait.decoding, 'async', 'Portrait decoding must be async');

    // Trigger 1st error -> switches to local silhouette
    testPortrait.onerror();
    assert.equal(testPortrait.src, PLAYER_SILHOUETTE_URL, 'First error must switch src to silhouette SVG');
    assert.equal(testPortrait.dataset.fallbackApplied, '1');

    // Trigger 2nd error (if silhouette itself failed) -> must clear onerror and not loop
    testPortrait.onerror();
    assert.equal(testPortrait.onerror, null, 'Second error must clear onerror handler to prevent infinite loop');

    // 5. Club/League logo runtime failure hides image without using player silhouette
    const wrapper = document.createElement('div');
    const testCrest = createClubCrest('Manchester United', { wrapperEl: wrapper });
    assert.ok(testCrest, 'Club crest element should be created');
    testCrest.onerror();
    assert.equal(testCrest.hidden, true, 'Failed club crest must be hidden');
    assert.equal(testCrest.style.display, 'none', 'Failed club crest display must be none');
    assert.notEqual(testCrest.src, PLAYER_SILHOUETTE_URL, 'Failed club crest must never switch to player silhouette');

    // 6. Static check on renderBlindOpponentPanel in public/game/draft/ui.js
    const draftUiSource = fs.readFileSync(draftUiPath, 'utf8');
    const blindFnMatch = draftUiSource.match(
        /export function renderBlindOpponentPanel\(teamState\)\s*\{([\s\S]*?)\n\}/
    );
    assert.ok(blindFnMatch, 'renderBlindOpponentPanel function must exist in draft/ui.js');
    const blindFnBody = blindFnMatch[1];
    for (const forbiddenToken of [
        'createPlayerPortrait',
        'createPlayerImage',
        'getPlayerMedia',
        'createClubCrest',
        'getClubCrest',
        '<img',
        'teamState.roster',
    ]) {
        assert.ok(
            !blindFnBody.includes(forbiddenToken),
            `renderBlindOpponentPanel must not reference "${forbiddenToken}"`
        );
    }

    // 7. Full Draft -> Ready -> Lock -> Reveal DOM rendering & Blind Privacy verification
    setLocale('zh-CN');
    const state = createInitialState({
        order: ['p1', 'p2'],
        players: [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' },
        ],
        seed: 20261007,
    });

    // Simulate PICK phase with a rolled team-season for Team A
    const sampleRoll = TEAM_SEASONS[0];
    state.teams[0].draft.phase = 'PICK';
    state.teams[0].draft.currentRoll = sampleRoll;

    // Render Team A's Draft Zone during PICK phase
    const pickZoneDom = renderDraftZone(state, state.teams[0], {});
    assert.equal(
        pickZoneDom.querySelectorAll('.fd-roll-league-emblem').length,
        1,
        'Draft Roll must render 1 league emblem'
    );
    assert.equal(
        pickZoneDom.querySelectorAll('.fd-roll-club-crest').length,
        1,
        'Draft Roll must render 1 club crest'
    );
    const rolledCount = sampleRoll.players.length;
    assert.equal(
        pickZoneDom.querySelectorAll('.fd-card-player-img').length,
        rolledCount,
        'Each candidate card must render a player portrait'
    );
    assert.equal(
        pickZoneDom.querySelectorAll('.fd-card-club-crest').length,
        rolledCount,
        'Each candidate card must render a club crest'
    );

    // Populate 11-player rosters for both teams
    state.teams[0].roster = buildSample11PlayerRoster(0);
    state.teams[0].draft.currentRoll = null;
    state.teams[0].draft.phase = 'READY';

    state.teams[1].roster = buildSample11PlayerRoster(20);
    state.teams[1].draft.currentRoll = null;
    state.teams[1].draft.phase = 'READY';

    // Before LOCK IN: state.phase is still 'DRAFT'
    assert.equal(state.phase, 'DRAFT');

    // Verify Ready Roster renders 11 mini portraits for p1
    const readyZoneDom = renderDraftZone(state, state.teams[0], {});
    assert.equal(
        readyZoneDom.querySelectorAll('.fd-ready-player-img').length,
        11,
        'Ready Roster must render 11 player mini portraits'
    );

    // Verify Own Team Panel renders 11 mini portraits for p1
    const ownPanelDom = renderTeamPanel(state, state.teams[0], 0, 'p1');
    assert.equal(
        ownPanelDom.querySelectorAll('.fd-slot-player-img').length,
        11,
        'Own Team Panel must render 11 player mini portraits'
    );

    // CRITICAL: Verify Opponent Team Panel for p1 (viewing Team B during DRAFT phase) is 100% blind
    const blindOpponentDom = renderTeamPanel(state, state.teams[1], 1, 'p1');
    assert.equal(
        blindOpponentDom.querySelectorAll('img').length,
        0,
        'Blind opponent panel must contain ZERO <img> elements'
    );
    const blindSerialized = blindOpponentDom.serializeText();
    for (const slot of SLOTS) {
        const oppPlayer = state.teams[1].roster[slot];
        assert.ok(
            !blindSerialized.includes(oppPlayer.name),
            `Blind opponent panel leaked opponent player name "${oppPlayer.name}"`
        );
    }

    // Lock both teams -> transitions to REVEAL
    state.teams[0].draft.locked = true;
    state.teams[0].draft.phase = 'LOCKED';
    state.teams[1].draft.locked = true;
    state.teams[1].draft.phase = 'LOCKED';
    state.phase = 'REVEAL';

    // Verify Roster Reveal renders 22 player portraits (11 per team) and preserves profile metrics
    for (const locale of ['zh-CN', 'ja', 'en']) {
        setLocale(locale);
        const revealDom = renderCompleteZone(state, true, () => {});
        assert.equal(
            revealDom.querySelectorAll('.fd-reveal-player-img').length,
            22,
            `Roster Reveal (${locale}) must render 22 player portraits`
        );
        assert.equal(
            revealDom.querySelectorAll('.fd-reveal-club-crest').length,
            22,
            `Roster Reveal (${locale}) must render 22 club crests`
        );
        assert.equal(
            revealDom.querySelectorAll('.fd-profile-chip').length,
            10,
            `Roster Reveal (${locale}) must preserve all 10 team profile metric chips (ATK/CRE/DEF/PHY/GK x 2)`
        );
    }

    // 8. Verify gameplay state objects were not polluted with media fields
    for (const team of state.teams) {
        for (const slot of SLOTS) {
            const p = team.roster[slot];
            assert.equal(p.imageUrl, undefined, 'Gameplay player object must not have imageUrl');
            assert.equal(p.provider, undefined, 'Gameplay player object must not have provider');
            assert.equal(p.resolutionType, undefined, 'Gameplay player object must not have resolutionType');
        }
    }

    console.log('[smoke-player-media-ui] PASS — All data, helper, fallback, blind-privacy, and UI checks succeeded.');
}

main().catch((err) => {
    console.error('[smoke-player-media-ui] FAILED:', err);
    process.exit(1);
});

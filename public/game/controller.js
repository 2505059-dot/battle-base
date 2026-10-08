// Main Game Controller — coordinates state, network messages, Draft rules, Match engine, and localized UI rendering

import { t, subscribeLocaleChange } from '../i18n/i18n.js';
import { el } from './shared/dom.js';
import { REROLL_TYPES } from './shared/constants.js';
import {
    createInitialState,
    getMyTeam,
    canTeamRoll,
    canTeamPick,
    canTeamLock,
    areBothTeamsLocked,
} from './state.js';
import { generateInitialRollTeamSeason } from './draft/random.js';
import {
    generateRerollTeamSeason,
    canFreeRedraw,
} from './draft/rules.js';
import {
    applyDraftRoll,
    applyDraftReroll,
    applyDraftRedraw,
    applyDraftPick,
    applyDraftLock as applyDraftLockTransition,
} from './draft/transitions.js';
import {
    MOBILE_TABS,
    createDraftPreviewState,
    clearDraftPreview,
    reconcileDraftPreview,
    selectPreviewCandidate,
    selectPreviewSlot,
    getConfirmPickStatus,
} from './draft/preview-state.js';
import {
    renderHeader,
    renderMobileWorkbenchTabs,
    renderDraftZone,
    renderTeamPanel,
} from './draft/ui.js';
import { renderPlayerInspector } from './draft/inspector-ui.js';
import { MATCH_SIM_CONFIG } from './match/config.js';
import { generateMatchScript } from './match/engine.js';
import { renderCompleteZone, renderMatchZone, scrollFeedToBottom } from './match/ui.js';

function syncDraftBodyScope(isDraft) {
    if (typeof document !== 'undefined' && document.body && document.body.classList) {
        if (typeof document.body.classList.toggle === 'function') {
            document.body.classList.toggle('in-draft', Boolean(isDraft));
        }
    }
}

function captureFocusAndScroll(root) {
    const snapshot = {
        focusKey: null,
        scrollBySelector: {},
    };
    if (!root || typeof root.querySelector !== 'function') return snapshot;

    for (const sel of ['.dw-candidates-scroll', '.fd-team-body', '.dw-inspector-body', '.dw-ready-roster-scroll']) {
        const container = root.querySelector(sel);
        if (container && typeof container.scrollTop === 'number' && container.scrollTop > 0) {
            snapshot.scrollBySelector[sel] = container.scrollTop;
        }
    }

    if (typeof document !== 'undefined' && document.activeElement) {
        let cur = document.activeElement;
        while (cur && cur !== root) {
            if (cur.dataset && cur.dataset.focusKey) {
                snapshot.focusKey = cur.dataset.focusKey;
                break;
            }
            cur = cur.parentNode ?? null;
        }
    }

    return snapshot;
}

function restoreFocusAndScroll(root, snapshot) {
    if (!root || !snapshot || typeof root.querySelector !== 'function') return;

    for (const [sel, top] of Object.entries(snapshot.scrollBySelector)) {
        const container = root.querySelector(sel);
        if (container) {
            container.scrollTop = top;
        }
    }

    if (snapshot.focusKey && typeof root.querySelectorAll === 'function') {
        const candidates = [
            ...root.querySelectorAll('.fd-card'),
            ...root.querySelectorAll('button'),
            ...root.querySelectorAll('.fd-pitch-node'),
            ...root.querySelectorAll('.fd-slot-row'),
        ];
        const target = candidates.find(
            (node) => node?.dataset?.focusKey === snapshot.focusKey && !node.disabled
        );
        if (target && typeof target.focus === 'function') {
            try {
                target.focus({ preventScroll: true });
            } catch {
                target.focus();
            }
        }
    }
}

export function startGame(ctx) {
    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    const root = el('div', 'fd-root ui-scope');
    ctx.area.append(root);

    // 2-player only check
    if (!Array.isArray(ctx.order) || ctx.order.length !== 2 || ctx.players.length !== 2) {
        syncDraftBodyScope(false);
        const renderOnlyTwoNotice = () => {
            root.replaceChildren(el('div', 'fd-only-two', t('draft.onlyTwoPlayers')));
        };
        renderOnlyTwoNotice();
        const unsubscribe = subscribeLocaleChange(() => {
            if (root.isConnected === false) {
                unsubscribe();
                return;
            }
            renderOnlyTwoNotice();
        });
        return;
    }

    const state = createInitialState(ctx);
    const preview = createDraftPreviewState();
    let submittingPick = false;
    let playbackTimer = null;

    function stopPlaybackTimer() {
        if (playbackTimer !== null) {
            clearInterval(playbackTimer);
            playbackTimer = null;
        }
    }

    function isTeamAPlayer() {
        return ctx.me === ctx.order[0];
    }

    // ----- State Transitions (Synced across both clients) -----

    function applyRoll(actorId, teamSeasonId) {
        const res = applyDraftRoll(state, actorId, teamSeasonId);
        if (!res.ok) return;
        if (actorId === ctx.me) {
            clearDraftPreview(preview);
            submittingPick = false;
        }
        render();
    }

    function applyReroll(actorId, type, teamSeasonId) {
        const res = applyDraftReroll(state, actorId, type, teamSeasonId);
        if (!res.ok) return;
        if (actorId === ctx.me) {
            clearDraftPreview(preview);
            submittingPick = false;
        }
        render();
    }

    function applyRedraw(actorId, teamSeasonId) {
        const res = applyDraftRedraw(state, actorId, teamSeasonId);
        if (!res.ok) return;
        if (actorId === ctx.me) {
            clearDraftPreview(preview);
            submittingPick = false;
        }
        render();
    }

    function applyPick(actorId, playerId, slot) {
        const res = applyDraftPick(state, actorId, playerId, slot);
        if (!res.ok) {
            if (actorId === ctx.me) {
                preview.pendingPickKey = null;
                submittingPick = false;
            }
            return;
        }
        if (actorId === ctx.me) {
            clearDraftPreview(preview);
            submittingPick = false;
        }
        render();
    }

    function applyDraftLock(actorId) {
        const res = applyDraftLockTransition(state, actorId);
        if (!res.ok) return;
        if (actorId === ctx.me) {
            clearDraftPreview(preview);
            submittingPick = false;
        }
        render();
    }

    function applyMatchStart(actorId, matchSeed) {
        if (state.phase !== 'REVEAL') return;
        if (!areBothTeamsLocked(state)) return;
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
                scrollFeedToBottom(root);
            } else {
                state.phase = 'RESULT';
                stopPlaybackTimer();
                render();
            }
        }, MATCH_SIM_CONFIG.playbackIntervalMs);
    }

    // ----- User Actions -----

    function handleRollClick() {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamRoll(myTeam)) return;
        const chosen = generateInitialRollTeamSeason();
        if (!chosen) return;
        clearDraftPreview(preview);
        ctx.send({ kind: 'roll', teamSeasonId: chosen.id });
        applyRoll(ctx.me, chosen.id);
    }

    function handleRerollClick(type) {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamPick(myTeam)) return;
        if (!REROLL_TYPES.includes(type) || myTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = generateRerollTeamSeason(myTeam.draft.currentRoll, type);
        if (!nextTeamSeason) return;

        clearDraftPreview(preview);
        ctx.send({ kind: 'reroll', type, teamSeasonId: nextTeamSeason.id });
        applyReroll(ctx.me, type, nextTeamSeason.id);
    }

    function handleRedrawClick() {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamPick(myTeam) || !canFreeRedraw(myTeam)) return;

        const nextTeamSeason = generateInitialRollTeamSeason();
        if (!nextTeamSeason) return;

        clearDraftPreview(preview);
        ctx.send({ kind: 'redraw', teamSeasonId: nextTeamSeason.id });
        applyRedraw(ctx.me, nextTeamSeason.id);
    }

    function handleSelectCandidate(playerId) {
        const myTeam = getMyTeam(state, ctx.me);
        const res = selectPreviewCandidate(state, myTeam, preview, playerId);
        if (!res.changed) return;
        render();
    }

    function handleSelectSlot(slotOrRole) {
        const myTeam = getMyTeam(state, ctx.me);
        const res = selectPreviewSlot(state, myTeam, preview, slotOrRole);
        if (!res.changed) return;
        render();
    }

    function handleClearPreview() {
        if (!preview.selectedPlayerId && !preview.selectedSlot) return;
        clearDraftPreview(preview);
        render();
    }

    function handleConfirmPick() {
        if (submittingPick) return;
        const myTeam = getMyTeam(state, ctx.me);
        const status = getConfirmPickStatus(state, myTeam, preview);
        if (!status.canConfirm || !status.candidate || !status.slot) return;

        const { candidate, slot } = status;
        const pickKey = `${myTeam.draft.currentRoll?.id ?? 'roll'}:${candidate.id}:${slot}`;
        if (preview.pendingPickKey === pickKey) return;

        submittingPick = true;
        preview.pendingPickKey = pickKey;

        ctx.send({ kind: 'pick', playerId: candidate.id, slot });
        applyPick(ctx.me, candidate.id, slot);
        submittingPick = false;
    }

    function handleSelectMobileTab(tabId) {
        if (!MOBILE_TABS.includes(tabId) || preview.mobileTab === tabId) return;
        preview.mobileTab = tabId;
        render();
    }

    function handleLockClick() {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamLock(myTeam)) return;
        ctx.send({ kind: 'draft_lock' });
        applyDraftLock(ctx.me);
    }

    function handleMatchStartClick() {
        if (state.phase !== 'REVEAL' || !areBothTeamsLocked(state) || !isTeamAPlayer() || state.match !== null) {
            return;
        }
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
        const myTeam = getMyTeam(state, ctx.me) ?? state.teams[0];
        reconcileDraftPreview(state, myTeam, preview);

        const isDraft = state.phase === 'DRAFT';
        syncDraftBodyScope(isDraft);

        const uiSnapshot = captureFocusAndScroll(root);
        root.replaceChildren();
        root.className = isDraft ? 'fd-root ui-scope dw-root ol3-draft-root' : 'fd-root ui-scope';

        root.append(renderHeader(state, ctx.me));

        if (state.opponentLeft) {
            root.append(el('div', 'fd-alert', t('draft.opponentLeft')));
        }

        if (isDraft) {
            root.append(renderMobileWorkbenchTabs(myTeam, preview, handleSelectMobileTab));

            const mainGrid = el('div', 'fd-main dw-workbench ol3-workbench');
            if (mainGrid.dataset) {
                mainGrid.dataset.mobileTab = preview.mobileTab;
            }

            const myIndex = state.teams[0]?.id === myTeam.id ? 0 : 1;
            const centerZone = renderDraftZone(
                state,
                myTeam,
                {
                    onRollClick: handleRollClick,
                    onRerollClick: handleRerollClick,
                    onRedrawClick: handleRedrawClick,
                    onSelectCandidate: handleSelectCandidate,
                    onSelectSlot: handleSelectSlot,
                    onConfirmPick: handleConfirmPick,
                    onClearPreview: handleClearPreview,
                    onLockClick: handleLockClick,
                    selectedPlayerId: preview.selectedPlayerId,
                    selectedSlot: preview.selectedSlot,
                    preview,
                },
                preview.selectedPlayerId
            );
            centerZone.classList.add('dw-col-center', 'ol3-col-candidates');

            const ownSquadCol = renderTeamPanel(state, myTeam, myIndex, ctx.me, {
                preview,
                onSelectSlot: handleSelectSlot,
                onConfirmPick: handleConfirmPick,
                onClearPreview: handleClearPreview,
            });
            ownSquadCol.classList.add('dw-col-squad', 'ol3-col-pitch');

            const inspectorCol = renderPlayerInspector(
                state,
                myTeam,
                {
                    onSelectSlot: handleSelectSlot,
                },
                preview
            );
            inspectorCol.classList.add('dw-col-inspector', 'ol3-col-inspector');

            mainGrid.append(centerZone, ownSquadCol, inspectorCol);
            root.append(mainGrid);
            restoreFocusAndScroll(root, uiSnapshot);
            return;
        }

        const mainGrid = el('div', 'fd-main');
        const teamAPanel = renderTeamPanel(state, state.teams[0], 0, ctx.me);
        const centerZone =
            state.phase === 'REVEAL'
                ? renderCompleteZone(state, isTeamAPlayer(), handleMatchStartClick)
                : renderMatchZone(state);
        const teamBPanel = renderTeamPanel(state, state.teams[1], 1, ctx.me);

        mainGrid.append(teamAPanel, centerZone, teamBPanel);
        root.append(mainGrid);
        restoreFocusAndScroll(root, uiSnapshot);
    }

    // Re-render in-place whenever the user changes locale (without resetting state or match playback)
    const unsubscribeLocale = subscribeLocaleChange(() => {
        if (root.isConnected === false) {
            unsubscribeLocale();
            syncDraftBodyScope(false);
            return;
        }
        render();
        if (state.phase === 'MATCH') {
            scrollFeedToBottom(root);
        }
    });

    // ----- Network Handlers -----

    ctx.onMessage(({ from, payload }) => {
        if (!payload || typeof payload !== 'object' || typeof from !== 'string') return;

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

        if (payload.kind === 'redraw' && typeof payload.teamSeasonId === 'string') {
            applyRedraw(from, payload.teamSeasonId);
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

        if (payload.kind === 'draft_lock') {
            applyDraftLock(from);
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

    return {
        getState: () => state,
        getPreviewState: () => ({ ...preview }),
        stop: () => {
            stopPlaybackTimer();
            syncDraftBodyScope(false);
        },
    };
}

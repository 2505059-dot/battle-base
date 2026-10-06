// Main Game Controller — coordinates state, network messages, Draft rules, Match engine, and localized UI rendering

import { TEAM_SEASON_MAP } from '../data/team-seasons.js';
import { t, subscribeLocaleChange } from '../i18n/i18n.js';
import { el } from './shared/dom.js';
import { SLOTS, REROLL_TYPES } from './shared/constants.js';
import {
    createInitialState,
    getTeamById,
    getMyTeam,
    canTeamRoll,
    canTeamPick,
    canTeamLock,
    areBothTeamsLocked,
    pushTeamHistory,
} from './state.js';
import { generateInitialRollTeamSeason } from './draft/random.js';
import {
    generateRerollTeamSeason,
    isValidRerollTransition,
    canPlayerFitSlot,
    isRosterComplete,
} from './draft/rules.js';
import { renderHeader, renderDraftZone, renderTeamPanel } from './draft/ui.js';
import { MATCH_SIM_CONFIG } from './match/config.js';
import { generateMatchScript } from './match/engine.js';
import { renderCompleteZone, renderMatchZone, scrollFeedToBottom } from './match/ui.js';

export function startGame(ctx) {
    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    const root = el('div', 'fd-root');
    ctx.area.append(root);

    // 2-player only check
    if (!Array.isArray(ctx.order) || ctx.order.length !== 2 || ctx.players.length !== 2) {
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
    let localSelectedPlayerId = null;
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
        if (state.phase !== 'DRAFT') return;
        const actorTeam = getTeamById(state, actorId);
        if (!actorTeam || !canTeamRoll(actorTeam)) return;

        const teamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!teamSeason) return;

        actorTeam.draft.currentRoll = teamSeason;
        actorTeam.draft.phase = 'PICK';
        if (actorId === ctx.me) {
            localSelectedPlayerId = null;
        }

        pushTeamHistory(actorTeam, {
            type: 'draft.roll',
            actorId: actorTeam.id,
            actorName: actorTeam.name,
            club: teamSeason.club,
            year: teamSeason.year,
        });
        render();
    }

    function applyReroll(actorId, type, teamSeasonId) {
        if (state.phase !== 'DRAFT') return;
        const actorTeam = getTeamById(state, actorId);
        if (!actorTeam || !canTeamPick(actorTeam)) return;

        if (!REROLL_TYPES.includes(type)) return;
        if (actorTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!nextTeamSeason) return;

        if (!isValidRerollTransition(actorTeam.draft.currentRoll, nextTeamSeason, type)) return;

        actorTeam.rerolls[type] -= 1;
        actorTeam.draft.currentRoll = nextTeamSeason;
        if (actorId === ctx.me) {
            localSelectedPlayerId = null;
        }

        pushTeamHistory(actorTeam, {
            type: 'draft.reroll',
            actorId: actorTeam.id,
            actorName: actorTeam.name,
            rerollType: type,
            club: nextTeamSeason.club,
            year: nextTeamSeason.year,
        });
        render();
    }

    function applyPick(actorId, playerId, slot) {
        if (state.phase !== 'DRAFT') return;
        const actorTeam = getTeamById(state, actorId);
        if (!actorTeam || !canTeamPick(actorTeam)) return;

        if (!SLOTS.includes(slot)) return;
        if (actorTeam.roster[slot] !== null) return;

        const candidate = actorTeam.draft.currentRoll.players.find((p) => p.id === playerId);
        if (!candidate) return;
        if (!canPlayerFitSlot(candidate, slot)) return;

        actorTeam.roster[slot] = candidate;
        actorTeam.draft.currentRoll = null;
        if (actorId === ctx.me) {
            localSelectedPlayerId = null;
        }

        if (isRosterComplete(actorTeam)) {
            actorTeam.draft.phase = 'READY';
        } else {
            actorTeam.draft.phase = 'ROLL';
        }

        pushTeamHistory(actorTeam, {
            type: 'draft.pick',
            actorId: actorTeam.id,
            actorName: actorTeam.name,
            playerId: candidate.id,
            playerName: candidate.name,
            slot,
        });

        render();
    }

    function applyDraftLock(actorId) {
        if (state.phase !== 'DRAFT') return;
        const actorTeam = getTeamById(state, actorId);
        if (!actorTeam || !canTeamLock(actorTeam)) return;

        actorTeam.draft.locked = true;
        actorTeam.draft.phase = 'LOCKED';
        actorTeam.draft.currentRoll = null;
        if (actorId === ctx.me) {
            localSelectedPlayerId = null;
        }

        pushTeamHistory(actorTeam, {
            type: 'draft.lock',
            actorId: actorTeam.id,
            actorName: actorTeam.name,
        });

        if (areBothTeamsLocked(state)) {
            state.phase = 'REVEAL';
        }

        render();
    }

    function applyMatchStart(actorId, matchSeed) {
        // Validate:
        // 1. State phase is REVEAL
        // 2. Both rosters are complete and locked
        // 3. actorId === ctx.order[0] (Team A)
        // 4. Match has not started yet
        // 5. matchSeed is a valid safe integer
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
        ctx.send({ kind: 'roll', teamSeasonId: chosen.id });
        applyRoll(ctx.me, chosen.id);
    }

    function handleRerollClick(type) {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamPick(myTeam)) return;
        if (!REROLL_TYPES.includes(type) || myTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = generateRerollTeamSeason(myTeam.draft.currentRoll, type);
        if (!nextTeamSeason) return;

        ctx.send({ kind: 'reroll', type, teamSeasonId: nextTeamSeason.id });
        applyReroll(ctx.me, type, nextTeamSeason.id);
    }

    function handleSelectCandidate(playerId) {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamPick(myTeam)) return;
        localSelectedPlayerId = localSelectedPlayerId === playerId ? null : playerId;
        render();
    }

    function handlePickSlot(playerId, slot) {
        const myTeam = getMyTeam(state, ctx.me);
        if (state.phase !== 'DRAFT' || !canTeamPick(myTeam)) return;
        ctx.send({ kind: 'pick', playerId, slot });
        applyPick(ctx.me, playerId, slot);
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
        root.replaceChildren();

        root.append(renderHeader(state, ctx.me));

        if (state.opponentLeft) {
            root.append(el('div', 'fd-alert', t('draft.opponentLeft')));
        }

        const mainGrid = el('div', 'fd-main');
        const teamAPanel = renderTeamPanel(state, state.teams[0], 0, ctx.me);
        let centerZone;
        if (state.phase === 'REVEAL') {
            centerZone = renderCompleteZone(state, isTeamAPlayer(), handleMatchStartClick);
        } else if (state.phase === 'MATCH' || state.phase === 'RESULT') {
            centerZone = renderMatchZone(state);
        } else {
            const myTeam = getMyTeam(state, ctx.me);
            centerZone = renderDraftZone(
                state,
                myTeam,
                {
                    onRollClick: handleRollClick,
                    onRerollClick: handleRerollClick,
                    onSelectCandidate: handleSelectCandidate,
                    onPickSlot: handlePickSlot,
                    onLockClick: handleLockClick,
                    selectedPlayerId: localSelectedPlayerId,
                },
                localSelectedPlayerId
            );
        }
        const teamBPanel = renderTeamPanel(state, state.teams[1], 1, ctx.me);

        mainGrid.append(teamAPanel, centerZone, teamBPanel);
        root.append(mainGrid);
    }

    // Re-render in-place whenever the user changes locale (without resetting state or match playback)
    const unsubscribeLocale = subscribeLocaleChange(() => {
        if (root.isConnected === false) {
            unsubscribeLocale();
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
        stop: stopPlaybackTimer,
    };
}


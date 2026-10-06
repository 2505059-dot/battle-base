// Main Game Controller — coordinates state, network messages, Draft rules, Match engine, and UI rendering

import { TEAM_SEASON_MAP } from '../data/team-seasons.js';
import { el } from './shared/dom.js';
import { SLOTS, REROLL_TYPES, REROLL_LABELS } from './shared/constants.js';
import { createInitialState, getCurrentTeam, isDraftPhase, pushHistory } from './state.js';
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

    // 2-player only check
    if (!Array.isArray(ctx.order) || ctx.order.length !== 2 || ctx.players.length !== 2) {
        const notice = el('div', 'fd-only-two', 'このプロトタイプは2人対戦専用です');
        ctx.area.append(notice);
        return;
    }

    const state = createInitialState(ctx);
    let playbackTimer = null;

    const root = el('div', 'fd-root');
    ctx.area.append(root);

    function stopPlaybackTimer() {
        if (playbackTimer !== null) {
            clearInterval(playbackTimer);
            playbackTimer = null;
        }
    }

    function isMyTurn() {
        return isDraftPhase(state) && getCurrentTeam(state).id === ctx.me;
    }

    function isTeamAPlayer() {
        return ctx.me === ctx.order[0];
    }

    // ----- State Transitions (Synced across both clients) -----

    function applyRoll(actorId, teamSeasonId) {
        if (state.phase !== 'ROLL') return;
        const currentTeam = getCurrentTeam(state);
        if (currentTeam.id !== actorId) return;

        const teamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!teamSeason) return;

        state.currentRoll = teamSeason;
        state.selectedPlayerId = null;
        state.phase = 'PICK';
        pushHistory(state, `${currentTeam.name} rolled ${teamSeason.club} ${teamSeason.year}`);
        render();
    }

    function applyReroll(actorId, type, teamSeasonId) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam(state);
        if (currentTeam.id !== actorId) return;

        if (!REROLL_TYPES.includes(type)) return;
        if (currentTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!nextTeamSeason) return;

        if (!isValidRerollTransition(state.currentRoll, nextTeamSeason, type)) return;

        currentTeam.rerolls[type] -= 1;
        state.currentRoll = nextTeamSeason;
        state.selectedPlayerId = null;

        pushHistory(state, `${currentTeam.name} used ${REROLL_LABELS[type]}`);
        pushHistory(state, `${currentTeam.name} rolled ${nextTeamSeason.club} ${nextTeamSeason.year}`);
        render();
    }

    function applyPick(actorId, playerId, slot) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam(state);
        if (currentTeam.id !== actorId) return;

        if (!SLOTS.includes(slot)) return;
        if (currentTeam.roster[slot] !== null) return;

        const candidate = state.currentRoll.players.find((p) => p.id === playerId);
        if (!candidate) return;
        if (!canPlayerFitSlot(candidate, slot)) return;

        currentTeam.roster[slot] = candidate;
        state.currentRoll = null;
        state.selectedPlayerId = null;
        pushHistory(state, `${currentTeam.name} picked ${candidate.name} → ${slot}`);

        if (state.teams.every((t) => isRosterComplete(t))) {
            state.phase = 'COMPLETE';
        } else {
            state.turnIndex = (state.turnIndex + 1) % 2;
            state.roundCount += 1;
            state.phase = 'ROLL';
        }

        render();
    }

    function applyMatchStart(actorId, matchSeed) {
        // Validate:
        // 1. Draft is complete
        // 2. actorId === ctx.order[0] (Team A)
        // 3. Match has not started yet
        // 4. matchSeed is a valid integer
        if (state.phase !== 'COMPLETE') return;
        if (!state.teams.every((t) => isRosterComplete(t))) return;
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
        if (!isMyTurn() || state.phase !== 'ROLL') return;
        const chosen = generateInitialRollTeamSeason();
        if (!chosen) return;
        ctx.send({ kind: 'roll', teamSeasonId: chosen.id });
        applyRoll(ctx.me, chosen.id);
    }

    function handleRerollClick(type) {
        if (!isMyTurn() || state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam(state);
        if (!REROLL_TYPES.includes(type) || currentTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = generateRerollTeamSeason(state.currentRoll, type);
        if (!nextTeamSeason) return;

        ctx.send({ kind: 'reroll', type, teamSeasonId: nextTeamSeason.id });
        applyReroll(ctx.me, type, nextTeamSeason.id);
    }

    function handleSelectCandidate(playerId) {
        if (!isMyTurn() || state.phase !== 'PICK') return;
        state.selectedPlayerId = state.selectedPlayerId === playerId ? null : playerId;
        render();
    }

    function handlePickSlot(playerId, slot) {
        if (!isMyTurn() || state.phase !== 'PICK') return;
        ctx.send({ kind: 'pick', playerId, slot });
        applyPick(ctx.me, playerId, slot);
    }

    function handleMatchStartClick() {
        if (state.phase !== 'COMPLETE' || !isTeamAPlayer() || state.match !== null) return;
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

    const draftHandlers = {
        onRollClick: handleRollClick,
        onRerollClick: handleRerollClick,
        onSelectCandidate: handleSelectCandidate,
        onPickSlot: handlePickSlot,
    };

    function render() {
        root.replaceChildren();

        root.append(renderHeader(state, ctx.me));

        if (state.opponentLeft) {
            root.append(el('div', 'fd-alert', '対戦相手が退出しました。'));
        }

        const mainGrid = el('div', 'fd-main');
        const teamAPanel = renderTeamPanel(state, state.teams[0], 0, ctx.me);
        let centerZone;
        if (state.phase === 'COMPLETE') {
            centerZone = renderCompleteZone(state, isTeamAPlayer(), handleMatchStartClick);
        } else if (state.phase === 'MATCH' || state.phase === 'RESULT') {
            centerZone = renderMatchZone(state);
        } else {
            centerZone = renderDraftZone(state, isMyTurn(), draftHandlers);
        }
        const teamBPanel = renderTeamPanel(state, state.teams[1], 1, ctx.me);

        mainGrid.append(teamAPanel, centerZone, teamBPanel);
        root.append(mainGrid);
    }

    // ----- Network Handlers -----

    ctx.onMessage(({ from, payload }) => {
        if (!payload || typeof payload !== 'object') return;

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
}

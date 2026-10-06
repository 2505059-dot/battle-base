// 5-a-side Football Fantasy Draft Prototype (2 Players)
// Uses Battle Base ctx: ctx.me, ctx.players, ctx.order, ctx.seed, ctx.send(), ctx.onMessage()

import {
    TEAM_SEASON_MAP,
    getLeagues,
    getClubsByLeague,
    getYearsByLeagueAndClub,
    findTeamSeason,
} from './data/team-seasons.js';

const SLOTS = ['GK', 'DF', 'MF', 'FW', 'FLEX'];
const REROLL_TYPES = ['league', 'club', 'year'];
const REROLL_LABELS = {
    league: 'League Reroll',
    club: 'Club Reroll',
    year: 'Year Reroll',
};
const MAX_HISTORY_ITEMS = 8;

// ---------- Random Selection & Hierarchical Roll Helpers ----------

function pickRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const index = Math.floor(Math.random() * arr.length);
    return arr[index];
}

function pickRandomExcept(arr, current) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const candidates = arr.filter((item) => item !== current);
    return pickRandom(candidates);
}

// 3-Stage Uniform Roll: League -> Club -> Year
function generateInitialRollTeamSeason() {
    const league = pickRandom(getLeagues());
    if (!league) return null;

    const club = pickRandom(getClubsByLeague(league));
    if (!club) return null;

    const year = pickRandom(getYearsByLeagueAndClub(league, club));
    if (year === null) return null;

    return findTeamSeason(league, club, year);
}

function hasRerollOption(currentRoll, type) {
    if (!currentRoll) return false;
    if (type === 'league') {
        return getLeagues().some((l) => l !== currentRoll.league);
    }
    if (type === 'club') {
        return getClubsByLeague(currentRoll.league).some((c) => c !== currentRoll.club);
    }
    if (type === 'year') {
        return getYearsByLeagueAndClub(currentRoll.league, currentRoll.club).some(
            (y) => y !== currentRoll.year
        );
    }
    return false;
}

function generateRerollTeamSeason(currentRoll, type) {
    if (!currentRoll) return null;

    if (type === 'league') {
        const newLeague = pickRandomExcept(getLeagues(), currentRoll.league);
        if (!newLeague) return null;
        const newClub = pickRandom(getClubsByLeague(newLeague));
        if (!newClub) return null;
        const newYear = pickRandom(getYearsByLeagueAndClub(newLeague, newClub));
        if (newYear === null) return null;
        return findTeamSeason(newLeague, newClub, newYear);
    }

    if (type === 'club') {
        const newClub = pickRandomExcept(getClubsByLeague(currentRoll.league), currentRoll.club);
        if (!newClub) return null;
        const newYear = pickRandom(getYearsByLeagueAndClub(currentRoll.league, newClub));
        if (newYear === null) return null;
        return findTeamSeason(currentRoll.league, newClub, newYear);
    }

    if (type === 'year') {
        const newYear = pickRandomExcept(
            getYearsByLeagueAndClub(currentRoll.league, currentRoll.club),
            currentRoll.year
        );
        if (newYear === null) return null;
        return findTeamSeason(currentRoll.league, currentRoll.club, newYear);
    }

    return null;
}

function isValidRerollTransition(prevRoll, nextRoll, type) {
    if (!prevRoll || !nextRoll) return false;
    if (type === 'league') {
        return nextRoll.league !== prevRoll.league;
    }
    if (type === 'club') {
        return nextRoll.league === prevRoll.league && nextRoll.club !== prevRoll.club;
    }
    if (type === 'year') {
        return (
            nextRoll.league === prevRoll.league &&
            nextRoll.club === prevRoll.club &&
            nextRoll.year !== prevRoll.year
        );
    }
    return false;
}

// ---------- Pure Rule Helpers ----------

function createEmptyRoster() {
    return {
        GK: null,
        DF: null,
        MF: null,
        FW: null,
        FLEX: null,
    };
}

function createInitialRerolls() {
    return {
        league: 1,
        club: 1,
        year: 1,
    };
}

function getPlayerOverall(player) {
    return player?.overall ?? player?.rating ?? 0;
}

function canPlayerFitSlot(player, slot) {
    if (!player || !Array.isArray(player.positions)) return false;
    switch (slot) {
        case 'GK':
            return player.positions.includes('GK');
        case 'DF':
            return player.positions.includes('DF');
        case 'MF':
            return player.positions.includes('MF');
        case 'FW':
            return player.positions.includes('FW');
        case 'FLEX':
            return !player.positions.includes('GK');
        default:
            return false;
    }
}

function getAvailableSlotsForPlayer(roster, player) {
    return SLOTS.filter((slot) => roster[slot] === null && canPlayerFitSlot(player, slot));
}

function isRosterComplete(teamState) {
    return SLOTS.every((slot) => teamState.roster[slot] !== null);
}

function getPickedCount(teamState) {
    return SLOTS.filter((slot) => teamState.roster[slot] !== null).length;
}

function calculateTeamRating(teamState) {
    const picked = SLOTS.map((slot) => teamState.roster[slot]).filter(Boolean);
    if (picked.length === 0) return 0;
    const sum = picked.reduce((acc, p) => acc + getPlayerOverall(p), 0);
    return Math.round(sum / picked.length);
}

function createInitialState(ctx) {
    const teams = ctx.order.map((id, idx) => ({
        id,
        label: idx === 0 ? 'TEAM A' : 'TEAM B',
        shortTag: idx === 0 ? 'A' : 'B',
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
    }));

    return {
        seed: ctx.seed,
        teams,
        turnIndex: 0,           // 0 or 1 (index into state.teams)
        roundCount: 1,          // 1..10
        phase: 'ROLL',          // 'ROLL' | 'PICK' | 'COMPLETE'
        currentRoll: null,      // teamSeason object when phase === 'PICK'
        selectedPlayerId: null, // local UI selection during 'PICK'
        history: [],            // recent 5~8 synchronized action logs
        matchNoticeShown: false,
        opponentLeft: false,
    };
}

// ---------- Game Entry Point ----------

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

    const root = el('div', 'fd-root');
    ctx.area.append(root);

    function getCurrentTeam() {
        return state.teams[state.turnIndex];
    }

    function isMyTurn() {
        return state.phase !== 'COMPLETE' && getCurrentTeam().id === ctx.me;
    }

    function pushHistory(entryText) {
        state.history.push(entryText);
        if (state.history.length > MAX_HISTORY_ITEMS) {
            state.history = state.history.slice(-MAX_HISTORY_ITEMS);
        }
    }

    // ----- State Transitions (Synced across both clients) -----

    function applyRoll(actorId, teamSeasonId) {
        if (state.phase !== 'ROLL') return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        const teamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!teamSeason) return;

        state.currentRoll = teamSeason;
        state.selectedPlayerId = null;
        state.phase = 'PICK';
        pushHistory(`${currentTeam.name} rolled ${teamSeason.club} ${teamSeason.year}`);
        render();
    }

    function applyReroll(actorId, type, teamSeasonId) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        if (!REROLL_TYPES.includes(type)) return;
        if (currentTeam.rerolls[type] <= 0) return;

        const nextTeamSeason = TEAM_SEASON_MAP.get(teamSeasonId);
        if (!nextTeamSeason) return;

        if (!isValidRerollTransition(state.currentRoll, nextTeamSeason, type)) return;

        currentTeam.rerolls[type] -= 1;
        state.currentRoll = nextTeamSeason;
        state.selectedPlayerId = null;

        pushHistory(`${currentTeam.name} used ${REROLL_LABELS[type]}`);
        pushHistory(`${currentTeam.name} rolled ${nextTeamSeason.club} ${nextTeamSeason.year}`);
        render();
    }

    function applyPick(actorId, playerId, slot) {
        if (state.phase !== 'PICK' || !state.currentRoll) return;
        const currentTeam = getCurrentTeam();
        if (currentTeam.id !== actorId) return;

        if (!SLOTS.includes(slot)) return;
        if (currentTeam.roster[slot] !== null) return;

        const candidate = state.currentRoll.players.find((p) => p.id === playerId);
        if (!candidate) return;
        if (!canPlayerFitSlot(candidate, slot)) return;

        currentTeam.roster[slot] = candidate;
        state.currentRoll = null;
        state.selectedPlayerId = null;
        pushHistory(`${currentTeam.name} picked ${candidate.name} → ${slot}`);

        if (state.teams.every((t) => isRosterComplete(t))) {
            state.phase = 'COMPLETE';
        } else {
            state.turnIndex = (state.turnIndex + 1) % 2;
            state.roundCount += 1;
            state.phase = 'ROLL';
        }

        render();
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
        const currentTeam = getCurrentTeam();
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

    // ----- Rendering -----

    function render() {
        root.replaceChildren();

        root.append(renderHeader());

        if (state.opponentLeft) {
            root.append(el('div', 'fd-alert', '対戦相手が退出しました。'));
        }

        const mainGrid = el('div', 'fd-main');
        const teamAPanel = renderTeamPanel(state.teams[0], 0);
        const centerZone = state.phase === 'COMPLETE' ? renderCompleteZone() : renderDraftZone();
        const teamBPanel = renderTeamPanel(state.teams[1], 1);

        mainGrid.append(teamAPanel, centerZone, teamBPanel);
        root.append(mainGrid);
    }

    function renderHeader() {
        const header = el('div', 'fd-header');
        const [teamA, teamB] = state.teams;

        const vsRow = el('div', 'fd-vs-row');

        const pA = el('div', 'fd-vs-player' + (state.phase !== 'COMPLETE' && state.turnIndex === 0 ? ' fd-vs-player--active' : ''));
        pA.append(
            el('span', 'fd-vs-tag', 'Player A'),
            el('span', 'fd-vs-name', teamA.name + (teamA.id === ctx.me ? ' (YOU)' : ''))
        );

        const vsBadge = el('span', 'fd-vs-badge', 'vs');

        const pB = el('div', 'fd-vs-player' + (state.phase !== 'COMPLETE' && state.turnIndex === 1 ? ' fd-vs-player--active' : ''));
        pB.append(
            el('span', 'fd-vs-tag', 'Player B'),
            el('span', 'fd-vs-name', teamB.name + (teamB.id === ctx.me ? ' (YOU)' : ''))
        );

        vsRow.append(pA, vsBadge, pB);

        const turnBar = el('div', 'fd-turn-bar');
        if (state.phase === 'COMPLETE') {
            turnBar.classList.add('fd-turn-bar--complete');
            turnBar.textContent = 'DRAFT COMPLETE';
        } else {
            const cur = getCurrentTeam();
            const stepText = state.phase === 'ROLL' ? 'Step 1: ROLL' : 'Step 2: REROLL OR PICK PLAYER';
            if (cur.id === ctx.me) {
                turnBar.classList.add('fd-turn-bar--mine');
                turnBar.textContent = `あなたのターン (${cur.label}: ${cur.name}) — ${stepText}`;
            } else {
                turnBar.textContent = `${cur.name} (${cur.label}) のターン — ${stepText}`;
            }
        }

        header.append(vsRow, turnBar);
        return header;
    }

    function renderRerollControls(curTeam, currentRoll, myTurn) {
        const box = el('div', 'fd-reroll-box');
        const btnRow = el('div', 'fd-reroll-row');
        let noYearHint = false;

        for (const type of REROLL_TYPES) {
            const remaining = curTeam.rerolls[type];
            const used = remaining <= 0;
            const hasOption = hasRerollOption(currentRoll, type);

            let btnText = `${REROLL_LABELS[type]} ×${remaining}`;
            if (used) {
                btnText = `${REROLL_LABELS[type]} — USED`;
            }

            let btnClass = 'fd-reroll-btn';
            if (used) btnClass += ' fd-reroll-btn--used';
            else if (!hasOption) btnClass += ' fd-reroll-btn--no-option';

            const btn = el('button', btnClass, btnText);
            btn.disabled = !myTurn || used || !hasOption;

            if (!used && !hasOption && type === 'year') {
                noYearHint = true;
            }

            btn.addEventListener('click', () => handleRerollClick(type));
            btnRow.append(btn);
        }

        box.append(btnRow);

        if (noYearHint) {
            box.append(
                el(
                    'div',
                    'fd-reroll-hint',
                    `※ ${currentRoll.club} は他年度のシーズンデータが登録されていないため Year Reroll できません`
                )
            );
        }

        return box;
    }

    function renderHistoryBox() {
        const box = el('div', 'fd-history');
        box.append(el('div', 'fd-history-title', 'RECENT HISTORY'));

        if (state.history.length === 0) {
            box.append(el('div', 'fd-history-empty', 'No actions yet.'));
            return box;
        }

        const list = el('div', 'fd-history-list');
        for (const item of state.history) {
            list.append(el('div', 'fd-history-item', item));
        }
        box.append(list);
        return box;
    }

    function renderPlayerMiniStats(player) {
        const statsRow = el('div', 'fd-card-stats');
        if (player.positions.includes('GK')) {
            statsRow.append(
                el('span', 'fd-stat', `GK ${player.goalkeeping}`),
                el('span', 'fd-stat', `DEF ${player.defense}`),
                el('span', 'fd-stat', `PHY ${player.physical}`),
                el('span', 'fd-stat', `CRE ${player.creation}`)
            );
        } else {
            statsRow.append(
                el('span', 'fd-stat', `ATK ${player.attack}`),
                el('span', 'fd-stat', `CRE ${player.creation}`),
                el('span', 'fd-stat', `DEF ${player.defense}`),
                el('span', 'fd-stat', `PHY ${player.physical}`)
            );
        }
        return statsRow;
    }

    function renderDraftZone() {
        const zone = el('div', 'fd-center');
        const cur = getCurrentTeam();
        const myTurn = isMyTurn();

        const pickCounter = el('div', 'fd-pick-counter', `PICK ${state.roundCount} / 10`);
        zone.append(pickCounter);

        if (state.phase === 'ROLL') {
            const rollBox = el('div', 'fd-roll-box');
            const promptText = myTurn
                ? 'ROLLボタンを押してクラブとシーズンを抽選してください'
                : `${cur.name} が ROLL するのを待っています...`;
            rollBox.append(el('p', 'fd-roll-prompt', promptText));

            const rollBtn = el('button', 'fd-roll-btn', 'ROLL');
            rollBtn.disabled = !myTurn;
            rollBtn.addEventListener('click', handleRollClick);
            rollBox.append(rollBtn);

            zone.append(rollBox, renderHistoryBox());
            return zone;
        }

        // Phase === 'PICK'
        const roll = state.currentRoll;
        const rollInfo = el('div', 'fd-roll-result');

        const leagueItem = el('div', 'fd-roll-meta');
        leagueItem.append(el('span', 'fd-meta-label', 'LEAGUE'), el('strong', 'fd-meta-val', roll.league));

        const clubItem = el('div', 'fd-roll-meta');
        clubItem.append(el('span', 'fd-meta-label', 'CLUB'), el('strong', 'fd-meta-val', roll.club));

        const yearItem = el('div', 'fd-roll-meta');
        yearItem.append(el('span', 'fd-meta-label', 'YEAR'), el('strong', 'fd-meta-val', String(roll.year)));

        rollInfo.append(leagueItem, clubItem, yearItem);
        zone.append(rollInfo);

        // Reroll Controls right under Roll Result
        zone.append(renderRerollControls(cur, roll, myTurn));

        const guide = el(
            'div',
            'fd-pick-guide',
            myTurn
                ? '選手カードを選択し、配置するポジションボタンを押してください'
                : `${cur.name} が選手を選択しています...`
        );
        zone.append(guide);

        const cardsGrid = el('div', 'fd-cards-grid');
        for (const player of roll.players) {
            const availableSlots = getAvailableSlotsForPlayer(cur.roster, player);
            const isSelected = state.selectedPlayerId === player.id;
            const hasSlots = availableSlots.length > 0;
            const ovr = getPlayerOverall(player);

            let cardClass = 'fd-card';
            if (isSelected) cardClass += ' fd-card--selected';
            if (!hasSlots) cardClass += ' fd-card--disabled';
            if (myTurn && hasSlots) cardClass += ' fd-card--interactive';

            const card = el('div', cardClass);
            const topRow = el('div', 'fd-card-top');
            topRow.append(
                el('span', 'fd-card-pos', player.positions.join(' / ')),
                el('span', 'fd-card-rating', `Rating ${ovr}`)
            );

            const nameEl = el('div', 'fd-card-name', player.name);
            card.append(topRow, nameEl, renderPlayerMiniStats(player));

            if (myTurn && hasSlots) {
                card.addEventListener('click', () => handleSelectCandidate(player.id));
            } else if (!hasSlots) {
                card.append(el('div', 'fd-card-noslot', '空き枠なし'));
            }

            if (myTurn && isSelected && hasSlots) {
                const slotBar = el('div', 'fd-slot-actions');
                slotBar.append(el('span', 'fd-slot-prompt', '配置枠を選択:'));
                const btnGroup = el('div', 'fd-slot-btns');
                for (const slot of availableSlots) {
                    const slotBtn = el('button', 'fd-slot-btn', slot);
                    slotBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        handlePickSlot(player.id, slot);
                    });
                    btnGroup.append(slotBtn);
                }
                slotBar.append(btnGroup);
                card.append(slotBar);
            }

            cardsGrid.append(card);
        }

        zone.append(cardsGrid, renderHistoryBox());
        return zone;
    }

    function renderCompleteZone() {
        const zone = el('div', 'fd-center fd-complete-zone');
        const [teamA, teamB] = state.teams;
        const ratingA = calculateTeamRating(teamA);
        const ratingB = calculateTeamRating(teamB);

        const banner = el('h2', 'fd-complete-title', 'DRAFT COMPLETE');
        const sub = el('p', 'fd-complete-sub', '両チームの5人制ロスターが確定しました');

        const summaryBox = el('div', 'fd-complete-ratings');

        const rowA = el('div', 'fd-complete-rating-card');
        rowA.append(
            el('div', 'fd-complete-team-name', `${teamA.label} (${teamA.name})`),
            el('div', 'fd-complete-rating-text', `Team A Rating: ${ratingA}`)
        );

        const rowB = el('div', 'fd-complete-rating-card');
        rowB.append(
            el('div', 'fd-complete-team-name', `${teamB.label} (${teamB.name})`),
            el('div', 'fd-complete-rating-text', `Team B Rating: ${ratingB}`)
        );

        summaryBox.append(rowA, rowB);

        const matchBtn = el('button', 'fd-match-btn', 'MATCH');
        matchBtn.addEventListener('click', () => {
            state.matchNoticeShown = true;
            render();
        });

        zone.append(banner, sub, summaryBox, matchBtn);

        if (state.matchNoticeShown) {
            zone.append(el('div', 'fd-match-notice', 'Match simulation coming next'));
        }

        zone.append(renderHistoryBox());
        return zone;
    }

    function renderTeamPanel(teamState, idx) {
        const isCurrent = state.phase !== 'COMPLETE' && state.turnIndex === idx;
        const panel = el('div', 'fd-team-panel' + (isCurrent ? ' fd-team-panel--active' : ''));

        const head = el('div', 'fd-team-head');
        const titleWrap = el('div', 'fd-team-title-wrap');
        titleWrap.append(
            el('div', 'fd-team-label', teamState.label),
            el('div', 'fd-team-player', teamState.name + (teamState.id === ctx.me ? ' (YOU)' : ''))
        );

        const ratingVal = calculateTeamRating(teamState);
        const ratingBadge = el(
            'div',
            'fd-team-rating',
            `Team Rating: ${ratingVal > 0 ? ratingVal : '---'} (${getPickedCount(teamState)}/5)`
        );

        const rerollChips = el('div', 'fd-team-rerolls');
        for (const type of REROLL_TYPES) {
            const left = teamState.rerolls[type];
            const shortName = type.charAt(0).toUpperCase() + type.slice(1);
            const chip = el(
                'span',
                'fd-reroll-chip' + (left <= 0 ? ' fd-reroll-chip--used' : ''),
                left > 0 ? `${shortName} ×1` : `${shortName}: USED`
            );
            rerollChips.append(chip);
        }

        head.append(titleWrap, ratingBadge, rerollChips);
        panel.append(head);

        const slotList = el('div', 'fd-slot-list');
        for (const slot of SLOTS) {
            const p = teamState.roster[slot];
            const row = el('div', 'fd-slot-row' + (p ? ' fd-slot-row--filled' : ''));
            row.append(el('span', 'fd-slot-tag', slot));

            if (p) {
                const info = el('div', 'fd-slot-player');
                info.append(
                    el('span', 'fd-slot-player-name', p.name),
                    el('span', 'fd-slot-player-meta', `${p.club} '${String(p.year).slice(-2)}`)
                );
                row.append(info, el('span', 'fd-slot-player-rating', String(getPlayerOverall(p))));
            } else {
                row.append(el('span', 'fd-slot-empty', '---'));
            }
            slotList.append(row);
        }

        panel.append(slotList);
        return panel;
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

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

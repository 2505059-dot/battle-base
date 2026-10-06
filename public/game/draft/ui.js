// Draft UI rendering functions (localized via i18n t() & formatLeagueName())

import { t, formatLeagueName } from '../../i18n/i18n.js';
import { el } from '../shared/dom.js';
import {
    SLOTS,
    REROLL_TYPES,
    REROLL_LABEL_KEYS,
    REROLL_SHORT_LABEL_KEYS,
} from '../shared/constants.js';
import { formatHistoryEvent } from '../shared/event-formatters.js';
import { getCurrentTeam, isDraftPhase } from '../state.js';
import {
    hasRerollOption,
    getAvailableSlotsForPlayer,
    getPlayerOverall,
    calculateTeamRating,
    getPickedCount,
} from './rules.js';

export function renderHeader(state, meId) {
    const header = el('div', 'fd-header');
    const [teamA, teamB] = state.teams;
    const draftPhase = isDraftPhase(state);

    const vsRow = el('div', 'fd-vs-row');

    const pA = el(
        'div',
        'fd-vs-player' + (draftPhase && state.turnIndex === 0 ? ' fd-vs-player--active' : '')
    );
    pA.append(
        el('span', 'fd-vs-tag', t('common.playerA')),
        el('span', 'fd-vs-name', teamA.name + (teamA.id === meId ? t('common.youSuffix') : ''))
    );

    const vsBadge = el('span', 'fd-vs-badge', t('common.vs'));

    const pB = el(
        'div',
        'fd-vs-player' + (draftPhase && state.turnIndex === 1 ? ' fd-vs-player--active' : '')
    );
    pB.append(
        el('span', 'fd-vs-tag', t('common.playerB')),
        el('span', 'fd-vs-name', teamB.name + (teamB.id === meId ? t('common.youSuffix') : ''))
    );

    vsRow.append(pA, vsBadge, pB);

    const turnBar = el('div', 'fd-turn-bar');
    if (state.phase === 'COMPLETE') {
        turnBar.classList.add('fd-turn-bar--complete');
        turnBar.textContent = t('draft.completeBanner');
    } else if (state.phase === 'MATCH') {
        turnBar.classList.add('fd-turn-bar--match');
        turnBar.textContent = t('match.liveTurnBar', {
            minute: state.match?.currentMinute ?? 1,
        });
    } else if (state.phase === 'RESULT') {
        turnBar.classList.add('fd-turn-bar--complete');
        turnBar.textContent = t('match.resultTurnBar');
    } else {
        const cur = getCurrentTeam(state);
        const stepText = state.phase === 'ROLL' ? t('draft.stepRoll') : t('draft.stepPick');
        if (cur.id === meId) {
            turnBar.classList.add('fd-turn-bar--mine');
            turnBar.textContent = t('draft.yourTurn', {
                teamLabel: cur.label,
                playerName: cur.name,
                stepText,
            });
        } else {
            turnBar.textContent = t('draft.opponentTurn', {
                teamLabel: cur.label,
                playerName: cur.name,
                stepText,
            });
        }
    }

    header.append(vsRow, turnBar);
    return header;
}

export function renderRerollControls(curTeam, currentRoll, myTurn, onRerollClick) {
    const box = el('div', 'fd-reroll-box');
    const btnRow = el('div', 'fd-reroll-row');
    let noYearHint = false;

    for (const type of REROLL_TYPES) {
        const remaining = curTeam.rerolls[type];
        const used = remaining <= 0;
        const hasOption = hasRerollOption(currentRoll, type);
        const label = t(REROLL_LABEL_KEYS[type]);

        const btnText = used
            ? t('draft.rerollUsed', { label })
            : t('draft.rerollRemaining', { label, count: remaining });

        let btnClass = 'fd-reroll-btn';
        if (used) btnClass += ' fd-reroll-btn--used';
        else if (!hasOption) btnClass += ' fd-reroll-btn--no-option';

        const btn = el('button', btnClass, btnText);
        btn.disabled = !myTurn || used || !hasOption;

        if (!used && !hasOption && type === 'year') {
            noYearHint = true;
        }

        btn.addEventListener('click', () => onRerollClick(type));
        btnRow.append(btn);
    }

    box.append(btnRow);

    if (noYearHint) {
        box.append(
            el(
                'div',
                'fd-reroll-hint',
                t('draft.rerollUnavailableYear', { club: currentRoll.club })
            )
        );
    }

    return box;
}

export function renderHistoryBox(state) {
    const box = el('div', 'fd-history');
    box.append(el('div', 'fd-history-title', t('draft.recentHistory')));

    if (state.history.length === 0) {
        box.append(el('div', 'fd-history-empty', t('draft.historyEmpty')));
        return box;
    }

    const list = el('div', 'fd-history-list');
    for (const item of state.history) {
        list.append(el('div', 'fd-history-item', formatHistoryEvent(item)));
    }
    box.append(list);
    return box;
}

export function renderPlayerMiniStats(player) {
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

export function renderDraftZone(state, myTurn, handlers) {
    const { onRollClick, onRerollClick, onSelectCandidate, onPickSlot } = handlers;
    const zone = el('div', 'fd-center');
    const cur = getCurrentTeam(state);

    const pickCounter = el(
        'div',
        'fd-pick-counter',
        t('draft.pickCounter', { current: state.roundCount, total: 10 })
    );
    zone.append(pickCounter);

    if (state.phase === 'ROLL') {
        const rollBox = el('div', 'fd-roll-box');
        const promptText = myTurn
            ? t('draft.rollPromptMine')
            : t('draft.rollPromptOpponent', { playerName: cur.name });
        rollBox.append(el('p', 'fd-roll-prompt', promptText));

        const rollBtn = el('button', 'fd-roll-btn', t('draft.rollBtn'));
        rollBtn.disabled = !myTurn;
        rollBtn.addEventListener('click', onRollClick);
        rollBox.append(rollBtn);

        zone.append(rollBox, renderHistoryBox(state));
        return zone;
    }

    // Phase === 'PICK'
    const roll = state.currentRoll;
    const rollInfo = el('div', 'fd-roll-result');

    const leagueItem = el('div', 'fd-roll-meta');
    leagueItem.append(
        el('span', 'fd-meta-label', t('draft.metaLeague')),
        el('strong', 'fd-meta-val', formatLeagueName(roll.league))
    );

    const clubItem = el('div', 'fd-roll-meta');
    clubItem.append(
        el('span', 'fd-meta-label', t('draft.metaClub')),
        el('strong', 'fd-meta-val', roll.club)
    );

    const yearItem = el('div', 'fd-roll-meta');
    yearItem.append(
        el('span', 'fd-meta-label', t('draft.metaYear')),
        el('strong', 'fd-meta-val', String(roll.year))
    );

    rollInfo.append(leagueItem, clubItem, yearItem);
    zone.append(rollInfo);

    // Reroll Controls right under Roll Result
    zone.append(renderRerollControls(cur, roll, myTurn, onRerollClick));

    const guide = el(
        'div',
        'fd-pick-guide',
        myTurn
            ? t('draft.pickGuideMine')
            : t('draft.pickGuideOpponent', { playerName: cur.name })
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
            el('span', 'fd-card-rating', t('draft.cardRating', { rating: ovr }))
        );

        const nameEl = el('div', 'fd-card-name', player.name);
        card.append(topRow, nameEl, renderPlayerMiniStats(player));

        if (myTurn && hasSlots) {
            card.addEventListener('click', () => onSelectCandidate(player.id));
        } else if (!hasSlots) {
            card.append(el('div', 'fd-card-noslot', t('draft.noAvailableSlot')));
        }

        if (myTurn && isSelected && hasSlots) {
            const slotBar = el('div', 'fd-slot-actions');
            slotBar.append(el('span', 'fd-slot-prompt', t('draft.chooseSlotPrompt')));
            const btnGroup = el('div', 'fd-slot-btns');
            for (const slot of availableSlots) {
                const slotBtn = el('button', 'fd-slot-btn', slot);
                slotBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onPickSlot(player.id, slot);
                });
                btnGroup.append(slotBtn);
            }
            slotBar.append(btnGroup);
            card.append(slotBar);
        }

        cardsGrid.append(card);
    }

    zone.append(cardsGrid, renderHistoryBox(state));
    return zone;
}

export function renderTeamPanel(state, teamState, idx, meId) {
    const isCurrent = isDraftPhase(state) && state.turnIndex === idx;
    const panel = el('div', 'fd-team-panel' + (isCurrent ? ' fd-team-panel--active' : ''));

    const head = el('div', 'fd-team-head');
    const titleWrap = el('div', 'fd-team-title-wrap');
    titleWrap.append(
        el('div', 'fd-team-label', teamState.label),
        el(
            'div',
            'fd-team-player',
            teamState.name + (teamState.id === meId ? t('common.youSuffix') : '')
        )
    );

    const ratingVal = calculateTeamRating(teamState);
    const ratingBadge = el(
        'div',
        'fd-team-rating',
        t('common.teamRating', {
            rating: ratingVal > 0 ? ratingVal : t('common.emptySlot'),
            picked: getPickedCount(teamState),
            total: SLOTS.length,
        })
    );

    const rerollChips = el('div', 'fd-team-rerolls');
    for (const type of REROLL_TYPES) {
        const left = teamState.rerolls[type];
        const shortLabel = t(REROLL_SHORT_LABEL_KEYS[type]);
        const chip = el(
            'span',
            'fd-reroll-chip' + (left <= 0 ? ' fd-reroll-chip--used' : ''),
            left > 0
                ? t('draft.rerollChipRemaining', { label: shortLabel, count: left })
                : t('draft.rerollChipUsed', { label: shortLabel })
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
            row.append(el('span', 'fd-slot-empty', t('common.emptySlot')));
        }
        slotList.append(row);
    }

    panel.append(slotList);
    return panel;
}

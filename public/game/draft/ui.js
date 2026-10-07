// Draft UI rendering functions (localized via i18n t() & entity formatters)

import {
    t,
    formatLeagueName,
    formatClubName,
    formatPlayerName,
    getPlayerDisplayName,
} from '../../i18n/i18n.js';
import { el } from '../shared/dom.js';
import {
    ROLES,
    SLOTS,
    REROLL_TYPES,
    REROLL_LABEL_KEYS,
    REROLL_SHORT_LABEL_KEYS,
    getSlotsForRole,
    formatSlotLabel,
} from '../shared/constants.js';
import { formatHistoryEvent } from '../shared/event-formatters.js';
import { getMyTeam, isDraftPhase, isTeamDraftActive } from '../state.js';
import {
    hasRerollOption,
    isPlayerInRoster,
    getAvailableRolesForPlayer,
    getFirstAvailableSlotForRole,
    getRoleProgress,
    getPlayerOverall,
    calculateTeamRating,
    getPickedCount,
    canFreeRedraw,
} from './rules.js';

const ROLE_TITLE_KEYS = {
    GK: 'draft.goalkeeper',
    DF: 'draft.defenders',
    MF: 'draft.midfielders',
    FW: 'draft.forwards',
};

function getTeamPhaseBadgeText(team, isSelf) {
    const phase = team?.draft?.phase;
    if (team?.draft?.locked || phase === 'LOCKED') {
        return t('draft.locked');
    }
    if (phase === 'READY') {
        return t('draft.ready');
    }
    if (isSelf) {
        return phase === 'PICK' ? 'PICK' : 'ROLL';
    }
    return t('draft.drafting');
}

function getTeamPhaseModifier(team) {
    const phase = team?.draft?.phase;
    if (team?.draft?.locked || phase === 'LOCKED') return 'locked';
    if (phase === 'READY') return 'ready';
    return 'drafting';
}

export function renderHeader(state, meId) {
    const header = el('div', 'fd-header');
    const [teamA, teamB] = state.teams;
    const draftPhase = isDraftPhase(state);

    const vsRow = el('div', 'fd-vs-row');

    const renderVsPlayer = (team, tagKey) => {
        const isSelf = team.id === meId;
        const active = draftPhase && isTeamDraftActive(team);
        const locked = Boolean(team?.draft?.locked);
        let cls = 'fd-vs-player';
        if (active) cls += ' fd-vs-player--active';
        if (locked) cls += ' fd-vs-player--locked';

        const box = el('div', cls);
        const picked = getPickedCount(team);
        const phaseMod = getTeamPhaseModifier(team);
        const metaRow = el('div', 'fd-vs-meta');
        metaRow.append(
            el('span', 'fd-vs-progress', `${picked} / ${SLOTS.length}`),
            el(
                'span',
                `fd-vs-status fd-vs-status--${phaseMod}`,
                getTeamPhaseBadgeText(team, isSelf)
            )
        );

        box.append(
            el('span', 'fd-vs-tag', t(tagKey)),
            el('span', 'fd-vs-name', team.name + (isSelf ? t('common.youSuffix') : '')),
            metaRow
        );
        return box;
    };

    const pA = renderVsPlayer(teamA, 'common.playerA');
    const vsBadge = el('span', 'fd-vs-badge', t('common.vs'));
    const pB = renderVsPlayer(teamB, 'common.playerB');

    vsRow.append(pA, vsBadge, pB);

    const turnBar = el('div', 'fd-turn-bar');
    if (state.phase === 'REVEAL') {
        turnBar.classList.add('fd-turn-bar--complete');
        turnBar.textContent = `${t('draft.rosterReveal')} — ${t('draft.bothLocked')}`;
    } else if (state.phase === 'MATCH') {
        turnBar.classList.add('fd-turn-bar--match');
        turnBar.textContent = t('match.liveTurnBar', {
            minute: state.match?.currentMinute ?? 1,
        });
    } else if (state.phase === 'RESULT') {
        turnBar.classList.add('fd-turn-bar--complete');
        turnBar.textContent = t('match.resultTurnBar');
    } else {
        const myTeam = getMyTeam(state, meId) ?? state.teams[0];
        const picked = getPickedCount(myTeam);
        const myPhase = myTeam?.draft?.phase;

        if (myTeam?.draft?.locked || myPhase === 'LOCKED') {
            turnBar.classList.add('fd-turn-bar--locked');
            turnBar.textContent = t('draft.statusBarLocked', {
                teamLabel: myTeam.label,
                playerName: myTeam.name,
            });
        } else if (myPhase === 'READY') {
            turnBar.classList.add('fd-turn-bar--ready');
            turnBar.textContent = t('draft.statusBarReady', {
                teamLabel: myTeam.label,
                playerName: myTeam.name,
                picked,
                total: SLOTS.length,
            });
        } else {
            turnBar.classList.add('fd-turn-bar--mine');
            const stepText = myPhase === 'ROLL' ? t('draft.stepRoll') : t('draft.stepPick');
            turnBar.textContent = t('draft.statusBarDrafting', {
                teamLabel: myTeam.label,
                playerName: myTeam.name,
                picked,
                total: SLOTS.length,
                stepText,
            });
        }
    }

    header.append(vsRow, turnBar);
    return header;
}

export function renderRerollControls(curTeam, currentRoll, canInteract, onRerollClick) {
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
        btn.disabled = !canInteract || used || !hasOption;

        if (!used && !hasOption && type === 'year') {
            noYearHint = true;
        }

        btn.addEventListener('click', () => onRerollClick(type));
        btnRow.append(btn);
    }

    box.append(btnRow);

    if (noYearHint && currentRoll) {
        box.append(
            el(
                'div',
                'fd-reroll-hint',
                t('draft.rerollUnavailableYear', { club: formatClubName(currentRoll.club) })
            )
        );
    }

    return box;
}

export function renderHistoryBox(teamOrState) {
    const box = el('div', 'fd-history');
    box.append(el('div', 'fd-history-title', t('draft.recentHistory')));

    let items = [];
    if (Array.isArray(teamOrState)) {
        items = teamOrState;
    } else if (Array.isArray(teamOrState?.draft?.history)) {
        items = teamOrState.draft.history;
    } else if (Array.isArray(teamOrState?.teams)) {
        items = teamOrState.teams.flatMap((team) => team?.draft?.history ?? []);
    }

    if (items.length === 0) {
        box.append(el('div', 'fd-history-empty', t('draft.historyEmpty')));
        return box;
    }

    const list = el('div', 'fd-history-list');
    for (const item of items) {
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

export function renderDraftZone(state, myTeam, handlers = {}, selectedPlayerIdOverride = null) {
    const {
        onRollClick,
        onRerollClick,
        onRedrawClick,
        onSelectCandidate,
        onPickSlot,
        onLockClick,
        selectedPlayerId: handlerSelectedId,
    } = handlers;
    const selectedPlayerId = selectedPlayerIdOverride ?? handlerSelectedId ?? null;
    const team = myTeam ?? state.teams[0];
    const myPhase = team?.draft?.phase ?? 'ROLL';
    const pickedCount = getPickedCount(team);

    const zone = el('div', 'fd-center');

    const pickCounter = el(
        'div',
        'fd-pick-counter',
        t('draft.progress', { picked: pickedCount, total: SLOTS.length })
    );
    zone.append(pickCounter);

    if (myPhase === 'ROLL') {
        const rollBox = el('div', 'fd-roll-box');
        rollBox.append(el('p', 'fd-roll-prompt', t('draft.rollPromptMine')));

        const rollBtn = el('button', 'fd-roll-btn', t('draft.rollBtn'));
        rollBtn.disabled = Boolean(team.draft.locked);
        if (onRollClick) rollBtn.addEventListener('click', onRollClick);
        rollBox.append(rollBtn);

        zone.append(rollBox, renderHistoryBox(team));
        return zone;
    }

    if (myPhase === 'PICK' && team.draft.currentRoll) {
        const roll = team.draft.currentRoll;
        const rollInfo = el('div', 'fd-roll-result');

        const leagueItem = el('div', 'fd-roll-meta');
        leagueItem.append(
            el('span', 'fd-meta-label', t('draft.metaLeague')),
            el('strong', 'fd-meta-val', formatLeagueName(roll.league))
        );

        const clubItem = el('div', 'fd-roll-meta');
        clubItem.append(
            el('span', 'fd-meta-label', t('draft.metaClub')),
            el('strong', 'fd-meta-val', formatClubName(roll.club))
        );

        const yearItem = el('div', 'fd-roll-meta');
        yearItem.append(
            el('span', 'fd-meta-label', t('draft.metaYear')),
            el('strong', 'fd-meta-val', String(roll.year))
        );

        rollInfo.append(leagueItem, clubItem, yearItem);
        zone.append(rollInfo);

        zone.append(renderRerollControls(team, roll, !team.draft.locked, onRerollClick));

        if (canFreeRedraw(team)) {
            const deadRollBox = el('div', 'fd-deadroll-box');
            deadRollBox.append(
                el('div', 'fd-deadroll-badge', t('draft.noValidPick')),
                el('p', 'fd-deadroll-explain', t('draft.freeRedrawExplain'))
            );

            const redrawBtn = el('button', 'fd-redraw-btn', t('draft.freeRedrawBtn'));
            redrawBtn.disabled = Boolean(team.draft.locked);
            if (onRedrawClick) {
                redrawBtn.addEventListener('click', onRedrawClick);
            }
            deadRollBox.append(redrawBtn);
            zone.append(deadRollBox);
        } else {
            const guide = el('div', 'fd-pick-guide', t('draft.pickGuideMine'));
            zone.append(guide);
        }

        const cardsGrid = el('div', 'fd-cards-grid');
        for (const player of roll.players) {
            const isDuplicate = isPlayerInRoster(team.roster, player);
            const availableRoles = getAvailableRolesForPlayer(team.roster, player);
            const isSelected = selectedPlayerId === player.id;
            const hasRoles = availableRoles.length > 0;
            const ovr = getPlayerOverall(player);

            let cardClass = 'fd-card';
            if (isSelected) cardClass += ' fd-card--selected';
            if (!hasRoles) cardClass += ' fd-card--disabled';
            if (!team.draft.locked && hasRoles) cardClass += ' fd-card--interactive';

            const card = el('div', cardClass);
            const topRow = el('div', 'fd-card-top');
            topRow.append(
                el('span', 'fd-card-pos', player.positions.join(' / ')),
                el('span', 'fd-card-rating', t('draft.cardRating', { rating: ovr }))
            );

            const displayName = getPlayerDisplayName(player.name);
            const nameEl = el('div', 'fd-card-name', displayName.primary);
            card.append(topRow, nameEl);
            if (displayName.secondary) {
                card.append(el('div', 'fd-card-name-secondary', displayName.secondary));
            }
            card.append(renderPlayerMiniStats(player));

            if (!team.draft.locked && hasRoles) {
                card.addEventListener('click', () => onSelectCandidate(player.id));
            } else if (!hasRoles) {
                card.append(
                    el(
                        'div',
                        'fd-card-noslot',
                        isDuplicate ? t('draft.duplicatePlayer') : t('draft.noAvailableSlot')
                    )
                );
            }

            if (!team.draft.locked && isSelected && hasRoles) {
                const slotBar = el('div', 'fd-slot-actions');
                slotBar.append(el('span', 'fd-slot-prompt', t('draft.chooseSlotPrompt')));
                const btnGroup = el('div', 'fd-slot-btns');
                for (const role of availableRoles) {
                    const roleBtn = el('button', 'fd-slot-btn', role);
                    roleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const targetSlot = getFirstAvailableSlotForRole(team.roster, role);
                        if (targetSlot) {
                            onPickSlot(player.id, targetSlot);
                        }
                    });
                    btnGroup.append(roleBtn);
                }
                slotBar.append(btnGroup);
                card.append(slotBar);
            }

            cardsGrid.append(card);
        }

        zone.append(cardsGrid, renderHistoryBox(team));
        return zone;
    }

    if (myPhase === 'READY') {
        const readyBox = el('div', 'fd-ready-box');
        readyBox.append(
            el('div', 'fd-ready-badge', t('draft.ready')),
            el('p', 'fd-ready-guide', t('draft.readyGuide'))
        );

        const readyRoster = el('div', 'fd-ready-roster');
        for (const role of ROLES) {
            const group = el('div', 'fd-ready-role-group');
            group.append(el('div', 'fd-ready-role-title', `${role} — ${t(ROLE_TITLE_KEYS[role])}`));
            for (const slot of getSlotsForRole(role)) {
                const p = team.roster[slot];
                if (!p) continue;
                const item = el('div', 'fd-ready-slot');
                item.append(
                    el('span', 'fd-slot-tag', formatSlotLabel(slot)),
                    el('span', 'fd-ready-player-name', formatPlayerName(p.name)),
                    el(
                        'span',
                        'fd-ready-player-meta',
                        `${formatClubName(p.club)} '${String(p.year).slice(-2)}`
                    ),
                    el('span', 'fd-slot-player-rating', String(getPlayerOverall(p)))
                );
                group.append(item);
            }
            readyRoster.append(group);
        }
        readyBox.append(readyRoster);

        const lockBtn = el('button', 'fd-lock-btn', t('draft.lockIn'));
        if (onLockClick) {
            lockBtn.addEventListener('click', onLockClick);
        }
        readyBox.append(lockBtn);

        zone.append(readyBox, renderHistoryBox(team));
        return zone;
    }

    // myPhase === 'LOCKED'
    const lockedBox = el('div', 'fd-locked-box');
    lockedBox.append(
        el('div', 'fd-locked-badge', t('draft.locked')),
        el('p', 'fd-locked-wait', t('draft.waitingOpponent'))
    );

    zone.append(lockedBox, renderHistoryBox(team));
    return zone;
}

export function renderBlindOpponentPanel(teamState) {
    const panel = el('div', 'fd-team-panel fd-team-panel--blind');

    const head = el('div', 'fd-team-head');
    const titleWrap = el('div', 'fd-team-title-wrap');
    titleWrap.append(
        el('div', 'fd-team-label', teamState.label),
        el('div', 'fd-team-player', teamState.name)
    );

    const pickedCount = getPickedCount(teamState);
    const progressEl = el(
        'div',
        'fd-team-progress',
        t('draft.progress', { picked: pickedCount, total: SLOTS.length })
    );

    const phaseMod = getTeamPhaseModifier(teamState);
    const statusRow = el('div', 'fd-blind-status-row');
    statusRow.append(
        el(
            'span',
            `fd-team-status fd-team-status--${phaseMod}`,
            getTeamPhaseBadgeText(teamState, false)
        ),
        el('span', 'fd-slot-blind-badge', t('draft.opponentHidden'))
    );

    head.append(titleWrap, progressEl, statusRow);
    panel.append(head);

    const roleProgress = getRoleProgress(teamState);
    const roleList = el('div', 'fd-blind-role-list');
    for (const role of ROLES) {
        const info = roleProgress[role];
        const isDone = info.filled >= info.total;
        const row = el('div', 'fd-blind-role-row' + (isDone ? ' fd-blind-role-row--done' : ''));
        row.append(el('span', 'fd-blind-role-text', `${role} ${info.filled} / ${info.total}`));

        const pips = el('div', 'fd-blind-pips');
        for (let i = 0; i < info.total; i++) {
            pips.append(
                el('span', 'fd-blind-pip' + (i < info.filled ? ' fd-blind-pip--filled' : ''))
            );
        }
        row.append(pips);
        roleList.append(row);
    }

    panel.append(roleList, el('div', 'fd-blind-note', t('draft.hiddenUntilReveal')));
    return panel;
}

export function renderGroupedSlotList(teamState) {
    const slotList = el('div', 'fd-slot-list');
    const roleProgress = getRoleProgress(teamState);

    for (const role of ROLES) {
        const info = roleProgress[role];
        const group = el('div', 'fd-role-group');
        const groupHead = el('div', 'fd-role-group-head');
        groupHead.append(
            el('span', 'fd-role-group-title', `${role} — ${t(ROLE_TITLE_KEYS[role])}`),
            el('span', 'fd-role-group-count', `${info.filled}/${info.total}`)
        );
        group.append(groupHead);

        for (const slot of getSlotsForRole(role)) {
            const p = teamState.roster[slot];
            const row = el('div', 'fd-slot-row' + (p ? ' fd-slot-row--filled' : ''));
            row.append(el('span', 'fd-slot-tag', formatSlotLabel(slot)));

            if (p) {
                const playerBox = el('div', 'fd-slot-player');
                playerBox.append(
                    el('span', 'fd-slot-player-name', formatPlayerName(p.name)),
                    el(
                        'span',
                        'fd-slot-player-meta',
                        `${formatClubName(p.club)} '${String(p.year).slice(-2)}`
                    )
                );
                row.append(playerBox, el('span', 'fd-slot-player-rating', String(getPlayerOverall(p))));
            } else {
                row.append(el('span', 'fd-slot-empty', t('common.emptySlot')));
            }
            group.append(row);
        }

        slotList.append(group);
    }

    return slotList;
}

export function renderTeamPanel(state, teamState, idx, meId) {
    const isSelf = teamState.id === meId;
    if (isDraftPhase(state) && !isSelf) {
        return renderBlindOpponentPanel(teamState);
    }

    const isActive = isDraftPhase(state) && isTeamDraftActive(teamState);
    const panel = el('div', 'fd-team-panel' + (isActive ? ' fd-team-panel--active' : ''));

    const head = el('div', 'fd-team-head');
    const titleWrap = el('div', 'fd-team-title-wrap');
    titleWrap.append(
        el('div', 'fd-team-label', teamState.label),
        el(
            'div',
            'fd-team-player',
            teamState.name + (isSelf ? t('common.youSuffix') : '')
        )
    );

    const formationBadge = el('div', 'fd-team-formation', t('draft.formation'));

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

    const phaseMod = getTeamPhaseModifier(teamState);
    const statusBadge = el(
        'div',
        `fd-team-status fd-team-status--${phaseMod}`,
        getTeamPhaseBadgeText(teamState, isSelf)
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

    head.append(titleWrap, formationBadge, ratingBadge, statusBadge, rerollChips);
    panel.append(head);
    panel.append(renderGroupedSlotList(teamState));
    return panel;
}



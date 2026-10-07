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
    getSlotRole,
    getSlotsForRole,
    formatSlotLabel,
} from '../shared/constants.js';
import { formatHistoryEvent } from '../shared/event-formatters.js';
import {
    createPlayerPortrait,
    createClubCrest,
    createLeagueEmblem,
} from '../../media/media-ui.js';
import { getMyTeam, isDraftPhase, isTeamDraftActive } from '../state.js';
import {
    hasRerollOption,
    isPlayerEntityInRoster,
    getAvailableRolesForPlayer,
    getFirstAvailableSlotForRole,
    getRoleProgress,
    getPlayerOverall,
    calculateTeamRating,
    getPickedCount,
    canFreeRedraw,
} from './rules.js';
import {
    MOBILE_TABS,
    getSelectedCandidate,
    getSlotPreviewState,
    getConfirmPickStatus,
} from './preview-state.js';

const ROLE_TITLE_KEYS = {
    GK: 'draft.goalkeeper',
    DF: 'draft.defenders',
    MF: 'draft.midfielders',
    FW: 'draft.forwards',
};

function attachKeyboardActivation(node, handler) {
    if (!node || typeof node.addEventListener !== 'function' || !handler) return;
    node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            if ( typeof e.preventDefault === 'function' ) e.preventDefault();
            handler(e);
        }
    });
}

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

export function renderBlindOpponentPanel(teamState) {
    const panel = el('aside', 'fd-team-panel fd-team-panel--blind dw-opponent-float');

    const head = el('div', 'fd-team-head dw-opponent-float-row');
    const titleWrap = el('div', 'fd-team-title-wrap dw-opponent-float-title');
    titleWrap.append(
        el('span', 'fd-team-label dw-opponent-float-tag', t('draft.opponentFloatTag')),
        el('span', 'fd-team-player dw-opponent-float-name', teamState.name)
    );

    const pickedCount = getPickedCount(teamState);
    const progressEl = el(
        'span',
        'fd-team-progress dw-opponent-float-count',
        `${pickedCount} / ${SLOTS.length}`
    );

    const phaseMod = getTeamPhaseModifier(teamState);
    const statusRow = el('div', 'fd-blind-status-row dw-opponent-float-badges');
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
    return panel;
}

export function renderHeader(state, meId) {
    const header = el('div', 'fd-header');
    const [teamA, teamB] = state.teams;
    const draftPhase = isDraftPhase(state);

    if (draftPhase) {
        header.classList.add('dw-header--draft');
        const myTeam = getMyTeam(state, meId) ?? teamA;
        const opponentTeam = myTeam.id === teamA.id ? teamB : teamA;
        const myTagKey = myTeam.id === teamA.id ? 'common.playerA' : 'common.playerB';

        const selfBox = el(
            'div',
            'fd-vs-player fd-vs-player--self' +
                (isTeamDraftActive(myTeam) ? ' fd-vs-player--active' : '') +
                (myTeam?.draft?.locked ? ' fd-vs-player--locked' : '')
        );
        const picked = getPickedCount(myTeam);
        const phaseMod = getTeamPhaseModifier(myTeam);
        const metaRow = el('div', 'fd-vs-meta');
        metaRow.append(
            el('span', 'fd-vs-progress', `${picked} / ${SLOTS.length}`),
            el(
                'span',
                `fd-vs-status fd-vs-status--${phaseMod}`,
                getTeamPhaseBadgeText(myTeam, true)
            )
        );
        selfBox.append(
            el('span', 'fd-vs-tag', t(myTagKey)),
            el('span', 'fd-vs-name', myTeam.name + t('common.youSuffix')),
            metaRow
        );

        const turnBar = el('div', 'fd-turn-bar');
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

        const opponentFloat = renderBlindOpponentPanel(opponentTeam);
        header.append(selfBox, turnBar, opponentFloat);
        return header;
    }

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
    } else {
        turnBar.classList.add('fd-turn-bar--complete');
        turnBar.textContent = t('match.resultTurnBar');
    }

    header.append(vsRow, turnBar);
    return header;
}

export function renderMobileWorkbenchTabs(myTeam, preview, onSelectMobileTab) {
    const bar = el('div', 'dw-mobile-tabs');
    if (typeof bar.setAttribute === 'function') {
        bar.setAttribute('role', 'tablist');
    }
    const picked = getPickedCount(myTeam);
    const activeTab = MOBILE_TABS.includes(preview?.mobileTab) ? preview.mobileTab : 'candidates';

    const tabSpecs = [
        { id: 'candidates', label: t('draft.mobileTabCandidates') },
        { id: 'squad', label: t('draft.mobileTabSquad', { picked, total: SLOTS.length }) },
        { id: 'inspector', label: t('draft.mobileTabInspector') },
    ];

    for (const spec of tabSpecs) {
        const isActive = activeTab === spec.id;
        const btn = el(
            'button',
            'dw-mobile-tab-btn' + (isActive ? ' dw-mobile-tab-btn--active' : ''),
            spec.label
        );
        btn.type = 'button';
        if (typeof btn.setAttribute === 'function') {
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', String(isActive));
        }
        if (btn.dataset) {
            btn.dataset.focusKey = `mobile-tab:${spec.id}`;
            btn.dataset.mobileTab = spec.id;
        }
        if (onSelectMobileTab) {
            btn.addEventListener('click', () => onSelectMobileTab(spec.id));
        }
        bar.append(btn);
    }

    return bar;
}

export function renderRerollControls(curTeam, currentRoll, canInteract, onRerollClick) {
    const box = el('div', 'fd-reroll-box');
    const btnRow = el('div', 'fd-reroll-row');
    let noLeagueHint = false;
    let noClubHint = false;
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
        btn.type = 'button';
        btn.disabled = !canInteract || used || !hasOption;
        if (btn.dataset) {
            btn.dataset.focusKey = `reroll:${type}`;
            btn.dataset.rerollType = type;
        }

        if (!used && !hasOption) {
            if (type === 'league') noLeagueHint = true;
            else if (type === 'club') noClubHint = true;
            else if (type === 'year') noYearHint = true;
        }

        if (onRerollClick) {
            btn.addEventListener('click', () => onRerollClick(type));
        }
        btnRow.append(btn);
    }

    box.append(btnRow);

    if (noLeagueHint && currentRoll) {
        box.append(
            el(
                'div',
                'fd-reroll-hint',
                t('draft.rerollUnavailableLeague', { year: currentRoll.year })
            )
        );
    }

    if (noClubHint && currentRoll) {
        box.append(
            el(
                'div',
                'fd-reroll-hint',
                t('draft.rerollUnavailableClub', { year: currentRoll.year })
            )
        );
    }

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

export const COMPACT_HISTORY_LIMIT = 3;

const PITCH_FORMATION_ROWS = [
    { role: 'FW', slots: ['FW1', 'FW2', 'FW3'] },
    { role: 'MF', slots: ['MF1', 'MF2', 'MF3'] },
    { role: 'DF', slots: ['DF1', 'DF2', 'DF3', 'DF4'] },
    { role: 'GK', slots: ['GK1'] },
];

let currentSquadViewMode = 'pitch';

export function getSquadViewMode() {
    return currentSquadViewMode;
}

export function setSquadViewMode(mode) {
    if (mode === 'pitch' || mode === 'list') {
        currentSquadViewMode = mode;
    }
}

export function renderHistoryBox(teamOrState) {
    const box = el('div', 'fd-history fd-history--compact');
    const head = el('div', 'fd-history-head');
    head.append(el('span', 'fd-history-title', t('draft.recentActivity')));
    box.append(head);

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

    const recentItems = items.slice(-COMPACT_HISTORY_LIMIT).reverse();
    const list = el('div', 'fd-history-list');
    for (let i = 0; i < recentItems.length; i++) {
        const item = recentItems[i];
        const cls = i === 0 ? 'fd-history-item fd-history-item--latest' : 'fd-history-item';
        list.append(el('div', cls, formatHistoryEvent(item)));
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

function renderConfirmPickBar(state, team, handlers, previewObj) {
    const { onConfirmPick, onClearPreview } = handlers;
    const status = getConfirmPickStatus(state, team, previewObj);

    const bar = el(
        'div',
        'dw-confirm-bar' + (status.canConfirm ? ' dw-confirm-bar--ready' : '')
    );

    const infoWrap = el('div', 'dw-confirm-info');
    if (status.canConfirm && status.candidate && status.slot) {
        const summary = el(
            'div',
            'dw-confirm-summary',
            t('draft.confirmReadySummary', {
                playerName: formatPlayerName(status.candidate.name),
                slot: formatSlotLabel(status.slot),
            })
        );
        infoWrap.append(summary);
    } else {
        const reason = el(
            'div',
            'dw-confirm-reason',
            t(status.reasonKey || 'draft.confirmReasonNeedPlayer')
        );
        infoWrap.append(reason);
    }

    const actionsWrap = el('div', 'dw-confirm-actions');
    if (previewObj?.selectedPlayerId) {
        const clearBtn = el('button', 'dw-clear-preview-btn', t('draft.clearPreviewBtn'));
        clearBtn.type = 'button';
        if (clearBtn.dataset) {
            clearBtn.dataset.focusKey = 'clear-preview';
        }
        if (onClearPreview) {
            clearBtn.addEventListener('click', onClearPreview);
        }
        actionsWrap.append(clearBtn);
    }

    const confirmLabel =
        status.canConfirm && status.slot
            ? t('draft.confirmPickWithTarget', { slot: formatSlotLabel(status.slot) })
            : t('draft.confirmPickBtn');
    const confirmBtn = el('button', 'dw-confirm-btn', confirmLabel);
    confirmBtn.type = 'button';
    confirmBtn.disabled = !status.canConfirm;
    if (confirmBtn.dataset) {
        confirmBtn.dataset.focusKey = 'confirm-pick';
    }
    if (status.canConfirm && onConfirmPick) {
        confirmBtn.addEventListener('click', onConfirmPick);
    }
    actionsWrap.append(confirmBtn);

    bar.append(infoWrap, actionsWrap);
    return bar;
}

export function renderDraftZone(state, myTeam, handlers = {}, selectedPlayerIdOverride = null) {
    const {
        onRollClick,
        onRerollClick,
        onRedrawClick,
        onSelectCandidate,
        onSelectSlot,
        onPickSlot,
        onConfirmPick,
        onClearPreview,
        onLockClick,
        selectedPlayerId: handlerSelectedId,
        selectedSlot: handlerSelectedSlot,
        preview: handlerPreview,
    } = handlers;

    const selectedPlayerId =
        selectedPlayerIdOverride ??
        handlerPreview?.selectedPlayerId ??
        handlerSelectedId ??
        null;
    const selectedSlot = handlerPreview?.selectedSlot ?? handlerSelectedSlot ?? null;
    const previewObj = handlerPreview ?? {
        selectedPlayerId,
        selectedSlot,
        pendingPickKey: null,
    };

    const team = myTeam ?? state.teams[0];
    const myPhase = team?.draft?.phase ?? 'ROLL';
    const pickedCount = getPickedCount(team);
    const slotSelectCallback = onSelectSlot ?? onPickSlot;

    const zone = el('div', 'fd-center dw-center');

    const pickCounter = el(
        'div',
        'fd-pick-counter',
        t('draft.progress', { picked: pickedCount, total: SLOTS.length })
    );

    if (myPhase === 'ROLL') {
        zone.append(pickCounter);
        const rollBox = el('div', 'fd-roll-box dw-roll-box');
        rollBox.append(el('p', 'fd-roll-prompt', t('draft.rollPromptMine')));

        const rollBtn = el('button', 'fd-roll-btn', t('draft.rollBtn'));
        rollBtn.type = 'button';
        rollBtn.disabled = Boolean(team.draft.locked);
        if (rollBtn.dataset) {
            rollBtn.dataset.focusKey = 'roll-btn';
        }
        if (onRollClick) rollBtn.addEventListener('click', onRollClick);
        rollBox.append(rollBtn);

        zone.append(rollBox, renderHistoryBox(team));
        return zone;
    }

    if (myPhase === 'PICK' && team.draft.currentRoll) {
        const roll = team.draft.currentRoll;
        const topControls = el('div', 'dw-center-top');

        const rollHeaderBar = el('div', 'dw-roll-header-bar');
        const rollInfo = el('div', 'fd-roll-result');

        const leagueItem = el('div', 'fd-roll-meta');
        const leagueContent = el('div', 'fd-roll-meta-content');
        const leagueEmblem = createLeagueEmblem(roll.league, {
            className: 'fd-roll-logo fd-roll-league-emblem',
            loading: 'eager',
            wrapperEl: leagueContent,
        });
        if (leagueEmblem) {
            leagueContent.append(leagueEmblem);
        }
        leagueContent.append(el('strong', 'fd-meta-val', formatLeagueName(roll.league)));
        leagueItem.append(el('span', 'fd-meta-label', t('draft.metaLeague')), leagueContent);

        const clubItem = el('div', 'fd-roll-meta');
        const clubContent = el('div', 'fd-roll-meta-content');
        const clubCrest = createClubCrest(roll.club, {
            className: 'fd-roll-logo fd-roll-club-crest',
            loading: 'eager',
            wrapperEl: clubContent,
        });
        if (clubCrest) {
            clubContent.append(clubCrest);
        }
        clubContent.append(el('strong', 'fd-meta-val', formatClubName(roll.club)));
        clubItem.append(el('span', 'fd-meta-label', t('draft.metaClub')), clubContent);

        const yearItem = el('div', 'fd-roll-meta');
        const yearContent = el('div', 'fd-roll-meta-content');
        yearContent.append(el('strong', 'fd-meta-val fd-meta-val--year', String(roll.year)));
        yearItem.append(el('span', 'fd-meta-label', t('draft.metaYear')), yearContent);

        rollInfo.append(leagueItem, clubItem, yearItem);
        rollHeaderBar.append(pickCounter, rollInfo);
        topControls.append(rollHeaderBar);

        topControls.append(renderRerollControls(team, roll, !team.draft.locked, onRerollClick));

        if (canFreeRedraw(team)) {
            const deadRollBox = el('div', 'fd-deadroll-box');
            deadRollBox.append(
                el('div', 'fd-deadroll-badge', t('draft.noValidPick')),
                el('p', 'fd-deadroll-explain', t('draft.freeRedrawExplain'))
            );

            const redrawBtn = el('button', 'fd-redraw-btn', t('draft.freeRedrawBtn'));
            redrawBtn.type = 'button';
            redrawBtn.disabled = Boolean(team.draft.locked);
            if (redrawBtn.dataset) {
                redrawBtn.dataset.focusKey = 'free-redraw-btn';
            }
            if (onRedrawClick) {
                redrawBtn.addEventListener('click', onRedrawClick);
            }
            deadRollBox.append(redrawBtn);
            topControls.append(deadRollBox);
        } else {
            const guide = el('div', 'fd-pick-guide', t('draft.pickGuideMine'));
            topControls.append(guide);
        }

        zone.append(topControls);

        const candidatesScroll = el('div', 'dw-candidates-scroll');
        const cardsGrid = el('div', 'fd-cards-grid');
        for (const player of roll.players) {
            const isDuplicate = isPlayerEntityInRoster(team.roster, player);
            const availableRoles = getAvailableRolesForPlayer(team.roster, player);
            const isSelected = selectedPlayerId === player.id;
            const hasRoles = availableRoles.length > 0;
            const ovr = getPlayerOverall(player);

            let cardClass = 'fd-card';
            if (isSelected) cardClass += ' fd-card--selected';
            if (!hasRoles) cardClass += ' fd-card--disabled';
            if (isDuplicate) cardClass += ' fd-card--duplicate';
            if (!team.draft.locked && hasRoles) cardClass += ' fd-card--interactive';

            const card = el('div', cardClass);
            if (card.dataset) {
                card.dataset.playerId = player.id;
                card.dataset.focusKey = `candidate:${player.id}`;
            }

            const topRow = el('div', 'fd-card-top');
            topRow.append(
                el('span', 'fd-card-pos', player.positions.join(' / ')),
                el('span', 'fd-card-rating', t('draft.cardRating', { rating: ovr }))
            );

            const mediaBox = el('div', 'fd-card-media');
            mediaBox.append(
                createPlayerPortrait(player, {
                    className: 'fd-card-player-img',
                    loading: 'eager',
                })
            );
            const cardCrest = createClubCrest(player.club, {
                className: 'fd-card-club-crest',
                loading: 'eager',
                wrapperEl: mediaBox,
            });
            if (cardCrest) {
                mediaBox.append(cardCrest);
            }

            const displayName = getPlayerDisplayName(player.name);
            const nameEl = el('div', 'fd-card-name', displayName.primary);
            card.append(topRow, mediaBox, nameEl);
            if (displayName.secondary) {
                card.append(el('div', 'fd-card-name-secondary', displayName.secondary));
            }

            if (!team.draft.locked && hasRoles) {
                card.tabIndex = 0;
                if (typeof card.setAttribute === 'function') {
                    card.setAttribute('role', 'button');
                    card.setAttribute('aria-pressed', String(isSelected));
                }
                const selectThis = () => {
                    if (onSelectCandidate) onSelectCandidate(player.id);
                };
                card.addEventListener('click', selectThis);
                attachKeyboardActivation(card, selectThis);
            } else if (!hasRoles) {
                if (typeof card.setAttribute === 'function') {
                    card.setAttribute('aria-disabled', 'true');
                }
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
                    const isRoleActive =
                        Boolean(selectedSlot) && getSlotRole(selectedSlot) === role;
                    const roleBtn = el(
                        'button',
                        'fd-slot-btn' + (isRoleActive ? ' fd-slot-btn--active' : ''),
                        role
                    );
                    roleBtn.type = 'button';
                    if (roleBtn.dataset) {
                        roleBtn.dataset.focusKey = `role-btn:${role}`;
                        roleBtn.dataset.role = role;
                    }
                    roleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const targetSlot = getFirstAvailableSlotForRole(team.roster, role);
                        if (targetSlot && slotSelectCallback) {
                            if (onSelectSlot) {
                                onSelectSlot(role);
                            } else if (onPickSlot) {
                                onPickSlot(player.id, targetSlot);
                            }
                        }
                    });
                    btnGroup.append(roleBtn);
                }
                slotBar.append(btnGroup);
                card.append(slotBar);
            }

            cardsGrid.append(card);
        }

        candidatesScroll.append(cardsGrid);
        zone.append(
            candidatesScroll,
            renderConfirmPickBar(state, team, handlers, previewObj),
            renderHistoryBox(team)
        );
        return zone;
    }

    if (myPhase === 'READY') {
        zone.append(pickCounter);
        const readyBox = el('div', 'fd-ready-box dw-ready-box');
        readyBox.append(
            el('div', 'fd-ready-badge', t('draft.ready')),
            el('p', 'fd-ready-guide', t('draft.readyGuide'))
        );

        const readyRoster = el('div', 'fd-ready-roster dw-ready-roster-scroll');
        for (const role of ROLES) {
            const group = el('div', 'fd-ready-role-group');
            group.append(el('div', 'fd-ready-role-title', `${role} — ${t(ROLE_TITLE_KEYS[role])}`));
            for (const slot of getSlotsForRole(role)) {
                const p = team.roster[slot];
                if (!p) continue;
                const item = el('div', 'fd-ready-slot');
                const avatarWrap = el('div', 'fd-ready-avatar');
                avatarWrap.append(
                    createPlayerPortrait(p, {
                        className: 'fd-ready-player-img',
                        loading: 'lazy',
                    })
                );

                const metaWrap = el('span', 'fd-ready-player-meta-wrap');
                const readyCrest = createClubCrest(p.club, {
                    className: 'fd-ready-club-crest',
                    loading: 'lazy',
                    wrapperEl: metaWrap,
                });
                if (readyCrest) {
                    metaWrap.append(readyCrest);
                }
                metaWrap.append(
                    el(
                        'span',
                        'fd-ready-player-meta',
                        `${formatClubName(p.club)} '${String(p.year).slice(-2)}`
                    )
                );

                item.append(
                    avatarWrap,
                    el('span', 'fd-slot-tag', formatSlotLabel(slot)),
                    el('span', 'fd-ready-player-name', formatPlayerName(p.name)),
                    metaWrap,
                    el('span', 'fd-slot-player-rating', String(getPlayerOverall(p)))
                );
                group.append(item);
            }
            readyRoster.append(group);
        }
        readyBox.append(readyRoster);

        const lockBtn = el('button', 'fd-lock-btn', t('draft.lockIn'));
        lockBtn.type = 'button';
        if (lockBtn.dataset) {
            lockBtn.dataset.focusKey = 'lock-btn';
        }
        if (onLockClick) {
            lockBtn.addEventListener('click', onLockClick);
        }
        readyBox.append(lockBtn);

        zone.append(readyBox, renderHistoryBox(team));
        return zone;
    }

    // myPhase === 'LOCKED'
    zone.append(pickCounter);
    const lockedBox = el('div', 'fd-locked-box');
    lockedBox.append(
        el('div', 'fd-locked-badge', t('draft.locked')),
        el('p', 'fd-locked-wait', t('draft.waitingOpponent'))
    );

    zone.append(lockedBox, renderHistoryBox(team));
    return zone;
}

export function renderPitchView(teamState, options = {}) {
    const {
        isDraftSelf = false,
        selectedCandidate = null,
        selectedSlot = null,
        onSelectSlot = null,
    } = options;

    const pitch = el('div', 'fd-pitch');

    const markings = el('div', 'fd-pitch-markings');
    if (typeof markings.setAttribute === 'function') {
        markings.setAttribute('aria-hidden', 'true');
    }
    markings.append(
        el('div', 'fd-pitch-halfline'),
        el('div', 'fd-pitch-circle'),
        el('div', 'fd-pitch-box'),
        el('div', 'fd-pitch-goal-box')
    );
    pitch.append(markings);

    const grid = el('div', 'fd-pitch-grid');
    for (const rowDef of PITCH_FORMATION_ROWS) {
        const rowEl = el('div', `fd-pitch-row fd-pitch-row--${rowDef.role.toLowerCase()}`);
        if (rowEl.dataset) {
            rowEl.dataset.pitchRow = rowDef.role;
        }

        for (const slot of rowDef.slots) {
            const p = teamState.roster[slot];
            const slotState = isDraftSelf
                ? getSlotPreviewState(teamState, selectedCandidate, slot, selectedSlot)
                : p
                    ? 'occupied'
                    : 'empty';

            let nodeCls = 'fd-pitch-node ';
            if (p) {
                nodeCls += 'fd-pitch-node--filled';
                if (isDraftSelf && selectedCandidate) nodeCls += ' dw-slot--occupied';
            } else if (slotState === 'preview') {
                nodeCls += 'fd-pitch-node--empty fd-pitch-node--preview dw-slot--preview';
            } else if (slotState === 'eligible') {
                nodeCls += 'fd-pitch-node--empty dw-slot--eligible';
            } else if (slotState === 'mismatch') {
                nodeCls += 'fd-pitch-node--empty dw-slot--mismatch';
            } else {
                nodeCls += 'fd-pitch-node--empty';
            }

            const node = el('div', nodeCls);
            if (node.dataset) {
                node.dataset.slot = slot;
                node.dataset.role = rowDef.role;
                node.dataset.slotState = slotState;
                node.dataset.focusKey = `pitch-slot:${slot}`;
            }

            const topBar = el('div', 'fd-pitch-node-top');
            topBar.append(el('span', 'fd-pitch-slot-tag', formatSlotLabel(slot)));
            if (p) {
                topBar.append(
                    el('span', 'fd-pitch-rating fd-slot-player-rating', String(getPlayerOverall(p)))
                );
            } else if (slotState === 'preview' && selectedCandidate) {
                topBar.append(el('span', 'dw-preview-badge', t('draft.previewBadge')));
            } else if (slotState === 'eligible') {
                topBar.append(el('span', 'dw-slot-state-tag', t('draft.slotStateEligible')));
            }
            node.append(topBar);

            if (p) {
                const avatarWrap = el('div', 'fd-pitch-avatar');
                avatarWrap.append(
                    createPlayerPortrait(p, {
                        className: 'fd-slot-player-img fd-pitch-player-img',
                        loading: 'lazy',
                    })
                );

                const playerNameText = formatPlayerName(p.name);
                const clubMetaText = `${formatClubName(p.club)} '${String(p.year).slice(-2)}`;
                if (typeof node.setAttribute === 'function') {
                    node.setAttribute(
                        'title',
                        `${formatSlotLabel(slot)} — ${playerNameText} (${clubMetaText})`
                    );
                    if (isDraftSelf && selectedCandidate) {
                        node.setAttribute('aria-disabled', 'true');
                    }
                }

                node.append(
                    avatarWrap,
                    el('div', 'fd-pitch-name', playerNameText),
                    el('div', 'fd-pitch-meta', clubMetaText)
                );
            } else if (slotState === 'preview' && selectedCandidate) {
                const previewAvatar = el('div', 'fd-pitch-avatar dw-preview-avatar');
                previewAvatar.append(
                    createPlayerPortrait(selectedCandidate, {
                        className: 'dw-preview-player-img fd-pitch-player-img',
                        loading: 'eager',
                    })
                );
                const previewNameText = formatPlayerName(selectedCandidate.name);
                node.append(
                    previewAvatar,
                    el('div', 'fd-pitch-name dw-preview-name', previewNameText),
                    el(
                        'div',
                        'fd-pitch-meta dw-preview-meta',
                        `OVR ${getPlayerOverall(selectedCandidate)}`
                    )
                );
            } else {
                const tokenText = slotState === 'eligible' ? '✓' : '+';
                const emptyLabelText =
                    slotState === 'eligible'
                        ? t('draft.slotStateEligible')
                        : slotState === 'mismatch'
                            ? t('draft.slotStateMismatch')
                            : t('common.emptySlot');
                node.append(
                    el('div', 'fd-pitch-empty-token', tokenText),
                    el('div', 'fd-pitch-empty-label fd-slot-empty', emptyLabelText)
                );
            }

            if (isDraftSelf && (slotState === 'eligible' || slotState === 'preview') && onSelectSlot) {
                node.tabIndex = 0;
                if (typeof node.setAttribute === 'function') {
                    node.setAttribute('role', 'button');
                    node.setAttribute('aria-pressed', String(slotState === 'preview'));
                }
                const chooseSlot = () => onSelectSlot(slot);
                node.addEventListener('click', chooseSlot);
                attachKeyboardActivation(node, chooseSlot);
            } else if (isDraftSelf && (slotState === 'occupied' || slotState === 'mismatch')) {
                if (typeof node.setAttribute === 'function') {
                    node.setAttribute('aria-disabled', 'true');
                }
            }

            rowEl.append(node);
        }

        grid.append(rowEl);
    }

    pitch.append(grid);
    return pitch;
}

export function renderGroupedSlotList(teamState, options = {}) {
    const {
        isDraftSelf = false,
        selectedCandidate = null,
        selectedSlot = null,
        onSelectSlot = null,
    } = options;

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
            const slotState = isDraftSelf
                ? getSlotPreviewState(teamState, selectedCandidate, slot, selectedSlot)
                : p
                    ? 'occupied'
                    : 'empty';

            let rowCls = 'fd-slot-row';
            if (p) {
                rowCls += ' fd-slot-row--filled';
                if (isDraftSelf && selectedCandidate) rowCls += ' dw-slot--occupied';
            } else if (slotState === 'preview') {
                rowCls += ' fd-slot-row--preview dw-slot--preview';
            } else if (slotState === 'eligible') {
                rowCls += ' dw-slot--eligible';
            } else if (slotState === 'mismatch') {
                rowCls += ' dw-slot--mismatch';
            }

            const row = el('div', rowCls);
            if (row.dataset) {
                row.dataset.slot = slot;
                row.dataset.role = role;
                row.dataset.slotState = slotState;
                row.dataset.focusKey = `list-slot:${slot}`;
            }
            row.append(el('span', 'fd-slot-tag', formatSlotLabel(slot)));

            if (p) {
                const miniAvatar = el('div', 'fd-slot-avatar');
                miniAvatar.append(
                    createPlayerPortrait(p, {
                        className: 'fd-slot-player-img',
                        loading: 'lazy',
                    })
                );
                const playerBox = el('div', 'fd-slot-player');
                playerBox.append(
                    el('span', 'fd-slot-player-name', formatPlayerName(p.name)),
                    el(
                        'span',
                        'fd-slot-player-meta',
                        `${formatClubName(p.club)} '${String(p.year).slice(-2)}`
                    )
                );
                row.append(
                    miniAvatar,
                    playerBox,
                    el('span', 'fd-slot-player-rating', String(getPlayerOverall(p)))
                );
            } else if (slotState === 'preview' && selectedCandidate) {
                const previewAvatar = el('div', 'fd-slot-avatar dw-preview-avatar');
                previewAvatar.append(
                    createPlayerPortrait(selectedCandidate, {
                        className: 'dw-preview-player-img',
                        loading: 'eager',
                    })
                );
                const playerBox = el('div', 'fd-slot-player');
                playerBox.append(
                    el('span', 'fd-slot-player-name dw-preview-name', formatPlayerName(selectedCandidate.name)),
                    el('span', 'dw-preview-badge', t('draft.previewBadge'))
                );
                row.append(
                    previewAvatar,
                    playerBox,
                    el(
                        'span',
                        'fd-slot-player-rating dw-preview-rating',
                        String(getPlayerOverall(selectedCandidate))
                    )
                );
            } else if (slotState === 'eligible') {
                row.append(
                    el('span', 'fd-slot-empty dw-slot-eligible-text', t('draft.slotStateEligible')),
                    el('span', 'dw-slot-state-tag', '+')
                );
            } else if (slotState === 'mismatch') {
                row.append(el('span', 'fd-slot-empty', t('draft.slotStateMismatch')));
            } else {
                row.append(el('span', 'fd-slot-empty', t('common.emptySlot')));
            }

            if (isDraftSelf && (slotState === 'eligible' || slotState === 'preview') && onSelectSlot) {
                row.tabIndex = 0;
                if (typeof row.setAttribute === 'function') {
                    row.setAttribute('role', 'button');
                    row.setAttribute('aria-pressed', String(slotState === 'preview'));
                }
                const chooseSlot = () => onSelectSlot(slot);
                row.addEventListener('click', chooseSlot);
                attachKeyboardActivation(row, chooseSlot);
            } else if (isDraftSelf && (slotState === 'occupied' || slotState === 'mismatch')) {
                if (typeof row.setAttribute === 'function') {
                    row.setAttribute('aria-disabled', 'true');
                }
            }

            group.append(row);
        }

        slotList.append(group);
    }

    return slotList;
}

export function renderTeamPanel(state, teamState, idx, meId, options = {}) {
    const isSelf = teamState.id === meId;
    if (isDraftPhase(state) && !isSelf) {
        return renderBlindOpponentPanel(teamState);
    }

    const { preview = null, onSelectSlot = null } = options;
    const isDraftSelf = isDraftPhase(state) && isSelf;
    const selectedCandidate = isDraftSelf ? getSelectedCandidate(teamState, preview) : null;
    const selectedSlot = isDraftSelf ? (preview?.selectedSlot ?? null) : null;

    const isActive = isDraftPhase(state) && isTeamDraftActive(teamState);
    const panel = el(
        'div',
        'fd-team-panel' +
            (isActive ? ' fd-team-panel--active' : '') +
            (isDraftSelf ? ' dw-squad-panel' : '')
    );

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

    const subRow = el('div', 'fd-team-subrow');
    const formationBadge = el('div', 'fd-team-formation', t('draft.formation'));
    const viewToggle = el('div', 'fd-view-toggle');
    const pitchBtn = el('button', 'fd-view-toggle-btn', t('draft.pitchView'));
    pitchBtn.type = 'button';
    if (pitchBtn.dataset) {
        pitchBtn.dataset.focusKey = `view-pitch:${teamState.id}`;
    }
    const listBtn = el('button', 'fd-view-toggle-btn', t('draft.listView'));
    listBtn.type = 'button';
    if (listBtn.dataset) {
        listBtn.dataset.focusKey = `view-list:${teamState.id}`;
    }
    viewToggle.append(pitchBtn, listBtn);
    subRow.append(formationBadge, viewToggle);

    const metaRow = el('div', 'fd-team-meta-row');
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
    metaRow.append(ratingBadge, statusBadge);

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

    head.append(titleWrap, subRow, metaRow, rerollChips);
    panel.append(head);

    const bodyWrap = el('div', 'fd-team-body');
    const viewOptions = {
        isDraftSelf,
        selectedCandidate,
        selectedSlot,
        onSelectSlot,
    };

    const renderBody = () => {
        const isPitch = currentSquadViewMode === 'pitch';
        pitchBtn.className =
            'fd-view-toggle-btn' + (isPitch ? ' fd-view-toggle-btn--active' : '');
        listBtn.className =
            'fd-view-toggle-btn' + (!isPitch ? ' fd-view-toggle-btn--active' : '');
        const nextView = isPitch
            ? renderPitchView(teamState, viewOptions)
            : renderGroupedSlotList(teamState, viewOptions);
        if (typeof bodyWrap.replaceChildren === 'function') {
            bodyWrap.replaceChildren(nextView);
        } else {
            bodyWrap.children = [];
            bodyWrap.append(nextView);
        }
    };

    pitchBtn.addEventListener('click', () => {
        if (currentSquadViewMode === 'pitch') return;
        currentSquadViewMode = 'pitch';
        renderBody();
    });
    listBtn.addEventListener('click', () => {
        if (currentSquadViewMode === 'list') return;
        currentSquadViewMode = 'list';
        renderBody();
    });

    renderBody();
    panel.append(bodyWrap);
    return panel;
}

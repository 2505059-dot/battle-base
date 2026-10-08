// Match Ready (REVEAL UI v1), Live Match Center, and Full Time Result UI rendering helpers (localized via i18n)

import {
    t,
    formatPlayerName,
    formatClubName,
    formatLeagueName,
    getPlayerDisplayName,
} from '../../i18n/i18n.js';
import { el } from '../shared/dom.js';
import { SLOTS, ROLES, getSlotRole, getSlotsForRole, formatSlotLabel } from '../shared/constants.js';
import { clamp } from '../shared/math.js';
import { formatMatchEvent, formatMatchEventBadge } from '../shared/event-formatters.js';
import { getPitchSlotCoord } from '../shared/pitch-coords.js';
import {
    createPlayerPortrait,
    createClubCrest,
    createLeagueEmblem,
} from '../../media/media-ui.js';
import {
    POSITION_BADGE_CLASSES,
    getAbilityTierClasses,
} from '../../ui/foundation-tokens.js';
import { calculateTeamRating, getPlayerOverall } from '../draft/rules.js';
import { renderHistoryBox, formatPitchPlayerName } from '../draft/ui.js';
import { calculateTeamProfile } from './team-profile.js';

export const REVEAL_VIEW_MODES = Object.freeze(['full', 'teamA', 'teamB']);

const REVEAL_ABILITY_ROWS = Object.freeze([
    { key: 'attack', labelKey: 'draft.abilityAttack' },
    { key: 'creation', labelKey: 'draft.abilityCreation' },
    { key: 'defense', labelKey: 'draft.abilityDefense' },
    { key: 'physical', labelKey: 'draft.abilityPhysical' },
    { key: 'goalkeeping', labelKey: 'draft.abilityGoalkeeping' },
]);

function attachRevealKeyHandler(node, handler) {
    if (!node || typeof node.addEventListener !== 'function' || !handler) return;
    node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            handler(e);
        }
    });
}

function resolveDefaultInspectedPlayer(teams, viewMode, preferredTeamIndex, preferredSlot) {
    const targetTeamIdx =
        viewMode === 'teamA'
            ? 0
            : viewMode === 'teamB'
              ? 1
              : preferredTeamIndex === 1
                ? 1
                : 0;
    const team = teams?.[targetTeamIdx] ?? teams?.[0];
    if (preferredSlot && team?.roster?.[preferredSlot]) {
        return {
            teamIndex: targetTeamIdx,
            slot: preferredSlot,
            player: team.roster[preferredSlot],
            team,
        };
    }

    let bestSlot = 'FW2';
    let bestPlayer = team?.roster?.FW2 ?? null;
    let bestOvr = bestPlayer ? getPlayerOverall(bestPlayer) : -1;

    for (const slot of SLOTS) {
        const p = team?.roster?.[slot];
        if (!p) continue;
        const ovr = getPlayerOverall(p);
        if (ovr > bestOvr) {
            bestOvr = ovr;
            bestSlot = slot;
            bestPlayer = p;
        }
    }

    if (bestPlayer) {
        return { teamIndex: targetTeamIdx, slot: bestSlot, player: bestPlayer, team };
    }

    // Fallback to other team if targetTeam has no players
    const fallbackIdx = targetTeamIdx === 0 ? 1 : 0;
    const fallbackTeam = teams?.[fallbackIdx];
    for (const slot of SLOTS) {
        const p = fallbackTeam?.roster?.[slot];
        if (p) {
            return { teamIndex: fallbackIdx, slot, player: p, team: fallbackTeam };
        }
    }

    return { teamIndex: 0, slot: 'FW2', player: null, team: teams?.[0] ?? null };
}

export function renderTeamSummaryHeader(team, rating, profile, teamIndex) {
    const sideMod = teamIndex === 0 ? 'a' : 'b';
    const card = el(
        'div',
        `fd-complete-rating-card rv-team-summary rv-team-summary--${sideMod}`
    );

    const topRow = el('div', 'rv-team-summary-top');
    const titleWrap = el('div', 'rv-team-summary-title');
    titleWrap.append(
        el('span', `rv-team-dot rv-team-dot--${sideMod}`, teamIndex === 0 ? 'A' : 'B'),
        el('span', 'fd-complete-team-name', `${team.label} (${team.name})`)
    );
    const ratingBadge = el(
        'span',
        'fd-complete-rating-text rv-team-ovr-badge',
        t('common.overallRating', { rating })
    );
    topRow.append(titleWrap, ratingBadge);
    card.append(topRow);

    const metrics = el('div', 'fd-profile-metrics rv-profile-metrics');
    const items = [
        ['ATK', profile.attack],
        ['CRE', profile.creation],
        ['DEF', profile.defense],
        ['PHY', profile.physical],
        ['GK', profile.goalkeeping],
    ];
    for (const [label, val] of items) {
        const chip = el('span', 'fd-profile-chip', `${label} ${Math.round(val)}`);
        metrics.append(chip);
    }
    card.append(metrics);

    return card;
}

export function renderProfileCard(team, rating, profile) {
    return renderTeamSummaryHeader(team, rating, profile, team?.id === 'p2' ? 1 : 0);
}

function renderFullPitch22Node(team, teamIndex, slot, player, isSelected, onSelectPlayer) {
    const coord = getPitchSlotCoord('full', teamIndex, slot);
    const sideMod = teamIndex === 0 ? 'a' : 'b';
    const role = (getSlotRole(slot) || player.positions?.[0] || 'MF').toLowerCase();
    const ovr = getPlayerOverall(player);

    let cls = `rv-node rv-node--22 rv-node--team-${sideMod} rv-node--role-${role} fd-reveal-player-row`;
    if (isSelected) cls += ' rv-node--selected';

    const node = el('div', cls);
    node.tabIndex = 0;
    if (typeof node.setAttribute === 'function') {
        node.setAttribute('role', 'button');
        node.setAttribute(
            'title',
            `${team.label} (${team.name}) · ${formatSlotLabel(slot)} — ${formatPlayerName(player.name)} (${formatClubName(player.club)} ${player.year}) · OVR ${ovr}`
        );
    }
    if (node.dataset) {
        node.dataset.teamIndex = String(teamIndex);
        node.dataset.slot = slot;
        node.dataset.playerId = player.id;
        node.dataset.focusKey = `reveal-node:${teamIndex}:${slot}`;
    }
    if (node.style && typeof node.style.setProperty === 'function') {
        node.style.setProperty('--rv-x', coord.xPct);
        node.style.setProperty('--rv-y', coord.yPct);
    } else if (node.style) {
        node.style.left = coord.xPct;
        node.style.top = coord.yPct;
    }

    // Tactical 22-player circular token: Team-colored circle + OVR + subtle slot/role indicator
    const token = el('div', `rv-token-22 rv-token-22--${sideMod}`);
    token.append(
        el('span', 'rv-token-22-ovr fd-reveal-player-ovr', String(ovr)),
        el('span', 'rv-token-22-slot fd-reveal-slot-tag', formatSlotLabel(slot))
    );

    // Hidden media elements preserved in DOM for media audit & preloading without cluttering 22-dot tactical pitch
    const hiddenMediaWrap = el('div', 'rv-hidden-media');
    hiddenMediaWrap.append(
        createPlayerPortrait(player, {
            className: 'fd-reveal-player-img',
            loading: 'lazy',
        })
    );
    const clubCrest = createClubCrest(player.club, {
        className: 'fd-reveal-club-crest',
        loading: 'lazy',
        wrapperEl: hiddenMediaWrap,
    });
    if (clubCrest) {
        hiddenMediaWrap.append(clubCrest);
    }

    const namePill = el('div', `rv-name-pill rv-name-pill--${sideMod}`);
    namePill.append(
        el('span', 'rv-name-short', formatPitchPlayerName(player.name)),
        el('span', 'rv-sr-only fd-reveal-player-name', `${formatPlayerName(player.name)} ${player.name}`)
    );

    node.append(token, namePill, hiddenMediaWrap);

    const activate = () => {
        if (onSelectPlayer) onSelectPlayer(teamIndex, slot);
    };
    node.addEventListener('click', activate);
    attachRevealKeyHandler(node, activate);

    return node;
}

export function renderSingleTeamRevealPitchNodes(
    pitch,
    team,
    teamIndex,
    selectedTeamIndex,
    selectedSlot,
    onSelectPlayer
) {
    const sideMod = teamIndex === 0 ? 'a' : 'b';
    const teamRating = calculateTeamRating(team);

    const topBanner = el('div', `rv-pitch-half-tag rv-pitch-half-tag--single rv-pitch-half-tag--${sideMod}`);
    topBanner.append(
        el('span', `rv-team-dot rv-team-dot--${sideMod}`, teamIndex === 0 ? 'A' : 'B'),
        el('span', 'rv-pitch-half-name', `${team.label} (${team.name}) · 4-3-3 · OVR ${teamRating}`),
        el('span', 'rv-pitch-half-dir', t('draft.revealAttackUp'))
    );
    pitch.append(topBanner);

    for (const slot of SLOTS) {
        const player = team?.roster?.[slot];
        if (!player) continue;

        const coord = getPitchSlotCoord('single', teamIndex, slot);
        const role = (getSlotRole(slot) || player.positions?.[0] || 'MF').toLowerCase();
        const ovr = getPlayerOverall(player);
        const isSelected = selectedTeamIndex === teamIndex && selectedSlot === slot;

        let cls = `rv-node rv-node--single rv-node--team-${sideMod} rv-node--role-${role} fd-reveal-player-row`;
        if (isSelected) cls += ' rv-node--selected';

        const node = el('div', cls);
        node.tabIndex = 0;
        if (typeof node.setAttribute === 'function') {
            node.setAttribute('role', 'button');
            node.setAttribute(
                'title',
                `${formatSlotLabel(slot)} — ${formatPlayerName(player.name)} (${formatClubName(player.club)} ${player.year}) · OVR ${ovr}`
            );
        }
        if (node.dataset) {
            node.dataset.teamIndex = String(teamIndex);
            node.dataset.slot = slot;
            node.dataset.playerId = player.id;
            node.dataset.focusKey = `reveal-node:${teamIndex}:${slot}`;
        }
        if (node.style && typeof node.style.setProperty === 'function') {
            node.style.setProperty('--rv-x', coord.xPct);
            node.style.setProperty('--rv-y', coord.yPct);
        } else if (node.style) {
            node.style.left = coord.xPct;
            node.style.top = coord.yPct;
        }

        const figure = el('div', 'fd-pitch-figure rv-single-figure');
        const portraitImg = createPlayerPortrait(player, {
            className: 'fd-slot-player-img fd-reveal-player-img',
            loading: 'eager',
        });
        const isSilhouette = portraitImg.classList?.contains('fd-player-img--silhouette');
        const avatarWrap = el(
            'div',
            'fd-pitch-avatar rv-single-avatar' + (isSilhouette ? ' fd-pitch-avatar--silhouette' : '')
        );
        avatarWrap.append(portraitImg);
        figure.append(
            avatarWrap,
            el('span', 'fd-pitch-rating fd-reveal-player-ovr', String(ovr))
        );

        const namePill = el('div', 'rv-single-label');
        namePill.append(
            el('span', 'fd-pitch-name rv-single-name', formatPitchPlayerName(player.name)),
            el('span', 'rv-sr-only fd-reveal-player-name', `${formatPlayerName(player.name)} ${player.name}`)
        );

        const metaPill = el('div', 'rv-single-meta');
        const crest = createClubCrest(player.club, {
            className: 'fd-reveal-club-crest rv-single-crest',
            loading: 'lazy',
            wrapperEl: metaPill,
        });
        if (crest) metaPill.append(crest);
        metaPill.append(
            el('span', 'rv-single-year', `'${String(player.year).slice(-2)}`),
            el('span', 'rv-single-slot fd-reveal-slot-tag', formatSlotLabel(slot))
        );

        node.append(figure, namePill, metaPill);

        const activate = () => {
            if (onSelectPlayer) onSelectPlayer(teamIndex, slot);
        };
        node.addEventListener('click', activate);
        attachRevealKeyHandler(node, activate);

        pitch.append(node);
    }
}

function renderHiddenTeamMediaContract(team) {
    const hidden = el('div', 'rv-hidden-media');
    for (const slot of SLOTS) {
        const p = team?.roster?.[slot];
        if (!p) continue;
        const row = el('div', 'fd-reveal-player-row');
        row.append(
            createPlayerPortrait(p, { className: 'fd-reveal-player-img', loading: 'lazy' }),
            el('span', 'fd-reveal-player-name', `${formatPlayerName(p.name)} ${p.name}`)
        );
        const crest = createClubCrest(p.club, {
            className: 'fd-reveal-club-crest',
            loading: 'lazy',
            wrapperEl: row,
        });
        if (crest) row.append(crest);
        hidden.append(row);
    }
    return hidden;
}

function renderRevealInspector(inspected) {
    const panel = el('div', 'fd-team-panel dw-inspector rv-inspector');
    const head = el('div', 'fd-team-head dw-inspector-head rv-inspector-head');
    const titleWrap = el('div', 'fd-team-title-wrap');
    titleWrap.append(el('div', 'fd-team-label', t('draft.revealInspectTitle')));

    if (inspected?.team && inspected?.slot) {
        const sideMod = inspected.teamIndex === 0 ? 'a' : 'b';
        const slotBadge = el(
            'span',
            `rv-inspector-team-pill rv-inspector-team-pill--${sideMod}`,
            `${inspected.team.label} (${inspected.team.name}) · ${formatSlotLabel(inspected.slot)}`
        );
        head.append(titleWrap, slotBadge);
    } else {
        head.append(titleWrap);
    }
    panel.append(head);

    const body = el('div', 'dw-inspector-body rv-inspector-body');
    const subject = inspected?.player;

    if (!subject) {
        body.append(el('div', 'dw-inspector-empty', t('draft.revealInspectHint')));
        panel.append(body);
        return panel;
    }

    const primaryRole = (subject.positions?.[0] || 'MF').toLowerCase();
    const hero = el(
        'div',
        `dw-inspector-hero ol3-inspector-hero ol3-inspector-hero--${primaryRole}`
    );

    const portraitCol = el('div', 'ol3-inspector-portrait-col');
    const portraitImg = createPlayerPortrait(subject, {
        className: 'dw-inspector-player-img',
        loading: 'eager',
    });
    const isSilhouette = portraitImg.classList?.contains('fd-player-img--silhouette');
    const portraitWell = el(
        'div',
        'dw-inspector-portrait-well ui-card-portrait-well ol3-portrait-well' +
            (isSilhouette ? ' dw-inspector-portrait-well--silhouette' : '')
    );
    const posWatermark = el('span', 'ol3-portrait-pos-watermark', subject.positions?.[0] || 'MF');
    if (typeof posWatermark.setAttribute === 'function') {
        posWatermark.setAttribute('aria-hidden', 'true');
    }
    portraitWell.append(posWatermark, portraitImg);
    portraitCol.append(portraitWell);

    const heroInfo = el('div', 'dw-inspector-hero-info');
    const topMetaRow = el('div', 'dw-inspector-top-meta');
    const roleGroup = el('div', 'dw-inspector-role-badges');
    for (const pos of subject.positions || []) {
        const badgeCls = POSITION_BADGE_CLASSES[pos] || POSITION_BADGE_CLASSES.MF;
        roleGroup.append(
            el('span', `dw-pos-badge ol3-pos-tag ol3-pos-tag--${pos.toLowerCase()} ${badgeCls}`, pos)
        );
    }

    const ovrBox = el('div', 'dw-inspector-ovr ol3-inspector-ovr');
    ovrBox.append(
        el('span', 'dw-inspector-ovr-label', t('common.rating')),
        el('strong', 'dw-inspector-ovr-val', String(getPlayerOverall(subject)))
    );
    topMetaRow.append(roleGroup, ovrBox);

    const displayName = getPlayerDisplayName(subject.name);
    const nameBlock = el('div', 'dw-inspector-names');
    nameBlock.append(el('div', 'dw-inspector-name-primary', displayName.primary));
    if (displayName.secondary && displayName.secondary !== displayName.primary) {
        nameBlock.append(el('div', 'dw-inspector-name-secondary', displayName.secondary));
    }

    const clubMeta = el('div', 'dw-inspector-club-meta');
    const clubRow = el('div', 'dw-inspector-meta-line');
    const clubCrest = createClubCrest(subject.club, {
        className: 'dw-inspector-logo',
        loading: 'eager',
        wrapperEl: clubRow,
    });
    if (clubCrest) clubRow.append(clubCrest);
    clubRow.append(
        el('span', 'dw-inspector-club-text', formatClubName(subject.club)),
        el('span', 'dw-inspector-season-pill ol3-season-badge', String(subject.year))
    );

    const leagueRow = el('div', 'dw-inspector-meta-line');
    const leagueEmblem = createLeagueEmblem(subject.league, {
        className: 'dw-inspector-logo dw-inspector-logo--league',
        loading: 'eager',
        wrapperEl: leagueRow,
    });
    if (leagueEmblem) leagueRow.append(leagueEmblem);
    leagueRow.append(el('span', 'dw-inspector-league-text', formatLeagueName(subject.league)));

    clubMeta.append(clubRow, leagueRow);
    heroInfo.append(topMetaRow, nameBlock, clubMeta);
    hero.append(portraitCol, heroInfo);
    body.append(hero);

    // 5 Core Abilities Breakdown
    const statsSection = el('div', 'dw-inspector-section');
    statsSection.append(el('div', 'dw-inspector-section-title', t('draft.inspectorAbilitiesTitle')));

    const statsList = el('div', 'dw-inspector-stats-list');
    for (const statDef of REVEAL_ABILITY_ROWS) {
        const val = Number(subject[statDef.key]) || 0;
        const clamped = Math.max(0, Math.min(100, val));
        const tier = getAbilityTierClasses(val);

        const row = el('div', 'dw-inspector-stat-row');
        const top = el('div', 'dw-inspector-stat-top');
        top.append(
            el('span', 'dw-inspector-stat-label', t(statDef.labelKey)),
            el('span', `dw-inspector-stat-val ${tier.value}`, String(val))
        );

        const track = el('div', 'dw-inspector-stat-track');
        const fill = el('div', `dw-inspector-stat-fill ${tier.bar}`);
        if (fill.style && typeof fill.style.setProperty === 'function') {
            fill.style.setProperty('--stat-pct', String(clamped));
        } else if (fill.style) {
            fill.style['--stat-pct'] = String(clamped);
        }
        track.append(fill);

        row.append(top, track);
        statsList.append(row);
    }
    statsSection.append(statsList);
    body.append(statsSection);

    body.append(el('div', 'rv-inspector-hint', t('draft.revealInspectHint')));
    panel.append(body);
    return panel;
}

export function renderCompleteZone(state, isTeamAPlayer, onMatchStartClick, revealOptions = {}) {
    const zone = el('div', 'fd-center fd-complete-zone fd-reveal-zone rv-root');
    const [teamA, teamB] = state.teams;
    const ratingA = calculateTeamRating(teamA);
    const ratingB = calculateTeamRating(teamB);
    const profileA = calculateTeamProfile(teamA);
    const profileB = calculateTeamProfile(teamB);

    const localState = {
        viewMode: REVEAL_VIEW_MODES.includes(revealOptions.viewMode)
            ? revealOptions.viewMode
            : 'full',
        selectedTeamIndex:
            revealOptions.selectedTeamIndex === 1 ? 1 : 0,
        selectedSlot: revealOptions.selectedSlot || 'FW2',
    };

    function selectMode(nextMode) {
        if (!REVEAL_VIEW_MODES.includes(nextMode)) return;
        localState.viewMode = nextMode;
        if (nextMode === 'teamA') localState.selectedTeamIndex = 0;
        if (nextMode === 'teamB') localState.selectedTeamIndex = 1;
        if (typeof revealOptions.onSelectViewMode === 'function') {
            revealOptions.onSelectViewMode(nextMode);
            return;
        }
        rebuildZone();
    }

    function selectPlayer(teamIndex, slot) {
        localState.selectedTeamIndex = teamIndex === 1 ? 1 : 0;
        localState.selectedSlot = slot;
        if (typeof revealOptions.onSelectPlayer === 'function') {
            revealOptions.onSelectPlayer(localState.selectedTeamIndex, slot);
            return;
        }
        rebuildZone();
    }

    function rebuildZone() {
        if (typeof zone.replaceChildren === 'function') {
            zone.replaceChildren();
        } else if (Array.isArray(zone.children)) {
            zone.children.length = 0;
        }

        const inspected = resolveDefaultInspectedPlayer(
            state.teams,
            localState.viewMode,
            localState.selectedTeamIndex,
            localState.selectedSlot
        );
        localState.selectedTeamIndex = inspected.teamIndex;
        localState.selectedSlot = inspected.slot;

        // 1. Top Matchup & Mode Switcher Bar
        const topBar = el('div', 'rv-top-bar fd-complete-ratings');
        const summaryCardA = renderTeamSummaryHeader(teamA, ratingA, profileA, 0);
        const summaryCardB = renderTeamSummaryHeader(teamB, ratingB, profileB, 1);

        const centerHub = el('div', 'rv-control-hub');
        const titleRow = el('div', 'rv-title-row');
        titleRow.append(
            el('span', 'fd-reveal-badge', t('draft.bothLocked')),
            el('h2', 'fd-complete-title', t('draft.rosterReveal')),
            el('p', 'fd-complete-sub', t('draft.revealSub'))
        );

        const modeTabs = el('div', 'rv-mode-tabs');
        if (typeof modeTabs.setAttribute === 'function') {
            modeTabs.setAttribute('role', 'tablist');
        }
        const modes = [
            { id: 'full', label: t('draft.revealModeAll22') },
            { id: 'teamA', label: `${t('draft.revealModeTeamA')} (${teamA.name})` },
            { id: 'teamB', label: `${t('draft.revealModeTeamB')} (${teamB.name})` },
        ];
        for (const m of modes) {
            const isActive = localState.viewMode === m.id;
            const btn = el(
                'button',
                'rv-mode-btn' + (isActive ? ' rv-mode-btn--active' : ''),
                m.label
            );
            btn.type = 'button';
            if (btn.dataset) {
                btn.dataset.revealMode = m.id;
                btn.dataset.focusKey = `reveal-mode:${m.id}`;
            }
            btn.addEventListener('click', () => selectMode(m.id));
            modeTabs.append(btn);
        }

        centerHub.append(titleRow, modeTabs);
        topBar.append(summaryCardA, centerHub, summaryCardB);
        zone.append(topBar);

        // 2. Main Reveal Stage: Central Vertical Pitch + Right Historical Archive Inspector
        const stageGrid = el('div', 'rv-stage-grid');
        const pitchStage = el('div', 'rv-pitch-stage');
        const pitch = el(
            'div',
            `fd-pitch ol3-pitch rv-pitch rv-pitch--${localState.viewMode}`
        );

        if (localState.viewMode === 'full') {
            const topHalfTag = el('div', 'rv-pitch-half-tag rv-pitch-half-tag--b');
            topHalfTag.append(
                el('span', 'rv-team-dot rv-team-dot--b', 'B'),
                el('span', 'rv-pitch-half-name', `${teamB.name} · 4-3-3`),
                el('span', 'rv-pitch-half-dir', '▼')
            );

            const bottomHalfTag = el('div', 'rv-pitch-half-tag rv-pitch-half-tag--a');
            bottomHalfTag.append(
                el('span', 'rv-team-dot rv-team-dot--a', 'A'),
                el('span', 'rv-pitch-half-name', `${teamA.name} · 4-3-3`),
                el('span', 'rv-pitch-half-dir', '▲')
            );

            pitch.append(topHalfTag, bottomHalfTag);

            // Render Team B (top half) and Team A (bottom half) — 22 players total on 1 vertical pitch
            for (let tIdx = 1; tIdx >= 0; tIdx--) {
                const teamObj = state.teams[tIdx];
                for (const slot of SLOTS) {
                    const p = teamObj?.roster?.[slot];
                    if (!p) continue;
                    const isSelected =
                        inspected.teamIndex === tIdx && inspected.slot === slot;
                    pitch.append(
                        renderFullPitch22Node(teamObj, tIdx, slot, p, isSelected, selectPlayer)
                    );
                }
            }
        } else {
            const activeTeamIdx = localState.viewMode === 'teamB' ? 1 : 0;
            const activeTeam = state.teams[activeTeamIdx];
            const inactiveTeam = state.teams[activeTeamIdx === 0 ? 1 : 0];
            renderSingleTeamRevealPitchNodes(
                pitch,
                activeTeam,
                activeTeamIdx,
                inspected.teamIndex,
                inspected.slot,
                selectPlayer
            );
            pitch.append(renderHiddenTeamMediaContract(inactiveTeam));
        }

        pitchStage.append(pitch);

        // Right Column: Match Start Action Dock + Selected Player Historical Archive Inspector + Activity Log
        const sideCol = el('aside', 'rv-side-col');
        const actionDock = el('div', 'rv-action-dock');
        if (isTeamAPlayer) {
            const matchBtn = el('button', 'fd-match-btn bb-btn-primary', t('match.matchBtn'));
            matchBtn.type = 'button';
            if (matchBtn.dataset) {
                matchBtn.dataset.focusKey = 'reveal-start-match-btn';
            }
            matchBtn.addEventListener('click', onMatchStartClick);
            actionDock.append(matchBtn);
        } else {
            const waitNotice = el(
                'div',
                'fd-match-wait',
                t('match.waitingForTeamA', { playerName: teamA.name })
            );
            actionDock.append(waitNotice);
        }

        const inspectorCard = renderRevealInspector(inspected);
        const historyCard = renderHistoryBox(state);
        historyCard.classList.add('rv-history-box');

        sideCol.append(actionDock, inspectorCard, historyCard);
        stageGrid.append(pitchStage, sideCol);
        zone.append(stageGrid);
    }

    rebuildZone();
    return zone;
}

export const renderRevealZone = renderCompleteZone;

export function renderMatchStatsBox(stats, score, isFullTime) {
    const box = el('div', 'fd-stats-box' + (isFullTime ? ' fd-stats-box--ft' : ''));
    box.append(
        el(
            'div',
            'fd-stats-title',
            isFullTime ? t('match.statsTitleFullTime') : t('match.statsTitleLive')
        )
    );

    const headerRow = el('div', 'fd-stats-row fd-stats-row--head');
    headerRow.append(
        el('span', 'fd-stats-val fd-stats-val--a', t('common.teamA')),
        el('span', 'fd-stats-label', ''),
        el('span', 'fd-stats-val fd-stats-val--b', t('common.teamB'))
    );
    box.append(headerRow);

    const rows = [
        [t('match.statGoals'), score.A, score.B],
        [t('match.statPossession'), `${stats.A.possession}%`, `${stats.B.possession}%`],
        [t('match.statShots'), stats.A.shots, stats.B.shots],
        [t('match.statShotsOnTarget'), stats.A.shotsOnTarget, stats.B.shotsOnTarget],
        [t('match.statSaves'), stats.A.saves, stats.B.saves],
    ];

    for (const [label, valA, valB] of rows) {
        const row = el('div', 'fd-stats-row');
        row.append(
            el('span', 'fd-stats-val fd-stats-val--a', String(valA)),
            el('span', 'fd-stats-label', label),
            el('span', 'fd-stats-val fd-stats-val--b', String(valB))
        );
        box.append(row);
    }

    return box;
}

export function renderMatchZone(state) {
    const zone = el('div', 'fd-center fd-match-zone');
    const [teamA, teamB] = state.teams;
    const match = state.match;
    if (!match) return zone;

    const isFinished = state.phase === 'RESULT';
    const score = isFinished ? match.script.finalScore : match.liveScore;
    const stats = isFinished ? match.script.stats : match.liveStats;
    const minute = isFinished ? 90 : match.currentMinute;
    const minuteStr = String(minute).padStart(2, '0') + "'";

    // 1. Scoreboard Header
    const scoreboard = el('div', 'fd-scoreboard');

    const sideA = el('div', 'fd-score-team fd-score-team--a');
    sideA.append(
        el('div', 'fd-score-label', t('common.teamA')),
        el('div', 'fd-score-player', teamA.name)
    );

    const scoreCenter = el('div', 'fd-score-center');
    const scoreNumbers = el('div', 'fd-score-numbers', `${score.A} - ${score.B}`);
    const clockWrap = el('div', 'fd-clock-wrap');
    clockWrap.append(
        el(
            'span',
            'fd-clock-label',
            isFinished ? t('match.fullTime') : t('match.matchClock')
        ),
        el('span', 'fd-clock-val' + (isFinished ? ' fd-clock-val--ft' : ''), minuteStr)
    );
    scoreCenter.append(scoreNumbers, clockWrap);

    const sideB = el('div', 'fd-score-team fd-score-team--b');
    sideB.append(
        el('div', 'fd-score-label', t('common.teamB')),
        el('div', 'fd-score-player', teamB.name)
    );

    scoreboard.append(sideA, scoreCenter, sideB);
    zone.append(scoreboard);

    // Progress Bar
    const progressTrack = el('div', 'fd-clock-progress');
    const progressFill = el('div', 'fd-clock-progress-fill');
    progressFill.style.width = `${clamp((minute / 90) * 100, 0, 100)}%`;
    progressTrack.append(progressFill);
    zone.append(progressTrack);

    // 2. Result Winner Banner + Full Statistics Table when FULL TIME
    if (isFinished) {
        let resultText = t('match.draw');
        let resultClass = 'fd-winner-banner fd-winner-banner--draw';
        if (score.A > score.B) {
            resultText = t('match.winnerTeamA', { playerName: teamA.name });
            resultClass = 'fd-winner-banner fd-winner-banner--win';
        } else if (score.B > score.A) {
            resultText = t('match.winnerTeamB', { playerName: teamB.name });
            resultClass = 'fd-winner-banner fd-winner-banner--win';
        }
        zone.append(el('div', resultClass, resultText));
        zone.append(renderMatchStatsBox(stats, score, true));
    }

    // 3. Match Center Event Feed
    const feedBox = el('div', 'fd-match-center');
    const feedHeader = el('div', 'fd-match-center-head');
    feedHeader.append(
        el('span', 'fd-match-center-title', t('match.matchCenterTitle')),
        el(
            'span',
            'fd-match-center-sub',
            isFinished
                ? t('match.matchCenterSubDone', { total: match.script.events.length })
                : t('match.matchCenterSubLive', {
                      current: match.revealedCount,
                      total: match.script.events.length,
                  })
        )
    );
    feedBox.append(feedHeader);

    const feedList = el('div', 'fd-match-feed-list');
    const visibleEvents = match.script.events.slice(0, match.revealedCount);

    for (let i = 0; i < visibleEvents.length; i++) {
        const ev = visibleEvents[i];
        const isLatest = !isFinished && i === visibleEvents.length - 1;
        let itemClass = `fd-feed-item fd-feed-item--${ev.type}`;
        if (isLatest) itemClass += ' fd-feed-item--latest';

        const row = el('div', itemClass);
        const minTag = el('span', 'fd-feed-min', `${String(ev.minute).padStart(2, '0')}'`);
        const badge = el(
            'span',
            `fd-feed-badge fd-feed-badge--${ev.type}`,
            formatMatchEventBadge(ev)
        );

        const body = el('div', 'fd-feed-body');
        if (ev.team) {
            const teamChip = el(
                'span',
                `fd-feed-team fd-feed-team--${ev.team.toLowerCase()}`,
                ev.team === 'A' ? t('common.teamA') : t('common.teamB')
            );
            body.append(teamChip);
        }
        body.append(el('span', 'fd-feed-text', formatMatchEvent(ev)));

        row.append(minTag, badge, body);
        feedList.append(row);
    }

    feedBox.append(feedList);
    zone.append(feedBox);

    // Live compact stats during MATCH phase
    if (!isFinished) {
        zone.append(renderMatchStatsBox(stats, score, false));
    }

    return zone;
}

export function scrollFeedToBottom(root) {
    const feedEl = root.querySelector('.fd-match-feed-list');
    if (feedEl) {
        feedEl.scrollTop = feedEl.scrollHeight;
    }
}

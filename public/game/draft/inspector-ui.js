// Draft Workbench v1 — Right Column Player Detail Inspector
// Displays the selected candidate's portrait, localized names, club/league/season,
// eligible roles & open slots, explicit per-position rating boundary note, and 5 core ability bars.

import {
    t,
    formatLeagueName,
    formatClubName,
    getPlayerDisplayName,
} from '../../i18n/i18n.js';
import { el } from '../shared/dom.js';
import { getSlotsForRole, formatSlotLabel } from '../shared/constants.js';
import {
    createPlayerPortrait,
    createClubCrest,
    createLeagueEmblem,
} from '../../media/media-ui.js';
import {
    POSITION_BADGE_CLASSES,
    getAbilityTierClasses,
} from '../../ui/foundation-tokens.js';
import {
    getPlayerOverall,
} from './rules.js';
import { getSelectedCandidate, isLegalCandidateSlot } from './preview-state.js';

const ABILITY_ROWS = Object.freeze([
    { key: 'attack', labelKey: 'draft.abilityAttack' },
    { key: 'creation', labelKey: 'draft.abilityCreation' },
    { key: 'defense', labelKey: 'draft.abilityDefense' },
    { key: 'physical', labelKey: 'draft.abilityPhysical' },
    { key: 'goalkeeping', labelKey: 'draft.abilityGoalkeeping' },
]);

export function renderPlayerInspector(state, myTeam, handlers = {}, preview = {}) {
    const { onSelectSlot } = handlers;
    const panel = el('aside', 'fd-team-panel dw-inspector');
    if (typeof panel.setAttribute === 'function') {
        panel.setAttribute('aria-label', t('draft.inspectorTitle'));
    }

    const head = el('div', 'fd-team-head dw-inspector-head');
    const titleWrap = el('div', 'fd-team-title-wrap');
    titleWrap.append(el('div', 'fd-team-label', t('draft.inspectorTitle')));
    head.append(titleWrap);
    panel.append(head);

    const body = el('div', 'dw-inspector-body');
    const candidate = getSelectedCandidate(myTeam, preview);

    if (!candidate) {
        const emptyBox = el('div', 'dw-inspector-empty');
        const badge = el('div', 'dw-inspector-empty-icon', '⚽');
        if (typeof badge.setAttribute === 'function') {
            badge.setAttribute('aria-hidden', 'true');
        }

        const myPhase = myTeam?.draft?.phase ?? 'ROLL';
        let guideKey = 'draft.inspectorEmptyGuide';
        if (myPhase === 'ROLL') {
            guideKey = 'draft.inspectorRollWaitGuide';
        } else if (myPhase === 'READY' || myPhase === 'LOCKED' || myTeam?.draft?.locked) {
            guideKey = 'draft.inspectorReadyGuide';
        }

        const stepsRow = el('div', 'dw-inspector-steps');
        stepsRow.append(
            el('span', 'dw-step-pill', t('draft.workbenchStep1')),
            el('span', 'dw-step-pill', t('draft.workbenchStep2')),
            el('span', 'dw-step-pill', t('draft.workbenchStep3'))
        );

        emptyBox.append(
            badge,
            el('div', 'dw-inspector-empty-title', t('draft.inspectorEmptyTitle')),
            el('p', 'dw-inspector-empty-guide', t(guideKey)),
            stepsRow
        );
        body.append(emptyBox);
        panel.append(body);
        return panel;
    }

    // 1. Hero Identity Card
    const hero = el('div', 'dw-inspector-hero');
    const portraitWell = el('div', 'dw-inspector-portrait-well ui-card-portrait-well');
    portraitWell.append(
        createPlayerPortrait(candidate, {
            className: 'dw-inspector-player-img',
            loading: 'eager',
        })
    );

    const heroInfo = el('div', 'dw-inspector-hero-info');
    const topMetaRow = el('div', 'dw-inspector-top-meta');
    const roleGroup = el('div', 'dw-inspector-role-badges');
    for (const pos of candidate.positions) {
        const badgeCls = POSITION_BADGE_CLASSES[pos] || POSITION_BADGE_CLASSES.MF;
        roleGroup.append(el('span', `dw-pos-badge ${badgeCls}`, pos));
    }

    const ovrBox = el('div', 'dw-inspector-ovr');
    ovrBox.append(
        el('span', 'dw-inspector-ovr-label', t('common.rating')),
        el('strong', 'dw-inspector-ovr-val', String(getPlayerOverall(candidate)))
    );
    topMetaRow.append(roleGroup, ovrBox);

    const displayName = getPlayerDisplayName(candidate.name);
    const nameBlock = el('div', 'dw-inspector-names');
    nameBlock.append(el('div', 'dw-inspector-name-primary', displayName.primary));
    if (displayName.secondary) {
        nameBlock.append(el('div', 'dw-inspector-name-secondary', displayName.secondary));
    }

    const clubMeta = el('div', 'dw-inspector-club-meta');
    const clubRow = el('div', 'dw-inspector-meta-line');
    const clubCrest = createClubCrest(candidate.club, {
        className: 'dw-inspector-logo',
        loading: 'eager',
        wrapperEl: clubRow,
    });
    if (clubCrest) clubRow.append(clubCrest);
    clubRow.append(
        el('span', 'dw-inspector-club-text', formatClubName(candidate.club)),
        el('span', 'dw-inspector-season-pill', String(candidate.year))
    );

    const leagueRow = el('div', 'dw-inspector-meta-line');
    const leagueEmblem = createLeagueEmblem(candidate.league, {
        className: 'dw-inspector-logo dw-inspector-logo--league',
        loading: 'eager',
        wrapperEl: leagueRow,
    });
    if (leagueEmblem) leagueRow.append(leagueEmblem);
    leagueRow.append(el('span', 'dw-inspector-league-text', formatLeagueName(candidate.league)));

    clubMeta.append(clubRow, leagueRow);
    heroInfo.append(topMetaRow, nameBlock, clubMeta);
    hero.append(portraitWell, heroInfo);
    body.append(hero);

    // 2. Eligible Positions & Slot Status (with explicit per-position rating boundary note)
    const posSection = el('div', 'dw-inspector-section');
    posSection.append(el('div', 'dw-inspector-section-title', t('draft.inspectorPositionsTitle')));

    const slotChipsWrap = el('div', 'dw-inspector-slots');
    for (const role of candidate.positions) {
        for (const slot of getSlotsForRole(role)) {
            const occupied = myTeam?.roster?.[slot] !== null;
            const legal = isLegalCandidateSlot(myTeam.roster, candidate, slot);
            const isPreviewed = legal && preview?.selectedSlot === slot;

            let chipCls = 'dw-inspector-slot-chip';
            if (isPreviewed) chipCls += ' dw-inspector-slot-chip--preview';
            else if (legal) chipCls += ' dw-inspector-slot-chip--eligible';
            else chipCls += ' dw-inspector-slot-chip--occupied';

            const stateLabel = isPreviewed
                ? t('draft.previewBadge')
                : legal
                    ? t('draft.slotStateEligible')
                    : t('draft.slotStateOccupied');

            const chipBtn = el('button', chipCls);
            chipBtn.type = 'button';
            chipBtn.disabled = !legal;
            if (chipBtn.dataset) {
                chipBtn.dataset.focusKey = `inspector-slot:${slot}`;
                chipBtn.dataset.slot = slot;
            }
            chipBtn.append(
                el('span', 'dw-inspector-slot-code', formatSlotLabel(slot)),
                el('span', 'dw-inspector-slot-state', stateLabel)
            );
            if (legal && onSelectSlot) {
                chipBtn.addEventListener('click', () => onSelectSlot(slot));
            }
            slotChipsWrap.append(chipBtn);
        }
    }
    posSection.append(
        slotChipsWrap,
        el('div', 'dw-inspector-pos-note', t('draft.inspectorPosRatingUnavailable'))
    );
    body.append(posSection);

    // 3. 5 Core Abilities Breakdown
    const statsSection = el('div', 'dw-inspector-section');
    statsSection.append(el('div', 'dw-inspector-section-title', t('draft.inspectorAbilitiesTitle')));

    const statsList = el('div', 'dw-inspector-stats-list');
    for (const statDef of ABILITY_ROWS) {
        const val = Number(candidate[statDef.key]) || 0;
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

    panel.append(body);
    return panel;
}

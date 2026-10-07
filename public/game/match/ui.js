// Match Ready, Live Match Center, and Full Time Result UI rendering helpers (localized via i18n)

import { t, formatPlayerName, formatClubName } from '../../i18n/i18n.js';
import { el } from '../shared/dom.js';
import { ROLES, getSlotsForRole, formatSlotLabel } from '../shared/constants.js';
import { clamp } from '../shared/math.js';
import { formatMatchEvent, formatMatchEventBadge } from '../shared/event-formatters.js';
import { calculateTeamRating, getPlayerOverall } from '../draft/rules.js';
import { renderHistoryBox } from '../draft/ui.js';
import { calculateTeamProfile } from './team-profile.js';

export function renderProfileCard(team, rating, profile) {
    const card = el('div', 'fd-complete-rating-card');
    card.append(
        el('div', 'fd-complete-team-name', `${team.label} (${team.name})`),
        el('div', 'fd-complete-rating-text', t('common.overallRating', { rating }))
    );

    const metrics = el('div', 'fd-profile-metrics');
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

    const lineupBox = el('div', 'fd-reveal-lineup');
    for (const role of ROLES) {
        const roleGroup = el('div', 'fd-reveal-role-group');
        roleGroup.append(el('div', 'fd-reveal-role-head', role));
        for (const slot of getSlotsForRole(role)) {
            const p = team?.roster?.[slot];
            if (!p) continue;
            const row = el('div', 'fd-reveal-player-row');
            row.append(
                el('span', 'fd-reveal-slot-tag', formatSlotLabel(slot)),
                el('span', 'fd-reveal-player-name', formatPlayerName(p.name)),
                el(
                    'span',
                    'fd-reveal-player-meta',
                    `${formatClubName(p.club)} '${String(p.year).slice(-2)}`
                ),
                el('span', 'fd-reveal-player-ovr', String(getPlayerOverall(p)))
            );
            roleGroup.append(row);
        }
        lineupBox.append(roleGroup);
    }
    card.append(lineupBox);

    return card;
}

export function renderCompleteZone(state, isTeamAPlayer, onMatchStartClick) {
    const zone = el('div', 'fd-center fd-complete-zone fd-reveal-zone');
    const [teamA, teamB] = state.teams;
    const ratingA = calculateTeamRating(teamA);
    const ratingB = calculateTeamRating(teamB);
    const profileA = calculateTeamProfile(teamA);
    const profileB = calculateTeamProfile(teamB);

    const lockedBadge = el('div', 'fd-reveal-badge', t('draft.bothLocked'));
    const banner = el('h2', 'fd-complete-title', t('draft.rosterReveal'));
    const sub = el('p', 'fd-complete-sub', t('draft.revealSub'));

    const summaryBox = el('div', 'fd-complete-ratings');
    summaryBox.append(
        renderProfileCard(teamA, ratingA, profileA),
        renderProfileCard(teamB, ratingB, profileB)
    );

    zone.append(lockedBadge, banner, sub, summaryBox);

    if (isTeamAPlayer) {
        const matchBtn = el('button', 'fd-match-btn', t('match.matchBtn'));
        matchBtn.addEventListener('click', onMatchStartClick);
        zone.append(matchBtn);
    } else {
        const waitNotice = el(
            'div',
            'fd-match-wait',
            t('match.waitingForTeamA', { playerName: teamA.name })
        );
        zone.append(waitNotice);
    }

    zone.append(renderHistoryBox(state));
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

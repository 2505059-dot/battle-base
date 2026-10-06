// Pure UI formatters for structured Draft History events and Match Simulation events

import { t } from '../../i18n/i18n.js';
import { formatSlotLabel } from './constants.js';

export function formatHistoryEvent(event, localeOverride = null) {
    if (!event) return '';
    if (typeof event === 'string') return event;

    switch (event.type) {
        case 'draft.roll':
            return t(
                'history.rolled',
                {
                    actorName: event.actorName,
                    club: event.club,
                    year: event.year,
                },
                localeOverride
            );
        case 'draft.reroll': {
            let key = 'history.rerolledLeague';
            if (event.rerollType === 'club') key = 'history.rerolledClub';
            else if (event.rerollType === 'year') key = 'history.rerolledYear';
            return t(
                key,
                {
                    actorName: event.actorName,
                    club: event.club,
                    year: event.year,
                },
                localeOverride
            );
        }
        case 'draft.pick':
            return t(
                'history.picked',
                {
                    actorName: event.actorName,
                    playerName: event.playerName,
                    slot: formatSlotLabel(event.slot),
                },
                localeOverride
            );
        case 'draft.lock':
            return t(
                'history.locked',
                {
                    actorName: event.actorName,
                },
                localeOverride
            );
        default:
            return '';
    }
}

function formatZoneLabel(zone, localeOverride = null) {
    if (zone === 'left') return t('match.zoneLeft', {}, localeOverride);
    if (zone === 'right') return t('match.zoneRight', {}, localeOverride);
    return t('match.zoneCenter', {}, localeOverride);
}

export function formatMatchEventBadge(event, localeOverride = null) {
    if (!event || !event.type) return '';
    return t(`match.badge.${event.type}`, {}, localeOverride);
}

export function formatMatchEvent(event, localeOverride = null) {
    if (!event || typeof event !== 'object') return '';

    switch (event.type) {
        case 'kick_off':
            return t('match.event.kickOff', {}, localeOverride);

        case 'attack': {
            const variant = [0, 1, 2].includes(event.variant) ? event.variant : 0;
            const zoneLabel = formatZoneLabel(event.zone, localeOverride);
            return t(
                `match.event.attack${variant}`,
                {
                    player: event.playerName ?? '',
                    zone: zoneLabel,
                    defender: event.defenderName ?? '',
                },
                localeOverride
            );
        }

        case 'shot':
            return t(
                'match.event.shotBlocked',
                {
                    player: event.playerName ?? '',
                    defender: event.defenderName ?? '',
                },
                localeOverride
            );

        case 'miss': {
            const variant = event.variant === 1 ? 1 : 0;
            return t(
                `match.event.miss${variant}`,
                {
                    player: event.playerName ?? '',
                },
                localeOverride
            );
        }

        case 'save':
            return t(
                'match.event.save',
                {
                    player: event.playerName ?? '',
                    goalkeeper: event.goalkeeperName ?? '',
                },
                localeOverride
            );

        case 'goal': {
            const scorer = event.scorerName ?? event.playerName ?? '';
            if (event.assistName) {
                return t(
                    'match.event.goalAssisted',
                    {
                        player: scorer,
                        assist: event.assistName,
                    },
                    localeOverride
                );
            }
            return t(
                'match.event.goalUnassisted',
                {
                    player: scorer,
                },
                localeOverride
            );
        }

        case 'half_time':
            return t(
                'match.event.halfTime',
                {
                    scoreA: event.score?.A ?? 0,
                    scoreB: event.score?.B ?? 0,
                },
                localeOverride
            );

        case 'full_time':
            return t(
                'match.event.fullTime',
                {
                    scoreA: event.score?.A ?? 0,
                    scoreB: event.score?.B ?? 0,
                },
                localeOverride
            );

        default:
            return '';
    }
}

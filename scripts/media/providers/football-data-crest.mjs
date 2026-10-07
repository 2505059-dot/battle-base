// scripts/media/providers/football-data-crest.mjs
// Discovers official SVG vectors and high-res PNG crests from football-data.org.
// Provider: "football-data", Source: "football-data-crests".

import { validateMediaAsset } from '../club-league-http.mjs';

export const FOOTBALL_DATA_CLUB_MAP = {
    'ac-milan': 98,
    ajax: 678,
    arsenal: 57,
    atalanta: 102,
    'atletico-madrid': 78,
    barcelona: 81,
    'bayer-leverkusen': 3,
    'bayern-munich': 5,
    benfica: 1903,
    'borussia-dortmund': 4,
    chelsea: 61,
    'deportivo-la-coruna': 599,
    'inter-milan': 108,
    juventus: 109,
    lazio: 110,
    'leicester-city': 338,
    lille: 521,
    liverpool: 64,
    'manchester-city': 65,
    'manchester-united': 66,
    monaco: 548,
    napoli: 113,
    parma: 112,
    porto: 503,
    psv: 674,
    'real-madrid': 86,
    roma: 100,
    valencia: 95,
};

export const FOOTBALL_DATA_LEAGUE_MAP = {
    bundesliga: 'BL1',
    eredivisie: 'DED',
    'la-liga': 'PD',
    'ligue-1': 'FL1',
    'premier-league': 'PL',
    'primeira-liga': 'PPL',
    'serie-a': 'SA',
};

export async function discoverFootballDataMedia(entity, entityType = 'club', options = {}) {
    const isClub = entityType === 'club';
    const id = isClub ? FOOTBALL_DATA_CLUB_MAP[entity.id] : FOOTBALL_DATA_LEAGUE_MAP[entity.id];

    if (!id) return [];

    const candidates = [];
    const mediaType = isClub ? 'club-crest' : 'league-emblem';
    const extensions = ['svg', 'png'];

    for (const ext of extensions) {
        const url = `https://crests.football-data.org/${id}.${ext}`;
        const val = await validateMediaAsset(url, options);

        if (val.reachable) {
            candidates.push({
                entityId: entity.id,
                mediaType,
                provider: 'football-data',
                source: 'football-data-crests',
                url,
                finalUrl: val.finalUrl || url,
                sourcePageUrl: `https://www.football-data.org/`,
                httpStatus: val.httpStatus,
                mimeType: val.mimeType,
                width: val.width,
                height: val.height,
                transparent: val.transparent,
                status: val.status,
                reachable: val.reachable,
                placeholder: val.placeholder,
                identityConfidence: 'high',
                licenseStatus: 'external-provider',
                footballDataId: id,
                score: 0,
            });
        }
    }

    return candidates;
}

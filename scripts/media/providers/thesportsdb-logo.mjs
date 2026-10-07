// scripts/media/providers/thesportsdb-logo.mjs
// Discovers high-res PNG badges from TheSportsDB.
// Provider: "thesportsdb", Source: "thesportsdb-badges".

import { fetchJsonPage, validateMediaAsset } from '../club-league-http.mjs';

export const THESPORTSDB_CLUB_MAP = {
    'ac-milan': 133670,
    ajax: 133772,
    arsenal: 133604,
    atalanta: 133666,
    'atletico-madrid': 133729,
    barcelona: 133739,
    'bayer-leverkusen': 133664,
    'bayern-munich': 133663,
    benfica: 133800,
    'borussia-dortmund': 133665,
    chelsea: 133610,
    'deportivo-la-coruna': 133734,
    'inter-milan': 133681,
    juventus: 133676,
    lazio: 133678,
    'leicester-city': 133626,
    lille: 133714,
    liverpool: 133612,
    'manchester-city': 133613,
    'manchester-united': 133614,
    monaco: 133719,
    napoli: 133682,
    parma: 133684,
    porto: 133802,
    psv: 133770,
    'real-madrid': 133738,
    roma: 133687,
    valencia: 133742,
};

export const THESPORTSDB_LEAGUE_MAP = {
    bundesliga: 4331,
    eredivisie: 4337,
    'la-liga': 4335,
    'ligue-1': 4334,
    'premier-league': 4328,
    'primeira-liga': 4344,
    'serie-a': 4332,
};

export async function discoverTheSportsDbMedia(entity, entityType = 'club', options = {}) {
    const isClub = entityType === 'club';
    const id = isClub ? THESPORTSDB_CLUB_MAP[entity.id] : THESPORTSDB_LEAGUE_MAP[entity.id];
    if (!id) return [];

    const candidates = [];
    const mediaType = isClub ? 'club-crest' : 'league-emblem';
    const queryUrl = isClub
        ? `https://www.thesportsdb.com/api/v1/json/3/lookupteam.php?id=${id}`
        : `https://www.thesportsdb.com/api/v1/json/3/lookupleague.php?id=${id}`;

    const res = await fetchJsonPage(queryUrl, options);
    const item = isClub ? res.data?.teams?.[0] : res.data?.leagues?.[0];
    const badgeUrl = item?.strBadge;

    if (badgeUrl && badgeUrl.startsWith('https://')) {
        const val = await validateMediaAsset(badgeUrl, options);
        if (val.reachable) {
            candidates.push({
                entityId: entity.id,
                mediaType,
                provider: 'thesportsdb',
                source: 'thesportsdb-badges',
                url: badgeUrl,
                finalUrl: val.finalUrl || badgeUrl,
                sourcePageUrl: `https://www.thesportsdb.com/`,
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
                theSportsDbId: id,
                score: 0,
            });
        }
    }

    return candidates;
}

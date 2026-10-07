// scripts/media/providers/fifaindex-club-league.mjs
// Discovers FIFAIndex FC 27 CDN assets for Club Entities and League Entities.
// Provider: "fifaindex", Source: "fifaindex-fc27".

import { validateMediaAsset } from '../club-league-http.mjs';

export const FIFA_INDEX_CLUB_MAP = {
    'ac-milan': { id: 131681, slug: 'milano-fc', unlicensed: true, reason: 'unlicensed generic shield in EA FC' },
    ajax: { id: 245, slug: 'ajax', unlicensed: false },
    arsenal: { id: 1, slug: 'arsenal', unlicensed: false },
    atalanta: { id: 115845, slug: 'atalanta', unlicensed: true, reason: 'unlicensed generic shield in EA FC' },
    'atletico-madrid': { id: 240, slug: 'atletico-de-madrid', unlicensed: false },
    barcelona: { id: 241, slug: 'fc-barcelona', unlicensed: false },
    'bayer-leverkusen': { id: 32, slug: 'bayer-04-leverkusen', unlicensed: false },
    'bayern-munich': { id: 21, slug: 'bayern-munchen', unlicensed: false },
    benfica: { id: 234, slug: 'benfica', unlicensed: false },
    'borussia-dortmund': { id: 22, slug: 'borussia-dortmund', unlicensed: false },
    chelsea: { id: 5, slug: 'chelsea', unlicensed: false },
    'deportivo-la-coruna': { id: 242, slug: 'rc-deportivo', unlicensed: false },
    'inter-milan': { id: 131682, slug: 'inter', unlicensed: true, reason: 'unlicensed generic shield in EA FC' },
    juventus: { id: 45, slug: 'juventus', unlicensed: false },
    lazio: { id: 115841, slug: 'lazio', unlicensed: true, reason: 'unlicensed generic shield in EA FC' },
    'leicester-city': { id: 95, slug: 'leicester-city', unlicensed: false },
    lille: { id: 65, slug: 'losc-lille', unlicensed: false },
    liverpool: { id: 9, slug: 'liverpool', unlicensed: false },
    'manchester-city': { id: 10, slug: 'manchester-city', unlicensed: false },
    'manchester-united': { id: 11, slug: 'manchester-united', unlicensed: false },
    monaco: { id: 69, slug: 'as-monaco', unlicensed: false },
    napoli: { id: 48, slug: 'napoli', unlicensed: false },
    parma: { id: 50, slug: 'parma', unlicensed: false },
    porto: { id: 236, slug: 'fc-porto', unlicensed: false },
    psv: { id: 247, slug: 'psv', unlicensed: false },
    'real-madrid': { id: 243, slug: 'real-madrid', unlicensed: false },
    roma: { id: 52, slug: 'roma', unlicensed: false },
    valencia: { id: 461, slug: 'valencia-cf', unlicensed: false },
};

export const FIFA_INDEX_LEAGUE_MAP = {
    bundesliga: { id: 19, slug: 'germany-1-bundesliga-1' },
    eredivisie: { id: 10, slug: 'holland-eredivisie-1' },
    'la-liga': { id: 53, slug: 'spain-primera-division-1' },
    'ligue-1': { id: 16, slug: 'france-ligue-1-1' },
    'premier-league': { id: 13, slug: 'england-premier-league-1' },
    'primeira-liga': { id: 308, slug: 'portugal-primeira-liga-1' },
    'serie-a': { id: 31, slug: 'italy-serie-a-1' },
};

export async function discoverFifaIndexMedia(entity, entityType = 'club', options = {}) {
    const isClub = entityType === 'club';
    const mapping = isClub ? FIFA_INDEX_CLUB_MAP[entity.id] : FIFA_INDEX_LEAGUE_MAP[entity.id];

    if (!mapping) {
        return null;
    }

    const mediaType = isClub ? 'club-crest' : 'league-emblem';
    const url = isClub
        ? `https://images.fifaindex.com/fc27/teams/${mapping.id}.webp`
        : `https://images.fifaindex.com/fc27/leagues/${mapping.id}.webp`;

    const sourcePageUrl = isClub
        ? `https://www.fifaindex.com/team/${mapping.id}/${mapping.slug}/`
        : `https://www.fifaindex.com/leagues/${mapping.id}-${mapping.slug}/`;

    const val = await validateMediaAsset(url, options);

    return {
        entityId: entity.id,
        mediaType,
        provider: 'fifaindex',
        source: 'fifaindex-fc27',
        url,
        finalUrl: val.finalUrl || url,
        sourcePageUrl,
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
        fifaIndexId: mapping.id,
        unlicensedBadge: Boolean(mapping.unlicensed),
        unlicensedReason: mapping.reason || null,
    };
}

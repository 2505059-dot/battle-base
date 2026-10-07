// scripts/media/providers/wikimedia-commons.mjs
// Discovers authentic vector SVGs and logos on Wikimedia Commons with strict identity
// and anti-confusion filtering. Provider: "wikimedia-commons", Source: "commons-api".

import { fetchJsonPage, validateMediaAsset } from '../club-league-http.mjs';

const FORBIDDEN_COMMONS_TERMS = [
    'stadium',
    'arena',
    'kit',
    'jersey',
    'shirt',
    'player',
    'photo',
    'match',
    'game',
    'celebration',
    'fan',
    'fans',
    'supporter',
    'trophy',
    'bus',
    'crowd',
    'training',
    'press conference',
    'squad',
    'basketball',
    'handball',
    'futsal',
    'esports',
    'women',
    'feminine',
    'reiterverein',
    'lsc ',
    'express',
    'station',
    'university',
    'iut',
    'imt',
    'caixabank',
    'communaut',
    'suburbia',
    'wipeout',
    'gastroenterology',
    "v'lille",
    'metro',
    'tram',
];

const CONFUSION_PAIRS = [
    { target: 'manchester-united', forbidden: ['manchester city', 'man city', 'etihad', 'fc united'] },
    { target: 'manchester-city', forbidden: ['manchester united', 'man utd', 'old trafford'] },
    { target: 'inter-milan', forbidden: ['inter miami', 'ac milan', 'inter turku', 'internacional'] },
    { target: 'ac-milan', forbidden: ['inter milan', 'internazionale'] },
    { target: 'atletico-madrid', forbidden: ['real madrid', 'bernabeu', 'athletic bilbao'] },
    { target: 'real-madrid', forbidden: ['atletico madrid', 'metropolitano', 'real sociedad', 'real betis'] },
    { target: 'bayern-munich', forbidden: ['bayer leverkusen', 'bayer 04', '1860'] },
    { target: 'bayer-leverkusen', forbidden: ['bayern munich', 'bayern munchen', 'allianz'] },
    { target: 'psv', forbidden: ['ajax'] },
    { target: 'ajax', forbidden: ['psv'] },
];

function cleanWikimediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        const u = new URL(rawUrl);
        if (u.hostname.endsWith('wikimedia.org') || u.hostname.endsWith('wikipedia.org')) {
            u.search = '';
            u.hash = '';
            return u.toString();
        }
    } catch {}
    return rawUrl;
}

export async function discoverCommonsMedia(entity, entityType = 'club', options = {}) {
    const isClub = entityType === 'club';
    const mediaType = isClub ? 'club-crest' : 'league-emblem';
    const searchTerms = isClub
        ? `intitle:"${entity.canonicalName}" (logo OR crest OR badge) filetype:svg`
        : `intitle:"${entity.canonicalName}" (logo OR emblem) filetype:svg`;

    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchTerms)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|size|mime&format=json`;
    const res = await fetchJsonPage(searchUrl, options);
    const pages = res.data?.query?.pages || {};

    const candidates = [];
    const requiredTokens = entity.id
        .split('-')
        .filter((t) => t.length >= 3 && !['the', 'la', 'de', 'fc', 'ac', 'as', 'ss'].includes(t));
    const confusionRule = CONFUSION_PAIRS.find((p) => p.target === entity.id);

    for (const page of Object.values(pages)) {
        const title = (page.title || '').toLowerCase();
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;

        // Require at least one core entity token in the filename title
        if (requiredTokens.length > 0 && !requiredTokens.some((tok) => title.includes(tok))) {
            continue;
        }

        // Anti-noise filter
        if (FORBIDDEN_COMMONS_TERMS.some((term) => title.includes(term))) continue;

        // Anti-confusion filter
        if (confusionRule && confusionRule.forbidden.some((term) => title.includes(term))) continue;

        // Must relate to crest/logo
        if (!title.includes('logo') && !title.includes('crest') && !title.includes('emblem') && !title.includes('badge')) {
            continue;
        }

        const cleanUrl = cleanWikimediaUrl(info.url);
        const val = await validateMediaAsset(cleanUrl, options);
        if (val.reachable && !val.placeholder) {
            candidates.push({
                entityId: entity.id,
                mediaType,
                provider: 'wikimedia-commons',
                source: 'commons-api',
                url: cleanUrl,
                finalUrl: cleanWikimediaUrl(val.finalUrl || cleanUrl),
                sourcePageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
                httpStatus: val.httpStatus,
                mimeType: val.mimeType || info.mime,
                width: val.width ?? info.width,
                height: val.height ?? info.height,
                transparent: val.transparent,
                status: val.status,
                reachable: val.reachable,
                placeholder: val.placeholder,
                identityConfidence: 'high',
                licenseStatus: 'external-provider',
                score: 0,
            });
        }
    }

    return candidates;
}

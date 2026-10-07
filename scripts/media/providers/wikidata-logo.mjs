// scripts/media/providers/wikidata-logo.mjs
// Discovers Club Crests and League Emblems via Wikidata claims (P154)
// and English Wikipedia infobox / pageimages.

import { fetchJsonPage, validateMediaAsset } from '../club-league-http.mjs';

export const WIKIDATA_QID_MAP = {
    // Leagues
    bundesliga: 'Q82595',
    eredivisie: 'Q167541',
    'la-liga': 'Q324867',
    'ligue-1': 'Q13394',
    'premier-league': 'Q9448',
    'primeira-liga': 'Q182994',
    'serie-a': 'Q15804',

    // Clubs
    'ac-milan': 'Q1543',
    ajax: 'Q81888',
    arsenal: 'Q9617',
    atalanta: 'Q1886',
    'atletico-madrid': 'Q8701',
    barcelona: 'Q7156',
    'bayer-leverkusen': 'Q104761',
    'bayern-munich': 'Q15789',
    benfica: 'Q131499',
    'borussia-dortmund': 'Q41420',
    chelsea: 'Q9616',
    'deportivo-la-coruna': 'Q8760',
    'inter-milan': 'Q631',
    juventus: 'Q1422',
    lazio: 'Q2609',
    'leicester-city': 'Q19481',
    lille: 'Q19516',
    liverpool: 'Q1130849',
    'manchester-city': 'Q50602',
    'manchester-united': 'Q18656',
    monaco: 'Q180305',
    napoli: 'Q2641',
    parma: 'Q2693',
    porto: 'Q128446',
    psv: 'Q11938',
    'real-madrid': 'Q8682',
    roma: 'Q2739',
    valencia: 'Q10333',
};

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

async function resolveCommonsFile(fileName, qid) {
    if (!fileName) return null;
    const cleanTitle = fileName.startsWith('File:') ? fileName : `File:${fileName}`;
    const encTitle = encodeURIComponent(cleanTitle);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encTitle}&prop=imageinfo&iiprop=url|size|mime&format=json`;
    const res = await fetchJsonPage(url);
    const pages = res.data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (!pageId || pageId === '-1') return null;

    const info = pages[pageId]?.imageinfo?.[0];
    if (!info?.url) return null;
    const cleanUrl = cleanWikimediaUrl(info.url);

    return {
        url: cleanUrl,
        sourcePageUrl: info.descriptionurl || `https://www.wikidata.org/wiki/${qid}`,
        mimeType: info.mime || null,
        width: info.width || null,
        height: info.height || null,
    };
}

async function resolveEnwikiInfobox(enwikiTitle, qid) {
    if (!enwikiTitle) return null;
    const encTitle = encodeURIComponent(enwikiTitle);
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encTitle}&prop=pageimages|images&pilicense=any&piprop=original|thumbnail&format=json`;
    const res = await fetchJsonPage(url);
    const pages = res.data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (!pageId || pageId === '-1') return null;

    const page = pages[pageId];
    const orig = page.original;
    if (orig?.source) {
        const cleanUrl = cleanWikimediaUrl(orig.source);
        const isCommons = cleanUrl.includes('/wikipedia/commons/');
        return {
            url: cleanUrl,
            sourcePageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(enwikiTitle.replace(/ /g, '_'))}`,
            provider: isCommons ? 'wikimedia-commons' : 'wikipedia',
            mimeType: cleanUrl.endsWith('.svg') ? 'image/svg+xml' : null,
            width: orig.width || null,
            height: orig.height || null,
        };
    }
    return null;
}

export async function discoverWikidataMedia(entity, entityType = 'club', options = {}) {
    const qid = WIKIDATA_QID_MAP[entity.id];
    if (!qid) return [];

    const candidates = [];
    const mediaType = entityType === 'club' ? 'club-crest' : 'league-emblem';

    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|sitelinks&format=json`;
    const entityRes = await fetchJsonPage(entityUrl);
    const entityData = entityRes.data?.entities?.[qid];

    if (!entityData) return [];

    // 1. Check P154 (logo image)
    const p154Claims = entityData.claims?.P154 || [];
    for (const claim of p154Claims) {
        const val = claim.mainsnak?.datavalue?.value;
        if (typeof val === 'string') {
            const resolved = await resolveCommonsFile(val, qid);
            if (resolved?.url) {
                const valRes = await validateMediaAsset(resolved.url, options);
                candidates.push({
                    entityId: entity.id,
                    mediaType,
                    provider: 'wikimedia-commons',
                    source: 'wikidata-p154',
                    url: resolved.url,
                    finalUrl: valRes.finalUrl || resolved.url,
                    sourcePageUrl: resolved.sourcePageUrl,
                    httpStatus: valRes.httpStatus,
                    mimeType: valRes.mimeType || resolved.mimeType,
                    width: valRes.width ?? resolved.width,
                    height: valRes.height ?? resolved.height,
                    transparent: valRes.transparent,
                    status: valRes.status,
                    reachable: valRes.reachable,
                    placeholder: valRes.placeholder,
                    identityConfidence: 'high',
                    licenseStatus: 'external-provider',
                    score: 0,
                });
            }
        }
    }

    // 2. Check sitelinks.enwiki -> infobox original image
    const enwikiTitle = entityData.sitelinks?.enwiki?.title;
    if (enwikiTitle) {
        const resolved = await resolveEnwikiInfobox(enwikiTitle, qid);
        if (resolved?.url) {
            const valRes = await validateMediaAsset(resolved.url, options);
            candidates.push({
                entityId: entity.id,
                mediaType,
                provider: resolved.provider,
                source: 'wikipedia-infobox',
                url: resolved.url,
                finalUrl: valRes.finalUrl || resolved.url,
                sourcePageUrl: resolved.sourcePageUrl,
                httpStatus: valRes.httpStatus,
                mimeType: valRes.mimeType || resolved.mimeType,
                width: valRes.width ?? resolved.width,
                height: valRes.height ?? resolved.height,
                transparent: valRes.transparent,
                status: valRes.status,
                reachable: valRes.reachable,
                placeholder: valRes.placeholder,
                identityConfidence: 'high',
                licenseStatus: 'external-provider',
                score: 0,
            });
        }
    }

    return candidates;
}

// scripts/media/providers/fifaaddict-fo3.mjs
// Provider B: FIFAAddict FIFA Online 3 (en.fifaaddict.com/fo3db.php)
// Discovers historical/legend and regular player renders from public FO3 search and detail pages.
// Strictly verifies player identity and never writes gameplay stats.

import {
    fetchPage,
    validateImageUrl,
    decodeHtmlEntities,
    normalizePersonName,
    normalizeAssetUrl,
    getExpandedAliases,
} from '../http-client.mjs';
import { normalizePositions } from '../../lib/normalize.mjs';

export const PROVIDER_ID = 'fifaaddict-fo3';

const FO3_SEASON_META = {
    '93': { label: 'World Legend (WL)', tier: 1, mediaType: 'icon-render' },
    '30': { label: 'Ultimate Legend (UL)', tier: 1, mediaType: 'icon-render' },
    '91': { label: 'World Best (WB)', tier: 2, mediaType: 'icon-render' },
    '27': { label: 'Ultimate Best (UB)', tier: 2, mediaType: 'icon-render' },
    '24': { label: 'Europe League Legend (EL)', tier: 3, mediaType: 'icon-render' },
    '22': { label: 'Club / Europe Legend (22)', tier: 3, mediaType: 'icon-render' },
    '55': { label: 'Man Utd Ambassador (MUA)', tier: 3, mediaType: 'icon-render' },
    '20': { label: '2002 Legend', tier: 3, mediaType: 'icon-render' },
    '65': { label: 'Captain Player (CP)', tier: 4, mediaType: 'player-render' },
    '29': { label: 'Continental Champion (CC)', tier: 4, mediaType: 'player-render' },
    '63': { label: 'Loyal Player (LP)', tier: 4, mediaType: 'player-render' },
    '40': { label: '06 UEFA Champions League (06U)', tier: 5, mediaType: 'player-render' },
    '42': { label: '10 UEFA Champions League (10U)', tier: 5, mediaType: 'player-render' },
    '36': { label: '06 World Cup (06WC)', tier: 5, mediaType: 'player-render' },
    '38': { label: '10 World Cup (10WC)', tier: 5, mediaType: 'player-render' },
    '94': { label: '14 World Cup (14WC)', tier: 5, mediaType: 'player-render' },
    '44': { label: '08 Euro (08E)', tier: 5, mediaType: 'player-render' },
    '46': { label: '16 Euro / Copa (16EC)', tier: 5, mediaType: 'player-render' },
    '88': { label: '16 Team of the Season (16TOTS)', tier: 6, mediaType: 'player-render' },
    '89': { label: '15 Team of the Season (15TOTS)', tier: 6, mediaType: 'player-render' },
    '95': { label: '14 Team of the Season (14TOTS)', tier: 6, mediaType: 'player-render' },
};

function getFo3SeasonInfo(seasonCode) {
    const code = String(seasonCode || '').padStart(2, '0');
    if (FO3_SEASON_META[code]) {
        return { code, ...FO3_SEASON_META[code] };
    }
    const num = Number(code);
    if (num >= 6 && num <= 18) {
        return {
            code,
            label: `Season 20${code}`,
            tier: 7,
            mediaType: 'portrait',
        };
    }
    return {
        code,
        label: `FO3 Class ${code}`,
        tier: 8,
        mediaType: 'player-render',
    };
}

export function buildFo3SearchQueries(entity) {
    const queries = [];
    const seen = new Set();
    const addQuery = (q) => {
        if (!q || typeof q !== 'string') return;
        const cleaned = q.trim();
        if (cleaned.length < 2) return;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        queries.push(cleaned);
    };

    // 1. Canonical name (and apostrophe-safe version since FO3 search fails on literal apostrophe)
    if (!entity.canonicalName.includes("'")) {
        addQuery(entity.canonicalName);
    } else {
        // E.g. "Samuel Eto'o" -> "Samuel Eto", "N'Golo Kante" -> "Kante", "Danilo D'Ambrosio" -> "Ambrosio"
        const withoutSuffix = entity.canonicalName.replace(/'[a-zA-Z]+/g, '').trim();
        if (withoutSuffix.length >= 4 && !withoutSuffix.includes("'")) {
            addQuery(withoutSuffix);
        }
        const parts = entity.canonicalName.split(/[\s']+/).filter((p) => p.length >= 4);
        for (const p of parts.reverse()) {
            addQuery(p);
        }
    }

    // 2. Surname fallback if multi-word name (FO3 frequently uses initial + surname like "G. Batistuta")
    const tokens = entity.canonicalName.replace(/'/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        const lastToken = tokens[tokens.length - 1];
        if (lastToken.length >= 4) {
            addQuery(lastToken);
        }
    }

    // 3. English aliases without apostrophes
    for (const alias of entity.aliases?.en || []) {
        if (!alias.includes("'") && alias.split(/\s+/).length <= 3) {
            addQuery(alias);
        }
    }

    return queries.slice(0, 4);
}

export function parseFo3SearchHtml(html, searchUrl) {
    if (!html || typeof html !== 'string') return [];
    const results = [];
    const rowRegex = /<tr\s+id="player_id(\d+)"\s+class="player-row">([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const [, fo3IdStr, rowHtml] = match;
        const fo3Id = Number(fo3IdStr);
        const seasonCode = fo3IdStr.slice(0, 2);
        const baseEaId = fo3Id % 1000000;

        const imgMatch = rowHtml.match(/<img\s+[^>]*class="player_img[^"]*"[^>]*src="([^"]+)"/i);
        const nameLgMatch = rowHtml.match(/<span\s+class="label_lg">([^<]+)<\/span>/i);
        const nameXsMatch = rowHtml.match(/<span\s+class="label_xs">([^<]+)<\/span>/i);
        const hrefMatch = rowHtml.match(/<a\s+href="(\/fo3player\.php\?id=\d+)"/i);
        const badgeMatch = rowHtml.match(/<span\s+class="badged\s+y20(\d{2})"/i);

        const posMatches = [...rowHtml.matchAll(/<i\s+class="badge_position[^"]*">([^<]+)<\/i><b\s+class="stat_value"[^>]*>(\d+)<\/b>/gi)];
        const rawPositions = posMatches.map((m) => m[1].trim());
        const sortWeight = posMatches.length > 0 ? Number(posMatches[0][2]) : 0;

        let rawImgUrl = imgMatch ? imgMatch[1].trim() : null;
        if (rawImgUrl && rawImgUrl.startsWith('//')) {
            rawImgUrl = `https:${rawImgUrl}`;
        }

        const assetIdMatch = rawImgUrl ? rawImgUrl.match(/\/p(\d+)\.(?:jpg|png)/i) : null;
        const fo3AssetId = assetIdMatch ? assetIdMatch[1] : null;

        const displayName = nameLgMatch ? decodeHtmlEntities(nameLgMatch[1].trim()) : '';
        const shortName = nameXsMatch ? decodeHtmlEntities(nameXsMatch[1].trim()) : '';
        const detailPageUrl = hrefMatch
            ? `https://en.fifaaddict.com${hrefMatch[1]}`
            : `https://en.fifaaddict.com/fo3player.php?id=${fo3IdStr}`;

        const seasonInfo = getFo3SeasonInfo(badgeMatch ? badgeMatch[1] : seasonCode);

        results.push({
            fo3Id: fo3IdStr,
            baseEaId,
            fo3AssetId,
            displayName,
            shortName,
            seasonCode: seasonInfo.code,
            editionOrClass: seasonInfo.label,
            classTier: seasonInfo.tier,
            mediaType: seasonInfo.mediaType,
            rawPositions,
            canonicalPositions: normalizePositions(rawPositions),
            sortWeight,
            searchPageUrl: searchUrl,
            detailPageUrl,
            thumbnailUrl: rawImgUrl,
        });
    }

    return results;
}

export function parseFo3DetailHtml(html, detailUrl) {
    if (!html || typeof html !== 'string') return null;

    const imgMatch = html.match(/<img\s+[^>]*class="player_img[^"]*realface"[^>]*src="([^"]+)"/i) ||
        html.match(/<img\s+[^>]*src="([^"]*\/fo3img\/players\/p\d+\.png[^"]*)"/i);
    let fullPngUrl = imgMatch ? imgMatch[1].trim() : null;
    if (fullPngUrl && fullPngUrl.startsWith('//')) {
        fullPngUrl = `https:${fullPngUrl}`;
    }

    const seasonBlockMatch = html.match(/<a\s+href="fo3db\.php\?q=player&season=[^"]*"[^>]*class="team_color_label\s+label_season">([\s\S]*?)<\/a>/i);
    let seasonLabel = null;
    if (seasonBlockMatch) {
        const cleaned = seasonBlockMatch[1]
            .replace(/<b\s+class="text\s+xs">[\s\S]*?<\/b>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleaned) seasonLabel = decodeHtmlEntities(cleaned);
    }
    const nationMatch = html.match(/<div\s+class="player_nation">[\s\S]*?<b>([^<]+)<\/b>/i);
    const clubMatch = html.match(/<div\s+class="player_club"><span[^>]*>([^<]+)<\/span>/i);
    const dobMatch = html.match(/Date of Birth\s*<b>(\d{1,2}\.\d{1,2}\.\d{4})/i);

    let birthYear = null;
    let birthDateIso = null;
    if (dobMatch) {
        const [d, m, y] = dobMatch[1].split('.').map(Number);
        birthYear = y;
        birthDateIso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    return {
        detailUrl,
        fullPngUrl,
        seasonLabel,
        nationality: nationMatch ? decodeHtmlEntities(nationMatch[1].trim()) : null,
        club: clubMatch ? decodeHtmlEntities(clubMatch[1].trim()) : null,
        birthDateIso,
        birthYear,
    };
}

function evaluateRowIdentity(entity, row, options = {}) {
    const knownEaId =
        options.knownEaId ||
        entity.externalIds?.fifaIndex ||
        entity.externalIds?.sofifa ||
        null;

    const canonicalNorm = normalizePersonName(entity.canonicalName);
    const aliasNorms = new Set(
        getExpandedAliases(entity).map((n) => normalizePersonName(n))
    );

    const rowDisplayNorm = normalizePersonName(row.displayName);
    const rowShortNorm = normalizePersonName(row.shortName);

    const isExactId = Boolean(knownEaId && row.baseEaId === Number(knownEaId));
    const isDifferentKnownId = Boolean(knownEaId && row.baseEaId !== Number(knownEaId));

    const isExactCanonicalName = rowDisplayNorm === canonicalNorm;
    const isAliasName = aliasNorms.has(rowDisplayNorm) || aliasNorms.has(rowShortNorm);

    // Token check: e.g. "F. Beckenbauer" or "Paolo Maldini"
    const canonicalTokens = canonicalNorm.split(' ').filter(Boolean);
    const rowTokens = rowDisplayNorm.split(' ').filter(Boolean);

    // Check abbreviated initial + surname match (e.g. "P. Maldini" for "Paolo Maldini")
    let isInitialPlusSurname = false;
    if (canonicalTokens.length >= 2 && rowTokens.length >= 2) {
        const cFirst = canonicalTokens[0];
        const cLast = canonicalTokens[canonicalTokens.length - 1];
        const rFirst = rowTokens[0];
        const rLast = rowTokens[rowTokens.length - 1];
        if (cLast === rLast && rFirst.length === 1 && cFirst.startsWith(rFirst)) {
            isInitialPlusSurname = true;
        }
    }

    // Position compatibility check if entity positions are provided
    const entityPositions = options.entityPositions || [];
    const positionOverlap =
        entityPositions.length === 0 ||
        row.canonicalPositions.length === 0 ||
        row.canonicalPositions.some((p) => entityPositions.includes(p));

    if (isExactId && (isExactCanonicalName || isAliasName || isInitialPlusSurname || positionOverlap)) {
        return {
            status: 'verified',
            confidence: 'exact-id',
            reason: 'Matched EA/FIFAIndex base ID and player identity on FO3',
        };
    }

    // If entity has a known EA ID, and the FO3 row has a DIFFERENT baseEaId:
    // In FO3, regular cards and standard legends use the EA player ID as baseEaId (fo3Id % 1000000).
    // If a mononym or common name has a different baseEaId, it is almost certainly a homonym (e.g. young Costinha 229473 vs Porto Costinha 20169).
    if (isDifferentKnownId) {
        if (canonicalTokens.length === 1) {
            return {
                status: 'rejected',
                confidence: 'unresolved',
                reason: `Homonym rejected: mononym "${row.displayName}" has baseEaId=${row.baseEaId} != knownEaId=${knownEaId}`,
            };
        }
        if (!isExactCanonicalName && !isAliasName) {
            return {
                status: 'rejected',
                confidence: 'unresolved',
                reason: `Different baseEaId=${row.baseEaId} != knownEaId=${knownEaId}`,
            };
        }
    }

    // When knownEaId is not available (e.g., retired pre-2005 players):
    if (!knownEaId) {
        if ((isExactCanonicalName || isAliasName) && canonicalTokens.length >= 2 && positionOverlap) {
            return {
                status: 'verified',
                confidence: isExactCanonicalName ? 'exact-name' : 'alias-confirmed',
                reason: 'Matched full canonical/alias name and position on FO3',
            };
        }
        if ((isExactCanonicalName || isAliasName) && canonicalTokens.length === 1 && positionOverlap) {
            // Single-word mononym without knownEaId (e.g. Donato): requires detail-page birthYear/era verification or manual review
            return {
                status: 'needs-detail-check',
                confidence: 'manual-review',
                reason: `Mononym "${row.displayName}" without externalId requires detail verification`,
            };
        }
        if (isInitialPlusSurname && positionOverlap) {
            return {
                status: 'needs-detail-check',
                confidence: 'name+context',
                reason: `Initial+surname "${row.displayName}" matches ${entity.canonicalName}`,
            };
        }
    }

    // Check if same surname only -> ambiguous / manual-review
    if (
        canonicalTokens.length >= 2 &&
        rowTokens.length >= 1 &&
        rowTokens[rowTokens.length - 1] === canonicalTokens[canonicalTokens.length - 1] &&
        !isExactCanonicalName &&
        !isAliasName &&
        !isInitialPlusSurname
    ) {
        return {
            status: 'ambiguous',
            confidence: 'manual-review',
            reason: `Surname collision on FO3: "${row.displayName}" vs "${entity.canonicalName}"`,
        };
    }

    return {
        status: 'rejected',
        confidence: 'unresolved',
        reason: 'Name does not match entity',
    };
}

const fo3EntityCache = new Map();

export async function discoverPlayerMedia({ entity, playerSeason = null, options = {} }) {
    if (!options.force && fo3EntityCache.has(entity.id)) {
        return fo3EntityCache.get(entity.id);
    }

    const queries = buildFo3SearchQueries(entity);
    const allRowsById = new Map();
    let blockedCount = 0;
    let errorCount = 0;
    let lastSearchUrl = null;

    for (const q of queries) {
        const searchUrl = `https://en.fifaaddict.com/fo3db.php?q=player&name=${encodeURIComponent(q)}`;
        lastSearchUrl = searchUrl;
        const pageRes = await fetchPage(searchUrl, options);
        if (pageRes.blocked) blockedCount++;
        if (pageRes.error) errorCount++;

        if (pageRes.status === 200 && pageRes.body) {
            const parsedRows = parseFo3SearchHtml(pageRes.body, searchUrl);
            for (const r of parsedRows) {
                if (!allRowsById.has(r.fo3Id)) {
                    allRowsById.set(r.fo3Id, r);
                }
            }
            // If primary query already yielded verified matches, no need to run fallback surname queries
            const hasVerified = [...allRowsById.values()].some(
                (r) => evaluateRowIdentity(entity, r, options).status === 'verified'
            );
            if (hasVerified) break;
        }
    }

    const verifiedRows = [];
    const needsDetailRows = [];
    const ambiguousRows = [];

    for (const row of allRowsById.values()) {
        const evalRes = evaluateRowIdentity(entity, row, options);
        if (evalRes.status === 'verified') {
            verifiedRows.push({ row, evalRes });
        } else if (evalRes.status === 'needs-detail-check') {
            needsDetailRows.push({ row, evalRes });
        } else if (evalRes.status === 'ambiguous') {
            ambiguousRows.push({ row, evalRes });
        }
    }

    // If we have rows needing detail check (and no verified rows yet), inspect top detail page
    if (verifiedRows.length === 0 && needsDetailRows.length > 0) {
        for (const item of needsDetailRows.slice(0, 2)) {
            const detailRes = await fetchPage(item.row.detailPageUrl, options);
            if (detailRes.blocked) blockedCount++;
            if (detailRes.error) errorCount++;

            if (detailRes.status === 200 && detailRes.body) {
                const detailMeta = parseFo3DetailHtml(detailRes.body, item.row.detailPageUrl);
                item.detailMeta = detailMeta;
                const minSeason = Math.min(...(entity.seasons || [2000]));
                // A player active in minSeason (e.g. 1999-2004) must have been born at least 15 years before minSeason and not after minSeason - 14
                const plausibleBirth =
                    detailMeta?.birthYear &&
                    detailMeta.birthYear >= minSeason - 45 &&
                    detailMeta.birthYear <= minSeason - 15;

                if (plausibleBirth && item.evalRes.confidence === 'name+context') {
                    verifiedRows.push({
                        row: item.row,
                        evalRes: {
                            status: 'verified',
                            confidence: 'name+context',
                            reason: `Verified via FO3 detail page birthYear=${detailMeta.birthYear} and nation=${detailMeta.nationality}`,
                        },
                        detailMeta,
                    });
                } else {
                    ambiguousRows.push(item);
                }
            } else {
                ambiguousRows.push(item);
            }
        }
    }

    // Sort verified rows deterministically by Legend/Class priority (Section 15), then sortWeight desc, then fo3Id asc
    verifiedRows.sort((a, b) => {
        if (a.row.classTier !== b.row.classTier) return a.row.classTier - b.row.classTier;
        if (b.row.sortWeight !== a.row.sortWeight) return b.row.sortWeight - a.row.sortWeight;
        return a.row.fo3Id.localeCompare(b.row.fo3Id);
    });

    const candidates = [];

    if (verifiedRows.length > 0) {
        // Fetch detail page for the #1 ranked candidate to extract full-size PNG portrait and detail metadata
        const topItem = verifiedRows[0];
        if (!topItem.detailMeta) {
            const detailRes = await fetchPage(topItem.row.detailPageUrl, options);
            if (detailRes.blocked) blockedCount++;
            if (detailRes.error) errorCount++;
            if (detailRes.status === 200 && detailRes.body) {
                topItem.detailMeta = parseFo3DetailHtml(detailRes.body, topItem.row.detailPageUrl);
            }
        }

        // Validate images for up to top 2 candidates, and keep up to 6 candidates in the candidate list
        const maxCandidates = Math.min(verifiedRows.length, 6);
        for (let i = 0; i < maxCandidates; i++) {
            const { row, evalRes, detailMeta } = verifiedRows[i];
            const primaryImageUrl = detailMeta?.fullPngUrl || row.thumbnailUrl;
            const sourcePageUrl = detailMeta?.fullPngUrl ? row.detailPageUrl : row.searchPageUrl;

            let imgValidation = {
                httpStatus: null,
                contentType: null,
                contentLength: null,
                finalUrl: primaryImageUrl,
                normalizedAssetUrl: normalizeAssetUrl(primaryImageUrl),
                redirectCount: 0,
                reachableImage: false,
                availabilityStatus: 'not-probed',
            };

            const shouldProbe =
                i === 0 ||
                (i === 1 && !candidates[0]?.reachableImage) ||
                (i === 1 && ['paolo-maldini', 'peter-schmeichel', 'zinedine-zidane'].includes(entity.id));

            if (shouldProbe && primaryImageUrl) {
                imgValidation = await validateImageUrl(primaryImageUrl, options);
                if (imgValidation.availabilityStatus === 'blocked') blockedCount++;
                if (imgValidation.availabilityStatus === 'request-failed') errorCount++;

                // If detail PNG is 404/not-found, fallback to validating the search row thumbnail JPG
                if (!imgValidation.reachableImage && detailMeta?.fullPngUrl && row.thumbnailUrl) {
                    const thumbVal = await validateImageUrl(row.thumbnailUrl, options);
                    if (thumbVal.reachableImage) {
                        imgValidation = thumbVal;
                    }
                }
            }

            const finalImgUrl =
                imgValidation.reachableImage && imgValidation.requestedUrl
                    ? imgValidation.requestedUrl
                    : primaryImageUrl;

            const isPlaceholderAsset =
                !finalImgUrl || /\/p0\.(?:png|jpg)|blank\.png|default/i.test(finalImgUrl);

            candidates.push({
                provider: PROVIDER_ID,
                sourcePageUrl,
                detailPageUrl: row.detailPageUrl,
                imageUrl: finalImgUrl,
                thumbnailUrl: row.thumbnailUrl,
                normalizedAssetUrl: normalizeAssetUrl(finalImgUrl),
                fo3PlayerId: row.fo3Id,
                fo3BaseEaId: row.baseEaId,
                fo3AssetId: row.fo3AssetId,
                displayName: row.displayName,
                editionOrClass: detailMeta?.seasonLabel || row.editionOrClass,
                seasonCode: row.seasonCode,
                classTier: row.classTier,
                assetKind: isPlaceholderAsset
                    ? 'placeholder'
                    : imgValidation.reachableImage
                      ? 'real-photo'
                      : imgValidation.availabilityStatus === 'not-probed'
                        ? 'real-photo'
                        : 'request-failed',
                mediaType: row.mediaType,
                matchConfidence: evalRes.confidence,
                manualReview: false,
                identityEvidence: {
                    reason: evalRes.reason,
                    displayName: row.displayName,
                    shortName: row.shortName,
                    fo3Id: row.fo3Id,
                    baseEaId: row.baseEaId,
                    observedPositions: row.rawPositions,
                    nationality: detailMeta?.nationality || null,
                    birthDate: detailMeta?.birthDateIso || null,
                },
                httpStatus: imgValidation.httpStatus,
                contentType: imgValidation.contentType,
                contentLength: imgValidation.contentLength,
                finalUrl: imgValidation.finalUrl,
                redirectCount: imgValidation.redirectCount,
                reachableImage: Boolean(!isPlaceholderAsset && imgValidation.reachableImage),
                availabilityStatus: isPlaceholderAsset
                    ? 'placeholder'
                    : imgValidation.availabilityStatus,
                licenseStatus: 'external-provider',
            });
        }

        const topConfidence = candidates[0]?.matchConfidence || 'exact-name';
        const result = {
            provider: PROVIDER_ID,
            matched: true,
            confidence: topConfidence,
            manualReview: false,
            identityEvidence: candidates[0]?.identityEvidence || {},
            candidates,
            ambiguousCandidates: [],
            stats: {
                totalSearchRows: allRowsById.size,
                verifiedRowCount: verifiedRows.length,
                blockedCount,
                errorCount,
            },
        };
        fo3EntityCache.set(entity.id, result);
        return result;
    }

    // If no verified rows, check if there were ambiguous candidates requiring manual review (Sections 16, 30, 46)
    if (ambiguousRows.length > 0) {
        const manualCandidates = ambiguousRows.slice(0, 3).map(({ row, evalRes, detailMeta }) => ({
            provider: PROVIDER_ID,
            sourcePageUrl: row.searchPageUrl,
            detailPageUrl: row.detailPageUrl,
            imageUrl: row.thumbnailUrl,
            normalizedAssetUrl: normalizeAssetUrl(row.thumbnailUrl),
            fo3PlayerId: row.fo3Id,
            fo3BaseEaId: row.baseEaId,
            displayName: row.displayName,
            editionOrClass: row.editionOrClass,
            assetKind: 'unknown',
            mediaType: row.mediaType,
            matchConfidence: 'manual-review',
            manualReview: true,
            identityEvidence: {
                reason: evalRes.reason,
                displayName: row.displayName,
                fo3Id: row.fo3Id,
                baseEaId: row.baseEaId,
                observedPositions: row.rawPositions,
                nationality: detailMeta?.nationality || null,
                birthDate: detailMeta?.birthDateIso || null,
            },
            httpStatus: null,
            contentType: null,
            contentLength: null,
            finalUrl: row.thumbnailUrl,
            redirectCount: 0,
            reachableImage: false,
            availabilityStatus: 'manual-review',
            licenseStatus: 'external-provider',
        }));

        const ambResult = {
            provider: PROVIDER_ID,
            matched: false,
            confidence: 'manual-review',
            manualReview: true,
            identityEvidence: {
                reason: ambiguousRows[0].evalRes.reason,
                candidateNames: [...new Set(ambiguousRows.map((a) => a.row.displayName))],
                sourcePageUrl: ambiguousRows[0].row.searchPageUrl,
            },
            candidates: manualCandidates,
            ambiguousCandidates: manualCandidates,
            stats: {
                totalSearchRows: allRowsById.size,
                verifiedRowCount: 0,
                blockedCount,
                errorCount,
            },
        };
        fo3EntityCache.set(entity.id, ambResult);
        return ambResult;
    }

    const emptyResult = {
        provider: PROVIDER_ID,
        matched: false,
        confidence: 'unresolved',
        manualReview: false,
        identityEvidence: {
            reason: blockedCount > 0 ? 'blocked' : 'no-matching-player-on-fo3',
            sourcePageUrl: lastSearchUrl,
        },
        candidates: [],
        ambiguousCandidates: [],
        stats: {
            totalSearchRows: allRowsById.size,
            verifiedRowCount: 0,
            blockedCount,
            errorCount,
        },
    };
    fo3EntityCache.set(entity.id, emptyResult);
    return emptyResult;
}

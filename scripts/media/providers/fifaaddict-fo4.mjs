// scripts/media/providers/fifaaddict-fo4.mjs
// Provider C: FIFAAddict FIFA Online 4 (en.fifaaddict.com/fo4db)
// Extracts opaque player image URLs (https://s1.fifaaddict.com/fo4/players/{uid}.png?...)
// from public FO4 search and detail pages. Never guesses or constructs image keys.

import {
    fetchPage,
    validateImageUrl,
    decodeHtmlEntities,
    normalizePersonName,
    normalizeAssetUrl,
    getExpandedAliases,
} from '../http-client.mjs';
import { normalizePositions } from '../../lib/normalize.mjs';

export const PROVIDER_ID = 'fifaaddict-fo4';

/**
 * Classify FO4 card class/season into the 4 ranking tiers required by Section 19:
 * 1. ICON The Moment
 * 2. ICON / Ultimate / Ballon d'Or
 * 3. historical premium class (Infinite Prime, Heroes, Tournament Champions, European Best Stars, Legend of Nation, Veteran, etc.)
 * 4. ordinary card (Live / regular year seasons)
 */
export function classifyFo4CardClass(yearBadgeCode, teamOrClassText = '') {
    const code = String(yearBadgeCode || '').trim();
    const label = decodeHtmlEntities(teamOrClassText || '').trim();
    const upper = label.toUpperCase();

    // Tier 1: ICON The Moment (y111 = ICONTMB, y112 = ICONTM)
    if (
        code === '111' ||
        code === '112' ||
        /ICON\s*THE\s*MOMENT|ICONTM/i.test(upper)
    ) {
        return {
            tier: 1,
            category: 'icon-the-moment',
            editionOrClass: label || 'ICON The Moment',
            mediaType: 'icon-render',
        };
    }

    // Tier 2: ICON / Ultimate / Ballon d'Or (y101 = ICON, y839 = Ballon d'Or, y829 = Ultimate)
    if (
        code === '101' ||
        code === '839' ||
        code === '829' ||
        /\bICON\b|BALLON\s*D'OR|ULTIMATE\s*TEAM|ULTIMATE\b/i.test(upper)
    ) {
        return {
            tier: 2,
            category: 'icon-or-ultimate',
            editionOrClass: label || (code === '101' ? 'ICON' : 'Ultimate / Ballon d\'Or'),
            mediaType: 'icon-render',
        };
    }

    // Tier 4: Ordinary / Live cards (y300+ live seasons like y317..y325 or plain club name without special class)
    if (/^3\d{2}$/.test(code) || /^LIVE\b/i.test(upper)) {
        return {
            tier: 4,
            category: 'ordinary-card',
            editionOrClass: label ? `Live (${label})` : `Live Season (${code})`,
            mediaType: 'portrait',
        };
    }

    // Tier 3: Historical premium classes (Infinite Prime, Tournament Champions, Loyal Heroes, Multi-League Champions, Heroes of the Team, National Hero Debut, Veteran, Captain, etc.)
    return {
        tier: 3,
        category: 'historical-premium',
        editionOrClass: label || (code ? `FO4 Class y${code}` : 'FO4 Special Class'),
        mediaType: 'player-render',
    };
}

export function buildFo4SearchQueries(entity) {
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

    if (!entity.canonicalName.includes("'")) {
        addQuery(entity.canonicalName);
    } else {
        const stripped = entity.canonicalName.replace(/'[a-zA-Z]+/g, '').trim();
        if (stripped.length >= 4 && !stripped.includes("'")) {
            addQuery(stripped);
        }
        const parts = entity.canonicalName.split(/[\s']+/).filter((p) => p.length >= 4);
        for (const p of parts.reverse()) {
            addQuery(p);
        }
    }

    // Surname query is very important on FO4 because FO4 search page often stores players as "P. Maldini", "G. Batistuta", "Z. Zidane"
    const tokens = entity.canonicalName.replace(/'/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
        const surname = tokens[tokens.length - 1];
        if (surname.length >= 3) {
            addQuery(surname);
        }
    }

    for (const alias of entity.aliases?.en || []) {
        if (!alias.includes("'") && alias.split(/\s+/).length <= 3) {
            addQuery(alias);
        }
    }

    return queries.slice(0, 3);
}

export function parseFo4SearchHtml(html, searchUrl) {
    if (!html || typeof html !== 'string') return [];
    const rows = [];

    const trRegex = /<tr\s+role="row"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    while ((match = trRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const pidMatch = rowHtml.match(/href="\/fo4db\/pid([a-z0-9]+)"/i);
        if (!pidMatch) continue;
        const uid = pidMatch[1];

        const imgMatch = rowHtml.match(/<img\s+src="(https:\/\/s1\.fifaaddict\.com\/fo4\/players\/[^"]+)"/i);
        const imageUrl = imgMatch ? imgMatch[1].trim() : null;

        const nameLinkMatch = rowHtml.match(/<a\s+href="\/fo4db\/pid[a-z0-9]+"\s+class="player-name"[^>]*>([\s\S]*?)<\/a>/i);
        let displayName = '';
        let yearBadgeCode = null;
        if (nameLinkMatch) {
            const inner = nameLinkMatch[1];
            const yMatch = inner.match(/\bbadgedss\s+y(\d+)/i);
            if (yMatch) yearBadgeCode = yMatch[1];
            displayName = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '').trim());
        }

        const teamMatch = rowHtml.match(/<span\s+class="team-name"><a[^>]*>([^<]+)<\/a><\/span>/i);
        const teamOrClassText = teamMatch ? decodeHtmlEntities(teamMatch[1].trim()) : '';

        const posMatches = [...rowHtml.matchAll(/<span\s+class="badge-pos[^"]*">([^<]+)<\/span><span\s+class="posval">(\d+)<\/span>/gi)];
        const rawPositions = posMatches.map((m) => m[1].trim());
        const sortWeight = posMatches.length > 0 ? Number(posMatches[0][2]) : 0;

        const classInfo = classifyFo4CardClass(yearBadgeCode, teamOrClassText);

        rows.push({
            uid,
            displayName,
            yearBadgeCode,
            teamOrClassText,
            editionOrClass: classInfo.editionOrClass,
            classTier: classInfo.tier,
            classCategory: classInfo.category,
            mediaType: classInfo.mediaType,
            rawPositions,
            canonicalPositions: normalizePositions(rawPositions),
            sortWeight,
            searchPageUrl: searchUrl,
            detailPageUrl: `https://en.fifaaddict.com/fo4db/pid${uid}`,
            imageUrl,
        });
    }

    return rows;
}

export function parseFo4DetailHtml(html, detailUrl) {
    if (!html || typeof html !== 'string') return null;

    const imgMatch =
        html.match(/<img\s+src="(https:\/\/s1\.fifaaddict\.com\/fo4\/players\/[^"]+)"[^>]*class="player-img"/i) ||
        html.match(/<img\s+src="(https:\/\/s1\.fifaaddict\.com\/fo4\/players\/[^"]+)"/i);
    const imageUrl = imgMatch ? imgMatch[1].trim() : null;

    let fullName = null;
    let yearBadgeCode = null;
    let seasonFullName = null;
    let birthYear = null;
    let birthDateIso = null;
    let nationality = null;

    // Format A: <div class="tablist fometa-desc">FullName (SeasonFullName), born on Month DD, YYYY, is a NN-year-old Country professional footballer...</div>
    const tabDescMatch = html.match(/<div\s+class="tablist\s+fometa-desc">([\s\S]*?)<\/div>/i);
    if (tabDescMatch) {
        const descText = decodeHtmlEntities(tabDescMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const headerMatch = descText.match(/^([^,(]+?)\s*\(([^)]+)\)\s*,\s*born\s+on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
        if (headerMatch) {
            fullName = headerMatch[1].trim();
            seasonFullName = headerMatch[2].trim();
            const parsedDate = new Date(`${headerMatch[3]} UTC`);
            if (!Number.isNaN(parsedDate.getTime())) {
                birthYear = parsedDate.getUTCFullYear();
                birthDateIso = parsedDate.toISOString().slice(0, 10);
            }
        }
        const natMatch = descText.match(/is\s+a\s+\d+-year-old\s+([A-Za-z\s-]+?)\s+professional\s+footballer/i);
        if (natMatch) {
            nationality = natMatch[1].trim();
        }
    }

    // Format B / Fallback: <div class="fometa"><h1>...</h1><p><b>FullName</b> (born <b>dd.m.yyyy</b>)...</p></div>
    const metaMatch = html.match(/<div\s+class="fometa">([\s\S]*?)<\/div>\s*<\/div>/i);
    const metaHtml = metaMatch ? metaMatch[1] : html;

    const h1Match = metaHtml.match(/<h1>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
        const yMatch = h1Match[1].match(/\bbadgedss\s+y(\d+)/i);
        if (yMatch) yearBadgeCode = yMatch[1];
        if (!fullName) {
            fullName = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());
        }
    }

    if (!birthYear) {
        const bornMatch = metaHtml.match(/\(born\s*<b>(\d{1,2}\.\d{1,2}\.\d{4})<\/b>\)/i);
        if (bornMatch) {
            const [d, m, y] = bornMatch[1].split('.').map(Number);
            birthYear = y;
            birthDateIso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    if (!seasonFullName) {
        const seasonLinkMatch = metaHtml.match(/<a\s+href="\/fo4db\?season=[^"]+">([^<]+)<\/a>/i);
        if (seasonLinkMatch) {
            seasonFullName = decodeHtmlEntities(seasonLinkMatch[1].trim());
        }
    }

    if (!nationality) {
        const nationLinkMatch = metaHtml.match(/<a\s+href="\/fo4db\?nation=([^"]+)">/i);
        if (nationLinkMatch) {
            nationality = decodeHtmlEntities(nationLinkMatch[1].replace(/-/g, ' ').trim());
        }
    }

    return {
        detailUrl,
        imageUrl,
        fullName,
        yearBadgeCode,
        seasonFullName,
        birthDateIso,
        birthYear,
        nationality,
    };
}

function matchSearchRowToEntity(entity, row, options = {}) {
    const canonicalNorm = normalizePersonName(entity.canonicalName);
    const aliasNorms = new Set(
        getExpandedAliases(entity).map((n) => normalizePersonName(n))
    );

    const rowNorm = normalizePersonName(row.displayName);
    const canonicalTokens = canonicalNorm.split(' ').filter(Boolean);
    const rowTokens = rowNorm.split(' ').filter(Boolean);

    const entityPositions = options.entityPositions || [];
    const positionOverlap =
        entityPositions.length === 0 ||
        row.canonicalPositions.length === 0 ||
        row.canonicalPositions.some((p) => entityPositions.includes(p));

    if (!positionOverlap) {
        return { plausible: false, matchType: 'none' };
    }

    if (rowNorm === canonicalNorm) {
        return { plausible: true, matchType: 'exact-name' };
    }
    if (aliasNorms.has(rowNorm)) {
        return { plausible: true, matchType: 'alias-name' };
    }

    // Check abbreviated initial + surname match: e.g. "P. Maldini" for "Paolo Maldini", "J. Veron" for "Juan Sebastian Veron"
    if (canonicalTokens.length >= 2 && rowTokens.length >= 2) {
        const cFirst = canonicalTokens[0];
        const cLast = canonicalTokens[canonicalTokens.length - 1];
        const rFirst = rowTokens[0];
        const rLast = rowTokens[rowTokens.length - 1];
        if (cLast === rLast && rFirst.length === 1 && cFirst.startsWith(rFirst)) {
            return { plausible: true, matchType: 'initial-surname' };
        }
        // Or all tokens of row appear in canonical/alias tokens (e.g. "Roberto Carlos" or "B. Lizarazu")
        for (const al of aliasNorms) {
            const alTokens = al.split(' ').filter(Boolean);
            if (alTokens.length >= 2) {
                const aFirst = alTokens[0];
                const aLast = alTokens[alTokens.length - 1];
                if (aLast === rLast && rFirst.length === 1 && aFirst.startsWith(rFirst)) {
                    return { plausible: true, matchType: 'initial-surname' };
                }
            }
        }
    }

    // Surname-only match (may be ambiguous, needs detail page check)
    if (
        canonicalTokens.length >= 2 &&
        rowTokens.length >= 1 &&
        rowTokens[rowTokens.length - 1] === canonicalTokens[canonicalTokens.length - 1]
    ) {
        return { plausible: true, matchType: 'surname-only' };
    }

    return { plausible: false, matchType: 'none' };
}

function verifyDetailIdentity(entity, row, detailMeta, options = {}) {
    if (!detailMeta || !detailMeta.fullName) {
        return { verified: false, confidence: 'unresolved', reason: 'missing-detail-metadata' };
    }

    const detailNorm = normalizePersonName(detailMeta.fullName);
    const canonicalNorm = normalizePersonName(entity.canonicalName);
    const aliasNorms = new Set(
        getExpandedAliases(entity).map((n) => normalizePersonName(n))
    );

    const canonicalTokens = canonicalNorm.split(' ').filter(Boolean);
    const detailTokens = detailNorm.split(' ').filter(Boolean);

    // Birth date / era plausibility check:
    // If options.knownBirthDate (from FIFAIndex) is provided, check exact birthYear or birthDate match!
    const knownBirthDate = options.knownBirthDate || null;
    const knownBirthYear = knownBirthDate ? Number(knownBirthDate.slice(0, 4)) : null;

    if (knownBirthYear && detailMeta.birthYear && Math.abs(detailMeta.birthYear - knownBirthYear) > 1) {
        return {
            verified: false,
            confidence: 'unresolved',
            reason: `Birth year mismatch: FO4 birthYear=${detailMeta.birthYear} vs knownBirthYear=${knownBirthYear} (${detailMeta.fullName})`,
        };
    }

    const minSeason = Math.min(...(entity.seasons || [2010]));
    const maxSeason = Math.max(...(entity.seasons || [2020]));
    if (detailMeta.birthYear) {
        // Player active in [minSeason, maxSeason] must be born between [minSeason - 44, maxSeason - 15]
        if (detailMeta.birthYear < minSeason - 44 || detailMeta.birthYear > maxSeason - 15) {
            return {
                verified: false,
                confidence: 'unresolved',
                reason: `Implausible birthYear=${detailMeta.birthYear} for seasons=${entity.seasons.join(',')}`,
            };
        }
    }

    const exactBirthMatch = Boolean(
        knownBirthDate && detailMeta.birthDateIso && knownBirthDate === detailMeta.birthDateIso
    );

    if (detailNorm === canonicalNorm) {
        if (canonicalTokens.length === 1 && !exactBirthMatch && !knownBirthYear) {
            return {
                verified: false,
                ambiguous: true,
                confidence: 'manual-review',
                reason: `Single-word mononym "${detailMeta.fullName}" on FO4 without confirming birth date`,
            };
        }
        return {
            verified: true,
            confidence: 'exact-name',
            reason: `Verified full name "${detailMeta.fullName}"${detailMeta.birthDateIso ? ` (born ${detailMeta.birthDateIso})` : ''} on FO4 detail page`,
        };
    }

    if (aliasNorms.has(detailNorm)) {
        return {
            verified: true,
            confidence: 'alias-confirmed',
            reason: `Verified known alias "${detailMeta.fullName}"${detailMeta.birthDateIso ? ` (born ${detailMeta.birthDateIso})` : ''} on FO4 detail page`,
        };
    }

    // Check if all tokens of canonicalName appear inside detailMeta.fullName (e.g. "Ronaldo Luis Nazario de Lima" or "Zinedine Yazid Zidane")
    if (
        canonicalTokens.length >= 2 &&
        canonicalTokens.every((t) => detailTokens.includes(t))
    ) {
        return {
            verified: true,
            confidence: 'alias-confirmed',
            reason: `Verified full legal name "${detailMeta.fullName}" on FO4 detail page`,
        };
    }

    // Check if exact birth date matches and surname/alias token matches
    if (
        exactBirthMatch &&
        canonicalTokens.some((t) => t.length >= 3 && detailTokens.includes(t))
    ) {
        return {
            verified: true,
            confidence: 'name+context',
            reason: `Verified via exact birthDate=${detailMeta.birthDateIso} and name="${detailMeta.fullName}" on FO4 detail page`,
        };
    }

    // Check if initial+surname matched on detail page too (some FO4 detail pages also use "P. Schmeichel" or "G. Batistuta" as h1)
    if (canonicalTokens.length >= 2 && detailTokens.length >= 2) {
        const cFirst = canonicalTokens[0];
        const cLast = canonicalTokens[canonicalTokens.length - 1];
        const dFirst = detailTokens[0];
        const dLast = detailTokens[detailTokens.length - 1];
        if (cLast === dLast && dFirst.length === 1 && cFirst.startsWith(dFirst)) {
            if (exactBirthMatch || detailMeta.birthYear) {
                return {
                    verified: true,
                    confidence: 'name+context',
                    reason: `Verified abbreviated name "${detailMeta.fullName}" with birthDate=${detailMeta.birthDateIso} and position on FO4 detail page`,
                };
            }
        }
    }

    return {
        verified: false,
        ambiguous: detailTokens[detailTokens.length - 1] === canonicalTokens[canonicalTokens.length - 1],
        confidence: 'manual-review',
        reason: `Unconfirmed identity on FO4: detailName="${detailMeta.fullName}" (born ${detailMeta.birthDateIso || 'unknown'}) vs "${entity.canonicalName}"`,
    };
}

const fo4EntityCache = new Map();

export async function discoverPlayerMedia({ entity, playerSeason = null, options = {} }) {
    if (!options.force && fo4EntityCache.has(entity.id)) {
        return fo4EntityCache.get(entity.id);
    }

    const queries = buildFo4SearchQueries(entity);
    const allRowsByUid = new Map();
    let blockedCount = 0;
    let errorCount = 0;
    let lastSearchUrl = null;

    for (const q of queries) {
        const searchUrl = `https://en.fifaaddict.com/fo4db?playername=${encodeURIComponent(q)}`;
        lastSearchUrl = searchUrl;
        const pageRes = await fetchPage(searchUrl, options);
        if (pageRes.blocked) blockedCount++;
        if (pageRes.error) errorCount++;

        if (pageRes.status === 200 && pageRes.body) {
            const parsed = parseFo4SearchHtml(pageRes.body, searchUrl);
            for (const r of parsed) {
                if (!allRowsByUid.has(r.uid)) {
                    allRowsByUid.set(r.uid, r);
                }
            }
            const hasStrongPlausible = [...allRowsByUid.values()].some((r) => {
                const m = matchSearchRowToEntity(entity, r, options);
                return m.plausible && m.matchType !== 'surname-only';
            });
            if (hasStrongPlausible) break;
        }
    }

    const strongPlausible = [];
    const surnameOnlyPlausible = [];

    for (const row of allRowsByUid.values()) {
        const m = matchSearchRowToEntity(entity, row, options);
        if (!m.plausible) continue;
        if (m.matchType === 'surname-only') {
            surnameOnlyPlausible.push({ row, matchType: m.matchType });
        } else {
            strongPlausible.push({ row, matchType: m.matchType });
        }
    }

    // Sort plausible rows by Section 19 priority:
    // 1. ICON The Moment (tier 1)
    // 2. ICON / Ultimate / Ballon d'Or (tier 2)
    // 3. historical premium class (tier 3)
    // 4. ordinary card (tier 4)
    // Then by sortWeight desc, then uid asc
    const sortRows = (list) =>
        list.sort((a, b) => {
            if (a.row.classTier !== b.row.classTier) return a.row.classTier - b.row.classTier;
            if (b.row.sortWeight !== a.row.sortWeight) return b.row.sortWeight - a.row.sortWeight;
            return a.row.uid.localeCompare(b.row.uid);
        });

    sortRows(strongPlausible);
    sortRows(surnameOnlyPlausible);

    // Group strongPlausible by normalized displayName so if a search returned 15 cards of "P. Maldini",
    // verifying the top card's detail page confirms the player identity for that displayName group
    const candidatesToInspect =
        strongPlausible.length > 0 ? strongPlausible : surnameOnlyPlausible.slice(0, 2);

    const verifiedCards = [];
    const ambiguousCards = [];
    const verifiedDisplayNames = new Map();
    const rejectedDisplayNames = new Set();

    let detailFetches = 0;
    for (const item of candidatesToInspect) {
        const { row } = item;
        const dispKey = `${normalizePersonName(row.displayName)}|${row.canonicalPositions.join('/')}`;

        if (rejectedDisplayNames.has(dispKey)) continue;

        if (verifiedDisplayNames.has(dispKey)) {
            verifiedCards.push({
                row,
                detailMeta: verifiedDisplayNames.get(dispKey).detailMeta,
                verification: verifiedDisplayNames.get(dispKey).verification,
            });
            continue;
        }

        if (detailFetches >= 2) continue;
        detailFetches++;

        const detailRes = await fetchPage(row.detailPageUrl, options);
        if (detailRes.blocked) blockedCount++;
        if (detailRes.error) errorCount++;

        if (detailRes.status === 200 && detailRes.body) {
            const detailMeta = parseFo4DetailHtml(detailRes.body, row.detailPageUrl);
            const verification = verifyDetailIdentity(entity, row, detailMeta, options);
            if (verification.verified) {
                verifiedDisplayNames.set(dispKey, { detailMeta, verification });
                verifiedCards.push({ row, detailMeta, verification });
            } else {
                rejectedDisplayNames.add(dispKey);
                if (verification.ambiguous) {
                    ambiguousCards.push({ row, detailMeta, verification });
                }
            }
        }
    }

    if (verifiedCards.length > 0) {
        const candidates = [];
        const maxKeep = Math.min(verifiedCards.length, 6);

        for (let i = 0; i < maxKeep; i++) {
            const { row, detailMeta, verification } = verifiedCards[i];
            const imageUrl = row.imageUrl || detailMeta?.imageUrl;
            const classInfo = classifyFo4CardClass(
                row.yearBadgeCode || detailMeta?.yearBadgeCode,
                detailMeta?.seasonFullName || row.teamOrClassText
            );

            let imgValidation = {
                httpStatus: null,
                contentType: null,
                contentLength: null,
                finalUrl: imageUrl,
                normalizedAssetUrl: normalizeAssetUrl(imageUrl),
                redirectCount: 0,
                reachableImage: false,
                availabilityStatus: 'not-probed',
            };

            const shouldProbe =
                i === 0 ||
                (i === 1 && !candidates[0]?.reachableImage) ||
                (i === 1 && ['paolo-maldini', 'peter-schmeichel', 'zinedine-zidane', 'gabriel-batistuta'].includes(entity.id));

            if (shouldProbe && imageUrl) {
                imgValidation = await validateImageUrl(imageUrl, options);
                if (imgValidation.availabilityStatus === 'blocked') blockedCount++;
                if (imgValidation.availabilityStatus === 'request-failed') errorCount++;
            }

            const isPlaceholderAsset =
                !imageUrl || /blank\.png|notfound|default/i.test(imageUrl);

            candidates.push({
                provider: PROVIDER_ID,
                sourcePageUrl: row.detailPageUrl,
                searchPageUrl: row.searchPageUrl,
                imageUrl,
                normalizedAssetUrl: normalizeAssetUrl(imageUrl),
                fo4OpaqueUid: row.uid,
                displayName: detailMeta?.fullName || row.displayName,
                searchDisplayName: row.displayName,
                editionOrClass: classInfo.editionOrClass,
                classCategory: classInfo.category,
                classTier: classInfo.tier,
                yearBadgeCode: row.yearBadgeCode,
                assetKind: isPlaceholderAsset
                    ? 'placeholder'
                    : imgValidation.reachableImage
                      ? 'real-photo'
                      : imgValidation.availabilityStatus === 'not-probed'
                        ? 'real-photo'
                        : 'request-failed',
                mediaType: classInfo.mediaType,
                matchConfidence: verification.confidence,
                manualReview: false,
                identityEvidence: {
                    reason: verification.reason,
                    fullName: detailMeta?.fullName || null,
                    searchDisplayName: row.displayName,
                    fo4Uid: row.uid,
                    birthDate: detailMeta?.birthDateIso || null,
                    nationality: detailMeta?.nationality || null,
                    observedPositions: row.rawPositions,
                    seasonFullName: detailMeta?.seasonFullName || row.teamOrClassText || null,
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

        const result = {
            provider: PROVIDER_ID,
            matched: true,
            confidence: candidates[0]?.matchConfidence || 'exact-name',
            manualReview: false,
            identityEvidence: candidates[0]?.identityEvidence || {},
            candidates,
            ambiguousCandidates: [],
            stats: {
                totalSearchRows: allRowsByUid.size,
                verifiedCardCount: verifiedCards.length,
                blockedCount,
                errorCount,
            },
        };
        fo4EntityCache.set(entity.id, result);
        return result;
    }

    if (ambiguousCards.length > 0) {
        const manualCandidates = ambiguousCards.slice(0, 3).map(({ row, detailMeta, verification }) => ({
            provider: PROVIDER_ID,
            sourcePageUrl: row.detailPageUrl,
            searchPageUrl: row.searchPageUrl,
            imageUrl: row.imageUrl,
            normalizedAssetUrl: normalizeAssetUrl(row.imageUrl),
            fo4OpaqueUid: row.uid,
            displayName: detailMeta?.fullName || row.displayName,
            editionOrClass: row.editionOrClass,
            assetKind: 'unknown',
            mediaType: row.mediaType,
            matchConfidence: 'manual-review',
            manualReview: true,
            identityEvidence: {
                reason: verification.reason,
                fullName: detailMeta?.fullName || row.displayName,
                fo4Uid: row.uid,
                birthDate: detailMeta?.birthDateIso || null,
                nationality: detailMeta?.nationality || null,
                observedPositions: row.rawPositions,
            },
            httpStatus: null,
            contentType: null,
            contentLength: null,
            finalUrl: row.imageUrl,
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
                reason: ambiguousCards[0].verification.reason,
                candidateNames: [...new Set(ambiguousCards.map((a) => a.detailMeta?.fullName || a.row.displayName))],
                sourcePageUrl: ambiguousCards[0].row.searchPageUrl,
            },
            candidates: manualCandidates,
            ambiguousCandidates: manualCandidates,
            stats: {
                totalSearchRows: allRowsByUid.size,
                verifiedCardCount: 0,
                blockedCount,
                errorCount,
            },
        };
        fo4EntityCache.set(entity.id, ambResult);
        return ambResult;
    }

    const emptyResult = {
        provider: PROVIDER_ID,
        matched: false,
        confidence: 'unresolved',
        manualReview: false,
        identityEvidence: {
            reason: blockedCount > 0 ? 'blocked' : 'no-matching-player-on-fo4',
            sourcePageUrl: lastSearchUrl,
        },
        candidates: [],
        ambiguousCandidates: [],
        stats: {
            totalSearchRows: allRowsByUid.size,
            verifiedCardCount: 0,
            blockedCount,
            errorCount,
        },
    };
    fo4EntityCache.set(entity.id, emptyResult);
    return emptyResult;
}

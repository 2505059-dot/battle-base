#!/usr/bin/env node
// scripts/build-player-media-resolution.mjs
// Deterministic PlayerSeason Media Resolver (availability-v1).
// Resolves all 554 PlayerSeasons from existing audited candidate data without scraping.
// Outputs:
// - data/entities/player-media-resolutions.json
// - data/reports/player-media-resolution-report.json
// - data/reports/player-media-resolution-report.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const PLAYERS_PATH = path.join(ROOT_DIR, 'data', 'entities', 'players.json');
const CANDIDATES_PATH = path.join(ROOT_DIR, 'data', 'entities', 'player-media-candidates.json');
const OVERRIDES_PATH = path.join(ROOT_DIR, 'data', 'manual', 'player-media-overrides.json');
const TEAM_SEASONS_PATH = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');

const RESOLUTIONS_OUT_PATH = path.join(ROOT_DIR, 'data', 'entities', 'player-media-resolutions.json');
const REPORT_JSON_OUT_PATH = path.join(ROOT_DIR, 'data', 'reports', 'player-media-resolution-report.json');
const REPORT_MD_OUT_PATH = path.join(ROOT_DIR, 'data', 'reports', 'player-media-resolution-report.md');

export const POLICY_VERSION = 'availability-v1';
export const LOCAL_SILHOUETTE_URL = '/assets/player-silhouette.svg';

const RELIABLE_CONFIDENCES = new Set([
    'exact-id',
    'exact-name',
    'alias-confirmed',
    'name+context',
]);

const CONFIDENCE_RANK = {
    'exact-id': 1,
    'exact-name': 2,
    'alias-confirmed': 3,
    'name+context': 4,
};

const RESOLUTION_TYPE_PRIORITY = {
    'manual-override': 0,
    'fifaindex-exact-year': 1,
    'fifaindex-nearest-year': 2,
    'fo3-supplemental': 3,
    'fo4-supplemental': 4,
    'silhouette': 5,
};

/**
 * Checks whether a candidate meets the v1 reliable real-photo criteria (Section 8).
 */
export function isReliableCandidate(cand) {
    if (!cand || typeof cand !== 'object') return false;
    if (cand.assetKind !== 'real-photo') return false;
    if (cand.reachableImage !== true) return false;
    if (cand.httpStatus !== 200) return false;
    if (typeof cand.contentType !== 'string' || !cand.contentType.startsWith('image/')) return false;
    if (cand.manualReview === true) return false;
    if (!RELIABLE_CONFIDENCES.has(cand.matchConfidence)) return false;
    if (cand.licenseStatus !== 'external-provider') return false;
    if (cand.availabilityStatus === 'placeholder' || cand.pathVariant === 'notfound-placeholder') return false;
    if (typeof cand.imageUrl !== 'string' || cand.imageUrl.includes('notfound_')) return false;
    return true;
}

function isFo3DetailPng(cand) {
    const assetUrl = String(cand.normalizedAssetUrl || cand.imageUrl || '').toLowerCase();
    return assetUrl.endsWith('.png') && !assetUrl.includes('/small/');
}

function selectBestFo3Candidate(fo3List) {
    if (!Array.isArray(fo3List) || fo3List.length === 0) return null;
    const reliable = fo3List
        .map((c, idx) => ({ cand: c, idx }))
        .filter(({ cand }) => isReliableCandidate(cand));
    if (reliable.length === 0) return null;

    reliable.sort((a, b) => {
        const aPng = isFo3DetailPng(a.cand) ? 0 : 1;
        const bPng = isFo3DetailPng(b.cand) ? 0 : 1;
        if (aPng !== bPng) return aPng - bPng;

        const aConf = CONFIDENCE_RANK[a.cand.matchConfidence] ?? 99;
        const bConf = CONFIDENCE_RANK[b.cand.matchConfidence] ?? 99;
        if (aConf !== bConf) return aConf - bConf;

        if (a.idx !== b.idx) return a.idx - b.idx;

        return String(a.cand.imageUrl || '').localeCompare(String(b.cand.imageUrl || ''));
    });

    return reliable[0].cand;
}

function selectBestFo4Candidate(fo4List) {
    if (!Array.isArray(fo4List) || fo4List.length === 0) return null;
    const reliable = fo4List
        .map((c, idx) => ({ cand: c, idx }))
        .filter(({ cand }) => isReliableCandidate(cand));
    if (reliable.length === 0) return null;

    reliable.sort((a, b) => {
        const aConf = CONFIDENCE_RANK[a.cand.matchConfidence] ?? 99;
        const bConf = CONFIDENCE_RANK[b.cand.matchConfidence] ?? 99;
        if (aConf !== bConf) return aConf - bConf;

        if (a.idx !== b.idx) return a.idx - b.idx;

        return String(a.cand.imageUrl || '').localeCompare(String(b.cand.imageUrl || ''));
    });

    return reliable[0].cand;
}

function findFifaIndexCandidateForSeason(fifaIndexList, seasonRes) {
    if (!Array.isArray(fifaIndexList) || !seasonRes) return null;
    const reliable = fifaIndexList.filter((c) => isReliableCandidate(c));
    if (reliable.length === 0) return null;

    if (seasonRes.imageUrl) {
        const byUrl = reliable.find((c) => c.imageUrl === seasonRes.imageUrl);
        if (byUrl) return byUrl;
    }
    if (typeof seasonRes.resolvedYear === 'number') {
        const byYear = reliable.find((c) => c.editionYear === seasonRes.resolvedYear);
        if (byYear) return byYear;
    }
    return null;
}

function buildMarkdownReport(report) {
    const lines = [];
    lines.push('# Player Media Resolution Report (v1)');
    lines.push('');
    lines.push(`- **Schema Version**: \`${report.schemaVersion}\``);
    lines.push(`- **Policy Version**: \`${report.policyVersion}\``);
    lines.push(`- **Total PlayerSeasons**: **${report.totalPlayerSeasons}**`);
    lines.push(`- **Total Player Entities**: **${report.totalEntities}**`);
    lines.push(`- **External Media Resolved**: **${report.externalMediaCount} / ${report.totalPlayerSeasons} (${report.externalCoveragePercent}%)**`);
    lines.push(`- **Local Silhouette Fallback**: **${report.silhouetteCount} / ${report.totalPlayerSeasons} (${report.fallbackPercent}%)**`);
    lines.push(`- **Manual Overrides Active**: **${report.manualOverrideCount}**`);
    lines.push(`- **Runtime Index Coverage**: **${report.runtimeIndexCoverage.resolvedCount} / ${report.runtimeIndexCoverage.totalPlayerSeasons} (${report.runtimeIndexCoverage.coveragePercent}%)**`);
    lines.push('');
    lines.push('## 1. Resolution Type Distribution');
    lines.push('');
    lines.push('| Resolution Type | Provider | Count | Percentage |');
    lines.push('| :--- | :--- | ---: | ---: |');
    lines.push(`| \`fifaindex-exact-year\` | \`fifaindex-current\` | ${report.exactCount} | ${((report.exactCount / report.totalPlayerSeasons) * 100).toFixed(1)}% |`);
    lines.push(`| \`fifaindex-nearest-year\` | \`fifaindex-current\` | ${report.nearestCount} | ${((report.nearestCount / report.totalPlayerSeasons) * 100).toFixed(1)}% |`);
    lines.push(`| \`fo3-supplemental\` | \`fifaaddict-fo3\` | ${report.fo3Count} | ${((report.fo3Count / report.totalPlayerSeasons) * 100).toFixed(1)}% |`);
    lines.push(`| \`fo4-supplemental\` | \`fifaaddict-fo4\` | ${report.fo4Count} | ${((report.fo4Count / report.totalPlayerSeasons) * 100).toFixed(1)}% |`);
    lines.push(`| \`silhouette\` | \`local-fallback\` | ${report.silhouetteCount} | ${((report.silhouetteCount / report.totalPlayerSeasons) * 100).toFixed(1)}% |`);
    lines.push(`| **Total** | — | **${report.totalPlayerSeasons}** | **100.0%** |`);
    lines.push('');
    lines.push('## 2. Provider Distribution');
    lines.push('');
    lines.push('| Provider | Count |');
    lines.push('| :--- | ---: |');
    for (const [prov, count] of Object.entries(report.providerDistribution)) {
        lines.push(`| \`${prov}\` | ${count} |`);
    }
    lines.push('');
    lines.push('## 3. Nearest-Year Distance Distribution (90 PlayerSeasons)');
    lines.push('');
    lines.push(`- **Total Nearest-Year Resolutions**: ${report.nearestYearAnalysis.totalNearestCount}`);
    lines.push(`- **Min Distance**: ${report.nearestYearAnalysis.minDistance} year(s)`);
    lines.push(`- **Max Distance**: ${report.nearestYearAnalysis.maxDistance} year(s)`);
    lines.push('');
    lines.push('| Year Distance (`|sourceYear - targetYear|`) | PlayerSeason Count |');
    lines.push('| :--- | ---: |');
    for (const [dist, count] of Object.entries(report.nearestYearAnalysis.distanceDistribution)) {
        lines.push(`| ${dist} year(s) | ${count} |`);
    }
    lines.push('');
    lines.push('## 4. Supplemental & Fallback Fixtures');
    lines.push('');
    lines.push('### FO3 Supplemental (4 PlayerSeasons)');
    lines.push('');
    for (const item of report.supplementalSelections.fo3) {
        lines.push(`- \`${item.playerSeasonId}\` — **${item.canonicalName}** (${item.club} ${item.targetYear}) -> \`${item.imageUrl}\``);
    }
    lines.push('');
    lines.push('### FO4 Supplemental (1 PlayerSeason)');
    lines.push('');
    for (const item of report.supplementalSelections.fo4) {
        lines.push(`- \`${item.playerSeasonId}\` — **${item.canonicalName}** (${item.club} ${item.targetYear}) -> \`${item.imageUrl}\``);
    }
    lines.push('');
    lines.push('### Silhouette Fallback (5 PlayerSeasons)');
    lines.push('');
    for (const item of report.missingExternalMediaPlayers) {
        lines.push(`- \`${item.playerSeasonId}\` — **${item.canonicalName}** (\`${item.entityId}\`, ${item.club} ${item.targetYear}) -> \`${item.imageUrl}\``);
    }
    lines.push('');
    lines.push('## 5. Multi-Provider Availability (Future Quality Resolver v2 Context)');
    lines.push('');
    lines.push(`- **Entities with Reliable Media in >= 2 Providers**: ${report.multiProviderSummary.entitiesWithMultipleReliableProvidersCount}`);
    lines.push(`- **Entities with Reliable Media in All 3 Providers (FIFAIndex + FO3 + FO4)**: ${report.multiProviderSummary.entitiesWithAllThreeProvidersCount}`);
    lines.push('');
    return lines.join('\n') + '\n';
}

export async function buildPlayerMediaResolution() {
    const playersData = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
    const candidatesData = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
    const overridesData = fs.existsSync(OVERRIDES_PATH)
        ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
        : { schemaVersion: '1.0.0', playerSeasons: {}, entities: {} };

    const { TEAM_SEASONS } = await import(pathToFileURL(TEAM_SEASONS_PATH).href);

    const entityById = new Map();
    for (const ent of playersData.entities) {
        entityById.set(ent.id, ent);
    }

    const allPlayerSeasons = [];
    for (const ts of TEAM_SEASONS) {
        for (const p of ts.players) {
            allPlayerSeasons.push({
                playerSeasonId: p.id,
                name: p.name,
                club: p.club,
                league: p.league,
                year: p.year,
            });
        }
    }

    // Sort deterministically by playerSeasonId
    allPlayerSeasons.sort((a, b) => a.playerSeasonId.localeCompare(b.playerSeasonId));

    const resolutions = {};
    let exactCount = 0;
    let nearestCount = 0;
    let fo3Count = 0;
    let fo4Count = 0;
    let silhouetteCount = 0;
    let manualOverrideCount = 0;

    const providerDistribution = {
        'fifaindex-current': 0,
        'fifaaddict-fo3': 0,
        'fifaaddict-fo4': 0,
        'local-fallback': 0,
    };

    const resolutionTypeDistribution = {
        'fifaindex-exact-year': 0,
        'fifaindex-nearest-year': 0,
        'fo3-supplemental': 0,
        'fo4-supplemental': 0,
        'silhouette': 0,
    };

    const nearestDistanceCounts = new Map();
    const fo3Selections = [];
    const fo4Selections = [];
    const missingExternalMediaPlayers = [];

    for (const ps of allPlayerSeasons) {
        const entityId = playersData.playerSeasonMap[ps.playerSeasonId];
        if (!entityId) {
            throw new Error(`Missing entityId mapping for playerSeasonId "${ps.playerSeasonId}"`);
        }
        const entity = entityById.get(entityId);
        if (!entity) {
            throw new Error(`Missing entity record for entityId "${entityId}"`);
        }
        const candEntity = candidatesData.entities[entityId];
        if (!candEntity) {
            throw new Error(`Missing candidate record for entityId "${entityId}"`);
        }

        const canonicalName = entity.canonicalName;
        const targetYear = ps.year;

        let resolvedEntry = null;

        // 0. Check manual override (empty in v1, ready for future overrides)
        const manualPsOverride = overridesData?.playerSeasons?.[ps.playerSeasonId];
        const manualEntityOverride = overridesData?.entities?.[entityId];
        const activeOverride = manualPsOverride || manualEntityOverride || null;

        if (activeOverride && activeOverride.imageUrl) {
            manualOverrideCount++;
            resolvedEntry = {
                playerSeasonId: ps.playerSeasonId,
                entityId,
                canonicalName,
                targetYear,
                provider: activeOverride.provider,
                resolutionType: activeOverride.resolutionType || 'manual-override',
                sourceYear: activeOverride.sourceYear ?? null,
                yearDistance:
                    typeof activeOverride.sourceYear === 'number'
                        ? Math.abs(activeOverride.sourceYear - targetYear)
                        : null,
                imageUrl: activeOverride.imageUrl,
                sourcePageUrl: activeOverride.sourcePageUrl ?? null,
                contentType: activeOverride.contentType || 'image/png',
                licenseStatus: activeOverride.licenseStatus || 'external-provider',
                selectionReason: 'manual-override',
            };
        }

        // 1 & 2. FIFAIndex exact-year or nearest-year
        if (!resolvedEntry) {
            const seasonRes = candEntity.seasonResolutions?.[String(targetYear)];
            if (seasonRes && seasonRes.resolutionType === 'exact-year' && seasonRes.exactYearRealPhoto === true) {
                const fifaCand = findFifaIndexCandidateForSeason(candEntity.fifaIndex, seasonRes);
                if (fifaCand) {
                    exactCount++;
                    resolvedEntry = {
                        playerSeasonId: ps.playerSeasonId,
                        entityId,
                        canonicalName,
                        targetYear,
                        provider: 'fifaindex-current',
                        resolutionType: 'fifaindex-exact-year',
                        sourceYear: seasonRes.resolvedYear,
                        yearDistance: 0,
                        imageUrl: fifaCand.imageUrl,
                        sourcePageUrl: fifaCand.sourcePageUrl,
                        contentType: fifaCand.contentType,
                        licenseStatus: 'external-provider',
                        selectionReason: 'fifaindex-exact-year',
                    };
                }
            } else if (seasonRes && seasonRes.resolutionType === 'nearest-year') {
                const fifaCand = findFifaIndexCandidateForSeason(candEntity.fifaIndex, seasonRes);
                if (fifaCand) {
                    nearestCount++;
                    const dist = Math.abs(seasonRes.resolvedYear - targetYear);
                    nearestDistanceCounts.set(dist, (nearestDistanceCounts.get(dist) || 0) + 1);
                    resolvedEntry = {
                        playerSeasonId: ps.playerSeasonId,
                        entityId,
                        canonicalName,
                        targetYear,
                        provider: 'fifaindex-current',
                        resolutionType: 'fifaindex-nearest-year',
                        sourceYear: seasonRes.resolvedYear,
                        yearDistance: dist,
                        imageUrl: fifaCand.imageUrl,
                        sourcePageUrl: fifaCand.sourcePageUrl,
                        contentType: fifaCand.contentType,
                        licenseStatus: 'external-provider',
                        selectionReason: 'fifaindex-nearest-year',
                    };
                }
            }
        }

        // 3. FO3 Supplemental Fallback
        if (!resolvedEntry) {
            const fo3Cand = selectBestFo3Candidate(candEntity.fifaAddictFo3);
            if (fo3Cand) {
                fo3Count++;
                resolvedEntry = {
                    playerSeasonId: ps.playerSeasonId,
                    entityId,
                    canonicalName,
                    targetYear,
                    provider: 'fifaaddict-fo3',
                    resolutionType: 'fo3-supplemental',
                    sourceYear: null,
                    yearDistance: null,
                    imageUrl: fo3Cand.imageUrl,
                    sourcePageUrl: fo3Cand.sourcePageUrl,
                    contentType: fo3Cand.contentType,
                    licenseStatus: 'external-provider',
                    selectionReason: 'fo3-supplemental',
                };
                fo3Selections.push({
                    playerSeasonId: ps.playerSeasonId,
                    entityId,
                    canonicalName,
                    club: ps.club,
                    targetYear,
                    imageUrl: fo3Cand.imageUrl,
                    editionOrClass: fo3Cand.editionOrClass,
                });
            }
        }

        // 4. FO4 Supplemental Fallback
        if (!resolvedEntry) {
            const fo4Cand = selectBestFo4Candidate(candEntity.fifaAddictFo4);
            if (fo4Cand) {
                fo4Count++;
                resolvedEntry = {
                    playerSeasonId: ps.playerSeasonId,
                    entityId,
                    canonicalName,
                    targetYear,
                    provider: 'fifaaddict-fo4',
                    resolutionType: 'fo4-supplemental',
                    sourceYear: null,
                    yearDistance: null,
                    imageUrl: fo4Cand.imageUrl,
                    sourcePageUrl: fo4Cand.sourcePageUrl,
                    contentType: fo4Cand.contentType,
                    licenseStatus: 'external-provider',
                    selectionReason: 'fo4-supplemental',
                };
                fo4Selections.push({
                    playerSeasonId: ps.playerSeasonId,
                    entityId,
                    canonicalName,
                    club: ps.club,
                    targetYear,
                    imageUrl: fo4Cand.imageUrl,
                    editionOrClass: fo4Cand.editionOrClass,
                });
            }
        }

        // 5. Local Silhouette Fallback
        if (!resolvedEntry) {
            silhouetteCount++;
            resolvedEntry = {
                playerSeasonId: ps.playerSeasonId,
                entityId,
                canonicalName,
                targetYear,
                provider: 'local-fallback',
                resolutionType: 'silhouette',
                sourceYear: null,
                yearDistance: null,
                imageUrl: LOCAL_SILHOUETTE_URL,
                sourcePageUrl: null,
                contentType: 'image/svg+xml',
                licenseStatus: 'project-generated',
                selectionReason: 'silhouette-fallback',
            };
            missingExternalMediaPlayers.push({
                playerSeasonId: ps.playerSeasonId,
                entityId,
                canonicalName,
                club: ps.club,
                targetYear,
                imageUrl: LOCAL_SILHOUETTE_URL,
            });
        }

        resolutions[ps.playerSeasonId] = resolvedEntry;
        providerDistribution[resolvedEntry.provider] =
            (providerDistribution[resolvedEntry.provider] || 0) + 1;
        resolutionTypeDistribution[resolvedEntry.resolutionType] =
            (resolutionTypeDistribution[resolvedEntry.resolutionType] || 0) + 1;
    }

    // Build deterministic entityDefaults (Section 15)
    const entityDefaults = {};
    const sortedEntities = [...playersData.entities].sort((a, b) => a.id.localeCompare(b.id));
    for (const ent of sortedEntities) {
        const psResolutions = (ent.playerSeasonIds || [])
            .map((psId) => resolutions[psId])
            .filter(Boolean);

        psResolutions.sort((a, b) => {
            const pA = RESOLUTION_TYPE_PRIORITY[a.resolutionType] ?? 99;
            const pB = RESOLUTION_TYPE_PRIORITY[b.resolutionType] ?? 99;
            if (pA !== pB) return pA - pB;
            const distA = a.yearDistance ?? 999;
            const distB = b.yearDistance ?? 999;
            if (distA !== distB) return distA - distB;
            if (b.targetYear !== a.targetYear) return b.targetYear - a.targetYear;
            return a.playerSeasonId.localeCompare(b.playerSeasonId);
        });

        const best = psResolutions[0];
        if (best) {
            entityDefaults[ent.id] = {
                entityId: ent.id,
                canonicalName: ent.canonicalName,
                representativePlayerSeasonId: best.playerSeasonId,
                provider: best.provider,
                resolutionType: best.resolutionType,
                sourceYear: best.sourceYear,
                targetYear: best.targetYear,
                imageUrl: best.imageUrl,
                licenseStatus: best.licenseStatus,
            };
        }
    }

    const totalPlayerSeasons = allPlayerSeasons.length;
    const externalMediaCount = exactCount + nearestCount + fo3Count + fo4Count;

    const resolutionsPayload = {
        schemaVersion: '1.0.0',
        policyVersion: POLICY_VERSION,
        totalPlayerSeasons,
        totalEntities: sortedEntities.length,
        externalMediaCount,
        silhouetteCount,
        manualOverrideCount,
        resolutions,
        entityDefaults,
    };

    // Distance distribution for nearest-year (Section 48)
    const sortedDistances = [...nearestDistanceCounts.keys()].sort((a, b) => a - b);
    const distanceDistribution = {};
    for (const d of sortedDistances) {
        distanceDistribution[String(d)] = nearestDistanceCounts.get(d);
    }

    // Multi-provider analysis for future Quality Resolver v2 (Section 49)
    const playersWithMultipleReliableProviders = [];
    let allThreeCount = 0;
    for (const ent of sortedEntities) {
        const candEntity = candidatesData.entities[ent.id];
        if (!candEntity) continue;
        const hasFifaIndex = (candEntity.fifaIndex || []).some((c) => isReliableCandidate(c));
        const hasFo3 = (candEntity.fifaAddictFo3 || []).some((c) => isReliableCandidate(c));
        const hasFo4 = (candEntity.fifaAddictFo4 || []).some((c) => isReliableCandidate(c));

        const availableProviders = [];
        if (hasFifaIndex) availableProviders.push('fifaindex-current');
        if (hasFo3) availableProviders.push('fifaaddict-fo3');
        if (hasFo4) availableProviders.push('fifaaddict-fo4');

        if (availableProviders.length >= 2) {
            if (availableProviders.length === 3) allThreeCount++;
            playersWithMultipleReliableProviders.push({
                entityId: ent.id,
                canonicalName: ent.canonicalName,
                providers: availableProviders,
                playerSeasonIds: [...(ent.playerSeasonIds || [])].sort(),
            });
        }
    }

    const reportPayload = {
        schemaVersion: '1.0.0',
        policyVersion: POLICY_VERSION,
        totalPlayerSeasons,
        totalEntities: sortedEntities.length,
        exactCount,
        nearestCount,
        fo3Count,
        fo4Count,
        silhouetteCount,
        externalMediaCount,
        fallbackCount: silhouetteCount,
        externalCoveragePercent: Number(((externalMediaCount / totalPlayerSeasons) * 100).toFixed(1)),
        fallbackPercent: Number(((silhouetteCount / totalPlayerSeasons) * 100).toFixed(1)),
        manualOverrideCount,
        providerDistribution,
        resolutionTypeDistribution,
        nearestYearAnalysis: {
            totalNearestCount: nearestCount,
            minDistance: sortedDistances.length > 0 ? sortedDistances[0] : 0,
            maxDistance: sortedDistances.length > 0 ? sortedDistances[sortedDistances.length - 1] : 0,
            distanceDistribution,
        },
        runtimeIndexCoverage: {
            resolvedCount: Object.keys(resolutions).length,
            totalPlayerSeasons,
            coveragePercent: Number(((Object.keys(resolutions).length / totalPlayerSeasons) * 100).toFixed(1)),
        },
        supplementalSelections: {
            fo3: fo3Selections,
            fo4: fo4Selections,
        },
        missingExternalMediaPlayers,
        multiProviderSummary: {
            entitiesWithMultipleReliableProvidersCount: playersWithMultipleReliableProviders.length,
            entitiesWithAllThreeProvidersCount: allThreeCount,
            playersWithMultipleReliableProviders,
        },
    };

    fs.mkdirSync(path.dirname(RESOLUTIONS_OUT_PATH), { recursive: true });
    fs.mkdirSync(path.dirname(REPORT_JSON_OUT_PATH), { recursive: true });

    fs.writeFileSync(RESOLUTIONS_OUT_PATH, JSON.stringify(resolutionsPayload, null, 2) + '\n', 'utf8');
    fs.writeFileSync(REPORT_JSON_OUT_PATH, JSON.stringify(reportPayload, null, 2) + '\n', 'utf8');
    fs.writeFileSync(REPORT_MD_OUT_PATH, buildMarkdownReport(reportPayload), 'utf8');

    return {
        resolutionsPayload,
        reportPayload,
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildPlayerMediaResolution()
        .then(({ reportPayload }) => {
            console.log(
                `[build-player-media-resolution] Resolved ${reportPayload.totalPlayerSeasons} PlayerSeasons ` +
                    `(exact=${reportPayload.exactCount}, nearest=${reportPayload.nearestCount}, ` +
                    `fo3=${reportPayload.fo3Count}, fo4=${reportPayload.fo4Count}, ` +
                    `silhouette=${reportPayload.silhouetteCount}).`
            );
        })
        .catch((err) => {
            console.error('[build-player-media-resolution] FAILED:', err);
            process.exit(1);
        });
}

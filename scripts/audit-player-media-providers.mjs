#!/usr/bin/env node
// scripts/audit-player-media-providers.mjs
// Main runner for Player Media Provider Audit v1.
// Audits all 418 unique Player Entities and 554 PlayerSeasons across:
//   A. FIFAIndex Current CDN (fifaindex-current)
//   B. FIFAAddict FIFA Online 3 (fifaaddict-fo3)
//   C. FIFAAddict FIFA Online 4 (fifaaddict-fo4)
// Generates:
//   - data/entities/player-media-candidates.json
//   - data/reports/player-media-provider-audit.json
//   - data/reports/player-media-provider-audit.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverPlayerMedia as discoverFifaIndex } from './media/providers/fifaindex-current.mjs';
import { discoverPlayerMedia as discoverFo3 } from './media/providers/fifaaddict-fo3.mjs';
import { discoverPlayerMedia as discoverFo4 } from './media/providers/fifaaddict-fo4.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const TEAM_SEASONS_JS = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');

const RELIABLE_CONFIDENCES = new Set([
    'exact-id',
    'exact-name',
    'alias-confirmed',
    'name+context',
]);

function isReliableRealCandidate(cand) {
    return Boolean(
        cand &&
            cand.assetKind === 'real-photo' &&
            cand.reachableImage === true &&
            !cand.manualReview &&
            RELIABLE_CONFIDENCES.has(cand.matchConfidence) &&
            cand.contentType &&
            cand.contentType.startsWith('image/')
    );
}

function getEraBucket(year) {
    const y = Number(year);
    if (y >= 1999 && y <= 2004) return '1999-2004';
    if (y >= 2005 && y <= 2010) return '2005-2010';
    if (y >= 2011 && y <= 2020) return '2011-2020';
    if (y >= 2021 && y <= 2024) return '2021-2024';
    return 'other';
}

function getImageExtension(url, contentType) {
    if (url) {
        const clean = url.split('?')[0].toLowerCase();
        if (clean.endsWith('.png')) return 'png';
        if (clean.endsWith('.webp')) return 'webp';
        if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
    }
    if (contentType) {
        if (contentType.includes('png')) return 'png';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
    }
    return 'other';
}

function pct(num, den) {
    if (!den) return '0.0%';
    return `${((num / den) * 100).toFixed(1)}%`;
}

async function main() {
    fs.mkdirSync(ENTITIES_DIR, { recursive: true });
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const playersPath = path.join(ENTITIES_DIR, 'players.json');
    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));

    const tsModule = await import(pathToFileURL(TEAM_SEASONS_JS).href);
    const { TEAM_SEASONS } = tsModule;

    // Build PlayerSeason index and per-entity position map from TEAM_SEASONS
    const allPlayerSeasons = [];
    const entityPositionsMap = new Map();

    for (const ts of TEAM_SEASONS) {
        for (const p of ts.players) {
            const entityId = playersData.playerSeasonMap[p.id];
            allPlayerSeasons.push({
                id: p.id,
                entityId,
                name: p.name,
                club: ts.club,
                league: ts.league,
                year: Number(ts.year),
                seasonLabel: ts.season,
                positions: p.positions || [],
            });
            if (entityId) {
                if (!entityPositionsMap.has(entityId)) {
                    entityPositionsMap.set(entityId, new Set());
                }
                for (const pos of p.positions || []) {
                    entityPositionsMap.get(entityId).add(pos);
                }
            }
        }
    }

    // Sort entities deterministically by id
    const entities = [...playersData.entities].sort((a, b) => a.id.localeCompare(b.id));
    console.log(`[audit-player-media-providers] Auditing ${entities.length} unique Player Entities and ${allPlayerSeasons.length} PlayerSeasons...`);

    const sidecarEntities = {};
    const entityAuditMap = new Map();

    let processed = 0;
    for (const entity of entities) {
        processed++;
        const entityPositions = [...(entityPositionsMap.get(entity.id) || [])];

        // 1. FIFAIndex discovery first (also gives resolvedFifaIndexId & birthDate for cross-provider verification)
        const fifaIndexRes = await discoverFifaIndex({
            entity,
            options: { entityPositions },
        });

        const knownEaId =
            entity.externalIds?.fifaIndex ||
            entity.externalIds?.sofifa ||
            fifaIndexRes.resolvedFifaIndexId ||
            null;
        const knownBirthDate = fifaIndexRes.identityEvidence?.birthDate || null;

        // 2. Run FO3 and FO4 discovery concurrently (distinct endpoints / rate-limited per host in http-client)
        const [fo3Res, fo4Res] = await Promise.all([
            discoverFo3({
                entity,
                options: { knownEaId, knownBirthDate, entityPositions },
            }),
            discoverFo4({
                entity,
                options: { knownEaId, knownBirthDate, entityPositions },
            }),
        ]);

        sidecarEntities[entity.id] = {
            entityId: entity.id,
            canonicalName: entity.canonicalName,
            fifaIndex: fifaIndexRes.candidates,
            fifaAddictFo3: fo3Res.candidates,
            fifaAddictFo4: fo4Res.candidates,
            seasonResolutions: Object.fromEntries(
                Object.entries(fifaIndexRes.seasonResolutions || {}).map(([yr, res]) => [
                    yr,
                    {
                        exactYear: res.exactYear,
                        resolvedYear: res.resolvedYear,
                        yearDistance: res.yearDistance,
                        resolutionType: res.resolutionType,
                        exactYearRealPhoto: res.exactYearRealPhoto,
                        exactYearStatus: res.exactYearStatus,
                        imageUrl: res.candidate?.imageUrl || null,
                    },
                ])
            ),
        };

        entityAuditMap.set(entity.id, {
            entity,
            fifaIndexRes,
            fo3Res,
            fo4Res,
        });

        if (processed % 25 === 0 || processed === entities.length) {
            console.log(`  [${processed}/${entities.length}] Processed ${entity.id}`);
        }
    }

    // Compute coverage, HTTP stats, deduplication, era breakdown, legend gap, manual review, and missing list
    const providerStats = {
        'fifaindex-current': {
            matchedEntities: 0,
            reliableRealMediaEntities: 0,
            totalCandidates: 0,
            reachableCount: 0,
            placeholderCount: 0,
            blockedCount: 0,
            notFound404Count: 0,
            timeoutCount: 0,
            requestFailedCount: 0,
            notProbedCount: 0,
            formatDistribution: { png: 0, webp: 0, jpg: 0, other: 0 },
            distinctImageUrls: new Set(),
            distinctNormalizedUrls: new Set(),
            legacyGPathCandidatesCount: 0,
            hubTotalPlaceholdersObserved: 0,
            hubTotalLegacyGPathsObserved: 0,
        },
        'fifaaddict-fo3': {
            matchedEntities: 0,
            reliableRealMediaEntities: 0,
            manualReviewEntities: 0,
            totalCandidates: 0,
            reachableCount: 0,
            placeholderCount: 0,
            blockedCount: 0,
            notFound404Count: 0,
            timeoutCount: 0,
            requestFailedCount: 0,
            notProbedCount: 0,
            formatDistribution: { png: 0, webp: 0, jpg: 0, other: 0 },
            distinctImageUrls: new Set(),
            distinctNormalizedUrls: new Set(),
            assetUsageCount: new Map(),
        },
        'fifaaddict-fo4': {
            matchedEntities: 0,
            reliableRealMediaEntities: 0,
            manualReviewEntities: 0,
            totalCandidates: 0,
            reachableCount: 0,
            placeholderCount: 0,
            blockedCount: 0,
            notFound404Count: 0,
            timeoutCount: 0,
            requestFailedCount: 0,
            notProbedCount: 0,
            formatDistribution: { png: 0, webp: 0, jpg: 0, other: 0 },
            distinctImageUrls: new Set(),
            distinctNormalizedUrls: new Set(),
            opaqueKeyLengths: new Map(),
        },
    };

    const fiReliableSet = new Set();
    const fo3ReliableSet = new Set();
    const fo4ReliableSet = new Set();

    const manualReviewQueue = [];
    const stillMissingPlayers = [];

    for (const entity of entities) {
        const { fifaIndexRes, fo3Res, fo4Res } = entityAuditMap.get(entity.id);

        // FIFAIndex stats
        const fiStat = providerStats['fifaindex-current'];
        if (fifaIndexRes.matched) fiStat.matchedEntities++;
        fiStat.hubTotalPlaceholdersObserved += fifaIndexRes.stats?.placeholderEditionsCount || 0;
        fiStat.hubTotalLegacyGPathsObserved += fifaIndexRes.stats?.legacyGPathCount || 0;
        fiStat.blockedCount += fifaIndexRes.stats?.blockedCount || 0;

        const fiHasReliable = fifaIndexRes.candidates.some(isReliableRealCandidate);
        if (fiHasReliable) {
            fiStat.reliableRealMediaEntities++;
            fiReliableSet.add(entity.id);
        }

        for (const c of fifaIndexRes.candidates) {
            fiStat.totalCandidates++;
            if (c.pathVariant === 'legacy-g-prefix') fiStat.legacyGPathCandidatesCount++;
            if (c.imageUrl) fiStat.distinctImageUrls.add(c.imageUrl);
            if (c.normalizedAssetUrl) fiStat.distinctNormalizedUrls.add(c.normalizedAssetUrl);

            const ext = getImageExtension(c.imageUrl, c.contentType);
            fiStat.formatDistribution[ext] = (fiStat.formatDistribution[ext] || 0) + 1;
            if (c.webpUrl) {
                fiStat.formatDistribution.webp++;
            }

            if (c.availabilityStatus === 'reachable') fiStat.reachableCount++;
            else if (c.availabilityStatus === 'placeholder') fiStat.placeholderCount++;
            else if (c.availabilityStatus === 'blocked') fiStat.blockedCount++;
            else if (c.availabilityStatus === 'not-found') fiStat.notFound404Count++;
            else if (c.availabilityStatus === 'timeout') fiStat.timeoutCount++;
            else if (c.availabilityStatus === 'not-probed') fiStat.notProbedCount++;
            else fiStat.requestFailedCount++;
        }

        // FO3 stats
        const fo3Stat = providerStats['fifaaddict-fo3'];
        if (fo3Res.matched) fo3Stat.matchedEntities++;
        if (fo3Res.manualReview) {
            fo3Stat.manualReviewEntities++;
            manualReviewQueue.push({
                entityId: entity.id,
                canonicalName: entity.canonicalName,
                provider: 'fifaaddict-fo3',
                candidateNames: fo3Res.identityEvidence?.candidateNames ||
                    fo3Res.candidates.map((c) => c.displayName),
                sourcePageUrl:
                    fo3Res.identityEvidence?.sourcePageUrl ||
                    fo3Res.candidates[0]?.sourcePageUrl ||
                    null,
                reason: fo3Res.identityEvidence?.reason || 'Ambiguous identity on FO3',
            });
        }
        fo3Stat.blockedCount += fo3Res.stats?.blockedCount || 0;

        const fo3HasReliable = fo3Res.candidates.some(isReliableRealCandidate);
        if (fo3HasReliable) {
            fo3Stat.reliableRealMediaEntities++;
            fo3ReliableSet.add(entity.id);
        }

        for (const c of fo3Res.candidates) {
            fo3Stat.totalCandidates++;
            if (c.imageUrl) fo3Stat.distinctImageUrls.add(c.imageUrl);
            if (c.normalizedAssetUrl) {
                fo3Stat.distinctNormalizedUrls.add(c.normalizedAssetUrl);
                fo3Stat.assetUsageCount.set(
                    c.normalizedAssetUrl,
                    (fo3Stat.assetUsageCount.get(c.normalizedAssetUrl) || 0) + 1
                );
            }
            const ext = getImageExtension(c.imageUrl, c.contentType);
            fo3Stat.formatDistribution[ext] = (fo3Stat.formatDistribution[ext] || 0) + 1;

            if (c.availabilityStatus === 'reachable') fo3Stat.reachableCount++;
            else if (c.availabilityStatus === 'placeholder') fo3Stat.placeholderCount++;
            else if (c.availabilityStatus === 'blocked') fo3Stat.blockedCount++;
            else if (c.availabilityStatus === 'not-found') fo3Stat.notFound404Count++;
            else if (c.availabilityStatus === 'timeout') fo3Stat.timeoutCount++;
            else if (c.availabilityStatus === 'not-probed' || c.availabilityStatus === 'manual-review')
                fo3Stat.notProbedCount++;
            else fo3Stat.requestFailedCount++;
        }

        // FO4 stats
        const fo4Stat = providerStats['fifaaddict-fo4'];
        if (fo4Res.matched) fo4Stat.matchedEntities++;
        if (fo4Res.manualReview) {
            fo4Stat.manualReviewEntities++;
            manualReviewQueue.push({
                entityId: entity.id,
                canonicalName: entity.canonicalName,
                provider: 'fifaaddict-fo4',
                candidateNames: fo4Res.identityEvidence?.candidateNames ||
                    fo4Res.candidates.map((c) => c.displayName),
                sourcePageUrl:
                    fo4Res.identityEvidence?.sourcePageUrl ||
                    fo4Res.candidates[0]?.sourcePageUrl ||
                    null,
                reason: fo4Res.identityEvidence?.reason || 'Ambiguous identity on FO4',
            });
        }
        fo4Stat.blockedCount += fo4Res.stats?.blockedCount || 0;

        const fo4HasReliable = fo4Res.candidates.some(isReliableRealCandidate);
        if (fo4HasReliable) {
            fo4Stat.reliableRealMediaEntities++;
            fo4ReliableSet.add(entity.id);
        }

        for (const c of fo4Res.candidates) {
            fo4Stat.totalCandidates++;
            if (c.imageUrl) fo4Stat.distinctImageUrls.add(c.imageUrl);
            if (c.normalizedAssetUrl) fo4Stat.distinctNormalizedUrls.add(c.normalizedAssetUrl);
            if (c.fo4OpaqueUid) {
                const len = c.fo4OpaqueUid.length;
                fo4Stat.opaqueKeyLengths.set(len, (fo4Stat.opaqueKeyLengths.get(len) || 0) + 1);
            }
            const ext = getImageExtension(c.imageUrl, c.contentType);
            fo4Stat.formatDistribution[ext] = (fo4Stat.formatDistribution[ext] || 0) + 1;

            if (c.availabilityStatus === 'reachable') fo4Stat.reachableCount++;
            else if (c.availabilityStatus === 'placeholder') fo4Stat.placeholderCount++;
            else if (c.availabilityStatus === 'blocked') fo4Stat.blockedCount++;
            else if (c.availabilityStatus === 'not-found') fo4Stat.notFound404Count++;
            else if (c.availabilityStatus === 'timeout') fo4Stat.timeoutCount++;
            else if (c.availabilityStatus === 'not-probed' || c.availabilityStatus === 'manual-review')
                fo4Stat.notProbedCount++;
            else fo4Stat.requestFailedCount++;
        }

        if (!fiHasReliable && !fo3HasReliable && !fo4HasReliable) {
            const reasons = [];
            reasons.push(`FIFAIndex: ${fifaIndexRes.identityEvidence?.reason || 'no-real-photo'}`);
            reasons.push(`FO3: ${fo3Res.manualReview ? `manual-review (${fo3Res.identityEvidence?.reason})` : (fo3Res.identityEvidence?.reason || 'not-found')}`);
            reasons.push(`FO4: ${fo4Res.manualReview ? `manual-review (${fo4Res.identityEvidence?.reason})` : (fo4Res.identityEvidence?.reason || 'not-found')}`);

            stillMissingPlayers.push({
                entityId: entity.id,
                canonicalName: entity.canonicalName,
                clubs: entity.clubs,
                seasons: entity.seasons,
                reason: reasons.join('; '),
            });
        }
    }

    // Net-new calculations (Section 32)
    const fo3NetNewVsFifaIndex = [...fo3ReliableSet].filter((id) => !fiReliableSet.has(id)).sort();
    const fiPlusFo3Set = new Set([...fiReliableSet, ...fo3ReliableSet]);
    const fo4NetNewVsFifaIndexOnly = [...fo4ReliableSet].filter((id) => !fiReliableSet.has(id)).sort();
    const fo4NetNewVsFiPlusFo3 = [...fo4ReliableSet].filter((id) => !fiPlusFo3Set.has(id)).sort();
    const combinedReliableSet = new Set([...fiReliableSet, ...fo3ReliableSet, ...fo4ReliableSet]);

    // PlayerSeason Coverage (Section 33) & Era Breakdown (Section 34)
    const eraBuckets = {
        '1999-2004': {
            totalPlayerSeasons: 0,
            exactFifaIndex: 0,
            nearestFifaIndex: 0,
            fo3Supplemental: 0,
            fo4Supplemental: 0,
            combinedCovered: 0,
            missing: 0,
            uniqueEntityIds: new Set(),
        },
        '2005-2010': {
            totalPlayerSeasons: 0,
            exactFifaIndex: 0,
            nearestFifaIndex: 0,
            fo3Supplemental: 0,
            fo4Supplemental: 0,
            combinedCovered: 0,
            missing: 0,
            uniqueEntityIds: new Set(),
        },
        '2011-2020': {
            totalPlayerSeasons: 0,
            exactFifaIndex: 0,
            nearestFifaIndex: 0,
            fo3Supplemental: 0,
            fo4Supplemental: 0,
            combinedCovered: 0,
            missing: 0,
            uniqueEntityIds: new Set(),
        },
        '2021-2024': {
            totalPlayerSeasons: 0,
            exactFifaIndex: 0,
            nearestFifaIndex: 0,
            fo3Supplemental: 0,
            fo4Supplemental: 0,
            combinedCovered: 0,
            missing: 0,
            uniqueEntityIds: new Set(),
        },
    };

    let psExactFifaIndex = 0;
    let psNearestFifaIndex = 0;
    let psFo3Supplemental = 0;
    let psFo4Supplemental = 0;
    let psNoMedia = 0;

    const playerSeasonResolutions = [];

    for (const ps of allPlayerSeasons) {
        const auditEntry = entityAuditMap.get(ps.entityId);
        const fiRes = auditEntry?.fifaIndexRes;
        const seasonRes = fiRes?.seasonResolutions?.[ps.year] || null;
        const hasFo3 = fo3ReliableSet.has(ps.entityId);
        const hasFo4 = fo4ReliableSet.has(ps.entityId);

        const era = getEraBucket(ps.year);
        const bucket = eraBuckets[era];
        if (bucket) {
            bucket.totalPlayerSeasons++;
            bucket.uniqueEntityIds.add(ps.entityId);
        }

        let resolvedBy = 'none';
        if (seasonRes && seasonRes.resolutionType === 'exact-year' && seasonRes.exactYearRealPhoto) {
            psExactFifaIndex++;
            if (bucket) bucket.exactFifaIndex++;
            resolvedBy = 'fifaindex-exact-year';
        } else if (seasonRes && seasonRes.resolutionType === 'nearest-year') {
            psNearestFifaIndex++;
            if (bucket) bucket.nearestFifaIndex++;
            resolvedBy = 'fifaindex-nearest-year';
        } else if (hasFo3) {
            psFo3Supplemental++;
            if (bucket) bucket.fo3Supplemental++;
            resolvedBy = 'fo3-supplemental';
        } else if (hasFo4) {
            psFo4Supplemental++;
            if (bucket) bucket.fo4Supplemental++;
            resolvedBy = 'fo4-supplemental';
        } else {
            psNoMedia++;
            if (bucket) bucket.missing++;
        }

        if (resolvedBy !== 'none' && bucket) {
            bucket.combinedCovered++;
        }

        playerSeasonResolutions.push({
            playerSeasonId: ps.id,
            entityId: ps.entityId,
            year: ps.year,
            club: ps.club,
            resolvedBy,
            exactYearRealPhoto: Boolean(seasonRes?.exactYearRealPhoto),
            fifaIndexResolvedYear: seasonRes?.resolvedYear || null,
            fifaIndexYearDistance: seasonRes?.yearDistance ?? null,
            fo3Available: hasFo3,
            fo4Available: hasFo4,
        });
    }

    // Legend / Historical Gap Report (Section 35):
    // 1999-2004 unique players without FIFAIndex exact-year photo (all 80 unique 1999-2004 players, since FIFAIndex starts at FIFA 05),
    // and specifically the 1999-2004 players without ANY FIFAIndex photo (neither exact nor nearest).
    const pre2005Entities = entities.filter((e) => e.seasons.some((y) => y >= 1999 && y <= 2004));
    const pre2005WithoutExactFifaIndex = pre2005Entities.filter((e) => {
        const fiRes = entityAuditMap.get(e.id)?.fifaIndexRes;
        return !e.seasons
            .filter((y) => y >= 1999 && y <= 2004)
            .some((y) => fiRes?.seasonResolutions?.[y]?.exactYearRealPhoto);
    });
    const pre2005WithoutAnyFifaIndex = pre2005Entities.filter((e) => !fiReliableSet.has(e.id));

    const summarizeLegendGroup = (group) => {
        let nearestFifaIndexCount = 0;
        let fo3FoundCount = 0;
        let fo4FoundCount = 0;
        let bothFo3AndFo4Count = 0;
        let eitherFo3OrFo4Count = 0;
        let stillMissingCount = 0;
        const playerDetails = [];

        for (const e of group) {
            const hasFiNearest = fiReliableSet.has(e.id);
            const hasFo3 = fo3ReliableSet.has(e.id);
            const hasFo4 = fo4ReliableSet.has(e.id);
            if (hasFiNearest) nearestFifaIndexCount++;
            if (hasFo3) fo3FoundCount++;
            if (hasFo4) fo4FoundCount++;
            if (hasFo3 && hasFo4) bothFo3AndFo4Count++;
            if (hasFo3 || hasFo4) eitherFo3OrFo4Count++;
            if (!hasFiNearest && !hasFo3 && !hasFo4) stillMissingCount++;

            playerDetails.push({
                entityId: e.id,
                canonicalName: e.canonicalName,
                seasons: e.seasons,
                clubs: e.clubs,
                fifaIndexNearestAvailable: hasFiNearest,
                fo3Available: hasFo3,
                fo4Available: hasFo4,
                combinedAvailable: hasFiNearest || hasFo3 || hasFo4,
            });
        }

        return {
            totalPlayers: group.length,
            fifaIndexNearestCovered: nearestFifaIndexCount,
            fo3Found: fo3FoundCount,
            fo4Found: fo4FoundCount,
            bothFo3AndFo4Found: bothFo3AndFo4Count,
            eitherFo3OrFo4Found: eitherFo3OrFo4Count,
            stillCompletelyMissing: stillMissingCount,
            players: playerDetails,
        };
    };

    const legendGapAllPre2005NoExact = summarizeLegendGroup(pre2005WithoutExactFifaIndex);
    const legendGapPre2005NoFifaIndexAtAll = summarizeLegendGroup(pre2005WithoutAnyFifaIndex);

    // Famous Historical Sample Audit (Section 36)
    const FAMOUS_SAMPLE_TARGETS = [
        { sampleLabel: 'Pelé', matchRegex: /^pele$/i },
        { sampleLabel: 'Maradona', matchRegex: /maradona/i },
        { sampleLabel: 'Cruyff', matchRegex: /cruyff/i },
        { sampleLabel: 'Beckenbauer', matchRegex: /beckenbauer/i },
        { sampleLabel: 'Maldini', matchRegex: /^paolo-maldini$/i },
        { sampleLabel: 'Baresi', matchRegex: /baresi/i },
        { sampleLabel: 'Yashin', matchRegex: /yashin/i },
        { sampleLabel: 'Gullit', matchRegex: /gullit/i },
        { sampleLabel: 'Van Basten', matchRegex: /van-basten/i },
        { sampleLabel: 'Matthäus', matchRegex: /matthaeus|matthaus/i },
        { sampleLabel: 'Ronaldo Nazário', matchRegex: /^ronaldo$|^ronaldo-nazario$/i },
        { sampleLabel: 'Ronaldinho', matchRegex: /^ronaldinho$/i },
        { sampleLabel: 'Zidane', matchRegex: /^zinedine-zidane$/i },
        { sampleLabel: 'George Best', matchRegex: /^george-best$/i },
        { sampleLabel: 'Weah', matchRegex: /^george-weah$/i },
        { sampleLabel: 'Schmeichel', matchRegex: /^peter-schmeichel$/i },
    ];

    const famousHistoricalSamplePresent = [];
    const famousHistoricalSampleNotInDataset = [];

    for (const target of FAMOUS_SAMPLE_TARGETS) {
        const foundEntity = entities.find(
            (e) => target.matchRegex.test(e.id) || target.matchRegex.test(e.canonicalName)
        );
        if (foundEntity) {
            const entry = entityAuditMap.get(foundEntity.id);
            const fiCands = entry.fifaIndexRes.candidates.filter(isReliableRealCandidate);
            const fo3Cands = entry.fo3Res.candidates.filter(
                (c) => c.assetKind === 'real-photo' && RELIABLE_CONFIDENCES.has(c.matchConfidence)
            );
            const fo4Cands = entry.fo4Res.candidates.filter(
                (c) => c.assetKind === 'real-photo' && RELIABLE_CONFIDENCES.has(c.matchConfidence)
            );
            famousHistoricalSamplePresent.push({
                sampleLabel: target.sampleLabel,
                entityId: foundEntity.id,
                canonicalName: foundEntity.canonicalName,
                inFifaIndex: fiReliableSet.has(foundEntity.id),
                inFo3: fo3ReliableSet.has(foundEntity.id),
                inFo4: fo4ReliableSet.has(foundEntity.id),
                fifaIndexCandidateCount: fiCands.length,
                fo3CandidateCount: fo3Cands.length,
                fo4CandidateCount: fo4Cands.length,
                totalCandidateCount: fiCands.length + fo3Cands.length + fo4Cands.length,
            });
        } else {
            famousHistoricalSampleNotInDataset.push(target.sampleLabel);
        }
    }

    // Regression Fixtures (Sections 37-40)
    const mbappeEntry = entityAuditMap.get('kylian-mbappe');
    const mbappeFifa16Cand =
        mbappeEntry?.fifaIndexRes?.candidates?.find((c) => c.editionYear === 2016) || null;

    const messiEntry = entityAuditMap.get('lionel-messi');
    const maldiniEntry = entityAuditMap.get('paolo-maldini');
    const schmeichelEntry = entityAuditMap.get('peter-schmeichel');
    const hierroEntry = entityAuditMap.get('fernando-hierro');
    const effenbergEntry = entityAuditMap.get('stefan-effenberg');
    const zidaneEntry = entityAuditMap.get('zinedine-zidane');
    const batistutaEntry = entityAuditMap.get('gabriel-batistuta');

    const regressionFixtures = {
        placeholderMbappeFifa16: {
            entityId: 'kylian-mbappe',
            edition: 'FIFA16',
            detectedAsPlaceholder: mbappeFifa16Cand?.assetKind === 'placeholder',
            countedAsRealPhoto: isReliableRealCandidate(mbappeFifa16Cand),
            candidate: mbappeFifa16Cand,
        },
        fifaIndexCdnModernAndLegacy: {
            modernSample:
                messiEntry?.fifaIndexRes?.candidates?.find((c) => c.editionYear === 2020) || null,
            legacyGPrefixSamples: [
                messiEntry?.fifaIndexRes?.candidates?.find((c) => c.pathVariant === 'legacy-g-prefix') || null,
                maldiniEntry?.fifaIndexRes?.candidates?.find((c) => c.pathVariant === 'legacy-g-prefix') || null,
            ].filter(Boolean),
        },
        fo3LegendFixtures: [
            {
                entityId: 'paolo-maldini',
                matched: maldiniEntry?.fo3Res?.matched || false,
                topCandidate: maldiniEntry?.fo3Res?.candidates?.[0] || null,
            },
            {
                entityId: 'peter-schmeichel',
                matched: schmeichelEntry?.fo3Res?.matched || false,
                topCandidate: schmeichelEntry?.fo3Res?.candidates?.[0] || null,
            },
            {
                entityId: 'fernando-hierro',
                matched: hierroEntry?.fo3Res?.matched || false,
                topCandidate: hierroEntry?.fo3Res?.candidates?.[0] || null,
            },
            {
                entityId: 'stefan-effenberg',
                matched: effenbergEntry?.fo3Res?.matched || false,
                topCandidate: effenbergEntry?.fo3Res?.candidates?.[0] || null,
            },
        ],
        fo4OpaqueKeyFixtures: [
            {
                entityId: 'paolo-maldini',
                matched: maldiniEntry?.fo4Res?.matched || false,
                topCandidate: maldiniEntry?.fo4Res?.candidates?.[0] || null,
            },
            {
                entityId: 'peter-schmeichel',
                matched: schmeichelEntry?.fo4Res?.matched || false,
                topCandidate: schmeichelEntry?.fo4Res?.candidates?.[0] || null,
            },
            {
                entityId: 'zinedine-zidane',
                matched: zidaneEntry?.fo4Res?.matched || false,
                topCandidate: zidaneEntry?.fo4Res?.candidates?.[0] || null,
            },
            {
                entityId: 'gabriel-batistuta',
                matched: batistutaEntry?.fo4Res?.matched || false,
                topCandidate: batistutaEntry?.fo4Res?.candidates?.[0] || null,
            },
        ],
    };

    const generatedAt = new Date().toISOString();

    // Write Sidecar: data/entities/player-media-candidates.json
    const sidecarPayload = {
        schemaVersion: '1.0.0',
        generatedAt,
        totalEntities: entities.length,
        totalPlayerSeasons: allPlayerSeasons.length,
        entities: sidecarEntities,
    };
    const sidecarPath = path.join(ENTITIES_DIR, 'player-media-candidates.json');
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecarPayload, null, 2) + '\n', 'utf8');

    // Serialize provider stats cleanly
    const serializedProviders = {};
    for (const [pKey, st] of Object.entries(providerStats)) {
        serializedProviders[pKey] = {
            matchedEntities: st.matchedEntities,
            reliableRealMediaEntities: st.reliableRealMediaEntities,
            manualReviewEntities: st.manualReviewEntities || 0,
            totalCandidates: st.totalCandidates,
            reachableCount: st.reachableCount,
            placeholderCount: st.placeholderCount,
            blockedCount: st.blockedCount,
            notFound404Count: st.notFound404Count,
            timeoutCount: st.timeoutCount,
            requestFailedCount: st.requestFailedCount,
            notProbedCount: st.notProbedCount,
            formatDistribution: st.formatDistribution,
            distinctImageUrlCount: st.distinctImageUrls.size,
            distinctNormalizedAssetUrlCount: st.distinctNormalizedUrls.size,
            ...(pKey === 'fifaindex-current'
                ? {
                      legacyGPathCandidatesCount: st.legacyGPathCandidatesCount,
                      hubTotalPlaceholdersObserved: st.hubTotalPlaceholdersObserved,
                      hubTotalLegacyGPathsObserved: st.hubTotalLegacyGPathsObserved,
                  }
                : {}),
            ...(pKey === 'fifaaddict-fo3'
                ? {
                      sharedAssetCount: [...st.assetUsageCount.values()].filter((v) => v > 1).length,
                  }
                : {}),
            ...(pKey === 'fifaaddict-fo4'
                ? {
                      opaqueKeyLengthDistribution: Object.fromEntries(
                          [...st.opaqueKeyLengths.entries()].sort((a, b) => a[0] - b[0])
                      ),
                  }
                : {}),
        };
    }

    const serializedEraBreakdown = {};
    for (const [era, b] of Object.entries(eraBuckets)) {
        serializedEraBreakdown[era] = {
            totalPlayerSeasons: b.totalPlayerSeasons,
            uniquePlayersInEra: b.uniqueEntityIds.size,
            exactFifaIndex: b.exactFifaIndex,
            nearestFifaIndex: b.nearestFifaIndex,
            fo3Supplemental: b.fo3Supplemental,
            fo4Supplemental: b.fo4Supplemental,
            combinedCovered: b.combinedCovered,
            combinedCoveragePercentage: pct(b.combinedCovered, b.totalPlayerSeasons),
            missing: b.missing,
        };
    }

    const auditReportJson = {
        schemaVersion: '1.0.0',
        generatedAt,
        scope: {
            totalUniquePlayers: entities.length,
            totalPlayerSeasons: allPlayerSeasons.length,
        },
        providerSummary: serializedProviders,
        uniquePlayerCoverage: {
            totalUniquePlayers: entities.length,
            fifaIndexOnly: {
                matchedUniquePlayers: providerStats['fifaindex-current'].matchedEntities,
                reliableRealPhotoUniquePlayers: fiReliableSet.size,
                percentage: pct(fiReliableSet.size, entities.length),
            },
            fifaAddictFo3: {
                matchedUniquePlayers: providerStats['fifaaddict-fo3'].matchedEntities,
                reliableRealMediaUniquePlayers: fo3ReliableSet.size,
                percentage: pct(fo3ReliableSet.size, entities.length),
                netNewVsFifaIndexCount: fo3NetNewVsFifaIndex.length,
                netNewVsFifaIndexEntityIds: fo3NetNewVsFifaIndex,
            },
            fifaAddictFo4: {
                matchedUniquePlayers: providerStats['fifaaddict-fo4'].matchedEntities,
                reliableRealMediaUniquePlayers: fo4ReliableSet.size,
                percentage: pct(fo4ReliableSet.size, entities.length),
                netNewVsFifaIndexOnlyCount: fo4NetNewVsFifaIndexOnly.length,
                netNewVsFifaIndexOnlyEntityIds: fo4NetNewVsFifaIndexOnly,
                netNewVsFifaIndexPlusFo3Count: fo4NetNewVsFiPlusFo3.length,
                netNewVsFifaIndexPlusFo3EntityIds: fo4NetNewVsFiPlusFo3,
            },
            combinedProgression: {
                fifaIndexOnlyCount: fiReliableSet.size,
                fifaIndexOnlyPercentage: pct(fiReliableSet.size, entities.length),
                fifaIndexPlusFo3Count: fiPlusFo3Set.size,
                fifaIndexPlusFo3Percentage: pct(fiPlusFo3Set.size, entities.length),
                fifaIndexPlusFo3PlusFo4Count: combinedReliableSet.size,
                fifaIndexPlusFo3PlusFo4Percentage: pct(combinedReliableSet.size, entities.length),
                stillMissingCount: stillMissingPlayers.length,
            },
        },
        playerSeasonCoverage: {
            totalPlayerSeasons: allPlayerSeasons.length,
            fifaIndexExactSeasonRealPhoto: psExactFifaIndex,
            fifaIndexExactSeasonPercentage: pct(psExactFifaIndex, allPlayerSeasons.length),
            fifaIndexNearestSeasonFallback: psNearestFifaIndex,
            fifaIndexNearestSeasonPercentage: pct(psNearestFifaIndex, allPlayerSeasons.length),
            fifaIndexTotalCovered: psExactFifaIndex + psNearestFifaIndex,
            fifaIndexTotalPercentage: pct(
                psExactFifaIndex + psNearestFifaIndex,
                allPlayerSeasons.length
            ),
            fo3SupplementalFallback: psFo3Supplemental,
            fo4SupplementalFallback: psFo4Supplemental,
            fo3OrFo4GenericFallbackTotal: psFo3Supplemental + psFo4Supplemental,
            combinedCoveredPlayerSeasons:
                psExactFifaIndex + psNearestFifaIndex + psFo3Supplemental + psFo4Supplemental,
            combinedCoveredPercentage: pct(
                psExactFifaIndex + psNearestFifaIndex + psFo3Supplemental + psFo4Supplemental,
                allPlayerSeasons.length
            ),
            noMediaPlayerSeasons: psNoMedia,
            noMediaPercentage: pct(psNoMedia, allPlayerSeasons.length),
        },
        eraBreakdown: serializedEraBreakdown,
        legendGap: {
            pre2005WithoutExactFifaIndexPhoto: legendGapAllPre2005NoExact,
            pre2005WithoutAnyFifaIndexPhoto: legendGapPre2005NoFifaIndexAtAll,
        },
        famousHistoricalSampleAudit: {
            presentInDataset: famousHistoricalSamplePresent,
            notPresentInDataset418: famousHistoricalSampleNotInDataset,
        },
        regressionFixtures,
        recommendedResolutionStrategy: [
            '1. FIFAIndex exact-season real photo (images.fifaindex.com)',
            '2. FIFAIndex nearest-season real photo (preferring earlier year on distance tie)',
            '3. FIFAAddict FO3 / FO4 verified historical/legend player render',
            '4. Wikimedia Commons licensed image (future enrichment for remaining missing historical players)',
            '5. Positional silhouette fallback',
        ],
        manualReviewQueue,
        stillMissingPlayers,
        playerSeasonResolutions,
    };

    const reportJsonPath = path.join(REPORTS_DIR, 'player-media-provider-audit.json');
    fs.writeFileSync(reportJsonPath, JSON.stringify(auditReportJson, null, 2) + '\n', 'utf8');

    // Generate Markdown Report: data/reports/player-media-provider-audit.md
    const mdLines = [
        '# Player Media Provider Audit v1',
        '',
        `- **Generated At**: \`${generatedAt}\``,
        `- **Total Unique Player Entities**: **${entities.length}**`,
        `- **Total PlayerSeasons**: **${allPlayerSeasons.length}**`,
        `- **Candidate Sidecar**: \`data/entities/player-media-candidates.json\``,
        '',
        '---',
        '',
        '## 1. Provider Summary',
        '',
        '| Provider | Matched Entities | Reliable Media Entities | Total Candidates | Reachable Images | Placeholders | 404 / Not Found | Blocked | Timeouts | Distinct Image URLs |',
        '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| \`fifaindex-current\` | ${serializedProviders['fifaindex-current'].matchedEntities} | **${serializedProviders['fifaindex-current'].reliableRealMediaEntities}** (${pct(serializedProviders['fifaindex-current'].reliableRealMediaEntities, entities.length)}) | ${serializedProviders['fifaindex-current'].totalCandidates} | ${serializedProviders['fifaindex-current'].reachableCount} | ${serializedProviders['fifaindex-current'].placeholderCount} (hub total: ${serializedProviders['fifaindex-current'].hubTotalPlaceholdersObserved}) | ${serializedProviders['fifaindex-current'].notFound404Count} | ${serializedProviders['fifaindex-current'].blockedCount} | ${serializedProviders['fifaindex-current'].timeoutCount} | ${serializedProviders['fifaindex-current'].distinctImageUrlCount} |`,
        `| \`fifaaddict-fo3\` | ${serializedProviders['fifaaddict-fo3'].matchedEntities} | **${serializedProviders['fifaaddict-fo3'].reliableRealMediaEntities}** (${pct(serializedProviders['fifaaddict-fo3'].reliableRealMediaEntities, entities.length)}) | ${serializedProviders['fifaaddict-fo3'].totalCandidates} | ${serializedProviders['fifaaddict-fo3'].reachableCount} | ${serializedProviders['fifaaddict-fo3'].placeholderCount} | ${serializedProviders['fifaaddict-fo3'].notFound404Count} | ${serializedProviders['fifaaddict-fo3'].blockedCount} | ${serializedProviders['fifaaddict-fo3'].timeoutCount} | ${serializedProviders['fifaaddict-fo3'].distinctImageUrlCount} |`,
        `| \`fifaaddict-fo4\` | ${serializedProviders['fifaaddict-fo4'].matchedEntities} | **${serializedProviders['fifaaddict-fo4'].reliableRealMediaEntities}** (${pct(serializedProviders['fifaaddict-fo4'].reliableRealMediaEntities, entities.length)}) | ${serializedProviders['fifaaddict-fo4'].totalCandidates} | ${serializedProviders['fifaaddict-fo4'].reachableCount} | ${serializedProviders['fifaaddict-fo4'].placeholderCount} | ${serializedProviders['fifaaddict-fo4'].notFound404Count} | ${serializedProviders['fifaaddict-fo4'].blockedCount} | ${serializedProviders['fifaaddict-fo4'].timeoutCount} | ${serializedProviders['fifaaddict-fo4'].distinctImageUrlCount} |`,
        '',
        '### Image Format & Path Variants',
        '',
        `- **FIFAIndex Current CDN (\`images.fifaindex.com\`)**: PNG = ${serializedProviders['fifaindex-current'].formatDistribution.png}, WEBP (\`<source srcSet>\`) = ${serializedProviders['fifaindex-current'].formatDistribution.webp}. Observed **${serializedProviders['fifaindex-current'].legacyGPathCandidatesCount}** candidate(s) using the legacy \`/players/g/{key}.png\` path variant (and **${serializedProviders['fifaindex-current'].hubTotalLegacyGPathsObserved}** total \`/g/\` edition entries across all hub pages for FIFA 05–08).`,
        `- **FIFAAddict FO3 (\`fifaaddict.com/fo3img\`)**: PNG = ${serializedProviders['fifaaddict-fo3'].formatDistribution.png}, JPG = ${serializedProviders['fifaaddict-fo3'].formatDistribution.jpg} (query string \`?2018\` preserved).`,
        `- **FIFAAddict FO4 (\`s1.fifaaddict.com/fo4/players\`)**: PNG = ${serializedProviders['fifaaddict-fo4'].formatDistribution.png} (opaque lowercase alphabetical keys of length 8–9 chars + \`?20260720\` query string preserved).`,
        '',
        '---',
        '',
        '## 2. Unique Player Coverage (418 Entities)',
        '',
        '| Resolution Stage | Covered Unique Players | Coverage % | Net-New Added | Remaining Missing |',
        '| :--- | ---: | ---: | ---: | ---: |',
        `| **FIFAIndex Only** | **${fiReliableSet.size}** / 418 | **${pct(fiReliableSet.size, entities.length)}** | +${fiReliableSet.size} | ${entities.length - fiReliableSet.size} |`,
        `| **FIFAIndex + FO3** | **${fiPlusFo3Set.size}** / 418 | **${pct(fiPlusFo3Set.size, entities.length)}** | +${fo3NetNewVsFifaIndex.length} (${fo3NetNewVsFifaIndex.join(', ') || 'none'}) | ${entities.length - fiPlusFo3Set.size} |`,
        `| **FIFAIndex + FO3 + FO4** | **${combinedReliableSet.size}** / 418 | **${pct(combinedReliableSet.size, entities.length)}** | +${fo4NetNewVsFiPlusFo3.length} (${fo4NetNewVsFiPlusFo3.join(', ') || 'none'}) | **${stillMissingPlayers.length}** |`,
        '',
        '---',
        '',
        '## 3. PlayerSeason Coverage (554 PlayerSeasons)',
        '',
        '| Resolution Tier | PlayerSeasons | Percentage | Notes |',
        '| :--- | ---: | ---: | :--- |',
        `| **1. FIFAIndex Exact-Season Real Photo** | **${psExactFifaIndex}** / 554 | **${pct(psExactFifaIndex, allPlayerSeasons.length)}** | Exact FIFA edition year matches \`PlayerSeason.year\` with verified \`images.fifaindex.com\` headshot |`,
        `| **2. FIFAIndex Nearest-Year Fallback** | **${psNearestFifaIndex}** / 554 | **${pct(psNearestFifaIndex, allPlayerSeasons.length)}** | Same entity's nearest FIFAIndex real photo (e.g., 1999–2004 seasons resolved to FIFA 05/07, or Mbappé 2016 placeholder) |`,
        `| **3. FO3 / FO4 Verified Render Fallback** | **${psFo3Supplemental + psFo4Supplemental}** / 554 | **${pct(psFo3Supplemental + psFo4Supplemental, allPlayerSeasons.length)}** | FO3 supplemental: ${psFo3Supplemental}, FO4 supplemental: ${psFo4Supplemental} |`,
        `| **Combined Covered PlayerSeasons** | **${psExactFifaIndex + psNearestFifaIndex + psFo3Supplemental + psFo4Supplemental}** / 554 | **${pct(psExactFifaIndex + psNearestFifaIndex + psFo3Supplemental + psFo4Supplemental, allPlayerSeasons.length)}** | All 3 providers combined |`,
        `| **4. No Media (Still Missing)** | **${psNoMedia}** / 554 | **${pct(psNoMedia, allPlayerSeasons.length)}** | Candidates for future Wikimedia Commons enrichment / silhouette fallback |`,
        '',
        '---',
        '',
        '## 4. Era Breakdown',
        '',
        '| Era | Total PlayerSeasons | Unique Players | Exact FIFAIndex | Nearest FIFAIndex | FO3 Supplemental | FO4 Supplemental | Combined Covered | Missing |',
        '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    for (const era of ['1999-2004', '2005-2010', '2011-2020', '2021-2024']) {
        const b = serializedEraBreakdown[era];
        mdLines.push(
            `| **${era}** | ${b.totalPlayerSeasons} | ${b.uniquePlayersInEra} | ${b.exactFifaIndex} | ${b.nearestFifaIndex} | ${b.fo3Supplemental} | ${b.fo4Supplemental} | **${b.combinedCovered}** (${b.combinedCoveragePercentage}) | ${b.missing} |`
        );
    }

    mdLines.push(
        '',
        '---',
        '',
        '## 5. Legend / Historical Gap Report (1999–2004)',
        '',
        `- **1999–2004 Unique Players without Exact-Year FIFAIndex Photo**: **${legendGapAllPre2005NoExact.totalPlayers}** (FIFAIndex archive begins at FIFA 05 / 2005)`,
        `  - Covered by **FIFAIndex Nearest-Year (2005+)**: **${legendGapAllPre2005NoExact.fifaIndexNearestCovered}**`,
        `  - Found in **FO3**: **${legendGapAllPre2005NoExact.fo3Found}**`,
        `  - Found in **FO4**: **${legendGapAllPre2005NoExact.fo4Found}**`,
        `  - Found in **Both FO3 & FO4**: **${legendGapAllPre2005NoExact.bothFo3AndFo4Found}**`,
        `  - Still completely missing across all 3 providers: **${legendGapAllPre2005NoExact.stillCompletelyMissing}**`,
        '',
        `- **1999–2004 Unique Players without ANY FIFAIndex Photo (Retired before FIFA 05)**: **${legendGapPre2005NoFifaIndexAtAll.totalPlayers}**`,
        `  - Found in **FO3**: **${legendGapPre2005NoFifaIndexAtAll.fo3Found}**`,
        `  - Found in **FO4**: **${legendGapPre2005NoFifaIndexAtAll.fo4Found}**`,
        `  - Found in **Both FO3 & FO4**: **${legendGapPre2005NoFifaIndexAtAll.bothFo3AndFo4Found}**`,
        `  - Net-new rescued by **FO3 or FO4**: **${legendGapPre2005NoFifaIndexAtAll.eitherFo3OrFo4Found}**`,
        `  - Still completely missing after FO3 + FO4: **${legendGapPre2005NoFifaIndexAtAll.stillCompletelyMissing}**`,
        '',
        '| Entity ID | Canonical Name | Seasons | Clubs | FIFAIndex Nearest | FO3 | FO4 | Combined Status |',
        '| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |'
    );

    for (const p of legendGapPre2005NoFifaIndexAtAll.players) {
        mdLines.push(
            `| \`${p.entityId}\` | ${p.canonicalName} | ${p.seasons.join(', ')} | ${p.clubs.join(', ')} | ${p.fifaIndexNearestAvailable ? 'YES' : 'NO'} | ${p.fo3Available ? 'YES' : 'NO'} | ${p.fo4Available ? 'YES' : 'NO'} | **${p.combinedAvailable ? 'COVERED' : 'MISSING'}** |`
        );
    }

    mdLines.push(
        '',
        '---',
        '',
        '## 6. Famous Historical Sample Audit (Section 36)',
        '',
        '> Only entities actually present in the current 418-player dataset are audited below (no synthetic entities added).',
        '',
        '| Famous Sample Name | Entity ID | In FIFAIndex | In FO3 | In FO4 | FIFAIndex Candidates | FO3 Candidates | FO4 Candidates | Total Candidates |',
        '| :--- | :--- | :---: | :---: | :---: | ---: | ---: | ---: | ---: |'
    );

    for (const s of famousHistoricalSamplePresent) {
        mdLines.push(
            `| **${s.sampleLabel}** (${s.canonicalName}) | \`${s.entityId}\` | ${s.inFifaIndex ? 'YES' : 'NO'} | ${s.inFo3 ? 'YES' : 'NO'} | ${s.inFo4 ? 'YES' : 'NO'} | ${s.fifaIndexCandidateCount} | ${s.fo3CandidateCount} | ${s.fo4CandidateCount} | **${s.totalCandidateCount}** |`
        );
    }
    mdLines.push(
        '',
        `- **Sample names not present in current 418 entities**: ${famousHistoricalSampleNotInDataset.join(', ')}.`,
        '',
        '---',
        '',
        '## 7. Regression Fixtures Verification (Sections 37–40)',
        '',
        `- **Placeholder Regression (\`kylian-mbappe\` FIFA 16)**: \`assetKind = "${mbappeFifa16Cand?.assetKind}"\`, \`availabilityStatus = "${mbappeFifa16Cand?.availabilityStatus}"\`, \`countedAsRealPhoto = ${isReliableRealCandidate(mbappeFifa16Cand)}\` (Page explicitly displays \`"Player photo not found"\` / \`/notfound_0.webp\`).`,
        `- **Current FIFAIndex CDN Regression**:`,
        `  - Modern: \`lionel-messi\` FIFA 20 -> \`${regressionFixtures.fifaIndexCdnModernAndLegacy.modernSample?.imageUrl || 'N/A'}\` (\`httpStatus = ${regressionFixtures.fifaIndexCdnModernAndLegacy.modernSample?.httpStatus}\`)`,
        `  - Legacy \`/g/\`: \`${regressionFixtures.fifaIndexCdnModernAndLegacy.legacyGPrefixSamples.map((c) => `${c.identityEvidence?.editionSlug}: ${c.imageUrl} (${c.httpStatus})`).join(' | ')}\``,
        `- **FO3 Legend Regression**: ${regressionFixtures.fo3LegendFixtures.map((f) => `\`${f.entityId}\` -> \`${f.topCandidate?.imageUrl}\` (${f.topCandidate?.editionOrClass}, status=${f.topCandidate?.httpStatus})`).join('; ')}`,
        `- **FO4 Opaque CDN Regression**: ${regressionFixtures.fo4OpaqueKeyFixtures.map((f) => `\`${f.entityId}\` -> \`${f.topCandidate?.imageUrl}\` (${f.topCandidate?.editionOrClass}, status=${f.topCandidate?.httpStatus})`).join('; ')}`,
        '',
        '---',
        '',
        '## 8. Manual Review Queue (Ambiguous Identities Not Auto-Adopted)',
        '',
        '| Entity ID | Canonical Name | Provider | Candidate Names Observed | Source Page | Reason |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |'
    );

    if (manualReviewQueue.length === 0) {
        mdLines.push('| _None_ | - | - | - | - | - |');
    } else {
        for (const mr of manualReviewQueue) {
            mdLines.push(
                `| \`${mr.entityId}\` | ${mr.canonicalName} | \`${mr.provider}\` | ${mr.candidateNames.join(', ')} | ${mr.sourcePageUrl || 'N/A'} | ${mr.reason} |`
            );
        }
    }

    mdLines.push(
        '',
        '---',
        '',
        '## 9. Still Missing Players (Input for Future Commons Enrichment)',
        '',
        '| Entity ID | Canonical Name | Clubs | Seasons | Audit Reason |',
        '| :--- | :--- | :--- | :--- | :--- |'
    );

    if (stillMissingPlayers.length === 0) {
        mdLines.push('| _None_ | - | - | - | - |');
    } else {
        for (const mp of stillMissingPlayers) {
            mdLines.push(
                `| \`${mp.entityId}\` | ${mp.canonicalName} | ${mp.clubs.join(', ')} | ${mp.seasons.join(', ')} | ${mp.reason} |`
            );
        }
    }

    const reportMdPath = path.join(REPORTS_DIR, 'player-media-provider-audit.md');
    fs.writeFileSync(reportMdPath, mdLines.join('\n') + '\n', 'utf8');

    console.log(`[audit-player-media-providers] Audit complete!`);
    console.log(`  - Sidecar written to: ${sidecarPath}`);
    console.log(`  - JSON report written to: ${reportJsonPath}`);
    console.log(`  - Markdown report written to: ${reportMdPath}`);
}

main().catch((err) => {
    console.error('[audit-player-media-providers] Fatal error:', err);
    process.exit(1);
});

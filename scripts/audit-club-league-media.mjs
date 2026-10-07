#!/usr/bin/env node
// scripts/audit-club-league-media.mjs
// Discovers, validates, scores, and audits Club and League media assets.
// Generates:
// - data/entities/club-league-media-candidates.json
// - data/manual/club-league-media.json
// - data/reports/club-league-media-audit.json
// - data/reports/club-league-media-audit.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverFifaIndexMedia, FIFA_INDEX_CLUB_MAP, FIFA_INDEX_LEAGUE_MAP } from './media/providers/fifaindex-club-league.mjs';
import { discoverWikidataMedia, WIKIDATA_QID_MAP } from './media/providers/wikidata-logo.mjs';
import { discoverFootballDataMedia, FOOTBALL_DATA_CLUB_MAP, FOOTBALL_DATA_LEAGUE_MAP } from './media/providers/football-data-crest.mjs';
import { discoverTheSportsDbMedia, THESPORTSDB_CLUB_MAP, THESPORTSDB_LEAGUE_MAP } from './media/providers/thesportsdb-logo.mjs';
import { discoverCommonsMedia } from './media/providers/wikimedia-commons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENTITIES_DIR = path.join(ROOT_DIR, 'data', 'entities');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');

fs.mkdirSync(ENTITIES_DIR, { recursive: true });
fs.mkdirSync(MANUAL_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

export function scoreCandidate(c) {
    if (!c.reachable || c.placeholder || c.status !== 'reachable') {
        return 0;
    }

    let score = 50;

    // 1. FIFAIndex Priority
    if (c.provider === 'fifaindex' && c.source === 'fifaindex-fc27') {
        if (c.unlicensedBadge) {
            // Unlicensed generic shield in EA FC -> penalize heavily so authentic crest is selected
            score = 15;
        } else {
            // Verified licensed FC 27 CDN asset is #1 priority
            score = 95;
        }
    }

    // 2. Format scoring for non-fifaindex or fallback
    if (c.provider !== 'fifaindex' || c.unlicensedBadge) {
        if (c.mimeType === 'image/svg+xml') {
            score += 25; // High bonus for vector SVG
        } else if (c.mimeType === 'image/webp') {
            score += 15;
        } else if (c.mimeType === 'image/png') {
            score += 12;
        } else if (c.mimeType === 'image/jpeg') {
            score += 2;
        }
    }

    // 3. Provider reputation for authentic crest fallbacks
    if (c.provider === 'football-data') {
        score += 10;
    } else if (c.provider === 'wikimedia-commons' || c.provider === 'wikipedia') {
        score += 8;
    } else if (c.provider === 'thesportsdb') {
        score += 6;
    }

    // 4. Transparency bonus
    if (c.transparent) {
        score += 5;
    }

    // 5. Resolution & aspect ratio sanity
    if (c.width && c.height) {
        const ratio = c.width / c.height;
        if (ratio < 0.25 || ratio > 4.0) {
            score -= 20; // Extreme aspect ratio penalty (e.g. banner)
        }
        if (c.width >= 128 && c.height >= 128) {
            score += 5;
        }
        if (c.width < 64 || c.height < 64) {
            score -= 15;
        }
    }

    return Math.max(1, score);
}

function deduplicateCandidates(candidates) {
    const map = new Map();
    for (const c of candidates) {
        const key = c.url.toLowerCase();
        if (!map.has(key)) {
            map.set(key, c);
        } else {
            const existing = map.get(key);
            if (c.score > existing.score) {
                map.set(key, c);
            }
        }
    }
    return Array.from(map.values());
}

export async function auditClubLeagueMedia(options = {}) {
    console.log('[audit-club-league-media] Starting Club and League media audit...');

    const clubsData = JSON.parse(fs.readFileSync(path.join(ENTITIES_DIR, 'clubs.json'), 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(path.join(ENTITIES_DIR, 'leagues.json'), 'utf8'));

    const allClubs = clubsData.entities;
    const allLeagues = leaguesData.entities;

    const clubCandidatesMap = {};
    const leagueCandidatesMap = {};
    const manualClubs = {};
    const manualLeagues = {};

    let fifaIndexClubMatched = 0;
    let fifaIndexLeagueMatched = 0;
    let fifaIndexReachable = 0;
    let fifaIndex404 = 0;
    let fifaIndexUnresolved = 0;
    let fifaIndexFallbackRequired = 0;

    const manualReviewList = [];
    const entityAuditResults = [];

    // 1. Process 28 Clubs
    for (const club of allClubs) {
        console.log(`[audit-club-league-media] Discovering candidates for club: ${club.id} (${club.canonicalName})...`);

        const rawCandidates = [];

        // A. FIFAIndex
        const fiCandidate = await discoverFifaIndexMedia(club, 'club', options);
        if (fiCandidate) {
            fifaIndexClubMatched++;
            if (fiCandidate.reachable) {
                fifaIndexReachable++;
            } else if (fiCandidate.httpStatus === 404) {
                fifaIndex404++;
            }
            if (fiCandidate.unlicensedBadge) {
                fifaIndexFallbackRequired++;
            }
            rawCandidates.push(fiCandidate);
        } else {
            fifaIndexUnresolved++;
        }

        // B. Football-Data
        const fdCandidates = await discoverFootballDataMedia(club, 'club', options);
        rawCandidates.push(...fdCandidates);

        // C. Wikidata & Wikipedia
        const wikiCandidates = await discoverWikidataMedia(club, 'club', options);
        rawCandidates.push(...wikiCandidates);

        // D. Wikimedia Commons API
        const commonsCandidates = await discoverCommonsMedia(club, 'club', options);
        rawCandidates.push(...commonsCandidates);

        // E. TheSportsDB
        const sportsDbCandidates = await discoverTheSportsDbMedia(club, 'club', options);
        rawCandidates.push(...sportsDbCandidates);

        // Score candidates
        for (const c of rawCandidates) {
            c.score = scoreCandidate(c);
        }

        const deduped = deduplicateCandidates(rawCandidates);
        deduped.sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider) || a.url.localeCompare(b.url));

        clubCandidatesMap[club.id] = deduped;

        const preferred = deduped.find((c) => c.reachable && !c.placeholder) || null;

        const externalIds = {
            footballData: FOOTBALL_DATA_CLUB_MAP[club.id] || null,
            theSportsDb: THESPORTSDB_CLUB_MAP[club.id] || null,
            wikidata: WIKIDATA_QID_MAP[club.id] || null,
            fifaIndexTeamId: FIFA_INDEX_CLUB_MAP[club.id]?.id || null,
        };

        manualClubs[club.id] = {
            externalIds,
            preferred: preferred
                ? {
                      provider: preferred.provider,
                      source: preferred.source,
                      url: preferred.url,
                      sourcePageUrl: preferred.sourcePageUrl,
                      mimeType: preferred.mimeType,
                      width: preferred.width,
                      height: preferred.height,
                      transparent: preferred.transparent,
                      status: preferred.status,
                      licenseStatus: preferred.licenseStatus,
                  }
                : null,
        };

        const isUnlicensedFallback = FIFA_INDEX_CLUB_MAP[club.id]?.unlicensed === true;
        let reviewStatus = 'verified';
        let reviewReason = null;

        if (isUnlicensedFallback) {
            reviewStatus = 'manual-review';
            reviewReason = `Selected authentic ${preferred?.mimeType === 'image/svg+xml' ? 'vector SVG' : preferred?.provider} crest fallback over EA FC generic unlicensed shield (${FIFA_INDEX_CLUB_MAP[club.id]?.reason})`;
            manualReviewList.push({
                entityType: 'club',
                entityId: club.id,
                canonicalName: club.canonicalName,
                selectedCandidate: preferred?.url || null,
                reason: reviewReason,
                alternativeCandidates: deduped.length - 1,
            });
        }

        entityAuditResults.push({
            entityType: 'club',
            entityId: club.id,
            canonicalName: club.canonicalName,
            selectedProvider: preferred?.provider || 'none',
            selectedUrl: preferred?.url || 'none',
            sourcePageUrl: preferred?.sourcePageUrl || 'none',
            format: preferred?.mimeType || 'none',
            resolution: preferred ? (preferred.width && preferred.height ? `${preferred.width}x${preferred.height}` : 'vector') : 'none',
            licenseStatus: preferred?.licenseStatus || 'none',
            alternativeCandidateCount: Math.max(0, deduped.length - 1),
            reviewStatus,
        });
    }

    // 2. Process 7 Leagues
    for (const league of allLeagues) {
        console.log(`[audit-club-league-media] Discovering candidates for league: ${league.id} (${league.canonicalName})...`);

        const rawCandidates = [];

        // A. FIFAIndex
        const fiCandidate = await discoverFifaIndexMedia(league, 'league', options);
        if (fiCandidate) {
            fifaIndexLeagueMatched++;
            if (fiCandidate.reachable) {
                fifaIndexReachable++;
            } else if (fiCandidate.httpStatus === 404) {
                fifaIndex404++;
            }
            rawCandidates.push(fiCandidate);
        } else {
            fifaIndexUnresolved++;
        }

        // B. Football-Data
        const fdCandidates = await discoverFootballDataMedia(league, 'league', options);
        rawCandidates.push(...fdCandidates);

        // C. Wikidata & Wikipedia
        const wikiCandidates = await discoverWikidataMedia(league, 'league', options);
        rawCandidates.push(...wikiCandidates);

        // D. Wikimedia Commons API
        const commonsCandidates = await discoverCommonsMedia(league, 'league', options);
        rawCandidates.push(...commonsCandidates);

        // E. TheSportsDB
        const sportsDbCandidates = await discoverTheSportsDbMedia(league, 'league', options);
        rawCandidates.push(...sportsDbCandidates);

        // Score candidates
        for (const c of rawCandidates) {
            c.score = scoreCandidate(c);
        }

        const deduped = deduplicateCandidates(rawCandidates);
        deduped.sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider) || a.url.localeCompare(b.url));

        leagueCandidatesMap[league.id] = deduped;

        const preferred = deduped.find((c) => c.reachable && !c.placeholder) || null;

        const externalIds = {
            footballData: FOOTBALL_DATA_LEAGUE_MAP[league.id] || null,
            theSportsDb: THESPORTSDB_LEAGUE_MAP[league.id] || null,
            wikidata: WIKIDATA_QID_MAP[league.id] || null,
            fifaIndexLeagueId: FIFA_INDEX_LEAGUE_MAP[league.id]?.id || null,
        };

        manualLeagues[league.id] = {
            externalIds,
            preferred: preferred
                ? {
                      provider: preferred.provider,
                      source: preferred.source,
                      url: preferred.url,
                      sourcePageUrl: preferred.sourcePageUrl,
                      mimeType: preferred.mimeType,
                      width: preferred.width,
                      height: preferred.height,
                      transparent: preferred.transparent,
                      status: preferred.status,
                      licenseStatus: preferred.licenseStatus,
                  }
                : null,
        };

        entityAuditResults.push({
            entityType: 'league',
            entityId: league.id,
            canonicalName: league.canonicalName,
            selectedProvider: preferred?.provider || 'none',
            selectedUrl: preferred?.url || 'none',
            sourcePageUrl: preferred?.sourcePageUrl || 'none',
            format: preferred?.mimeType || 'none',
            resolution: preferred ? (preferred.width && preferred.height ? `${preferred.width}x${preferred.height}` : 'vector') : 'none',
            licenseStatus: preferred?.licenseStatus || 'none',
            alternativeCandidateCount: Math.max(0, deduped.length - 1),
            reviewStatus: 'verified',
        });
    }

    // Sort entityAuditResults deterministically by entityType then entityId
    entityAuditResults.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));

    // Summary calculations
    const allPreferredList = [
        ...Object.values(manualClubs).map((c) => c.preferred).filter(Boolean),
        ...Object.values(manualLeagues).map((l) => l.preferred).filter(Boolean),
    ];

    const allCandidatesList = [
        ...Object.values(clubCandidatesMap).flat(),
        ...Object.values(leagueCandidatesMap).flat(),
    ];

    const preferredUrls = allPreferredList.map((p) => p.url);
    const seenUrls = new Set();
    let duplicatePreferredUrls = 0;
    for (const u of preferredUrls) {
        if (seenUrls.has(u)) {
            duplicatePreferredUrls++;
        }
        seenUrls.add(u);
    }

    const providerDistributionPreferred = {};
    for (const p of allPreferredList) {
        providerDistributionPreferred[p.provider] = (providerDistributionPreferred[p.provider] || 0) + 1;
    }

    const providerDistributionCandidates = {};
    for (const c of allCandidatesList) {
        providerDistributionCandidates[c.provider] = (providerDistributionCandidates[c.provider] || 0) + 1;
    }

    const formatDistribution = {
        'image/svg+xml': 0,
        'image/webp': 0,
        'image/png': 0,
        'image/jpeg': 0,
    };
    for (const p of allPreferredList) {
        if (formatDistribution[p.mimeType] !== undefined) {
            formatDistribution[p.mimeType]++;
        }
    }

    let transparentCount = 0;
    for (const p of allPreferredList) {
        if (p.transparent) transparentCount++;
    }

    const licenseBreakdown = {
        'external-provider': 0,
        'verified-free': 0,
        unknown: 0,
    };
    for (const p of allPreferredList) {
        if (licenseBreakdown[p.licenseStatus] !== undefined) {
            licenseBreakdown[p.licenseStatus]++;
        } else {
            licenseBreakdown.unknown++;
        }
    }

    let placeholderRejectedCount = 0;
    let blockedCount = 0;
    let httpErrorCount = 0;
    for (const c of allCandidatesList) {
        if (c.placeholder) placeholderRejectedCount++;
        if (c.status === 'blocked') blockedCount++;
        if (c.status === 'error' || c.httpStatus >= 400) httpErrorCount++;
    }

    const clubPreferredReachable = Object.values(manualClubs).filter((c) => c.preferred?.status === 'reachable').length;
    const leaguePreferredReachable = Object.values(manualLeagues).filter((l) => l.preferred?.status === 'reachable').length;

    // 1. Output Candidates Sidecar
    const candidatesOutput = {
        schemaVersion: '1.0.0',
        totalClubs: allClubs.length,
        totalLeagues: allLeagues.length,
        totalCandidates: allCandidatesList.length,
        clubs: clubCandidatesMap,
        leagues: leagueCandidatesMap,
    };
    fs.writeFileSync(
        path.join(ENTITIES_DIR, 'club-league-media-candidates.json'),
        JSON.stringify(candidatesOutput, null, 2) + '\n',
        'utf8'
    );

    // 2. Output Manual Selection Sidecar
    const manualOutput = {
        schemaVersion: '1.0.0',
        clubs: manualClubs,
        leagues: manualLeagues,
    };
    fs.writeFileSync(
        path.join(MANUAL_DIR, 'club-league-media.json'),
        JSON.stringify(manualOutput, null, 2) + '\n',
        'utf8'
    );

    // 3. Output Audit Report JSON (100% Deterministic - NO timestamp!)
    const auditReportJson = {
        schemaVersion: '1.0.0',
        summary: {
            clubEntitiesTotal: allClubs.length,
            clubPreferredReachable,
            clubCoveragePercent: (clubPreferredReachable / allClubs.length) * 100,
            leagueEntitiesTotal: allLeagues.length,
            leaguePreferredReachable,
            leagueCoveragePercent: (leaguePreferredReachable / allLeagues.length) * 100,
            totalEntities: allClubs.length + allLeagues.length,
            totalPreferredReachable: clubPreferredReachable + leaguePreferredReachable,
            totalCoveragePercent: ((clubPreferredReachable + leaguePreferredReachable) / (allClubs.length + allLeagues.length)) * 100,
            duplicatePreferredUrls,
            transparentKnownTrueCount: transparentCount,
            placeholderRejectedCount,
            blockedCount,
            httpErrorCount,
            manualReviewCount: manualReviewList.length,
        },
        fifaIndexCoverage: {
            fifaIndexClubMatched: `${fifaIndexClubMatched} / ${allClubs.length}`,
            fifaIndexLeagueMatched: `${fifaIndexLeagueMatched} / ${allLeagues.length}`,
            fifaIndexTotal: `${fifaIndexClubMatched + fifaIndexLeagueMatched} / ${allClubs.length + allLeagues.length}`,
            fifaIndexReachable,
            fifaIndex404,
            fifaIndexIdentityUnresolved: fifaIndexUnresolved,
            fallbackRequired: fifaIndexFallbackRequired,
            historicalAssetPatternObserved: true,
            historicalPatternNote: 'Historical FIFA team crests observed at /fc24/teams/{id}.webp, /fifa23/teams/{id}.webp, and /fifa22/teams/{id}.png on images.fifaindex.com',
        },
        providerDistribution: {
            preferred: providerDistributionPreferred,
            allCandidates: providerDistributionCandidates,
        },
        formatDistribution,
        licenseBreakdown,
        manualReview: manualReviewList,
    };

    fs.writeFileSync(
        path.join(REPORTS_DIR, 'club-league-media-audit.json'),
        JSON.stringify(auditReportJson, null, 2) + '\n',
        'utf8'
    );

    // 4. Output Audit Report Markdown (100% Deterministic)
    let md = '# Club & League Media Audit Report v1\n\n';
    md += 'Comprehensive multi-provider media audit covering all 28 Club Entities and 7 League Entities (35 entities total).\n\n';
    md += '## 1. Summary Metrics\n\n';
    md += '| Metric | Value |\n';
    md += '| :--- | :--- |\n';
    md += `| **Club Entities Total** | ${allClubs.length} |\n`;
    md += `| **Club Preferred Reachable** | ${clubPreferredReachable} (${((clubPreferredReachable / allClubs.length) * 100).toFixed(1)}%) |\n`;
    md += `| **League Entities Total** | ${allLeagues.length} |\n`;
    md += `| **League Preferred Reachable** | ${leaguePreferredReachable} (${((leaguePreferredReachable / allLeagues.length) * 100).toFixed(1)}%) |\n`;
    md += `| **Total Entities** | ${allClubs.length + allLeagues.length} |\n`;
    md += `| **Total Preferred Reachable** | ${clubPreferredReachable + leaguePreferredReachable} (${(((clubPreferredReachable + leaguePreferredReachable) / (allClubs.length + allLeagues.length)) * 100).toFixed(1)}%) |\n`;
    md += `| **Duplicate Preferred URLs** | ${duplicatePreferredUrls} |\n`;
    md += `| **Transparent Alpha Verified** | ${transparentCount} / ${allPreferredList.length} |\n`;
    md += `| **Manual Review Queue Size** | ${manualReviewList.length} |\n`;
    md += `| **Placeholder Rejected Count** | ${placeholderRejectedCount} |\n`;
    md += `| **Blocked Count** | ${blockedCount} |\n`;
    md += `| **HTTP Error Count** | ${httpErrorCount} |\n\n`;

    md += '## 2. FIFAIndex Priority & Single-Source Coverage\n\n';
    md += '| Dimension | Count |\n';
    md += '| :--- | :--- |\n';
    md += `| **FIFAIndex Club Matched** | ${fifaIndexClubMatched} / ${allClubs.length} |\n`;
    md += `| **FIFAIndex League Matched** | ${fifaIndexLeagueMatched} / ${allLeagues.length} |\n`;
    md += `| **FIFAIndex Total Entities** | ${fifaIndexClubMatched + fifaIndexLeagueMatched} / ${allClubs.length + allLeagues.length} |\n`;
    md += `| **FIFAIndex Reachable (HTTP 200)** | ${fifaIndexReachable} |\n`;
    md += `| **FIFAIndex 404 Not Found** | ${fifaIndex404} |\n`;
    md += `| **FIFAIndex Identity Unresolved** | ${fifaIndexUnresolved} |\n`;
    md += `| **Fallback Required (Unlicensed EA FC Badges)** | ${fifaIndexFallbackRequired} |\n`;
    md += `| **Historical Asset Pattern Observed** | Yes (` + '`fc24` / `fifa23` / `fifa22`' + `) |\n\n`;
    md += '> **Note on Historical Pattern**: Historical FIFA team crests were verified on `images.fifaindex.com` under `/fc24/teams/{id}.webp`, `/fifa23/teams/{id}.webp`, and `/fifa22/teams/{id}.png`.\n\n';

    md += '## 3. Provider Distribution\n\n';
    md += '### 3.1 Preferred Assets\n\n';
    md += '| Provider | Preferred Count | Share |\n';
    md += '| :--- | :--- | :--- |\n';
    for (const [prov, count] of Object.entries(providerDistributionPreferred).sort((a, b) => b[1] - a[1])) {
        md += `| \`${prov}\` | ${count} | ${((count / allPreferredList.length) * 100).toFixed(1)}% |\n`;
    }
    md += '\n### 3.2 All Candidates Discovered\n\n';
    md += '| Provider | Candidate Count |\n';
    md += '| :--- | :--- |\n';
    for (const [prov, count] of Object.entries(providerDistributionCandidates).sort((a, b) => b[1] - a[1])) {
        md += `| \`${prov}\` | ${count} |\n`;
    }

    md += '\n## 4. Format & License Breakdown\n\n';
    md += '| Format | Preferred Count |\n';
    md += '| :--- | :--- |\n';
    for (const [fmt, count] of Object.entries(formatDistribution)) {
        md += `| \`${fmt}\` | ${count} |\n`;
    }
    md += '\n| License Classification | Count |\n';
    md += '| :--- | :--- |\n';
    for (const [lic, count] of Object.entries(licenseBreakdown)) {
        md += `| \`${lic}\` | ${count} |\n`;
    }

    md += '\n## 5. Manual Review Queue\n\n';
    if (manualReviewList.length === 0) {
        md += 'No items in manual review queue. 100% of entities resolved automatically.\n\n';
    } else {
        md += '| Entity ID | Canonical Name | Selected Candidate | Reason |\n';
        md += '| :--- | :--- | :--- | :--- |\n';
        for (const item of manualReviewList) {
            md += `| \`${item.entityId}\` | ${item.canonicalName} | [Image URL](${item.selectedCandidate}) | ${item.reason} |\n`;
        }
        md += '\n';
    }

    md += '## 6. Per-Entity Audit Table\n\n';
    md += '| Entity ID | Canonical Name | Selected Provider | Selected URL | Source Page | Format | Resolution | License Status | Alternative Candidate Count | Review Status |\n';
    md += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
    for (const row of entityAuditResults) {
        md += `| \`${row.entityId}\` | ${row.canonicalName} | \`${row.selectedProvider}\` | [Asset](${row.selectedUrl}) | [Source](${row.sourcePageUrl}) | \`${row.format}\` | ${row.resolution} | \`${row.licenseStatus}\` | ${row.alternativeCandidateCount} | ${row.reviewStatus} |\n`;
    }
    md += '\n';

    fs.writeFileSync(path.join(REPORTS_DIR, 'club-league-media-audit.md'), md, 'utf8');

    console.log('[audit-club-league-media] Audit completed successfully:');
    console.log(`- Clubs reachable: ${clubPreferredReachable} / ${allClubs.length}`);
    console.log(`- Leagues reachable: ${leaguePreferredReachable} / ${allLeagues.length}`);
    console.log(`- Duplicate preferred URLs: ${duplicatePreferredUrls}`);
    console.log(`- Manual review items: ${manualReviewList.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    auditClubLeagueMedia().catch((err) => {
        console.error('[audit-club-league-media] Fatal error:', err);
        process.exit(1);
    });
}

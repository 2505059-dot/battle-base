#!/usr/bin/env node
// scripts/validate-data.mjs
// Comprehensive data integrity, schema, alias, and provenance validator for:
// - public/data/team-seasons.js
// - data/manual/{season-pool,club-aliases,player-aliases,overrides}.json
// - data/reports/{build-report,unresolved}.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAliasIndex } from './lib/normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MANUAL_DIR = path.join(ROOT_DIR, 'data', 'manual');
const REPORTS_DIR = path.join(ROOT_DIR, 'data', 'reports');
const TEAM_SEASONS_JS = path.join(ROOT_DIR, 'public', 'data', 'team-seasons.js');

const ALLOWED_POSITIONS = new Set(['GK', 'DF', 'MF', 'FW']);
const STAT_FIELDS = ['overall', 'attack', 'creation', 'defense', 'physical', 'goalkeeping'];

async function main() {
    const errors = [];
    const warnings = [];

    // 1. Load manual configuration & reports
    const seasonPool = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'season-pool.json'), 'utf8')
    );
    const clubAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'club-aliases.json'), 'utf8')
    );
    const playerAliases = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'player-aliases.json'), 'utf8')
    );
    const overridesConfig = JSON.parse(
        fs.readFileSync(path.join(MANUAL_DIR, 'overrides.json'), 'utf8')
    );
    const buildReport = JSON.parse(
        fs.readFileSync(path.join(REPORTS_DIR, 'build-report.json'), 'utf8')
    );
    const unresolvedReport = JSON.parse(
        fs.readFileSync(path.join(REPORTS_DIR, 'unresolved.json'), 'utf8')
    );

    // 2. Import generated public/data/team-seasons.js
    const tsModule = await import(pathToFileURL(TEAM_SEASONS_JS).href);
    const {
        RAW_TEAM_SEASONS,
        TEAM_SEASONS,
        LEAGUES,
        getLeagues,
        getClubsByLeague,
        getYearsByLeagueAndClub,
        findTeamSeason,
    } = tsModule;

    if (!Array.isArray(TEAM_SEASONS) || !Array.isArray(RAW_TEAM_SEASONS)) {
        errors.push('public/data/team-seasons.js does not export valid TEAM_SEASONS / RAW_TEAM_SEASONS arrays.');
    }

    // 3. Check allowlist consistency (season-pool.json vs TEAM_SEASONS)
    if (TEAM_SEASONS.length !== seasonPool.length) {
        errors.push(
            `TeamSeason count mismatch: TEAM_SEASONS has ${TEAM_SEASONS.length}, season-pool.json has ${seasonPool.length}.`
        );
    }

    const poolMap = new Map(seasonPool.map((s) => [s.id, s]));

    // 4. Check alias conflicts in club-aliases.json and player-aliases.json
    const knownClubs = [...new Set(seasonPool.map((s) => s.club))];
    const knownPlayers = [
        ...new Set(TEAM_SEASONS.flatMap((ts) => ts.players.map((p) => p.name))),
    ];
    const clubAliasCheck = buildAliasIndex(clubAliases, knownClubs);
    const playerAliasCheck = buildAliasIndex(playerAliases, knownPlayers);

    for (const conflict of clubAliasCheck.conflicts) {
        errors.push(
            `Club alias conflict: "${conflict.alias}" maps to both "${conflict.canonicalA}" and "${conflict.canonicalB}".`
        );
    }
    for (const conflict of playerAliasCheck.conflicts) {
        errors.push(
            `Player alias conflict: "${conflict.alias}" maps to both "${conflict.canonicalA}" and "${conflict.canonicalB}".`
        );
    }

    // 5. Check manual overrides have valid reason
    for (const [key, ovr] of Object.entries(overridesConfig.overrides || {})) {
        if (!ovr || typeof ovr.reason !== 'string' || !ovr.reason.trim()) {
            errors.push(`Manual override "${key}" is missing a required non-empty 'reason' explanation.`);
        }
    }

    // 6. Validate TeamSeasons and PlayerSeasons
    const seenTeamSeasonIds = new Set();
    const seenPlayerSeasonIds = new Set();
    const reportByPlayerId = new Map((buildReport.players || []).map((p) => [p.id, p]));

    for (const ts of TEAM_SEASONS) {
        // duplicate TeamSeason id
        if (!ts.id || typeof ts.id !== 'string') {
            errors.push(`TeamSeason missing valid id: ${JSON.stringify(ts)}`);
        } else if (seenTeamSeasonIds.has(ts.id)) {
            errors.push(`Duplicate TeamSeason id: "${ts.id}".`);
        } else {
            seenTeamSeasonIds.add(ts.id);
        }

        // missing league / club / year
        if (!ts.league || typeof ts.league !== 'string' || !ts.league.trim()) {
            errors.push(`TeamSeason "${ts.id}" is missing league.`);
        }
        if (!ts.club || typeof ts.club !== 'string' || !ts.club.trim()) {
            errors.push(`TeamSeason "${ts.id}" is missing club.`);
        }
        if (!Number.isInteger(ts.year) || ts.year < 1950 || ts.year > 2030) {
            errors.push(`TeamSeason "${ts.id}" has missing or invalid year: ${ts.year}.`);
        }

        // club/year consistency with allowlist and slug id
        const poolEntry = poolMap.get(ts.id);
        if (!poolEntry) {
            errors.push(`TeamSeason "${ts.id}" is not allowlisted in season-pool.json.`);
        } else if (
            poolEntry.league !== ts.league ||
            poolEntry.club !== ts.club ||
            poolEntry.year !== ts.year
        ) {
            errors.push(
                `Club/year/league mismatch between TEAM_SEASONS and season-pool.json for "${ts.id}".`
            );
        }

        if (!ts.id.endsWith(`-${ts.year}`)) {
            errors.push(`TeamSeason id "${ts.id}" is inconsistent with year ${ts.year}.`);
        }

        // Positional minimums per TeamSeason: >= 1 GK, >= 2 DF, >= 2 MF, >= 2 FW
        const posCounts = { GK: 0, DF: 0, MF: 0, FW: 0 };

        for (const player of ts.players) {
            // duplicate PlayerSeason id
            if (!player.id || typeof player.id !== 'string') {
                errors.push(`Player in "${ts.id}" is missing id.`);
            } else if (seenPlayerSeasonIds.has(player.id)) {
                errors.push(`Duplicate PlayerSeason id: "${player.id}".`);
            } else {
                seenPlayerSeasonIds.add(player.id);
            }

            // player name non-empty
            if (!player.name || typeof player.name !== 'string' || !player.name.trim()) {
                errors.push(`Player "${player.id}" has an empty or invalid name.`);
            }

            // club/year/league consistency on normalized player object
            if (player.club !== ts.club || player.year !== ts.year || player.league !== ts.league) {
                errors.push(
                    `Player "${player.id}" (${player.name}) has inconsistent club/year/league with parent TeamSeason "${ts.id}".`
                );
            }

            // positions validity
            if (!Array.isArray(player.positions) || player.positions.length === 0) {
                errors.push(`Player "${player.id}" (${player.name}) has empty positions.`);
            } else {
                const seenPos = new Set();
                for (const pos of player.positions) {
                    if (!ALLOWED_POSITIONS.has(pos)) {
                        errors.push(
                            `Player "${player.id}" (${player.name}) has invalid position "${pos}".`
                        );
                    }
                    if (seenPos.has(pos)) {
                        errors.push(
                            `Player "${player.id}" (${player.name}) has duplicate position "${pos}".`
                        );
                    }
                    seenPos.add(pos);
                    if (posCounts[pos] !== undefined) {
                        posCounts[pos]++;
                    }
                }
            }

            // overall present + all stats integers in 1..99
            if (player.overall === undefined || player.overall === null) {
                errors.push(`Player "${player.id}" (${player.name}) is missing overall.`);
            }
            for (const stat of STAT_FIELDS) {
                const val = player[stat];
                if (!Number.isInteger(val) || val < 1 || val > 99) {
                    errors.push(
                        `Player "${player.id}" (${player.name}) has invalid ${stat}=${val} (must be integer in 1..99).`
                    );
                }
            }

            // Provenance source presence in build-report.json
            const rep = reportByPlayerId.get(player.id);
            if (!rep || !rep.provenance) {
                errors.push(`Missing provenance entry in build-report.json for "${player.id}".`);
            } else {
                const prov = rep.provenance;
                if (
                    !prov.squadSource ||
                    !prov.positionSource ||
                    !prov.overallSource ||
                    !prov.technicalSource
                ) {
                    errors.push(
                        `Incomplete provenance sources for "${player.id}" (${player.name}).`
                    );
                }
            }
        }

        if (posCounts.GK < 1) {
            errors.push(`TeamSeason "${ts.id}" has ${posCounts.GK} GK (minimum 1 required).`);
        }
        if (posCounts.DF < 2) {
            errors.push(`TeamSeason "${ts.id}" has ${posCounts.DF} DF (minimum 2 required).`);
        }
        if (posCounts.MF < 2) {
            errors.push(`TeamSeason "${ts.id}" has ${posCounts.MF} MF (minimum 2 required).`);
        }
        if (posCounts.FW < 2) {
            errors.push(`TeamSeason "${ts.id}" has ${posCounts.FW} FW (minimum 2 required).`);
        }

        // Verify query helper functions work for every TeamSeason
        if (!getLeagues().includes(ts.league)) {
            errors.push(`getLeagues() missing "${ts.league}".`);
        }
        if (!getClubsByLeague(ts.league).includes(ts.club)) {
            errors.push(`getClubsByLeague("${ts.league}") missing "${ts.club}".`);
        }
        if (!getYearsByLeagueAndClub(ts.league, ts.club).includes(ts.year)) {
            errors.push(`getYearsByLeagueAndClub("${ts.league}", "${ts.club}") missing ${ts.year}.`);
        }
        if (!findTeamSeason(ts.league, ts.club, ts.year)) {
            errors.push(`findTeamSeason("${ts.league}", "${ts.club}", ${ts.year}) returned null.`);
        }
    }

    // 7. Analyze unresolved & coverage breakdowns
    const unresolvedItems = unresolvedReport.items || [];
    const unmatchedSquadPlayers = unresolvedItems.filter((i) =>
        i.reasons.includes('unmatched_squad_player')
    );
    const unmatchedFifaPlayersPost2004 = unresolvedItems.filter(
        (i) =>
            i.year >= 2005 &&
            (i.reasons.includes('unmatched_fifa_player_or_incomplete_attributes') ||
                i.reasons.includes('ambiguous_homonym_collision'))
    );
    const pre2005Players = unresolvedItems.filter((i) =>
        i.reasons.includes('season_predates_fifa_05_dataset')
    );
    const uncertainFuzzyMatches = unresolvedItems.filter((i) =>
        i.reasons.includes('fuzzy_match_uncertain')
    );

    if (unmatchedSquadPlayers.length > 0) {
        warnings.push(
            `Unmatched squad players (${unmatchedSquadPlayers.length}): ${unmatchedSquadPlayers
                .map((i) => `${i.playerName} (${i.teamSeasonId})`)
                .join(', ')}`
        );
    }
    if (unmatchedFifaPlayersPost2004.length > 0) {
        warnings.push(
            `Unmatched/ambiguous 2005-2024 FIFA players (${unmatchedFifaPlayersPost2004.length}): ${unmatchedFifaPlayersPost2004
                .map((i) => `${i.playerName} (${i.teamSeasonId}: ${i.reasons.join('+')})`)
                .join(', ')}`
        );
    }
    if (uncertainFuzzyMatches.length > 0) {
        warnings.push(
            `Uncertain fuzzy matches rejected (${uncertainFuzzyMatches.length}): ${uncertainFuzzyMatches
                .map((i) => `${i.playerName} -> ${i.fuzzySuggestion?.candidate}`)
                .join(', ')}`
        );
    }

    const totalPlayers = seenPlayerSeasonIds.size;
    const { verifiedExternal, manualOverride, fallbackGenerated, unresolved, squadRosterVerified } =
        buildReport.summary.counts;

    console.log('==========================================================');
    console.log(' Football Historical Dataset Validation & Coverage Report ');
    console.log('==========================================================');
    console.log(`Leagues:                  ${LEAGUES.length}`);
    console.log(`Clubs:                    ${knownClubs.length}`);
    console.log(`TeamSeasons:              ${seenTeamSeasonIds.size}`);
    console.log(`PlayerSeasons:            ${totalPlayers}`);
    console.log('----------------------------------------------------------');
    console.log('Provenance & Coverage Breakdown:');
    console.log(
        `  squad roster verified:  ${squadRosterVerified} / ${totalPlayers} (${buildReport.summary.percentages.squadRosterVerifiedPct}%)`
    );
    console.log(
        `  verified external:      ${verifiedExternal} / ${totalPlayers} (${buildReport.summary.percentages.verifiedExternalPct}%)`
    );
    console.log(
        `  manual override:        ${manualOverride} / ${totalPlayers} (${buildReport.summary.percentages.manualOverridePct}%)`
    );
    console.log(
        `  fallback-generated:     ${fallbackGenerated} / ${totalPlayers} (${buildReport.summary.percentages.fallbackGeneratedPct}%)`
    );
    console.log(`  unresolved:             ${unresolved}`);
    console.log(`    - pre-2005 (no FIFA): ${pre2005Players.length}`);
    console.log(`    - 2005-2024 FIFA gap: ${unmatchedFifaPlayersPost2004.length}`);
    console.log(`    - unmatched squad:    ${unmatchedSquadPlayers.length}`);
    console.log(`    - uncertain fuzzy:    ${uncertainFuzzyMatches.length}`);
    console.log('----------------------------------------------------------');

    if (warnings.length > 0) {
        console.log(`Diagnostics (${warnings.length}):`);
        for (const w of warnings) {
            console.log(`  [WARN] ${w}`);
        }
        console.log('----------------------------------------------------------');
    }

    if (errors.length > 0) {
        console.error(`Validation FAILED with ${errors.length} error(s):`);
        for (const err of errors) {
            console.error(`  [ERROR] ${err}`);
        }
        process.exit(1);
    }

    console.log('Validation PASSED: 0 schema, constraint, or alias errors.');
}

main().catch((err) => {
    console.error('[validate-data] Fatal error:', err);
    process.exit(1);
});

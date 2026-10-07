#!/usr/bin/env node
// scripts/build-club-league-media-index.mjs
// Reads data/entities/clubs.json and data/entities/leagues.json,
// and outputs deterministic public/data/club-league-media.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CLUBS_PATH = path.join(ROOT_DIR, 'data', 'entities', 'clubs.json');
const LEAGUES_PATH = path.join(ROOT_DIR, 'data', 'entities', 'leagues.json');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'data', 'club-league-media.js');

export function buildClubLeagueMediaIndex() {
    console.log('[build-club-league-media-index] Building runtime media index...');

    if (!fs.existsSync(CLUBS_PATH) || !fs.existsSync(LEAGUES_PATH)) {
        console.error('[build-club-league-media-index] Missing clubs.json or leagues.json');
        process.exit(1);
    }

    const clubsData = JSON.parse(fs.readFileSync(CLUBS_PATH, 'utf8'));
    const leaguesData = JSON.parse(fs.readFileSync(LEAGUES_PATH, 'utf8'));

    const clubMedia = {};
    const leagueMedia = {};
    const clubCanonicalToId = {};
    const leagueCanonicalToId = {};

    // Sort clubs deterministically by id
    const sortedClubs = [...clubsData.entities].sort((a, b) => a.id.localeCompare(b.id));
    for (const c of sortedClubs) {
        clubMedia[c.id] = {
            canonicalName: c.canonicalName,
            crest: c.media?.crest
                ? {
                      url: c.media.crest.url,
                      provider: c.media.crest.provider,
                      licenseStatus: c.media.crest.licenseStatus || 'external-provider',
                  }
                : null,
        };
        clubCanonicalToId[c.canonicalName] = c.id;
    }

    // Sort leagues deterministically by id
    const sortedLeagues = [...leaguesData.entities].sort((a, b) => a.id.localeCompare(b.id));
    for (const l of sortedLeagues) {
        leagueMedia[l.id] = {
            canonicalName: l.canonicalName,
            emblem: l.media?.emblem
                ? {
                      url: l.media.emblem.url,
                      provider: l.media.emblem.provider,
                      licenseStatus: l.media.emblem.licenseStatus || 'external-provider',
                  }
                : null,
        };
        leagueCanonicalToId[l.canonicalName] = l.id;
    }

    // Sort canonical mapping keys deterministically
    const sortedClubCanonicalToId = {};
    for (const k of Object.keys(clubCanonicalToId).sort()) {
        sortedClubCanonicalToId[k] = clubCanonicalToId[k];
    }

    const sortedLeagueCanonicalToId = {};
    for (const k of Object.keys(leagueCanonicalToId).sort()) {
        sortedLeagueCanonicalToId[k] = leagueCanonicalToId[k];
    }

    const jsContent = `// public/data/club-league-media.js
// Auto-generated runtime index for Club Crests and League Emblems.
// Deterministic build from data/entities/clubs.json and data/entities/leagues.json.

export const CLUB_MEDIA = ${JSON.stringify(clubMedia, null, 2)};

export const LEAGUE_MEDIA = ${JSON.stringify(leagueMedia, null, 2)};

export const CLUB_CANONICAL_TO_ID = ${JSON.stringify(sortedClubCanonicalToId, null, 2)};

export const LEAGUE_CANONICAL_TO_ID = ${JSON.stringify(sortedLeagueCanonicalToId, null, 2)};
`;

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, jsContent, 'utf8');

    console.log(`[build-club-league-media-index] Successfully wrote ${OUTPUT_PATH}`);
    console.log(`- Clubs indexed: ${sortedClubs.length}`);
    console.log(`- Leagues indexed: ${sortedLeagues.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildClubLeagueMediaIndex();
}

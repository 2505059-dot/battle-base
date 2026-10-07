#!/usr/bin/env node
// scripts/check-entity-localization-leaks.mjs
// Audits UI render boundary files for raw canonical football entity name leaks:
// - public/game/draft/ui.js
// - public/game/match/ui.js
// - public/game/shared/event-formatters.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const CHECKS = [
    {
        file: 'public/game/draft/ui.js',
        forbiddenPatterns: [
            {
                regex: /el\(\s*['"]div['"]\s*,\s*['"]fd-card-name['"]\s*,\s*player\.name\s*\)/,
                description: 'Raw player.name passed directly to .fd-card-name',
            },
            {
                regex: /el\(\s*['"]strong['"]\s*,\s*['"]fd-meta-val['"]\s*,\s*roll\.club\s*\)/,
                description: 'Raw roll.club passed directly to .fd-meta-val',
            },
            {
                regex: /el\(\s*['"]strong['"]\s*,\s*['"]fd-meta-val['"]\s*,\s*roll\.league\s*\)/,
                description: 'Raw roll.league passed directly to .fd-meta-val',
            },
            {
                regex: /t\(\s*['"]draft\.rerollUnavailableYear['"]\s*,\s*\{\s*club:\s*currentRoll\.club\s*\}\s*\)/,
                description: 'Raw currentRoll.club passed to draft.rerollUnavailableYear',
            },
            {
                regex: /el\(\s*['"]span['"]\s*,\s*['"]fd-ready-player-name['"]\s*,\s*p\.name\s*\)/,
                description: 'Raw p.name passed directly to .fd-ready-player-name',
            },
            {
                regex: /el\(\s*['"]span['"]\s*,\s*['"]fd-slot-player-name['"]\s*,\s*p\.name\s*\)/,
                description: 'Raw p.name passed directly to .fd-slot-player-name',
            },
            {
                regex: /\$\{p\.club\}/,
                description: 'Raw ${p.club} interpolated without formatClubName()',
            },
        ],
        requiredPatterns: [
            {
                regex: /getPlayerDisplayName\(\s*player\.name\s*\)/,
                description: 'Draft card uses getPlayerDisplayName(player.name)',
            },
            {
                regex: /formatLeagueName\(\s*roll\.league\s*\)/,
                description: 'Draft roll metadata uses formatLeagueName(roll.league)',
            },
            {
                regex: /formatClubName\(\s*roll\.club\s*\)/,
                description: 'Draft roll metadata uses formatClubName(roll.club)',
            },
            {
                regex: /formatClubName\(\s*currentRoll\.club\s*\)/,
                description: 'Year reroll hint uses formatClubName(currentRoll.club)',
            },
            {
                regex: /formatPlayerName\(\s*p\.name\s*\)/,
                description: 'Roster slots use formatPlayerName(p.name)',
            },
            {
                regex: /formatClubName\(\s*p\.club\s*\)/,
                description: 'Roster slot metadata uses formatClubName(p.club)',
            },
        ],
    },
    {
        file: 'public/game/match/ui.js',
        forbiddenPatterns: [
            {
                regex: /el\(\s*['"]span['"]\s*,\s*['"]fd-reveal-player-name['"]\s*,\s*p\.name\s*\)/,
                description: 'Raw p.name passed directly to .fd-reveal-player-name',
            },
            {
                regex: /\$\{p\.club\}/,
                description: 'Raw ${p.club} interpolated in Reveal without formatClubName()',
            },
        ],
        requiredPatterns: [
            {
                regex: /formatPlayerName\(\s*p\.name\s*\)/,
                description: 'Reveal lineup uses formatPlayerName(p.name)',
            },
            {
                regex: /formatClubName\(\s*p\.club\s*\)/,
                description: 'Reveal lineup uses formatClubName(p.club)',
            },
        ],
    },
    {
        file: 'public/game/shared/event-formatters.js',
        forbiddenPatterns: [
            {
                regex: /club:\s*event\.club\b/,
                description: 'Raw event.club passed into history template',
            },
            {
                regex: /playerName:\s*event\.playerName\b/,
                description: 'Raw event.playerName passed into history.picked template',
            },
            {
                regex: /player:\s*event\.playerName\b/,
                description: 'Raw event.playerName passed into match event template',
            },
            {
                regex: /defender:\s*event\.defenderName\b/,
                description: 'Raw event.defenderName passed into match event template',
            },
            {
                regex: /goalkeeper:\s*event\.goalkeeperName\b/,
                description: 'Raw event.goalkeeperName passed into match event template',
            },
            {
                regex: /assist:\s*event\.assistName\b/,
                description: 'Raw event.assistName passed into match event template',
            },
        ],
        requiredPatterns: [
            {
                regex: /formatClubName\(\s*event\.club/,
                description: 'Draft history uses formatClubName(event.club)',
            },
            {
                regex: /formatPlayerName\(\s*event\.playerName/,
                description: 'History & match events use formatPlayerName(event.playerName)',
            },
            {
                regex: /formatPlayerName\(\s*event\.defenderName/,
                description: 'Match events use formatPlayerName(event.defenderName)',
            },
            {
                regex: /formatPlayerName\(\s*event\.goalkeeperName/,
                description: 'Match events use formatPlayerName(event.goalkeeperName)',
            },
            {
                regex: /formatPlayerName\(\s*event\.assistName/,
                description: 'Match events use formatPlayerName(event.assistName)',
            },
        ],
    },
];

function main() {
    const errors = [];

    for (const check of CHECKS) {
        const absPath = path.join(ROOT_DIR, check.file);
        if (!fs.existsSync(absPath)) {
            errors.push(`Missing file: ${check.file}`);
            continue;
        }
        const content = fs.readFileSync(absPath, 'utf8');

        for (const rule of check.forbiddenPatterns) {
            if (rule.regex.test(content)) {
                errors.push(`[LEAK] ${check.file}: ${rule.description}`);
            }
        }

        for (const req of check.requiredPatterns) {
            if (!req.regex.test(content)) {
                errors.push(`[MISSING FORMATTER] ${check.file}: ${req.description}`);
            }
        }
    }

    if (errors.length > 0) {
        console.error(`[check-entity-localization-leaks] FAILED with ${errors.length} issue(s):`);
        for (const err of errors) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    console.log(
        '[check-entity-localization-leaks] PASS — Zero raw entity name leaks across draft/ui.js, match/ui.js, and event-formatters.js.'
    );
    process.exit(0);
}

main();

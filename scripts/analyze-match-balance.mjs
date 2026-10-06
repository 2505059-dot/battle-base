#!/usr/bin/env node
// Formal 11v11 Match Balance & Calibration Analysis Tool (scripts/analyze-match-balance.mjs)
// Deterministic Monte Carlo analysis suite for Battle Base / Golden Road LoL.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setLocale } from '../public/i18n/i18n.js';
import { SLOTS } from '../public/game/shared/constants.js';
import { calculateTeamProfile } from '../public/game/match/team-profile.js';
import { generateMatchScript } from '../public/game/match/engine.js';
import {
    buildHistoricalTierRosters,
    buildControlledSyntheticRosters,
    runBatchMatches,
    runSeatSwapExperiment,
    buildControlBaselineRecords,
    runPairedSensitivity,
    analyzeMatchupClamps,
    analyzePopulationClampGrid,
    runIntraRoleQualityTest,
} from './lib/match-balance.mjs';

function parseArgs(argv) {
    const opts = {
        matches: 10000,
        mirrorMatches: null,
        baseSeed: 20261006,
        jsonOut: null,
    };

    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--matches=')) {
            opts.matches = Math.max(100, Number(arg.split('=')[1]) || 10000);
        } else if (arg.startsWith('--mirror-matches=')) {
            opts.mirrorMatches = Math.max(1000, Number(arg.split('=')[1]) || 50000);
        } else if (arg.startsWith('--base-seed=')) {
            opts.baseSeed = (Number(arg.split('=')[1]) || 20261006) >>> 0;
        } else if (arg.startsWith('--json-out=')) {
            opts.jsonOut = arg.split('=')[1];
        }
    }

    if (!opts.mirrorMatches) {
        opts.mirrorMatches = Math.max(50000, opts.matches);
    }

    return opts;
}

function fmt(num, digits = 2) {
    return Number(num).toFixed(digits);
}

function fmtSigned(num, digits = 2) {
    const n = Number(num);
    return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

function formatRosterSummary(roster) {
    const profile = calculateTeamProfile(roster);
    const players = SLOTS.map((s) => `${s}:${roster[s]?.name}(${roster[s]?.overall})`).join(', ');
    return {
        profile,
        players,
    };
}

function main() {
    const opts = parseArgs(process.argv);
    const startTime = Date.now();

    console.log('==================================================================');
    console.log(' BATTLE BASE — 11v11 MATCH BALANCE & CALIBRATION v1 ANALYZER');
    console.log('==================================================================');
    console.log(
        `Config: matches=${opts.matches}, mirrorMatches=${opts.mirrorMatches}, baseSeed=${opts.baseSeed}`
    );

    // 1. Build Historical Tier Rosters & Synthetic Rosters
    const tiers = buildHistoricalTierRosters();
    const controlRoster = tiers.Average;
    const synthetics = buildControlledSyntheticRosters(controlRoster);

    console.log('\n=== HISTORICAL TIER ROSTERS (DETERMINISTIC QUANTILE SELECTION) ===');
    for (const [tierName, roster] of Object.entries(tiers)) {
        const info = formatRosterSummary(roster);
        const p = info.profile;
        console.log(
            `${tierName.padEnd(8)} | OVR ${fmt(p.overall, 1)} | ATK ${fmt(p.attack, 1)} | CRE ${fmt(p.creation, 1)} | DEF ${fmt(p.defense, 1)} | PHY ${fmt(p.physical, 1)} | GK ${fmt(p.goalkeeping, 1)}`
        );
        console.log(`  Lineup: ${info.players}`);
    }

    // 2. Mirror Fairness & Baseline Match Shape (50,000+ matches)
    console.log(`\n=== 1. MIRROR FAIRNESS & BASELINE MATCH SHAPE (N=${opts.mirrorMatches}) ===`);
    const mirror = runBatchMatches(
        synthetics.CONTROL,
        synthetics.CONTROL,
        opts.mirrorMatches,
        opts.baseSeed
    );

    console.log(`Matches:        ${mirror.matches}`);
    console.log(
        `A Win:          ${fmt(mirror.winRateA)}% (${mirror.winsA}) [95% CI: ±${fmt(mirror.winRateACI.ci95 * 100)}%]`
    );
    console.log(`Draw:           ${fmt(mirror.drawRate)}% (${mirror.draws})`);
    console.log(`B Win:          ${fmt(mirror.winRateB)}% (${mirror.winsB})`);
    console.log(`Seat Delta A-B: ${fmtSigned(mirror.seatWinDelta)} pp`);
    console.log(
        `Points/Match A: ${fmt(mirror.pointsPerMatchA, 4)} (±${fmt(mirror.pointsCI.ci95, 4)})`
    );
    console.log(
        `Possession A/B: ${fmt(mirror.avgPossessionA)}% / ${fmt(mirror.avgPossessionB)}% (P10=${mirror.possessionPercentilesA.P10}%, P50=${mirror.possessionPercentilesA.P50}%, P90=${mirror.possessionPercentilesA.P90}%)`
    );
    console.log(`Attack Share A: ${fmt(mirror.attackShareA)}%`);

    console.log('\n--- MATCH SHAPE ---');
    console.log(
        `Avg Goals:      Total ${fmt(mirror.avgTotalGoals)} (A: ${fmt(mirror.avgGoalsA)}, B: ${fmt(mirror.avgGoalsB)})`
    );
    console.log(
        `Avg Shots:      Total ${fmt(mirror.avgTotalShots)} (A: ${fmt(mirror.avgShotsA)}, B: ${fmt(mirror.avgShotsB)}) | Team P10=${mirror.shotsPercentilesTeam.P10}, P25=${mirror.shotsPercentilesTeam.P25}, P50=${mirror.shotsPercentilesTeam.P50}, P75=${mirror.shotsPercentilesTeam.P75}, P90=${mirror.shotsPercentilesTeam.P90}`
    );
    console.log(
        `Avg SOT:        Total ${fmt(mirror.avgTotalOnTarget)} (A: ${fmt(mirror.avgOnTargetA)}, B: ${fmt(mirror.avgOnTargetB)}) | Team P10=${mirror.sotPercentilesTeam.P10}, P25=${mirror.sotPercentilesTeam.P25}, P50=${mirror.sotPercentilesTeam.P50}, P75=${mirror.sotPercentilesTeam.P75}, P90=${mirror.sotPercentilesTeam.P90}`
    );
    console.log(`SOT / Shot:     ${fmt(mirror.shotOnTargetRateTotal)}%`);
    console.log(`Goal / Shot:    ${fmt(mirror.goalPerShotTotal)}%`);
    console.log(`Goal / SOT:     ${fmt(mirror.goalPerOnTargetTotal)}%`);
    console.log(
        `Avg Saves:      A: ${fmt(mirror.avgSavesA)} (${fmt(mirror.saveRateA)}%), B: ${fmt(mirror.avgSavesB)} (${fmt(mirror.saveRateB)}%)`
    );
    console.log(
        `Clean Sheets:   Team A ${fmt(mirror.cleanSheetRateA)}%, Team B ${fmt(mirror.cleanSheetRateB)}%, Any CS ${fmt(mirror.anyCleanSheetRate)}%`
    );
    console.log(
        `Key Rates:      0-0: ${fmt(mirror.zeroZeroRate)}% | 1-goal margin: ${fmt(mirror.oneGoalGameRate)}% | 3+ goals: ${fmt(mirror.threePlusGoalRate)}% | 5+ goals: ${fmt(mirror.fivePlusGoalRate)}% | 7+ goals: ${fmt(mirror.sevenPlusGoalRate)}% | 5+ margin blowout: ${fmt(mirror.blowout5PlusRate)}%`
    );
    console.log(
        `Scorelines:     0-0=${fmt(mirror.specificScorelines['0-0'])}%, 1-0/0-1=${fmt(mirror.specificScorelines['1-0 / 0-1'])}%, 1-1=${fmt(mirror.specificScorelines['1-1'])}%, 2-1/1-2=${fmt(mirror.specificScorelines['2-1 / 1-2'])}%, 2-2=${fmt(mirror.specificScorelines['2-2'])}%`
    );
    console.log(
        `Top Scorelines: ${mirror.topScorelines.map((s) => `${s.scoreline} (${fmt(s.pct, 1)}%)`).join(', ')}`
    );
    console.log(
        `Goals Hist:     ${Object.entries(mirror.totalGoalsHistogram)
            .map(([k, v]) => `${k}g:${fmt(v, 1)}%`)
            .join(' | ')}`
    );

    console.log('\n--- ROLE EVENT DISTRIBUTION (MIRROR 50K+) ---');
    for (const [cat, dist] of Object.entries(mirror.roleDistribution)) {
        console.log(
            `${cat.padEnd(15)} | FW: ${fmt(dist.FW).padStart(5)}% | MF: ${fmt(dist.MF).padStart(5)}% | DF: ${fmt(dist.DF).padStart(5)}% | GK: ${fmt(dist.GK).padStart(5)}% (N=${dist.counts.total})`
        );
    }

    // 3. Seat Swap Test
    console.log(`\n=== 2. SEAT SWAP SYMMETRY TEST (N=${opts.matches} per seat) ===`);
    const seatSwapStrongAvg = runSeatSwapExperiment(
        tiers.Strong,
        tiers.Average,
        opts.matches,
        opts.baseSeed
    );
    console.log(
        `Strong vs Average | Strong as A Win: ${fmt(seatSwapStrongAvg.xWinAsA)}% | Strong as B Win: ${fmt(seatSwapStrongAvg.xWinAsB)}% | Overall Win: ${fmt(seatSwapStrongAvg.xOverallWinRate)}% | Seat Delta: ${fmtSigned(seatSwapStrongAvg.seatBiasWinDiff)} pp | PPM A/B: ${fmt(seatSwapStrongAvg.xPpmAsA, 3)} / ${fmt(seatSwapStrongAvg.xPpmAsB, 3)}`
    );

    // 4. Controlled Synthetic Sensitivity Suite (Paired Seeds)
    console.log(`\n=== 3. CONTROLLED SYNTHETIC SENSITIVITY (N=${opts.matches} PAIRED SEEDS) ===`);
    const controlBaselineRecords = buildControlBaselineRecords(
        synthetics.CONTROL,
        opts.matches,
        opts.baseSeed
    );

    const variantOrder = [
        'CONTROL',
        'ATTACK_PLUS_5',
        'ATTACK_PLUS_10',
        'CREATION_PLUS_5',
        'CREATION_PLUS_10',
        'DEFENSE_PLUS_5',
        'DEFENSE_PLUS_10',
        'GK_PLUS_5',
        'GK_PLUS_10',
        'PHYSICAL_PLUS_5',
        'PHYSICAL_PLUS_10',
        'ALL_PLUS_5',
        'ALL_PLUS_10',
    ];

    const sensitivityResults = {};
    console.log(
        'Variant'.padEnd(18) +
            ' | Win%  | Draw% | Loss% | NonDrW| PPM (±95%CI)       | dPPM (paired)     | GF / GA     | Shots F/A   | SOT F/A   | Poss% | Save% | Blowout5+'
    );
    console.log('-'.repeat(148));

    for (const key of variantOrder) {
        const res = runPairedSensitivity(
            synthetics[key],
            synthetics.CONTROL,
            opts.matches,
            opts.baseSeed,
            controlBaselineRecords
        );
        sensitivityResults[key] = res;
        const b = res.batch;
        const d = res.pairedDeltas;
        console.log(
            `${key.padEnd(18)} | ${fmt(b.winRateA).padStart(5)} | ${fmt(b.drawRate).padStart(5)} | ${fmt(b.winRateB).padStart(5)} | ${fmt(b.nonDrawWinShareA).padStart(5)} | ${fmt(b.pointsPerMatchA, 3)} (±${fmt(b.pointsCI.ci95, 3)}) | ${fmtSigned(d.points.mean, 3)} (±${fmt(d.points.ci95, 3)}) | ${fmt(b.avgGoalsA)} / ${fmt(b.avgGoalsB)} | ${fmt(b.avgShotsA).padStart(5)}/${fmt(b.avgShotsB).padStart(5)} | ${fmt(b.avgOnTargetA)}/${fmt(b.avgOnTargetB)} | ${fmt(b.avgPossessionA, 1).padStart(5)} | ${fmt(b.saveRateA, 1).padStart(5)} | ${fmt(b.blowout5PlusRate)}%`
        );
    }

    console.log('\n--- SPECIALIZED DIMENSION DIAGNOSTICS ---');
    const ctrlB = sensitivityResults.CONTROL.batch;
    const atk5B = sensitivityResults.ATTACK_PLUS_5.batch;
    const atk10B = sensitivityResults.ATTACK_PLUS_10.batch;
    console.log(
        `Attack (+5/+10):    Goal/Shot ${fmt(ctrlB.goalPerShotA)}% -> ${fmt(atk5B.goalPerShotA)}% -> ${fmt(atk10B.goalPerShotA)}% | SOT% ${fmt(ctrlB.shotOnTargetRateA)}% -> ${fmt(atk5B.shotOnTargetRateA)}% -> ${fmt(atk10B.shotOnTargetRateA)}% | FW Shot Share ${fmt(ctrlB.roleDistributionByTeam.A.shots.FW)}% -> ${fmt(atk5B.roleDistributionByTeam.A.shots.FW)}% -> ${fmt(atk10B.roleDistributionByTeam.A.shots.FW)}% | Poss ${fmt(ctrlB.avgPossessionA)}% -> ${fmt(atk5B.avgPossessionA)}% -> ${fmt(atk10B.avgPossessionA)}%`
    );

    const cre5B = sensitivityResults.CREATION_PLUS_5.batch;
    const cre10B = sensitivityResults.CREATION_PLUS_10.batch;
    console.log(
        `Creation (+5/+10):  Possession ${fmt(ctrlB.avgPossessionA)}% -> ${fmt(cre5B.avgPossessionA)}% -> ${fmt(cre10B.avgPossessionA)}% | AtkSeq ${fmt(ctrlB.avgAttackSeqA)} -> ${fmt(cre5B.avgAttackSeqA)} -> ${fmt(cre10B.avgAttackSeqA)} | Shots ${fmt(ctrlB.avgShotsA)} -> ${fmt(cre5B.avgShotsA)} -> ${fmt(cre10B.avgShotsA)} | MF Creator Share ${fmt(ctrlB.roleDistributionByTeam.A.creator.MF)}% -> ${fmt(cre5B.roleDistributionByTeam.A.creator.MF)}% -> ${fmt(cre10B.roleDistributionByTeam.A.creator.MF)}%`
    );

    const def5B = sensitivityResults.DEFENSE_PLUS_5.batch;
    const def10B = sensitivityResults.DEFENSE_PLUS_10.batch;
    console.log(
        `Defense (+5/+10):   Opp Shots ${fmt(ctrlB.avgShotsB)} -> ${fmt(def5B.avgShotsB)} -> ${fmt(def10B.avgShotsB)} | Opp SOT ${fmt(ctrlB.avgOnTargetB)} -> ${fmt(def5B.avgOnTargetB)} -> ${fmt(def10B.avgOnTargetB)} | Opp Goals ${fmt(ctrlB.avgGoalsB)} -> ${fmt(def5B.avgGoalsB)} -> ${fmt(def10B.avgGoalsB)} | DF Def Share ${fmt(ctrlB.roleDistributionByTeam.A.defensive.DF)}% -> ${fmt(def5B.roleDistributionByTeam.A.defensive.DF)}% -> ${fmt(def10B.roleDistributionByTeam.A.defensive.DF)}%`
    );

    const gk5B = sensitivityResults.GK_PLUS_5.batch;
    const gk10B = sensitivityResults.GK_PLUS_10.batch;
    console.log(
        `GK (+5/+10):        Save Rate ${fmt(ctrlB.saveRateA)}% -> ${fmt(gk5B.saveRateA)}% -> ${fmt(gk10B.saveRateA)}% | Opp Goal/SOT ${fmt(ctrlB.goalPerOnTargetB)}% -> ${fmt(gk5B.goalPerOnTargetB)}% -> ${fmt(gk10B.goalPerOnTargetB)}% | Opp Goals ${fmt(ctrlB.avgGoalsB)} -> ${fmt(gk5B.avgGoalsB)} -> ${fmt(gk10B.avgGoalsB)} | Poss ${fmt(ctrlB.avgPossessionA)}% -> ${fmt(gk5B.avgPossessionA)}% -> ${fmt(gk10B.avgPossessionA)}% | Shots ${fmt(ctrlB.avgShotsA)} -> ${fmt(gk5B.avgShotsA)} -> ${fmt(gk10B.avgShotsA)}`
    );

    const phy5B = sensitivityResults.PHYSICAL_PLUS_5.batch;
    const phy10B = sensitivityResults.PHYSICAL_PLUS_10.batch;
    console.log(
        `Physical (+5/+10):  Possession ${fmt(ctrlB.avgPossessionA)}% -> ${fmt(phy5B.avgPossessionA)}% -> ${fmt(phy10B.avgPossessionA)}% | Shots F/A ${fmt(ctrlB.avgShotsA)}/${fmt(ctrlB.avgShotsB)} -> ${fmt(phy5B.avgShotsA)}/${fmt(phy5B.avgShotsB)} -> ${fmt(phy10B.avgShotsA)}/${fmt(phy10B.avgShotsB)} | Goals F/A ${fmt(ctrlB.avgGoalsA)}/${fmt(ctrlB.avgGoalsB)} -> ${fmt(phy5B.avgGoalsA)}/${fmt(phy5B.avgGoalsB)} -> ${fmt(phy10B.avgGoalsA)}/${fmt(phy10B.avgGoalsB)}`
    );

    // 5. Intra-Role Player Quality Test
    console.log(`\n=== 4. INTRA-ROLE PLAYER QUALITY TEST (N=${opts.matches}) ===`);
    const intraRole = runIntraRoleQualityTest(synthetics.CONTROL, opts.matches, opts.baseSeed);
    console.log(
        `FW Shooter Share:   FW1(ATK 95)=${fmt(intraRole.fwShooterShare.FW1_ATK95)}% | FW2(ATK 82)=${fmt(intraRole.fwShooterShare.FW2_ATK82)}% | FW3(ATK 70)=${fmt(intraRole.fwShooterShare.FW3_ATK70)}% (95/70 ratio = ${fmt(intraRole.fwShooterShare.ratio95to70)}x)`
    );
    console.log(
        `MF Creator Share:   MF1(CRE 95)=${fmt(intraRole.mfCreatorShare.MF1_CRE95)}% | MF2(CRE 82)=${fmt(intraRole.mfCreatorShare.MF2_CRE82)}% | MF3(CRE 70)=${fmt(intraRole.mfCreatorShare.MF3_CRE70)}% (95/70 ratio = ${fmt(intraRole.mfCreatorShare.ratio95to70)}x)`
    );
    console.log(
        `MF Assist Share:    MF1(CRE 95)=${fmt(intraRole.mfAssistShare.MF1_CRE95)}% | MF2(CRE 82)=${fmt(intraRole.mfAssistShare.MF2_CRE82)}% | MF3(CRE 70)=${fmt(intraRole.mfAssistShare.MF3_CRE70)}% (95/70 ratio = ${fmt(intraRole.mfAssistShare.ratio95to70)}x)`
    );
    console.log(
        `DF Defender Share:  DF1(DEF 95)=${fmt(intraRole.dfDefensiveShare.DF1_DEF95)}% | DF2(DEF 82)=${fmt(intraRole.dfDefensiveShare.DF2_DEF82)}% | DF3(DEF 82)=${fmt(intraRole.dfDefensiveShare.DF3_DEF82)}% | DF4(DEF 70)=${fmt(intraRole.dfDefensiveShare.DF4_DEF70)}% (95/70 ratio = ${fmt(intraRole.dfDefensiveShare.ratio95to70)}x)`
    );

    // 6. Historical Ladder (Seat-Swapped)
    console.log(`\n=== 5. HISTORICAL LADDER (N=${opts.matches} per seat, Seat-Swapped) ===`);
    const ladderPairs = [
        ['Elite', 'Strong'],
        ['Strong', 'Average'],
        ['Average', 'Weak'],
        ['Elite', 'Average'],
        ['Elite', 'Weak'],
    ];
    const ladderResults = {};
    for (const [tX, tY] of ladderPairs) {
        const key = `${tX}_vs_${tY}`;
        const swap = runSeatSwapExperiment(tiers[tX], tiers[tY], opts.matches, opts.baseSeed);
        ladderResults[key] = swap;
        console.log(
            `${key.padEnd(18)} | ${tX} Win: ${fmt(swap.xOverallWinRate)}% (as A: ${fmt(swap.xWinAsA)}%, as B: ${fmt(swap.xWinAsB)}%) | Draw: ${fmt(swap.overallDrawRate)}% | ${tY} Win: ${fmt(swap.yOverallWinRate)}% | ${tX} PPM: ${fmt(swap.xOverallPpm, 3)} | Seat Delta: ${fmtSigned(swap.seatBiasWinDiff)} pp`
        );
    }

    // 7. Clamp Diagnostics
    console.log('\n=== 6. PROBABILITY CLAMP DIAGNOSTICS ===');
    const clampScenarios = {
        Mirror_Control: [synthetics.CONTROL, synthetics.CONTROL],
        Attack_Plus_10: [synthetics.ATTACK_PLUS_10, synthetics.CONTROL],
        Creation_Plus_10: [synthetics.CREATION_PLUS_10, synthetics.CONTROL],
        Defense_Plus_10: [synthetics.DEFENSE_PLUS_10, synthetics.CONTROL],
        GK_Plus_10: [synthetics.GK_PLUS_10, synthetics.CONTROL],
        Physical_Plus_10: [synthetics.PHYSICAL_PLUS_10, synthetics.CONTROL],
        All_Plus_5: [synthetics.ALL_PLUS_5, synthetics.CONTROL],
        All_Plus_10: [synthetics.ALL_PLUS_10, synthetics.CONTROL],
        Elite_vs_Strong: [tiers.Elite, tiers.Strong],
        Strong_vs_Average: [tiers.Strong, tiers.Average],
        Average_vs_Weak: [tiers.Average, tiers.Weak],
        Elite_vs_Average: [tiers.Elite, tiers.Average],
        Elite_vs_Weak: [tiers.Elite, tiers.Weak],
    };

    const clampResults = {};
    for (const [name, [rA, rB]] of Object.entries(clampScenarios)) {
        const c = analyzeMatchupClamps(rA, rB);
        clampResults[name] = c;
        console.log(
            `${name.padEnd(18)} | Poss Clamp: ${fmt(c.possession.anyPct, 1)}% | AtkShare Clamp: ${fmt(c.attackShare.anyPct, 1)}% (raw=${fmt(c.attackShare.raw, 3)}) | ShotProb Clamp: ${fmt(c.shotProb.anyPct, 1)}% (rawA=${fmt(c.shotProb.A.raw, 3)}, rawB=${fmt(c.shotProb.B.raw, 3)}) | SOT Clamp: ${fmt(c.onTargetProb.anyPct, 1)}% | Goal Clamp: ${fmt(c.goalOnTargetProb.anyPct, 1)}%`
        );
    }

    const popClampGrid = analyzePopulationClampGrid(25);
    console.log(
        `Population 25x25 Grid (${popClampGrid.matchupPairs} matchups) Avg Clamp Rates | Poss: ${fmt(popClampGrid.possession.minPct + popClampGrid.possession.maxPct)}% | AtkShare: ${fmt(popClampGrid.attackShare.minPct + popClampGrid.attackShare.maxPct)}% | ShotProb: ${fmt(popClampGrid.shotProb.minPct + popClampGrid.shotProb.maxPct)}% | SOT: ${fmt(popClampGrid.onTargetProb.minPct + popClampGrid.onTargetProb.maxPct)}% | Goal/SOT: ${fmt(popClampGrid.goalOnTargetProb.minPct + popClampGrid.goalOnTargetProb.maxPct)}%`
    );

    // 8. Determinism & Locale Check
    setLocale('ja', { persist: false });
    const detJa = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, opts.baseSeed));
    setLocale('en', { persist: false });
    const detEn = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, opts.baseSeed));
    setLocale('zh-CN', { persist: false });
    const detZh = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, opts.baseSeed));
    const determinismPass = detJa === detEn && detEn === detZh;

    // 9. Automated Diagnostic Verdict Table
    console.log('\n=== 7. DIAGNOSTIC VERDICT SUMMARY ===');
    const checks = [];

    // Mirror fairness check
    const mirrorBiasAbs = Math.abs(mirror.seatWinDelta);
    const mirrorPossDiff = Math.abs(mirror.avgPossessionA - 50);
    checks.push({
        name: 'Mirror fairness (|A-B| <= 1.0pp, Poss ~50%)',
        status: mirrorBiasAbs <= 1.0 && mirrorPossDiff <= 0.3 ? 'PASS' : 'FAIL',
        detail: `|A-B| = ${fmt(mirrorBiasAbs)} pp, Poss A = ${fmt(mirror.avgPossessionA)}%`,
    });

    // Seat swap symmetry check
    const mirror10kDelta = sensitivityResults.CONTROL.batch.seatWinDelta;
    const seatAdjustedDelta = seatSwapStrongAvg.seatBiasWinDiff - mirror10kDelta;
    const ladderMeanSeatDelta =
        Object.values(ladderResults).reduce((acc, r) => acc + r.seatBiasWinDiff, 0) /
        Object.keys(ladderResults).length;
    const seatSwapOk =
        Math.abs(seatAdjustedDelta) <= 1.5 && Math.abs(ladderMeanSeatDelta) <= 1.5;
    checks.push({
        name: 'Seat swap symmetry (Ladder & Strong vs Avg)',
        status: seatSwapOk ? 'PASS' : 'CONCERN',
        detail: `Seed-adj Strong/Avg = ${fmtSigned(seatAdjustedDelta)} pp, Ladder mean = ${fmtSigned(ladderMeanSeatDelta)} pp`,
    });

    // Determinism check
    checks.push({
        name: 'Determinism & Locale independence (ja/en/zh-CN)',
        status: determinismPass ? 'PASS' : 'FAIL',
        detail: determinismPass ? '100% byte-for-byte identical' : 'Mismatch detected',
    });

    // Match shape check
    const shapeGoalsOk = mirror.avgTotalGoals >= 2.3 && mirror.avgTotalGoals <= 3.4;
    const shapeShotsOk = mirror.avgShotsA >= 8 && mirror.avgShotsA <= 14;
    const shapeSotOk = mirror.shotOnTargetRateTotal >= 35 && mirror.shotOnTargetRateTotal <= 55;
    const shapeGoalSotOk = mirror.goalPerOnTargetTotal >= 20 && mirror.goalPerOnTargetTotal <= 40;
    const shapeDrawOk = mirror.drawRate >= 18 && mirror.drawRate <= 32;
    checks.push({
        name: 'Match shape (Goals, Shots, SOT%, Goal/SOT%, Draw%)',
        status:
            shapeGoalsOk && shapeShotsOk && shapeSotOk && shapeGoalSotOk && shapeDrawOk
                ? 'PASS'
                : 'CONCERN',
        detail: `Goals=${fmt(mirror.avgTotalGoals)}, Shots/team=${fmt(mirror.avgShotsA)}, SOT%=${fmt(mirror.shotOnTargetRateTotal)}%, G/SOT=${fmt(mirror.goalPerOnTargetTotal)}%, Draw=${fmt(mirror.drawRate)}%`,
    });

    // Role event distribution check
    const rShots = mirror.roleDistribution.shots;
    const rGoals = mirror.roleDistribution.goals;
    const rDef = mirror.roleDistribution.defensive;
    const roleSanityOk =
        rShots.FW > rShots.MF &&
        rShots.MF > rShots.DF &&
        rShots.GK < 1.0 &&
        rGoals.FW > rGoals.MF &&
        rGoals.MF > rGoals.DF &&
        rDef.DF > rDef.MF &&
        rDef.MF > rDef.FW &&
        rDef.GK < 3.0;
    checks.push({
        name: 'Role event distribution (4-3-3 hierarchy)',
        status: roleSanityOk ? 'PASS' : 'FAIL',
        detail: `Shots FW/MF/DF/GK = ${fmt(rShots.FW, 1)}/${fmt(rShots.MF, 1)}/${fmt(rShots.DF, 1)}/${fmt(rShots.GK, 2)}% | Def DF/MF/FW/GK = ${fmt(rDef.DF, 1)}/${fmt(rDef.MF, 1)}/${fmt(rDef.FW, 1)}/${fmt(rDef.GK, 2)}%`,
    });

    // Intra-role player quality check
    const intraRoleOk =
        intraRole.fwShooterShare.FW1_ATK95 > intraRole.fwShooterShare.FW2_ATK82 &&
        intraRole.fwShooterShare.FW2_ATK82 > intraRole.fwShooterShare.FW3_ATK70 &&
        intraRole.mfCreatorShare.MF1_CRE95 > intraRole.mfCreatorShare.MF2_CRE82 &&
        intraRole.mfCreatorShare.MF2_CRE82 > intraRole.mfCreatorShare.MF3_CRE70 &&
        intraRole.mfAssistShare.MF1_CRE95 > intraRole.mfAssistShare.MF2_CRE82 &&
        intraRole.mfAssistShare.MF2_CRE82 > intraRole.mfAssistShare.MF3_CRE70 &&
        intraRole.dfDefensiveShare.DF1_DEF95 > intraRole.dfDefensiveShare.DF4_DEF70;
    checks.push({
        name: 'Intra-role player quality differentiation (95 > 82 > 70)',
        status: intraRoleOk ? 'PASS' : 'FAIL',
        detail: `95/70 ratios: FW shot=${fmt(intraRole.fwShooterShare.ratio95to70)}x, MF cre=${fmt(intraRole.mfCreatorShare.ratio95to70)}x, DF def=${fmt(intraRole.dfDefensiveShare.ratio95to70)}x`,
    });

    // Attribute monotonicity check
    const dPpm = (k) => sensitivityResults[k].pairedDeltas.points.mean;
    const monoAll = dPpm('ALL_PLUS_10') > dPpm('ALL_PLUS_5') && dPpm('ALL_PLUS_5') > 0.05;
    const monoAtk = dPpm('ATTACK_PLUS_10') > dPpm('ATTACK_PLUS_5') && dPpm('ATTACK_PLUS_5') > 0.01;
    const monoCre =
        dPpm('CREATION_PLUS_10') > dPpm('CREATION_PLUS_5') && dPpm('CREATION_PLUS_5') > 0.01;
    const monoDef =
        dPpm('DEFENSE_PLUS_10') > dPpm('DEFENSE_PLUS_5') && dPpm('DEFENSE_PLUS_5') > 0.01;
    const monoGk = dPpm('GK_PLUS_10') > dPpm('GK_PLUS_5') && dPpm('GK_PLUS_5') > 0.01;
    const monoPhy =
        dPpm('PHYSICAL_PLUS_10') > dPpm('PHYSICAL_PLUS_5') && dPpm('PHYSICAL_PLUS_5') > 0.01;
    checks.push({
        name: 'Attribute monotonicity (0 < +5 < +10 across all dims)',
        status: monoAll && monoAtk && monoCre && monoDef && monoGk && monoPhy ? 'PASS' : 'FAIL',
        detail: `dPPM (+5/+10): ATK=${fmtSigned(dPpm('ATTACK_PLUS_5'), 3)}/${fmtSigned(dPpm('ATTACK_PLUS_10'), 3)}, CRE=${fmtSigned(dPpm('CREATION_PLUS_5'), 3)}/${fmtSigned(dPpm('CREATION_PLUS_10'), 3)}, DEF=${fmtSigned(dPpm('DEFENSE_PLUS_5'), 3)}/${fmtSigned(dPpm('DEFENSE_PLUS_10'), 3)}, GK=${fmtSigned(dPpm('GK_PLUS_5'), 3)}/${fmtSigned(dPpm('GK_PLUS_10'), 3)}, PHY=${fmtSigned(dPpm('PHYSICAL_PLUS_5'), 3)}/${fmtSigned(dPpm('PHYSICAL_PLUS_10'), 3)}`,
    });

    // Strength ladder check (Section 16 & 27)
    const all5Win = sensitivityResults.ALL_PLUS_5.batch.winRateA;
    const all5NonDraw = sensitivityResults.ALL_PLUS_5.batch.nonDrawWinShareA;
    const all10Win = sensitivityResults.ALL_PLUS_10.batch.winRateA;
    const all10NonDraw = sensitivityResults.ALL_PLUS_10.batch.nonDrawWinShareA;
    const all10Blowout5 = sensitivityResults.ALL_PLUS_10.batch.blowout5PlusRate;
    const strengthOk =
        all5NonDraw >= 55 &&
        all5NonDraw <= 73 &&
        all10Win >= 68 &&
        all10Win <= 83 &&
        all10Blowout5 <= 8.0;
    checks.push({
        name: 'Strength ladder & Upset retention (ALL +5 / +10)',
        status: strengthOk ? 'PASS' : 'CONCERN',
        detail: `ALL+5 Win=${fmt(all5Win)}% (NonDraw=${fmt(all5NonDraw)}%), ALL+10 Win=${fmt(all10Win)}% (NonDraw=${fmt(all10NonDraw)}%, 5+ blowout=${fmt(all10Blowout5)}%)`,
    });

    // Physical balance check: Physical +10 should not simultaneously out-create Creation +10 AND out-defend Defense +10
    const phyOutCreatesCre = phy10B.avgPossessionA > cre10B.avgPossessionA && phy10B.avgShotsA > cre10B.avgShotsA;
    const phyOutDefendsDef = phy10B.avgShotsB < def10B.avgShotsB && phy10B.avgGoalsB < def10B.avgGoalsB;
    const phyVsCreDefRatio =
        dPpm('PHYSICAL_PLUS_10') / Math.max(0.001, (dPpm('CREATION_PLUS_10') + dPpm('DEFENSE_PLUS_10')) / 2);
    checks.push({
        name: 'Physical balance vs Creation/Defense specialists',
        status:
            !phyOutCreatesCre && !phyOutDefendsDef && phyVsCreDefRatio <= 1.25
                ? 'PASS'
                : 'CONCERN',
        detail: `PHY+10 dPPM=${fmtSigned(dPpm('PHYSICAL_PLUS_10'), 3)} vs CRE+10=${fmtSigned(dPpm('CREATION_PLUS_10'), 3)}, DEF+10=${fmtSigned(dPpm('DEFENSE_PLUS_10'), 3)} (out-creates CRE: ${phyOutCreatesCre}, out-defends DEF: ${phyOutDefendsDef})`,
    });

    // Clamp saturation check
    const normalClampsOk =
        clampResults.Strong_vs_Average.shotProb.anyPct === 0 &&
        clampResults.Strong_vs_Average.attackShare.anyPct === 0 &&
        clampResults.Strong_vs_Average.onTargetProb.anyPct < 10 &&
        clampResults.Strong_vs_Average.goalOnTargetProb.anyPct < 10;
    checks.push({
        name: 'Clamp saturation in normal matchups',
        status: normalClampsOk ? 'PASS' : 'CONCERN',
        detail: `Strong vs Avg clamp rates: Poss=${fmt(clampResults.Strong_vs_Average.possession.anyPct)}%, Atk=${fmt(clampResults.Strong_vs_Average.attackShare.anyPct)}%, Shot=${fmt(clampResults.Strong_vs_Average.shotProb.anyPct)}%, SOT=${fmt(clampResults.Strong_vs_Average.onTargetProb.anyPct)}%, Goal=${fmt(clampResults.Strong_vs_Average.goalOnTargetProb.anyPct)}%`,
    });

    for (const c of checks) {
        console.log(`[${c.status.padEnd(7)}] ${c.name.padEnd(50)} | ${c.detail}`);
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nCompleted analysis in ${elapsedSec}s.`);

    if (opts.jsonOut) {
        const payload = {
            config: opts,
            tiers: Object.fromEntries(
                Object.entries(tiers).map(([k, v]) => [k, formatRosterSummary(v)])
            ),
            mirror,
            seatSwapStrongAvg,
            sensitivityResults,
            intraRole,
            ladderResults,
            clampResults,
            popClampGrid,
            determinismPass,
            checks,
        };
        fs.writeFileSync(opts.jsonOut, JSON.stringify(payload, null, 2), 'utf8');
        console.log(`Wrote JSON output to ${opts.jsonOut}`);
    }
}

main();

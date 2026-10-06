#!/usr/bin/env node
// Fast Permanent Regression Suite for 11v11 Match Balance & Invariants (scripts/smoke-match-balance.mjs)

import assert from 'node:assert/strict';
import { setLocale } from '../public/i18n/i18n.js';
import { SLOTS, getSlotRole } from '../public/game/shared/constants.js';
import { findPlayerByRole } from '../public/game/draft/rules.js';
import { generateMatchScript } from '../public/game/match/engine.js';
import {
    deriveMatchSeed,
    buildHistoricalTierRosters,
    buildControlledSyntheticRosters,
    runBatchMatches,
    buildControlBaselineRecords,
    runPairedSensitivity,
    runIntraRoleQualityTest,
} from './lib/match-balance.mjs';

console.log('[smoke-match-balance] Running fast 11v11 match balance & invariant regression suite...');

const BASE_SEED = 20261006;
const tiers = buildHistoricalTierRosters();
const synthetics = buildControlledSyntheticRosters(tiers.Average);

// 1. Same-seed & Cross-locale Determinism (3 runs + ja/en/zh-CN)
{
    const run1 = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, BASE_SEED));
    const run2 = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, BASE_SEED));
    const run3 = JSON.stringify(generateMatchScript(tiers.Elite, tiers.Average, BASE_SEED));
    assert.equal(run1, run2, 'Same-seed run 1 and run 2 must be byte-for-byte identical');
    assert.equal(run2, run3, 'Same-seed run 2 and run 3 must be byte-for-byte identical');

    setLocale('ja', { persist: false });
    const jaScript = JSON.stringify(generateMatchScript(tiers.Strong, tiers.Weak, BASE_SEED + 7));
    setLocale('en', { persist: false });
    const enScript = JSON.stringify(generateMatchScript(tiers.Strong, tiers.Weak, BASE_SEED + 7));
    setLocale('zh-CN', { persist: false });
    const zhScript = JSON.stringify(generateMatchScript(tiers.Strong, tiers.Weak, BASE_SEED + 7));
    assert.equal(jaScript, enScript, 'ja and en match scripts must be byte-for-byte identical');
    assert.equal(enScript, zhScript, 'en and zh-CN match scripts must be byte-for-byte identical');
}

// 2. Match Stat & Event Attribution Invariants (1,000 matches)
{
    const teamA = tiers.Strong;
    const teamB = tiers.Average;
    const gkA = findPlayerByRole(teamA, 'GK');
    const gkB = findPlayerByRole(teamB, 'GK');

    const mapA = new Map(SLOTS.map((s) => [teamA[s].id, getSlotRole(s)]));
    const mapB = new Map(SLOTS.map((s) => [teamB[s].id, getSlotRole(s)]));

    for (let i = 0; i < 1000; i++) {
        const seed = deriveMatchSeed(BASE_SEED, i);
        const s = generateMatchScript(teamA, teamB, seed);

        for (const side of ['A', 'B']) {
            const st = s.stats[side];
            const prof = s.profiles[side];
            assert.ok(!Number.isNaN(s.finalScore[side]), `Score ${side} must not be NaN`);
            assert.ok(Number.isInteger(s.finalScore[side]) && s.finalScore[side] >= 0);
            for (const [k, v] of Object.entries(st)) {
                assert.ok(Number.isFinite(v) && !Number.isNaN(v), `Stats ${side}.${k} must be finite`);
            }
            for (const [k, v] of Object.entries(prof)) {
                assert.ok(Number.isFinite(v) && !Number.isNaN(v), `Profile ${side}.${k} must be finite`);
            }
            assert.ok(st.shotsOnTarget <= st.shots, `${side}: shotsOnTarget <= shots`);
            assert.ok(st.goals <= st.shotsOnTarget, `${side}: goals <= shotsOnTarget`);
            assert.ok(st.saves >= 0, `${side}: saves >= 0`);
            assert.equal(st.goals, s.finalScore[side], `${side}: stats.goals must equal finalScore`);
        }

        assert.equal(
            s.stats.A.possession + s.stats.B.possession,
            100,
            'Possession A + B must equal 100'
        );
        assert.equal(
            s.stats.A.goals + s.stats.B.saves,
            s.stats.A.shotsOnTarget,
            'A goals + B saves must equal A shotsOnTarget'
        );
        assert.equal(
            s.stats.B.goals + s.stats.A.saves,
            s.stats.B.shotsOnTarget,
            'B goals + A saves must equal B shotsOnTarget'
        );

        for (const ev of s.events) {
            assert.ok(Number.isFinite(ev.minute) && !Number.isNaN(ev.minute), 'Valid event minute');
            if (!ev.team) continue;
            const attMap = ev.team === 'A' ? mapA : mapB;
            const defMap = ev.team === 'A' ? mapB : mapA;
            const expectedDefGk = ev.team === 'A' ? gkB : gkA;

            if (
                ev.type === 'attack' ||
                ev.type === 'shot' ||
                ev.type === 'miss' ||
                ev.type === 'save' ||
                ev.type === 'goal'
            ) {
                assert.ok(
                    ev.playerId && attMap.has(ev.playerId),
                    `Event ${ev.type} playerId must belong to attacking roster`
                );
            }
            if (ev.type === 'attack' || ev.type === 'shot') {
                assert.ok(
                    ev.defenderId && defMap.has(ev.defenderId),
                    `Event ${ev.type} defenderId must belong to defending roster`
                );
            }
            if (ev.type === 'save' || ev.type === 'goal') {
                assert.equal(
                    ev.goalkeeperId,
                    expectedDefGk.id,
                    `Event ${ev.type} goalkeeperId must match defending GK1`
                );
                assert.equal(
                    ev.goalkeeperName,
                    expectedDefGk.name,
                    `Event ${ev.type} goalkeeperName must match defending GK1`
                );
            }
            if (ev.type === 'goal' && ev.assistId) {
                assert.ok(
                    attMap.has(ev.assistId) && ev.assistId !== ev.scorerId,
                    'Goal assistId must belong to attacking team and differ from scorerId'
                );
            }
        }
    }
}

// 3. Mirror Short-Run Gross Bias & 4-3-3 Role Hierarchy Sanity (5,000 matches)
{
    const mirror = runBatchMatches(synthetics.CONTROL, synthetics.CONTROL, 5000, BASE_SEED);
    assert.ok(
        Math.abs(mirror.seatWinDelta) <= 3.0,
        `Mirror short-run |A-B| win delta (${mirror.seatWinDelta.toFixed(2)} pp) must be within gross sanity bound`
    );
    assert.ok(
        Math.abs(mirror.avgPossessionA - 50) <= 0.3,
        `Mirror possession A (${mirror.avgPossessionA.toFixed(2)}%) must be ~50%`
    );
    assert.ok(
        mirror.avgTotalGoals >= 2.2 && mirror.avgTotalGoals <= 3.5,
        `Mirror avg total goals (${mirror.avgTotalGoals.toFixed(2)}) must be in sanity band [2.2, 3.5]`
    );

    const rShots = mirror.roleDistribution.shots;
    const rGoals = mirror.roleDistribution.goals;
    const rAssists = mirror.roleDistribution.assists;
    const rDef = mirror.roleDistribution.defensive;

    assert.ok(
        rShots.FW > rShots.MF && rShots.MF > rShots.DF && rShots.GK < 1.0,
        'Shot share must follow FW > MF > DF >> GK'
    );
    assert.ok(
        rGoals.FW > rGoals.MF && rGoals.MF > rGoals.DF && rGoals.GK < 1.0,
        'Goal share must follow FW > MF > DF >> GK'
    );
    assert.ok(
        rAssists.MF > rAssists.FW && rAssists.MF > rAssists.DF && rAssists.GK < 1.0,
        'Assist share must be led by MF with GK < 1%'
    );
    assert.ok(
        rDef.DF > rDef.MF && rDef.MF > rDef.FW && rDef.GK < 2.0,
        'Defensive involvement must follow DF > MF > FW >> GK'
    );
}

// 4. Attribute Sensitivity Direction & Monotonicity Sanity (2,000 paired seeds)
{
    const N = 2000;
    const ctrlBase = buildControlBaselineRecords(synthetics.CONTROL, N, BASE_SEED);
    const runVar = (key) =>
        runPairedSensitivity(synthetics[key], synthetics.CONTROL, N, BASE_SEED, ctrlBase);

    const ctrl = runVar('CONTROL');
    const atk5 = runVar('ATTACK_PLUS_5');
    const atk10 = runVar('ATTACK_PLUS_10');
    const cre5 = runVar('CREATION_PLUS_5');
    const cre10 = runVar('CREATION_PLUS_10');
    const def5 = runVar('DEFENSE_PLUS_5');
    const def10 = runVar('DEFENSE_PLUS_10');
    const gk5 = runVar('GK_PLUS_5');
    const gk10 = runVar('GK_PLUS_10');
    const phy5 = runVar('PHYSICAL_PLUS_5');
    const phy10 = runVar('PHYSICAL_PLUS_10');
    const all5 = runVar('ALL_PLUS_5');
    const all10 = runVar('ALL_PLUS_10');

    // Monotonicity on paired dPPM
    assert.ok(
        atk10.pairedDeltas.points.mean > atk5.pairedDeltas.points.mean &&
            atk5.pairedDeltas.points.mean > 0.01,
        'Attack +10 > Attack +5 > Control in PPM'
    );
    assert.ok(
        cre10.pairedDeltas.points.mean > cre5.pairedDeltas.points.mean &&
            cre5.pairedDeltas.points.mean > 0.01,
        'Creation +10 > Creation +5 > Control in PPM'
    );
    assert.ok(
        def10.pairedDeltas.points.mean > def5.pairedDeltas.points.mean &&
            def5.pairedDeltas.points.mean > 0.01,
        'Defense +10 > Defense +5 > Control in PPM'
    );
    assert.ok(
        gk10.pairedDeltas.points.mean > gk5.pairedDeltas.points.mean &&
            gk5.pairedDeltas.points.mean > 0.01,
        'GK +10 > GK +5 > Control in PPM'
    );
    assert.ok(
        phy10.pairedDeltas.points.mean > phy5.pairedDeltas.points.mean &&
            phy5.pairedDeltas.points.mean > 0.005,
        'Physical +10 > Physical +5 > Control in PPM'
    );
    assert.ok(
        all10.pairedDeltas.points.mean > all5.pairedDeltas.points.mean &&
            all5.pairedDeltas.points.mean > 0.10,
        'All +10 > All +5 > Control in PPM'
    );

    // Domain-specific directional sanity
    assert.ok(
        atk10.batch.goalPerShotA > atk5.batch.goalPerShotA &&
            atk5.batch.goalPerShotA > ctrl.batch.goalPerShotA,
        'Attack must monotonically increase goal conversion'
    );
    assert.ok(
        cre10.batch.avgPossessionA > cre5.batch.avgPossessionA &&
            cre5.batch.avgPossessionA > ctrl.batch.avgPossessionA &&
            cre10.batch.avgShotsA > ctrl.batch.avgShotsA,
        'Creation must monotonically increase possession and shots'
    );
    assert.ok(
        def10.batch.avgShotsB < def5.batch.avgShotsB &&
            def5.batch.avgShotsB < ctrl.batch.avgShotsB &&
            def10.batch.avgGoalsB < ctrl.batch.avgGoalsB,
        'Defense must monotonically reduce opponent shots and opponent goals'
    );
    assert.ok(
        gk10.batch.saveRateA > gk5.batch.saveRateA &&
            gk5.batch.saveRateA > ctrl.batch.saveRateA &&
            Math.abs(gk10.batch.avgPossessionA - ctrl.batch.avgPossessionA) < 0.01,
        'GK must increase save rate without altering possession'
    );
    assert.ok(
        cre10.batch.avgPossessionA > phy10.batch.avgPossessionA &&
            cre10.batch.avgShotsA > phy10.batch.avgShotsA &&
            def10.batch.avgShotsB < phy10.batch.avgShotsB &&
            def10.batch.avgGoalsB < phy10.batch.avgGoalsB,
        'Specialist Creation/Defense +10 must outperform Physical +10 in their respective domains'
    );
}

// 5. Intra-Role Player Quality Sanity (2,000 matches)
{
    const intra = runIntraRoleQualityTest(synthetics.CONTROL, 2000, BASE_SEED);
    assert.ok(
        intra.fwShooterShare.FW1_ATK95 > intra.fwShooterShare.FW2_ATK82 &&
            intra.fwShooterShare.FW2_ATK82 > intra.fwShooterShare.FW3_ATK70,
        'FW shooter share must follow ATK 95 > ATK 82 > ATK 70'
    );
    assert.ok(
        intra.mfCreatorShare.MF1_CRE95 > intra.mfCreatorShare.MF2_CRE82 &&
            intra.mfCreatorShare.MF2_CRE82 > intra.mfCreatorShare.MF3_CRE70,
        'MF creator share must follow CRE 95 > CRE 82 > CRE 70'
    );
    assert.ok(
        intra.dfDefensiveShare.DF1_DEF95 > intra.dfDefensiveShare.DF4_DEF70,
        'DF defender share must follow DEF 95 > DEF 70'
    );
}

console.log(
    '[smoke-match-balance] PASS — All determinism, invariant, mirror, role hierarchy, attribute monotonicity, and intra-role quality checks succeeded.'
);
process.exit(0);

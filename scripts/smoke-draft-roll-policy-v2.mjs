// Comprehensive smoke test for Draft Roll Policy v2 & Semantic Dice
// Validates:
// 1. Policy version and constants (DRAFT_ROLL_POLICY_VERSION, max drifts = 3)
// 2. Initial roll distribution uniformity, probability sum (1.0), and deterministic order
// 3. 1,000,000 Seeded Monte Carlo initial roll distribution tolerance
// 4. League Die fixtures (exact same-year, nearest fallback, +-3 cap, fairness, equal-distance years)
// 5. Club Die fixtures (exact same-year, nearest fallback, >3 unavailable, fairness)
// 6. Season Die fixtures (multi-season uniform, single-season empty/disabled)
// 7. Illegal transition rejection (isLegalRerollDestination, isValidRerollTransition, applyDraftReroll)
// 8. Probability sum (1.0 within 1e-12) & deterministic index ordering across all 62 TeamSeasons x 3 dice
// 9. Exact RNG consumption (0 for construction, 1 per sample) & deterministic sampling
// 10. Bot EV shared policy consistency, NaN checks, and UI hint verification in 3 locales

import assert from 'node:assert/strict';

import {
    TEAM_SEASONS,
    LEAGUES,
    getClubsByLeague,
    TEAM_SEASON_MAP,
} from '../public/data/team-seasons.js';
import { REROLL_TYPES } from '../public/game/shared/constants.js';
import {
    DRAFT_ROLL_POLICY_VERSION,
    LEAGUE_REROLL_MAX_YEAR_DRIFT,
    CLUB_REROLL_MAX_YEAR_DRIFT,
    getInitialRollOutcomeDistribution,
    getRerollOutcomeDistribution,
    sampleOutcomeDistribution,
    isLegalRerollDestination,
} from '../public/game/roll-policy.js';
import {
    generateInitialRollTeamSeason,
    pickRandomDraft,
    pickRandomExceptDraft,
} from '../public/game/draft/random.js';
import {
    hasRerollOption,
    generateRerollTeamSeason,
    isValidRerollTransition,
    createEmptyRoster,
    createInitialRerolls,
} from '../public/game/draft/rules.js';
import {
    applyDraftRoll,
    applyDraftReroll,
} from '../public/game/draft/transitions.js';
import {
    getRerollOutcomeDistribution as botRerollDist,
    estimateRerollValue,
} from '../public/game/bot/reroll-value.js';
import { renderRerollControls } from '../public/game/draft/ui.js';
import { setLocale, t } from '../public/i18n/i18n.js';

console.log('[smoke-draft-roll-policy-v2] Starting Draft Roll Policy v2 smoke test suite...');

// Simple Mulberry32 PRNG for deterministic tests
function createMulberry32(seed = 123456789) {
    let s = seed >>> 0;
    return function mulberry32() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// 1. Constants & Version Integrity
// ---------------------------------------------------------------------------
{
    assert.equal(
        DRAFT_ROLL_POLICY_VERSION,
        'teamseason-semantic-v2',
        'Policy version must be teamseason-semantic-v2'
    );
    assert.equal(
        LEAGUE_REROLL_MAX_YEAR_DRIFT,
        3,
        'League reroll max year drift must be 3'
    );
    assert.equal(
        CLUB_REROLL_MAX_YEAR_DRIFT,
        3,
        'Club reroll max year drift must be 3'
    );
}

// ---------------------------------------------------------------------------
// 2. Initial Roll Outcome Distribution Uniformity & Determinism
// ---------------------------------------------------------------------------
{
    const initialDist = getInitialRollOutcomeDistribution();
    assert.equal(
        initialDist.length,
        62,
        `Expected 62 outcomes in initial distribution, got ${initialDist.length}`
    );

    const expectedProb = 1 / 62;
    let sumProb = 0;
    for (let i = 0; i < initialDist.length; i++) {
        const entry = initialDist[i];
        assert.equal(
            entry.teamSeason.id,
            TEAM_SEASONS[i].id,
            `Initial distribution must strictly preserve TEAM_SEASONS dataset order at index ${i}`
        );
        assert(
            Math.abs(entry.probability - expectedProb) < 1e-15,
            `Expected probability ${expectedProb}, got ${entry.probability} for ${entry.teamSeason.id}`
        );
        sumProb += entry.probability;
    }

    assert(
        Math.abs(sumProb - 1.0) < 1e-12,
        `Initial distribution sum must be 1.0 within 1e-12, got ${sumProb}`
    );

    // Verify key regression anchors all have identical probability
    const anchorIds = [
        'porto-2004',
        'benfica-2014',
        'monaco-2017',
        'ajax-2019',
        'real-madrid-2002',
        'manchester-united-2008',
    ];
    for (const id of anchorIds) {
        const found = initialDist.find((e) => e.teamSeason.id === id);
        assert.ok(found, `Anchor ${id} must exist in initial distribution`);
        assert.equal(
            found.probability,
            expectedProb,
            `Anchor ${id} must have exact probability 1/62`
        );
    }
}

// ---------------------------------------------------------------------------
// 3. Seeded Monte Carlo Initial Roll Verification (1,000,000 Rolls)
// ---------------------------------------------------------------------------
{
    const rng = createMulberry32(20261007);
    const totalRolls = 1000000;
    const counts = new Map();

    for (let i = 0; i < totalRolls; i++) {
        const ts = generateInitialRollTeamSeason(rng);
        assert.ok(ts && ts.id, 'generateInitialRollTeamSeason must return a valid TeamSeason');
        counts.set(ts.id, (counts.get(ts.id) || 0) + 1);
    }

    assert.equal(counts.size, 62, 'All 62 TeamSeasons must be observed in 1,000,000 rolls');

    const expectedCount = totalRolls / 62; // ~16129.03
    // Standard deviation for binomial: sqrt(N * p * (1-p)) ≈ sqrt(1,000,000 * 1/62 * 61/62) ≈ 125.9
    // 4.5 sigma tolerance ≈ 566 rolls deviation
    const maxDeviation = 600;

    for (const [id, count] of counts.entries()) {
        const diff = Math.abs(count - expectedCount);
        assert(
            diff < maxDeviation,
            `TeamSeason ${id} count ${count} deviated from expected ${expectedCount} by ${diff} (exceeds tolerance ${maxDeviation})`
        );
    }
}

// ---------------------------------------------------------------------------
// 4. League Die Fixtures (Sections 45–46)
// ---------------------------------------------------------------------------
{
    // 4A: Exact same-year fixture (real-madrid-2022)
    const madrid2022 = TEAM_SEASON_MAP.get('real-madrid-2022');
    const madridLeagueOutcomes = getRerollOutcomeDistribution(madrid2022, 'league');
    assert(madridLeagueOutcomes.length > 0, 'League reroll from real-madrid-2022 must be non-empty');
    for (const { teamSeason } of madridLeagueOutcomes) {
        assert.notEqual(teamSeason.league, madrid2022.league, 'Must be a different league');
        assert.equal(teamSeason.year, madrid2022.year, 'Must be exact same year 2022');
    }

    // 4B: Nearest-year fallback fixtures (dynamically find all 7 TeamSeasons without exact same-year other league)
    const fallbackSeasons = [];
    for (const ts of TEAM_SEASONS) {
        const otherLeagues = LEAGUES.filter((l) => l !== ts.league);
        let minD = Infinity;
        for (const l of otherLeagues) {
            for (const other of TEAM_SEASONS.filter((x) => x.league === l)) {
                const d = Math.abs(other.year - ts.year);
                if (d < minD) minD = d;
            }
        }
        if (minD > 0) {
            fallbackSeasons.push(ts);
        }
    }
    assert.equal(
        fallbackSeasons.length,
        7,
        `Expected exactly 7 fallback seasons without exact same-year other league, found ${fallbackSeasons.length}`
    );
    for (const ts of fallbackSeasons) {
        const outcomes = getRerollOutcomeDistribution(ts, 'league');
        assert(outcomes.length > 0, `Fallback season ${ts.id} must have available league outcomes`);
        for (const { teamSeason } of outcomes) {
            assert.notEqual(teamSeason.league, ts.league);
            const dist = Math.abs(teamSeason.year - ts.year);
            assert.equal(
                dist,
                1,
                `Fallback season ${ts.id} outcome ${teamSeason.id} must be exactly distance 1 (got ${dist})`
            );
        }
    }

    // 4C: League +-3 cap test with synthetic roll (globalMinDistance > 3)
    const syntheticOldRoll = {
        id: 'synthetic-1990',
        league: 'Premier League',
        club: 'Manchester United',
        year: 1990,
    };
    assert.deepStrictEqual(
        getRerollOutcomeDistribution(syntheticOldRoll, 'league'),
        [],
        'Synthetic roll with min distance > 3 must return empty array'
    );
    assert.equal(
        hasRerollOption(syntheticOldRoll, 'league'),
        false,
        'hasRerollOption must return false when drift exceeds cap'
    );

    // 4D: League fairness fixture (manchester-united-2022)
    // Target leagues at 2022: La Liga (barcelona-2022, real-madrid-2022), Serie A (ac-milan-2022), Bundesliga (bayern-munich-2022)
    const mu2022 = TEAM_SEASON_MAP.get('manchester-united-2022');
    const muOutcomes = getRerollOutcomeDistribution(mu2022, 'league');
    const targetLeagues = Array.from(new Set(muOutcomes.map((o) => o.teamSeason.league)));
    const expectedLeagueProb = 1 / targetLeagues.length; // 1/3

    for (const targetLeague of targetLeagues) {
        const leagueProbSum = muOutcomes
            .filter((o) => o.teamSeason.league === targetLeague)
            .reduce((sum, o) => sum + o.probability, 0);
        assert(
            Math.abs(leagueProbSum - expectedLeagueProb) < 1e-12,
            `League ${targetLeague} total prob must be ${expectedLeagueProb}, got ${leagueProbSum}`
        );
    }
    // And within La Liga, the 2 TeamSeasons must each have half of La Liga's probability
    const laLigaEntries = muOutcomes.filter((o) => o.teamSeason.league === 'La Liga');
    assert.equal(laLigaEntries.length, 2);
    for (const entry of laLigaEntries) {
        assert(
            Math.abs(entry.probability - expectedLeagueProb / 2) < 1e-12,
            `Each La Liga entry must have ${expectedLeagueProb / 2}, got ${entry.probability}`
        );
    }

    // 4E: Equal-distance years within a target league (juventus-2003)
    // Target league La Liga has both 2002 (real-madrid-2002) and 2004 (valencia-2004) at distance 1
    const juve2003 = TEAM_SEASON_MAP.get('juventus-2003');
    const juveOutcomes = getRerollOutcomeDistribution(juve2003, 'league');
    const juveLaLigaOutcomes = juveOutcomes.filter((o) => o.teamSeason.league === 'La Liga');
    assert.equal(juveLaLigaOutcomes.length, 2);
    const yearsInLaLiga = juveLaLigaOutcomes.map((o) => o.teamSeason.year).sort();
    assert.deepStrictEqual(yearsInLaLiga, [2002, 2004]);
    assert(
        Math.abs(juveLaLigaOutcomes[0].probability - juveLaLigaOutcomes[1].probability) < 1e-15,
        'Both equal-distance years in La Liga must share the league probability equally'
    );
}

// ---------------------------------------------------------------------------
// 5. Club Die Fixtures (Sections 47–48)
// ---------------------------------------------------------------------------
{
    // 5A: Exact same-year same-league other club fixture (manchester-united-2008 & real-madrid-2022)
    const mu2008 = TEAM_SEASON_MAP.get('manchester-united-2008');
    const muClubOutcomes = getRerollOutcomeDistribution(mu2008, 'club');
    assert.equal(muClubOutcomes.length, 1);
    assert.equal(muClubOutcomes[0].teamSeason.id, 'arsenal-2008');
    assert.equal(muClubOutcomes[0].teamSeason.year, 2008);
    assert.equal(muClubOutcomes[0].teamSeason.league, 'Premier League');
    assert.notEqual(muClubOutcomes[0].teamSeason.club, 'Manchester United');

    const madrid2022 = TEAM_SEASON_MAP.get('real-madrid-2022');
    const rmClubOutcomes = getRerollOutcomeDistribution(madrid2022, 'club');
    assert.equal(rmClubOutcomes.length, 1);
    assert.equal(rmClubOutcomes[0].teamSeason.id, 'barcelona-2022');
    assert.equal(rmClubOutcomes[0].teamSeason.year, 2022);

    // 5B: Nearest-era fallback fixture (within +-1, +-2, +-3)
    let fallbackCount = 0;
    for (const ts of TEAM_SEASONS) {
        const otherClubs = getClubsByLeague(ts.league).filter((c) => c !== ts.club);
        let minD = Infinity;
        for (const c of otherClubs) {
            for (const other of TEAM_SEASONS.filter((x) => x.league === ts.league && x.club === c)) {
                const d = Math.abs(other.year - ts.year);
                if (d < minD) minD = d;
            }
        }
        if (minD >= 1 && minD <= CLUB_REROLL_MAX_YEAR_DRIFT) {
            fallbackCount++;
            const outcomes = getRerollOutcomeDistribution(ts, 'club');
            assert(outcomes.length > 0, `Fallback club roll ${ts.id} must be non-empty`);
            for (const { teamSeason } of outcomes) {
                assert.equal(teamSeason.league, ts.league);
                assert.notEqual(teamSeason.club, ts.club);
                assert.equal(
                    Math.abs(teamSeason.year - ts.year),
                    minD,
                    `Outcome ${teamSeason.id} year must match globalMinDistance ${minD}`
                );
            }
        }
    }
    assert.equal(fallbackCount, 38, `Expected exactly 38 fallback club TeamSeasons, got ${fallbackCount}`);

    // 5C: Max-drift (>3 years) unavailable fixtures & Porto 2004 regression
    const unavailableClubIds = [
        'manchester-united-1999',
        'bayern-munich-2001',
        'monaco-2017',
        'lille-2021',
        'ajax-2019',
        'psv-2005',
        'porto-2004',
        'benfica-2014',
    ];
    assert.equal(unavailableClubIds.length, 8);
    for (const id of unavailableClubIds) {
        const ts = TEAM_SEASON_MAP.get(id);
        assert.ok(ts);
        assert.deepStrictEqual(
            getRerollOutcomeDistribution(ts, 'club'),
            [],
            `Club reroll for ${id} must return empty array`
        );
        assert.equal(
            hasRerollOption(ts, 'club'),
            false,
            `hasRerollOption for ${id} club must be false`
        );
    }

    // 5D: Club fairness fixture (ac-milan-2022)
    // Target clubs in Serie A at distance 0 (2022): Inter Milan, Juventus, Napoli
    const milan2022 = TEAM_SEASON_MAP.get('ac-milan-2022');
    const milanClubOutcomes = getRerollOutcomeDistribution(milan2022, 'club');
    assert.equal(milanClubOutcomes.length, 3);
    for (const entry of milanClubOutcomes) {
        assert(
            Math.abs(entry.probability - 1 / 3) < 1e-12,
            `Each eligible club in ac-milan-2022 must receive 1/3 probability, got ${entry.probability}`
        );
    }
}

// ---------------------------------------------------------------------------
// 6. Season Die Fixtures (Section 49)
// ---------------------------------------------------------------------------
{
    // Multi-season club: real-madrid-2017
    const madrid2017 = TEAM_SEASON_MAP.get('real-madrid-2017');
    const yearOutcomes = getRerollOutcomeDistribution(madrid2017, 'year');
    assert.equal(yearOutcomes.length, 4, 'Real Madrid has 5 total seasons, so 4 other seasons');
    const targetIds = yearOutcomes.map((o) => o.teamSeason.id).sort();
    assert.deepStrictEqual(targetIds, [
        'real-madrid-2002',
        'real-madrid-2012',
        'real-madrid-2019',
        'real-madrid-2022',
    ]);
    for (const entry of yearOutcomes) {
        assert.equal(entry.teamSeason.club, 'Real Madrid');
        assert.notEqual(entry.teamSeason.year, 2017);
        assert.equal(entry.probability, 0.25);
    }

    // Single-season clubs: porto-2004, ajax-2019
    const porto2004 = TEAM_SEASON_MAP.get('porto-2004');
    assert.deepStrictEqual(getRerollOutcomeDistribution(porto2004, 'year'), []);
    assert.equal(hasRerollOption(porto2004, 'year'), false);

    const ajax2019 = TEAM_SEASON_MAP.get('ajax-2019');
    assert.deepStrictEqual(getRerollOutcomeDistribution(ajax2019, 'year'), []);
    assert.equal(hasRerollOption(ajax2019, 'year'), false);
}

// ---------------------------------------------------------------------------
// 7. Illegal Transition Rejection Tests (Section 50)
// ---------------------------------------------------------------------------
{
    const madrid2022 = TEAM_SEASON_MAP.get('real-madrid-2022');
    const mu2008 = TEAM_SEASON_MAP.get('manchester-united-2008');
    const juve2017 = TEAM_SEASON_MAP.get('juventus-2017');
    const bvb2013 = TEAM_SEASON_MAP.get('borussia-dortmund-2013');
    const chelsea2012 = TEAM_SEASON_MAP.get('chelsea-2012');
    const porto2004 = TEAM_SEASON_MAP.get('porto-2004');
    const benfica2014 = TEAM_SEASON_MAP.get('benfica-2014');
    const bayern2001 = TEAM_SEASON_MAP.get('bayern-munich-2001');

    // League Die: different league, but year not in nearest distribution
    assert.equal(isLegalRerollDestination(madrid2022, mu2008, 'league'), false);
    assert.equal(isValidRerollTransition(madrid2022, mu2008, 'league'), false);
    assert.equal(isLegalRerollDestination(juve2017, bvb2013, 'league'), false);
    assert.equal(isValidRerollTransition(juve2017, bvb2013, 'league'), false);

    // Club Die: same league, other club, but year not nearest legal
    assert.equal(isLegalRerollDestination(mu2008, chelsea2012, 'club'), false);
    assert.equal(isValidRerollTransition(mu2008, chelsea2012, 'club'), false);
    assert.equal(isLegalRerollDestination(porto2004, benfica2014, 'club'), false);
    assert.equal(isValidRerollTransition(porto2004, benfica2014, 'club'), false);
    assert.equal(isLegalRerollDestination(bayern2001, bvb2013, 'club'), false);
    assert.equal(isValidRerollTransition(bayern2001, bvb2013, 'club'), false);

    // Season Die: other club or same year
    assert.equal(isLegalRerollDestination(madrid2022, mu2008, 'year'), false);
    assert.equal(isLegalRerollDestination(madrid2022, madrid2022, 'year'), false);

    // Test transition failure in state engine (applyDraftReroll)
    const state = {
        phase: 'DRAFT',
        teams: [
            {
                id: 'p1',
                name: 'Player 1',
                draft: { phase: 'PICK', locked: false, currentRoll: juve2017 },
                rerolls: { league: 1, club: 1, year: 1 },
            },
        ],
    };
    const rejectedRes = applyDraftReroll(state, 'p1', 'league', bvb2013.id);
    assert.equal(rejectedRes.ok, false);
    assert.equal(rejectedRes.reason, 'invalid_reroll_transition');
    assert.equal(state.teams[0].rerolls.league, 1, 'Token must not be consumed on rejected transition');
    assert.equal(state.teams[0].draft.currentRoll.id, juve2017.id, 'currentRoll must remain unchanged');
}

// ---------------------------------------------------------------------------
// 8. Exact Probability Sum & Deterministic Ordering across all 62 TS x 3 dice
// ---------------------------------------------------------------------------
{
    const orderIndexMap = new Map(TEAM_SEASONS.map((ts, idx) => [ts.id, idx]));

    for (const ts of TEAM_SEASONS) {
        for (const rType of REROLL_TYPES) {
            const dist = getRerollOutcomeDistribution(ts, rType);
            if (dist.length === 0) continue;

            let sum = 0;
            let lastIndex = -1;
            for (let i = 0; i < dist.length; i++) {
                const entry = dist[i];
                assert(entry.probability > 0, `Probability must be positive for ${entry.teamSeason.id}`);
                sum += entry.probability;

                const currIndex = orderIndexMap.get(entry.teamSeason.id);
                assert(
                    currIndex > lastIndex,
                    `Deterministic order violation for ${ts.id} ${rType}: index ${currIndex} <= ${lastIndex}`
                );
                lastIndex = currIndex;
            }

            assert(
                Math.abs(sum - 1.0) < 1e-12,
                `Probability sum for ${ts.id} ${rType} must be 1.0 within 1e-12, got ${sum}`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 9. Deterministic Sampling & RNG Consumption Rules
// ---------------------------------------------------------------------------
{
    let rngCallCount = 0;
    const testRng = () => {
        rngCallCount++;
        return 0.42;
    };

    // Distribution construction must consume 0 RNG calls
    getRerollOutcomeDistribution(TEAM_SEASONS[0], 'league');
    getInitialRollOutcomeDistribution();
    assert.equal(rngCallCount, 0, 'Constructing distributions must consume 0 RNG calls');

    // Sampling from non-empty distribution consumes exactly 1 RNG call
    const dist = getInitialRollOutcomeDistribution();
    const sampled = sampleOutcomeDistribution(dist, testRng);
    assert.ok(sampled);
    assert.equal(rngCallCount, 1, 'sampleOutcomeDistribution must consume exactly 1 RNG call');

    // Sampling from empty distribution consumes 0 RNG calls
    const emptySampled = sampleOutcomeDistribution([], testRng);
    assert.equal(emptySampled, null);
    assert.equal(rngCallCount, 1, 'sampleOutcomeDistribution on empty must consume 0 RNG calls');

    // Identical seeds produce identical sample sequences
    const rngA = createMulberry32(99999);
    const rngB = createMulberry32(99999);
    for (let i = 0; i < 50; i++) {
        const rollA = generateInitialRollTeamSeason(rngA);
        const rollB = generateInitialRollTeamSeason(rngB);
        assert.equal(rollA.id, rollB.id, `Identical seeds must yield identical rolls at step ${i}`);
    }
}

// ---------------------------------------------------------------------------
// 10. Bot EV Shared Contract, NaN-Safety & UI Unavailable Hints
// ---------------------------------------------------------------------------
{
    // Module contract: bot/reroll-value.js exports the exact same reference
    assert.equal(
        botRerollDist,
        getRerollOutcomeDistribution,
        'bot/reroll-value.js getRerollOutcomeDistribution must be identical reference to roll-policy.js'
    );

    const testTeam = {
        id: 'bot-ev-tester',
        roster: createEmptyRoster(),
        rerolls: createInitialRerolls(),
        draft: { phase: 'PICK' },
    };

    for (const ts of TEAM_SEASONS) {
        for (const rType of REROLL_TYPES) {
            const ev = estimateRerollValue({
                team: testTeam,
                currentRoll: ts,
                rerollType: rType,
                bestCurrentPickValue: 80,
                bestCurrentCandidateScore: 80,
            });
            assert.equal(typeof ev.available, 'boolean');
            assert(!Number.isNaN(ev.expectedValue), `expectedValue was NaN for ${ts.id} ${rType}`);
            assert(!Number.isNaN(ev.netExpectedValue), `netExpectedValue was NaN for ${ts.id} ${rType}`);
            assert(!Number.isNaN(ev.netGain), `netGain was NaN for ${ts.id} ${rType}`);
            assert(!Number.isNaN(ev.upgradeProbability), `upgradeProbability was NaN for ${ts.id} ${rType}`);
            assert(!Number.isNaN(ev.deadRollProbability), `deadRollProbability was NaN for ${ts.id} ${rType}`);
        }
    }

    // Porto 2004 Club Reroll unavailable check in Bot EV
    const porto2004 = TEAM_SEASON_MAP.get('porto-2004');
    const portoEv = estimateRerollValue({
        team: testTeam,
        currentRoll: porto2004,
        rerollType: 'club',
    });
    assert.equal(portoEv.available, false, 'Club reroll on porto-2004 must return available: false');

    // UI Headless Hint Verification across zh-CN, ja, and en
    class FakeUiNode {
        constructor(tag, cls = '', text = '') {
            this.tagName = tag.toUpperCase();
            this.className = cls;
            this.textContent = text;
            this.children = [];
            this.disabled = false;
        }
        append(...kids) {
            for (const k of kids) {
                if (k) this.children.push(k);
            }
        }
        addEventListener() {}
    }

    globalThis.document = {
        createElement(tag) {
            return new FakeUiNode(tag);
        },
    };

    const locales = ['zh-CN', 'ja', 'en'];
    for (const loc of locales) {
        setLocale(loc, { persist: false });
        const uiTeam = { rerolls: { league: 1, club: 1, year: 1 } };
        const box = renderRerollControls(uiTeam, porto2004, true, () => {});
        assert.ok(box, 'renderRerollControls must return container');

        const btnRow = box.children.find((c) => c.className === 'fd-reroll-row');
        assert.ok(btnRow, 'Must render fd-reroll-row');
        assert.equal(btnRow.children.length, 3, 'Must render 3 reroll buttons');

        // Button 1 (club) and Button 2 (year) must be disabled for Porto 2004
        const [leagueBtn, clubBtn, yearBtn] = btnRow.children;
        assert.equal(leagueBtn.disabled, false, 'League button should be enabled');
        assert.equal(clubBtn.disabled, true, 'Club button must be disabled for Porto 2004');
        assert.equal(yearBtn.disabled, true, 'Year button must be disabled for Porto 2004');

        const hints = box.children.filter((c) => c.className === 'fd-reroll-hint');
        assert.equal(hints.length, 2, `Expected 2 hints for Porto 2004 in ${loc}, got ${hints.length}`);
        const hintTexts = hints.map((h) => h.textContent).join(' ');
        assert(hintTexts.includes('2004'), `Hint in ${loc} must mention year 2004`);
    }
}

console.log(
    '[smoke-draft-roll-policy-v2] PASS — All constants, initial roll distributions, 1M Monte Carlo verification, dice fixtures, illegal transition rejection, exact sums, determinism, Bot EV, and UI hints succeeded.'
);

const sourcePriority = (policy) => new Map(policy.sourcePriority.map((item) => [item.sourceId, item.priority]));
const compare = (a, b, priorities) => (priorities.get(a.sourceId) ?? Number.MAX_SAFE_INTEGER) - (priorities.get(b.sourceId) ?? Number.MAX_SAFE_INTEGER)
  || a.sourceId.localeCompare(b.sourceId)
  || a.rowNumber - b.rowNumber;

function uniqueGroup(observations, year, priorities) {
  const candidates = observations.filter((o) => o.identityMatch?.status === 'stable_external_id' && o.editionYear === year);
  if (!candidates.length) return { status: 'missing', candidates };
  const counts = new Map();
  for (const row of candidates) counts.set(row.sourceId, (counts.get(row.sourceId) || 0) + 1);
  if ([...counts.values()].some((count) => count > 1)) return { status: 'ambiguous', candidates };
  candidates.sort((a, b) => compare(a, b, priorities));
  return { status: 'unique', candidates, selected: candidates[0] };
}

export function selectSnapshot(observations, seasonYear, policy) {
  const targetEditionYear = seasonYear + policy.targetEditionOffset;
  const priorities = sourcePriority(policy);
  const rejected = [];
  for (const [year, strategy] of [[targetEditionYear, 'y_plus_1'], [seasonYear, 'y_fallback']]) {
    const group = uniqueGroup(observations, year, priorities);
    if (group.status === 'unique') return result(group.selected, targetEditionYear, strategy, 'selected', rejected, policy);
    if (group.status === 'ambiguous') rejected.push({ editionYear: year, strategy, reason: 'duplicate_source_rows', observationIds: group.candidates.map((o) => o.observationId) });
  }
  if (policy.boundedNearest.enabled) {
    const nearest = observations.filter((o) => o.identityMatch?.status === 'stable_external_id'
      && o.editionYear !== targetEditionYear && o.editionYear !== seasonYear
      && Math.abs(o.editionYear - targetEditionYear) <= policy.boundedNearest.maxAbsoluteOffsetFromTargetEdition);
    const years = [...new Set(nearest.map((o) => o.editionYear))].sort((a, b) => Math.abs(a - targetEditionYear) - Math.abs(b - targetEditionYear) || b - a);
    for (const year of years) {
      const group = uniqueGroup(nearest, year, priorities);
      if (group.status === 'unique') return result(group.selected, targetEditionYear, 'bounded_nearest', 'selected', rejected, policy);
      if (group.status === 'ambiguous') rejected.push({ editionYear: year, strategy: 'bounded_nearest', reason: 'duplicate_source_rows', observationIds: group.candidates.map((o) => o.observationId) });
    }
  }
  return {
    targetEditionYear, actualEditionYear: null, yearOffset: null, strategy: 'unavailable',
    selectionStatus: 'unavailable', primaryObservationId: null, primary: null,
    tieBreakRule: policy.boundedNearest.tieBreak.join(' > '), rejected
  };
}

function result(primary, targetEditionYear, strategy, selectionStatus, rejected, policy) {
  return {
    targetEditionYear, actualEditionYear: primary.editionYear,
    yearOffset: primary.editionYear - targetEditionYear, strategy, selectionStatus,
    primaryObservationId: primary.observationId, primary,
    tieBreakRule: policy.boundedNearest.tieBreak.join(' > '), rejected
  };
}

export function verifySnapshotFixtures(policy) {
  const obs = (id, year, sourceId = 'lbenz-fifaindex', rowNumber = 2, status = 'stable_external_id') => ({
    observationId: id, editionYear: year, sourceId, rowNumber,
    identityMatch: { status }
  });
  const check = (name, candidates, expectedStatus, expectedStrategy, expectedYear, seasonYear = 2005) => {
    const selected = selectSnapshot(candidates, seasonYear, policy);
    if (selected.selectionStatus !== expectedStatus || selected.strategy !== expectedStrategy || selected.actualEditionYear !== expectedYear) {
      throw new Error('Snapshot fixture failed: ' + name + ' got ' + JSON.stringify({ status: selected.selectionStatus, strategy: selected.strategy, year: selected.actualEditionYear }));
    }
  };
  check('Y+1 outranks Y', [obs('y', 2005), obs('y1', 2006)], 'selected', 'y_plus_1', 2006);
  check('Y fallback', [obs('y', 2005)], 'selected', 'y_fallback', 2005);
  check('nearest tie prefers later edition', [obs('early', 2004), obs('late', 2008)], 'selected', 'bounded_nearest', 2008, 2005);
  check('name candidate is not selected', [obs('name', 2006, 'lbenz-fifaindex', 2, 'name_candidate')], 'unavailable', 'unavailable', null);
  check('duplicates rejected', [obs('dup-a', 2006, 'lbenz-fifaindex', 2), obs('dup-b', 2006, 'lbenz-fifaindex', 3)], 'unavailable', 'unavailable', null);
  check('outside bound unavailable', [obs('far', 2009)], 'unavailable', 'unavailable', null);
  return 6;
}

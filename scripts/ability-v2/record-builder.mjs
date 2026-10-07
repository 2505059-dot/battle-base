import { parseSourceRating } from './source-adapters.mjs';
import { selectSnapshot } from './snapshots.mjs';

function canonicalScalar(raw, sourceField, observation, mappingVersion, kind, noFieldReason = null) {
  if (!observation) return { value: null, sourceField: sourceField || null, observationId: null, mappingVersion, status: 'unavailable', missingReason: 'no selected stable source observation' };
  if (!sourceField) return { value: null, sourceField: null, observationId: observation.observationId, mappingVersion, status: 'unmapped', missingReason: noFieldReason || 'no confirmed source-field mapping' };
  const parsed = parseSourceRating(raw, sourceField);
  return { value: parsed.value, sourceField, observationId: observation.observationId, mappingVersion,
    status: parsed.value == null ? (parsed.raw ? 'invalid' : 'missing') : 'observed',
    missingReason: parsed.reason, rawString: raw == null ? null : String(raw), valueKind: kind };
}

export function buildPlayerSeasonRecord(target, observations, configs) {
  const selection = selectSnapshot(observations, target.seasonYear, configs.snapshotPolicy);
  const primary = selection.primary;
  const sourceConfig = primary ? configs.sources.sources[primary.sourceId] : null;
  const fieldRule = primary ? configs.fieldMappings.rules.find((rule) => rule.sourceId === primary.sourceId) : null;
  const fields = fieldRule?.fields || {};
  const mappingVersion = configs.fieldMappings.version;
  const attributeNames = configs.fieldMappings.canonicalAttributes;
  const attributes = {};
  for (const name of attributeNames) {
    const sourceField = fields[name] || null;
    const raw = sourceField ? primary?.rawFields[sourceField] : null;
    attributes[name] = sourceField
      ? canonicalScalar(raw, sourceField, primary, mappingVersion, 'attribute')
      : { value: null, sourceField: null, observationId: primary?.observationId || null, mappingVersion, status: primary ? 'unmapped' : 'unavailable', missingReason: primary ? 'no confirmed source-field mapping' : 'no selected stable source observation' };
  }
  const overall = canonicalScalar(primary?.rawOverall, sourceConfig?.overallField || null, primary, mappingVersion, 'overall');
  const potential = canonicalScalar(primary?.rawPotential, sourceConfig?.potentialField || null, primary, mappingVersion, 'potential', sourceConfig?.potentialFieldReason || 'source does not expose a potential field');
  const naturalPositions = primary?.sourcePositions.filter((position) => position.positionKind === 'natural') || [];
  const unresolved = [];
  for (const observation of observations) {
    if (observation.identityMatch.status !== 'stable_external_id') unresolved.push({
      type: 'identity_candidate', observationId: observation.observationId, sourceId: observation.sourceId,
      editionYear: observation.editionYear, matchStatus: observation.identityMatch.status, confidence: observation.identityMatch.confidence
    });
    for (const position of observation.sourcePositions) if (['unresolved','legacy-special','roster-status'].includes(position.mappingStatus)) unresolved.push({
      type: 'position_mapping', observationId: observation.observationId, sourceId: observation.sourceId,
      editionYear: observation.editionYear, sourceField: position.sourceField, nativeCode: position.nativeCode,
      mappingStatus: position.mappingStatus
    });
    for (const rating of observation.observedPositionRatings) if (rating.parseStatus !== 'valid') unresolved.push({
      type: 'position_rating_parse', observationId: observation.observationId, sourceId: observation.sourceId,
      editionYear: observation.editionYear, sourceField: rating.sourceField, rawString: rating.rawString
    });
  }
  if (!primary) unresolved.push({ type: 'snapshot_unavailable', reason: 'no unique stable external-ID observation within the bounded policy window' });
  const observedAttributeCount = Object.values(attributes).filter((value) => value.value != null).length;
  const availability = !primary ? 'unavailable' : observedAttributeCount ? 'available' : 'partial';
  const { primary: ignoredPrimary, ...snapshotSelection } = selection;
  return {
    playerSeasonId: target.playerSeasonId, canonicalPlayerId: target.canonicalPlayerId,
    teamSeasonId: target.teamSeasonId, membershipClub: target.membershipClub,
    identityStatus: target.identityStatus, availability,
    unavailableReason: primary ? null : 'No unique stable external-ID source observation in the configured edition window.',
    snapshotSelection, observations,
    canonical: {
      mappingVersion, overall, potential, attributes, naturalPositions
    },
    positionModel: {
      naturalPositions, rosterPosition: primary?.rosterPosition || null,
      formationSlots: [], tacticalRoles: [], tactics: []
    },
    derived: { status: 'not_implemented', positionRatings: [] },
    legacy: {
      source: 'public/data/team-seasons.js', isTrainingTruth: false,
      originStatus: 'unknown_source_lineage', dimensions: target.legacy
    },
    overrides: configs.overrides.overrides.filter((item) => item.playerSeasonId === target.playerSeasonId),
    unresolved
  };
}

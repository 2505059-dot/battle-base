const positionCodes = ['cam','cb','cdm','cf','cm','gk','lam','lb','lcb','lcm','ldm','lf','lm','ls','lw','lwb','ram','rb','rcb','rcm','rdm','rf','rm','rs','rw','rwb','st'];
const sideOf = (code) => code.startsWith('L') ? 'left' : code.startsWith('R') ? 'right' : ['GK','CB','CDM','CM','CAM','CF','ST'].includes(code) ? 'center' : 'unknown';

function mapToken(rawToken, sourceField, sourceOrder, kind, sourceConfig, globalConfig) {
  const nativeCode = String(rawToken ?? '').trim().toUpperCase();
  const statuses = (sourceConfig.rosterStatuses || []).map((x) => x.toUpperCase());
  if (statuses.includes(nativeCode)) return {
    nativeCode, sourceField, sourceOrder, positionKind: 'status', side: 'unknown', canonicalPosition: null,
    mappingStatus: 'roster-status', preferredClaim: 'not-declared'
  };
  const known = sourceConfig.knownAliases?.[nativeCode];
  const sideAlias = globalConfig.sideAliases?.[nativeCode];
  const direct = globalConfig.canonicalPositions.includes(nativeCode);
  const canonicalPosition = known ? known.canonical : sideAlias ? sideAlias.family : direct ? nativeCode : null;
  const mappingStatus = known?.status || (canonicalPosition ? 'mapped' : 'unresolved');
  const side = known?.side || sideAlias?.side || sideOf(nativeCode);
  return {
    nativeCode, sourceField, sourceOrder, positionKind: kind, side, canonicalPosition, mappingStatus,
    preferredClaim: ['preferred_positions','Preferred Positions'].includes(sourceField) ? 'source-declared' : 'not-declared'
  };
}

export function parseSourcePositions(row, sourceId, config) {
  const source = config.sources[sourceId];
  const positions = [];
  const naturalField = source.naturalPositionsField;
  if (naturalField && row[naturalField] != null && row[naturalField] !== '') {
    const tokens = String(row[naturalField]).split(new RegExp(source.separator || '[,/\\s]+')).map((x) => x.trim()).filter(Boolean);
    tokens.forEach((token, index) => positions.push(mapToken(token, naturalField, index, 'natural', source, config)));
  }
  let rosterPosition = null;
  const rosterField = source.rosterPositionField;
  if (rosterField && row[rosterField] != null && String(row[rosterField]).trim() !== '') {
    rosterPosition = mapToken(row[rosterField], rosterField, 0, 'roster', source, config);
    positions.push(rosterPosition);
  }
  return { sourcePositions: positions, rosterPosition };
}

export function parseObservedPositionRatings(row, sourceId, config) {
  const specification = config.positionRatingFields.sources?.[sourceId];
  if (!specification) return [];
  const codes = specification.codes?.length ? specification.codes : sourceId === 'stefano-legacy' ? positionCodes : [];
  const regex = new RegExp(specification.parsePattern);
  const ratings = [];
  for (const code of codes) {
    const field = specification.codeCase === 'lowercase' ? code.toLowerCase() : code.toUpperCase();
    const raw = row[field];
    if (raw == null || String(raw).trim() === '') continue;
    const rawString = String(raw);
    const match = rawString.match(regex);
    const baseInteger = match ? Number(match[1]) : null;
    const signedModifier = match && match[2] ? Number(match[2]) : null;
    ratings.push({
      nativeCode: code.toUpperCase(), rawString, baseInteger, signedModifier,
      kind: 'observed', sourceField: field, mappingVersion: config.version,
      parseStatus: match && Number.isInteger(baseInteger) ? 'valid' : 'unparsed'
    });
  }
  return ratings;
}

export const POSITION_RATING_CODES = positionCodes.map((x) => x.toUpperCase());

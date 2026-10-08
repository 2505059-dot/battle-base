export function sourceLocalCardIdentity(site, detailUrl, rawFields = {}) {
  let id = null;
  let namespace = null;
  try {
    const url = new URL(detailUrl);
    if (site === 'wefut') { id = url.pathname.match(/\/player\/\d+\/(\d+)(?:\/|$)/)?.[1] ?? null; namespace = 'wefut:card'; }
    else if (site === 'fo4') { id = url.pathname.match(/\/fo4db\/(pid[^/?#]+)/i)?.[1] ?? null; namespace = 'fifaaddict:fo4-pid'; }
    else if (site === 'fo3') { id = url.searchParams.get('id'); namespace = 'fifaaddict:fo3-card'; }
    else if (site === 'nexon-fco') { id = String(rawFields.spid ?? url.searchParams.get('spid') ?? '') || null; namespace = 'nexon-fco:spid'; }
  } catch { /* Preserve a missing source-local identifier as null. */ }
  const rawPersonId = rawFields.basePersonId;
  const normalizedPersonId = rawPersonId == null ? '' : String(rawPersonId).trim();
  const sourcePlayerId = normalizedPersonId || null;
  return {
    cardId: id == null ? null : (/^\d+$/.test(String(id)) ? Number(id) : String(id)),
    sourceCardId: id == null ? null : String(id),
    sourceIdNamespace: namespace,
    sourcePlayerId,
    numericIdentityEvidence: null,
  };
}

export function applySourceLocalCardIdentity(candidate) {
  const identity = sourceLocalCardIdentity(candidate.site, candidate.detailUrl, candidate.rawFields ?? {});
  return {
    ...candidate,
    cardId: candidate.cardId ?? identity.cardId,
    sourceCardId: candidate.sourceCardId ?? identity.sourceCardId,
    sourceIdNamespace: candidate.sourceIdNamespace ?? identity.sourceIdNamespace,
    sourcePlayerId: identity.sourcePlayerId,
    numericIdentityEvidence: candidate.numericIdentityEvidence ?? null,
  };
}

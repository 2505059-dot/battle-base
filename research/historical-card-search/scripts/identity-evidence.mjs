const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

function verifiedNumericMatch(player, evidence) {
  if (!evidence || evidence.verified !== true || evidence.value == null) return false;
  const targetNamespace = evidence.targetNamespace;
  const sourceNamespace = evidence.sourceNamespace;
  const reference = evidence.reference;
  if (!targetNamespace || !sourceNamespace || typeof reference !== 'string' || !reference.trim()) return false;
  const targetValue = player.existingExternalIds?.[targetNamespace];
  if (targetValue == null || String(targetValue) !== String(evidence.value)) return false;
  if (evidence.relationship === 'same_namespace') return sourceNamespace === targetNamespace;
  if (evidence.relationship === 'documented_crosswalk') {
    return evidence.crosswalk?.sourceNamespace === sourceNamespace &&
      evidence.crosswalk?.targetNamespace === targetNamespace &&
      typeof evidence.crosswalk?.reference === 'string' && Boolean(evidence.crosswalk.reference.trim());
  }
  return false;
}

export function classifyIdentity(player, cardName, numericIdentityEvidence = null) {
  if (verifiedNumericMatch(player, numericIdentityEvidence)) return { level: 'high', evidence: 'verified_external_id_namespace_match' };
  const card = normalize(cardName);
  if (!card) return { level: 'none', evidence: 'missing_card_name' };
  const names = [...new Set([...(player.rosterNames ?? []), player.canonicalName, ...(player.searchTerms ?? [])].filter(Boolean))];
  if (names.some((name) => normalize(name) === card)) return { level: 'low', evidence: 'exact_name_only' };
  if (names.map(normalize).filter((name) => name.split(' ').length >= 2).some((name) => card.startsWith(name + ' '))) return { level: 'low', evidence: 'full_name_and_card_alias_in_result' };
  const cardParts = card.split(' ');
  if (cardParts.length >= 2) {
    for (const name of names) {
      const parts = normalize(name).split(' ');
      const first = parts[0] ?? ''; const last = parts.at(-1) ?? '';
      if (first.length > 1 && cardParts.at(-1) === last && cardParts[0].startsWith(first[0]))
        return { level: 'low', evidence: 'first_initial_and_surname' };
    }
  }
  const similar = names.some((name) => { const n = normalize(name); return n && (n.includes(card) || card.includes(n)); });
  return { level: 'none', evidence: similar ? 'substring_name_only_unconfirmed' : 'name_mismatch' };
}

export function classifyCandidateIdentity(player, candidate) {
  if (candidate.site === 'nexon-fco' && candidate.identity_confidence === 'unverified') {
    return { level: 'unverified', evidence: candidate.identity_evidence || 'source_identity_crosswalk_unverified' };
  }
  return classifyIdentity(player, candidate.name, candidate.numericIdentityEvidence ?? null);
}

export function refreshCandidateIdentity(player, candidate) {
  const identity = classifyCandidateIdentity(player, candidate);
  const updated = {
    ...candidate,
    identity_confidence: identity.level,
    identity_evidence: identity.evidence,
    card_found: identity.level === 'unverified' ? Boolean(candidate.card_found) : identity.level !== 'none',
    overall_found: identity.level !== 'none' && Number.isFinite(candidate.overall),
    attributes_found: identity.level !== 'none' && Boolean(candidate.attributes_found),
  };
  if (candidate.identity_confidence !== identity.level || candidate.identity_evidence !== identity.evidence) {
    updated.identityConfidenceRefresh = {
      priorConfidence: candidate.identity_confidence ?? null,
      priorEvidence: candidate.identity_evidence ?? null,
      rule: 'Numeric identifiers count only with an explicit same-namespace contract or documented crosswalk; source-local IDs remain separate.',
    };
  }
  return updated;
}

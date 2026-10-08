export function birthYear(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const eastAsian = text.match(/(\d{4})\s*年/);
  if (eastAsian) return Number(eastAsian[1]);
  const leadingYear = text.match(/^\s*(\d{4})(?:[-/.年]|$)/);
  if (leadingYear) return Number(leadingYear[1]);
  const trailingYear = text.match(/(?:^|\D)(\d{4})\s*$/);
  return trailingYear ? Number(trailingYear[1]) : null;
}

export function ageAtRosterYear(candidate, playerSeason) {
  const born = birthYear(candidate?.dateOfBirth);
  const seasonYear = Number(playerSeason?.year);
  return Number.isInteger(born) && Number.isInteger(seasonYear) ? seasonYear - born : null;
}

export function ageConflictAtRosterYear(candidate, playerSeason) {
  const age = ageAtRosterYear(candidate, playerSeason);
  return age !== null && age < 14;
}

export function identityLinkedForSeason(candidate, playerSeason) {
  return candidate?.identity_confidence !== 'none' && !ageConflictAtRosterYear(candidate, playerSeason);
}
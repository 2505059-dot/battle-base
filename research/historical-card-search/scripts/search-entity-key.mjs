const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function searchEntityKeyFor(record) {
  if (record?.searchEntityKey) return String(record.searchEntityKey);
  const id = record?.playerId ?? record?.searchedPlayerId;
  if (id !== null && id !== undefined && String(id) !== '') return `entity:${String(id)}`;
  const name = normalize(record?.canonicalName ?? record?.searchedCanonicalName ?? record?.name);
  const seasons = [...new Set((record?.playerSeasonIds ?? []).map(String))].sort();
  if (!name && seasons.length === 0) throw new Error('Cannot derive a stable searchEntityKey without an ID, name, or PlayerSeason key.');
  return `unresolved:${encodeURIComponent(name || 'unnamed')}:${seasons.map(encodeURIComponent).join(',')}`;
}

export function assertUniqueSearchEntityKeys(records) {
  const keys = records.map(searchEntityKeyFor);
  if (new Set(keys).size !== keys.length) throw new Error(`Expected unique searchEntityKey values, found ${new Set(keys).size} for ${keys.length} entities.`);
  return keys;
}
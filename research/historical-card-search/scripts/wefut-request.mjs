const NON_SORTABLE_COLUMNS = new Set([0, 8, 10, 11, 12, 67, 68, 73]);
const FILTERS = ['rating','pace_tot','shooting_tot','passing_tot','dribbling_tot','defending_tot','heading_tot','acceleration','agility','balance','jumping','reactions','sprintspeed','stamina','strength','aggression','tact_aware','positioning','vision','potential','ball_control','crossing','curve','dribbling','finishing','fk_acc','heading_acc','longpass','longshot','marking','penalties','shortpass','shotpower','sliding_tackle','standing_tackle','volleys','gk_diving','gk_handling','gk_kicking','gk_reflexes','gk_speed','gk_positioning','height','weight'];

export function wefutRequestColumnCount(schema) {
  const count = Number(schema?.headerColumnCount);
  return schema?.tableId === 'playerTable' && Number.isInteger(count) && count >= 19 ? count : null;
}

export function buildWefutPostBody(term, start, csrf, columnCount) {
  if (!Number.isInteger(columnCount) || columnCount < 19) throw new RangeError('A verified playerTable header column count is required.');
  const fields = new URLSearchParams();
  fields.set('sEcho', String(Math.floor(start / 100) + 1));
  fields.set('iColumns', String(columnCount));
  const columns = Array.from({ length: columnCount }, (_, index) => index === 0 ? 'player_card' : String(index));
  fields.set('sColumns', columns.join(','));
  fields.set('iDisplayStart', String(start));
  fields.set('iDisplayLength', '100');
  for (let index = 0; index < columnCount; index++) {
    fields.set(`mDataProp_${index}`, columns[index]);
    fields.set(`sSearch_${index}`, '');
    fields.set(`bRegex_${index}`, 'false');
    fields.set(`bSearchable_${index}`, 'true');
    fields.set(`bSortable_${index}`, String(!NON_SORTABLE_COLUMNS.has(index)));
  }
  fields.set('sSearch', term);
  fields.set('bRegex', 'false');
  fields.set('iSortingCols', '1');
  fields.set('iSortCol_0', '4');
  fields.set('sSortDir_0', 'desc');
  for (const filter of FILTERS) {
    fields.set(`min_${filter}`, '');
    fields.set(`max_${filter}`, '');
  }
  for (const filter of ['awr','dwr','skillmoves','weakfoot','preferredfoot','console','type','clubs','nations','positions','traits','minprice','maxprice','cardtype','min_dob','max_dob','totw']) fields.set(filter, '');
  fields.set('wf_csrf', csrf);
  return fields.toString();
}

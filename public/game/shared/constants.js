// Shared constants across Draft and Match modules (language-independent)

export const ROLES = ['GK', 'DF', 'MF', 'FW'];

export const FORMATION_NAME = '4-3-3';

export const ROSTER_SLOTS = [
    { id: 'GK1', role: 'GK', index: 1 },

    { id: 'DF1', role: 'DF', index: 1 },
    { id: 'DF2', role: 'DF', index: 2 },
    { id: 'DF3', role: 'DF', index: 3 },
    { id: 'DF4', role: 'DF', index: 4 },

    { id: 'MF1', role: 'MF', index: 1 },
    { id: 'MF2', role: 'MF', index: 2 },
    { id: 'MF3', role: 'MF', index: 3 },

    { id: 'FW1', role: 'FW', index: 1 },
    { id: 'FW2', role: 'FW', index: 2 },
    { id: 'FW3', role: 'FW', index: 3 },
];

export const SLOTS = ROSTER_SLOTS.map((slot) => slot.id);

const SLOT_DEFINITION_MAP = new Map(ROSTER_SLOTS.map((slot) => [slot.id, slot]));

export function getSlotDefinition(slotId) {
    return SLOT_DEFINITION_MAP.get(slotId) ?? null;
}

export function getSlotRole(slotId) {
    return SLOT_DEFINITION_MAP.get(slotId)?.role ?? null;
}

export function getSlotsForRole(role) {
    return ROSTER_SLOTS.filter((slot) => slot.role === role).map((slot) => slot.id);
}

export function formatSlotLabel(slotId) {
    const def = getSlotDefinition(slotId);
    if (!def) return String(slotId ?? '');
    if (def.role === 'GK') return 'GK';
    return `${def.role} ${def.index}`;
}

export const REROLL_TYPES = ['league', 'club', 'year'];

export const REROLL_LABEL_KEYS = {
    league: 'draft.rerollLeague',
    club: 'draft.rerollClub',
    year: 'draft.rerollYear',
};

export const REROLL_SHORT_LABEL_KEYS = {
    league: 'draft.rerollLeagueShort',
    club: 'draft.rerollClubShort',
    year: 'draft.rerollYearShort',
};

export const MAX_HISTORY_ITEMS = 8;


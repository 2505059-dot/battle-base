// Shared constants across Draft and Match modules (language-independent)

export const SLOTS = ['GK', 'DF', 'MF', 'FW', 'FLEX'];

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

// Lightweight zero-dependency i18n runtime (ja / en / zh-CN)

import { ja } from './ja.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import {
    PLAYER_LOCALIZATIONS,
    CLUB_LOCALIZATIONS,
    LEAGUE_LOCALIZATIONS,
    PLAYER_CANONICAL_TO_ID,
    CLUB_CANONICAL_TO_ID,
    LEAGUE_CANONICAL_TO_ID,
} from '../data/entity-localizations.js';

export const SUPPORTED_LOCALES = ['ja', 'en', 'zh-CN'];
export const DEFAULT_LOCALE = 'ja';
export const LOCALE_STORAGE_KEY = 'battle-base-locale';

export const DICTIONARIES = {
    ja,
    en,
    'zh-CN': zhCN,
};

const ENTITY_TABLES = {
    player: {
        byId: PLAYER_LOCALIZATIONS,
        canonicalToId: PLAYER_CANONICAL_TO_ID,
    },
    club: {
        byId: CLUB_LOCALIZATIONS,
        canonicalToId: CLUB_CANONICAL_TO_ID,
    },
    league: {
        byId: LEAGUE_LOCALIZATIONS,
        canonicalToId: LEAGUE_CANONICAL_TO_ID,
    },
};

const listeners = new Set();
const warnedMissingKeys = new Set();

export function normalizeLocale(input) {
    if (!input || typeof input !== 'string') return null;
    const raw = input.trim().toLowerCase();
    if (!raw) return null;

    if (raw === 'ja' || raw.startsWith('ja-') || raw.startsWith('ja_')) {
        return 'ja';
    }
    if (raw === 'zh' || raw.startsWith('zh-') || raw.startsWith('zh_')) {
        return 'zh-CN';
    }
    if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_')) {
        return 'en';
    }
    return null;
}

function readStoredLocale() {
    try {
        if (typeof localStorage !== 'undefined') {
            return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
        }
    } catch {
        // Ignore storage errors in restricted environments
    }
    return null;
}

function writeStoredLocale(locale) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        }
    } catch {
        // Ignore storage errors
    }
}

function detectNavigatorLocale() {
    try {
        if (typeof navigator !== 'undefined') {
            if ( typeof navigator.language === 'string') {
                const matched = normalizeLocale(navigator.language);
                if (matched) return matched;
            }
            if (Array.isArray(navigator.languages)) {
                for (const lang of navigator.languages) {
                    const matched = normalizeLocale(lang);
                    if (matched) return matched;
                }
            }
        }
    } catch {
        // Ignore navigator access errors
    }
    return null;
}

export function detectInitialLocale() {
    return readStoredLocale() ?? detectNavigatorLocale() ?? DEFAULT_LOCALE;
}

let currentLocale = detectInitialLocale();

function syncDocumentLang(locale) {
    try {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = locale;
        }
    } catch {
        // Ignore DOM access errors in headless tests
    }
}

syncDocumentLang(currentLocale);

export function getLocale() {
    return currentLocale;
}

export function setLocale(nextLocale) {
    const resolved = normalizeLocale(nextLocale) ?? DEFAULT_LOCALE;
    const changed = resolved !== currentLocale;
    currentLocale = resolved;
    writeStoredLocale(currentLocale);
    syncDocumentLang(currentLocale);

    if (changed) {
        for (const cb of listeners) {
            try {
                cb(currentLocale);
            } catch (err) {
                console.error('[i18n] subscriber error:', err);
            }
        }
    }
    return currentLocale;
}

export function subscribeLocaleChange(callback) {
    if (typeof callback !== 'function') return () => {};
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

function lookupPath(dict, keyPath) {
    if (!dict || typeof keyPath !== 'string') return undefined;
    const parts = keyPath.split('.');
    let cur = dict;
    for (const part of parts) {
        if (cur && typeof cur === 'object' && part in cur) {
            cur = cur[part];
        } else {
            return undefined;
        }
    }
    return typeof cur === 'string' ? cur : undefined;
}

export function t(key, params = {}, localeOverride = null) {
    const activeLocale = localeOverride
        ? (normalizeLocale(localeOverride) ?? DEFAULT_LOCALE)
        : currentLocale;

    let template = lookupPath(DICTIONARIES[activeLocale], key);
    if (template === undefined && activeLocale !== DEFAULT_LOCALE) {
        template = lookupPath(DICTIONARIES[DEFAULT_LOCALE], key);
    }

    if (template === undefined) {
        if (!warnedMissingKeys.has(key)) {
            warnedMissingKeys.add(key);
            console.warn(`[i18n] Missing translation key: "${key}"`);
        }
        return key;
    }

    if (!params || typeof params !== 'object') {
        return template;
    }

    return template.replace(/\{(\w+)\}/g, (_, token) => {
        return token in params && params[token] !== undefined && params[token] !== null
            ? String(params[token])
            : '';
    });
}

function resolveEntityRecord(type, canonicalOrId) {
    if (!canonicalOrId || typeof canonicalOrId !== 'string') return null;
    const raw = canonicalOrId.trim();
    if (!raw) return null;
    const table = ENTITY_TABLES[type];
    if (!table) return null;

    const mappedId = table.canonicalToId?.[raw];
    if (mappedId && table.byId?.[mappedId]) {
        return table.byId[mappedId];
    }
    if (table.byId?.[raw]) {
        return table.byId[raw];
    }
    return null;
}

export function formatEntityName(type, canonicalName, localeOverride = null) {
    try {
        if (canonicalName === null || canonicalName === undefined) return '';
        const raw = String(canonicalName).trim();
        if (!raw) return '';

        const activeLocale = localeOverride
            ? (normalizeLocale(localeOverride) ?? DEFAULT_LOCALE)
            : currentLocale;

        const record = resolveEntityRecord(type, raw);
        if (record) {
            if (activeLocale === 'en') {
                return record.localizedNames?.en || record.canonicalName || raw;
            }
            const localized = record.localizedNames?.[activeLocale];
            if (typeof localized === 'string' && localized.trim().length > 0) {
                return localized.trim();
            }
            return record.canonicalName || raw;
        }

        if (type === 'league') {
            const dict = DICTIONARIES[activeLocale];
            const dictVal = dict?.leagues?.[raw];
            if (typeof dictVal === 'string' && dictVal.trim().length > 0) {
                return dictVal.trim();
            }
        }

        return raw;
    } catch {
        return canonicalName ? String(canonicalName) : '';
    }
}

export function formatPlayerName(canonicalPlayer, localeOverride = null) {
    return formatEntityName('player', canonicalPlayer, localeOverride);
}

export function formatClubName(canonicalClub, localeOverride = null) {
    return formatEntityName('club', canonicalClub, localeOverride);
}

export function formatLeagueName(canonicalLeague, localeOverride = null) {
    return formatEntityName('league', canonicalLeague, localeOverride);
}

function buildEntityDisplayName(type, canonicalName, localeOverride = null) {
    try {
        if (canonicalName === null || canonicalName === undefined) {
            return { primary: '', secondary: null };
        }
        const raw = String(canonicalName).trim();
        if (!raw) {
            return { primary: '', secondary: null };
        }

        const activeLocale = localeOverride
            ? (normalizeLocale(localeOverride) ?? DEFAULT_LOCALE)
            : currentLocale;

        const record = resolveEntityRecord(type, raw);
        const canonical = record?.canonicalName || raw;

        if (activeLocale === 'en') {
            return { primary: canonical, secondary: null };
        }

        const localized = record?.localizedNames?.[activeLocale];
        if (typeof localized === 'string' && localized.trim().length > 0) {
            return {
                primary: localized.trim(),
                secondary: canonical,
            };
        }

        return {
            primary: canonical,
            secondary: null,
        };
    } catch {
        return {
            primary: canonicalName ? String(canonicalName) : '',
            secondary: null,
        };
    }
}

export function getPlayerDisplayName(canonicalPlayer, localeOverride = null) {
    return buildEntityDisplayName('player', canonicalPlayer, localeOverride);
}

export function getClubDisplayName(canonicalClub, localeOverride = null) {
    return buildEntityDisplayName('club', canonicalClub, localeOverride);
}

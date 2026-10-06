import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const i18nDir = path.resolve(__dirname, '../public/i18n');

const LOCALES = ['ja', 'en', 'zh-CN'];

/**
 * Flatten nested dictionary object into dot-notation key -> string value map.
 */
function flattenDict(obj, prefix = '', result = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenDict(v, key, result);
    } else {
      result[key] = v;
    }
  }
  return result;
}

/**
 * Extract sorted array of placeholder names `{name}` from a template string.
 */
function extractPlaceholders(str) {
  if (typeof str !== 'string') return [];
  const matches = [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return [...new Set(matches)].sort();
}

async function main() {
  const dicts = {};
  const EXPORT_NAMES = { ja: 'ja', en: 'en', 'zh-CN': 'zhCN' };
  for (const locale of LOCALES) {
    const modPath = pathToFileURL(path.join(i18nDir, `${locale}.js`)).href;
    const mod = await import(modPath);
    const dictObj = mod.default || mod[EXPORT_NAMES[locale]];
    if (!dictObj || typeof dictObj !== 'object') {
      console.error(`[FAIL] ${locale}.js does not export a valid dictionary object.`);
      process.exit(1);
    }
    dicts[locale] = flattenDict(dictObj);
  }

  const baseLocale = 'ja';
  const baseKeys = Object.keys(dicts[baseLocale]).sort();
  let errorCount = 0;

  for (const locale of LOCALES) {
    const currentMap = dicts[locale];
    const currentKeys = Object.keys(currentMap).sort();

    // Check non-string values
    for (const [k, v] of Object.entries(currentMap)) {
      if (typeof v !== 'string') {
        console.error(`[FAIL] [${locale}] Key "${k}" is not a string (got ${typeof v}).`);
        errorCount++;
      } else if (v.trim().length === 0) {
        console.error(`[FAIL] [${locale}] Key "${k}" is an empty string.`);
        errorCount++;
      }
    }

    if (locale === baseLocale) continue;

    // Missing keys compared to base
    for (const k of baseKeys) {
      if (!(k in currentMap)) {
        console.error(`[FAIL] [${locale}] Missing key: "${k}" (present in ${baseLocale})`);
        errorCount++;
      }
    }

    // Extra keys compared to base
    for (const k of currentKeys) {
      if (!(k in dicts[baseLocale])) {
        console.error(`[FAIL] [${locale}] Extra key: "${k}" (not present in ${baseLocale})`);
        errorCount++;
      }
    }

    // Placeholder parity check
    for (const k of baseKeys) {
      if (!(k in currentMap)) continue;
      const basePlaceholders = extractPlaceholders(dicts[baseLocale][k]);
      const localePlaceholders = extractPlaceholders(currentMap[k]);
      if (basePlaceholders.join(',') !== localePlaceholders.join(',')) {
        console.error(
          `[FAIL] [${locale}] Placeholder mismatch on key "${k}": ` +
            `${baseLocale}={${basePlaceholders.join(', ')}} vs ${locale}={${localePlaceholders.join(', ')}}`
        );
        errorCount++;
      }
    }
  }

  if (errorCount > 0) {
    console.error(`\n[check-i18n] FAILED with ${errorCount} error(s).`);
    process.exit(1);
  }

  console.log(
    `[check-i18n] OK — Verified ${baseKeys.length} translation keys and placeholders across ${LOCALES.join(', ')}.`
  );
}

main().catch((err) => {
  console.error('[check-i18n] Unexpected error:', err);
  process.exit(1);
});

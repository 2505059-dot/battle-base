function text(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function className(tag) {
  return tag.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? '';
}

function sectionRanges(html) {
  const ranges = [];
  for (const match of html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)) {
    if (!/<li\b[^>]*class\s*=\s*(["'])[^"']*\bab\b[^"']*\1/i.test(match[2])) continue;
    const section = /\bdata_wrap_playerinfo\b/i.test(className(match[0]))
      ? 'detailed_attributes'
      : 'summary_ratings';
    ranges.push({ start: match.index, end: match.index + match[0].length, section });
  }
  return ranges;
}

export function parseNexonAttributeEntries(fragment) {
  const html = String(fragment ?? '');
  const ranges = sectionRanges(html);
  const entries = [];
  const itemPattern = /<li\b[^>]*class\s*=\s*(["'])[^"']*\bab\b[^"']*\1[^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const labelHtml = match[2].match(/<[^>]*class\s*=\s*(["'])[^"']*\btxt\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[2] ?? '';
    const valueHtml = match[2].match(/<[^>]*class\s*=\s*(["'])[^"']*\bvalue\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[2] ?? '';
    const label = text(labelHtml);
    const valueText = text(valueHtml);
    if (!label || !valueText) continue;
    const valueMatch = valueText.match(/-?\d+/);
    const range = ranges.find((item) => match.index >= item.start && match.index < item.end);
    entries.push({
      index: entries.length,
      section: range?.section ?? 'unclassified',
      label,
      value: valueMatch ? Number(valueMatch[0]) : null,
      valueText,
      rawLabelHtml: labelHtml,
      rawValueHtml: valueHtml,
    });
  }
  return entries;
}

function collectSection(entries, section, target, duplicates, ambiguities) {
  const occurrences = new Map();
  for (const entry of entries.filter((item) => item.section === section)) {
    const key = entry.label;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    if (entry.value == null) continue;
    if (occurrence === 1) {
      target[key] = entry.value;
      continue;
    }
    const first = target[key];
    const equal = first === entry.value;
    duplicates.push({ section, label: key, occurrence, firstValue: first, value: entry.value, equal });
    if (!equal) {
      target[`${key}#${occurrence}`] = entry.value;
      ambiguities.push({ section, label: key, occurrence, firstValue: first, value: entry.value });
    }
  }
}

export function normalizeNexonAttributeEntries(entries) {
  const summaryRatings = {};
  const attributes = {};
  const duplicates = [];
  const ambiguities = [];
  collectSection(entries, 'summary_ratings', summaryRatings, duplicates, ambiguities);
  collectSection(entries, 'detailed_attributes', attributes, duplicates, ambiguities);
  const detailedEntries = entries.filter((item) => item.section === 'detailed_attributes');
  const unclassifiedEntries = entries.filter((item) => item.section === 'unclassified');
  const detailedAmbiguity = ambiguities.some((item) => item.section === 'detailed_attributes');
  return {
    summaryRatings,
    attributes,
    attributes_found: detailedEntries.length >= 20 && Object.keys(attributes).length >= 20 && !detailedAmbiguity && unclassifiedEntries.length === 0,
    attributes_ambiguous: ambiguities.length > 0 || unclassifiedEntries.length > 0,
    attributeAmbiguities: ambiguities,
    duplicateAttributeLabels: duplicates,
    unclassifiedEntryCount: unclassifiedEntries.length,
    summaryRatingCount: Object.keys(summaryRatings).length,
    detailedAttributeEntryCount: detailedEntries.length,
    detailedAttributeCount: Object.keys(attributes).length,
  };
}

export function wefutPaginationCompleteness(pages, rawUniqueRows) {
  if (!pages.length) return { complete: false, reason: 'no_page_counts', reportedCounts: [] };
  const rawCounts = pages.map((page) => page.reported);
  const reportedCounts = rawCounts.map((count) => Number(count));
  if (rawCounts.some((count) => count == null || count === '') || reportedCounts.some((count) => !Number.isFinite(count) || count < 0)) {
    return { complete: false, reason: 'invalid_or_missing_reported_count', reportedCounts: rawCounts };
  }
  if (reportedCounts.some((count) => count !== reportedCounts[0])) {
    return { complete: false, reason: 'reported_count_changed', reportedCounts };
  }
  if (Number(pages.at(-1).rows) >= 100) {
    return { complete: false, reason: 'last_page_not_terminal', reportedCounts };
  }
  if (rawUniqueRows !== reportedCounts[0]) {
    return { complete: false, reason: 'reported_count_does_not_match_raw_unique_rows', reportedCounts };
  }
  return { complete: true, reason: null, reportedCounts };
}

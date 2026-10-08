export function searchCompletenessOf(observations = []) {
  const gotResponse = observations.some((item) => item.requestSucceeded === true || ['ok', 'partial', 'unverified'].includes(item.status));
  if (!gotResponse) return { state: 'unknown', possiblyTruncated: false };
  const complete = observations.length > 0 && observations.every((item) => item.searchCompleteness === 'complete' && !item.possiblyTruncated && !item.truncated);
  const uncertain = observations.some((item) => item.searchCompleteness !== 'complete' || item.possiblyTruncated || item.truncated);
  return { state: complete ? 'complete' : 'partial', possiblyTruncated: !complete || uncertain };
}
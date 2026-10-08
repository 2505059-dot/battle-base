import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const CANDIDATES_PATH = resolve(DIR, 'results/candidates.json');
const HEADERS_PATH = resolve(DIR, 'results/wefut-edition-headers.json');
const COVERAGE_PATH = resolve(DIR, 'results/coverage-report.json');
const REPORT_PATH = resolve(DIR, 'results/report.md');
const MANIFEST_PATH = resolve(DIR, 'results/run-manifest.json');

function headerForEdition(headerAudit, edition) {
  return (headerAudit?.entries ?? []).find((entry) => Number(entry.edition) === Number(edition))?.headerEvidence ?? null;
}

export function candidateDataProjection(candidate) {
  const copy = structuredClone(candidate);
  if (copy.rawFields) {
    delete copy.rawFields.wefutHeaderEvidence;
    delete copy.rawFields.wefutHeaderEvidenceRef;
    delete copy.rawFields.attributeSourceEvidence;
  }
  if (copy.attributeSourceEvidence) delete copy.attributeSourceEvidence.presentSourceColumns;
  return copy;
}

export function compactCandidateEvidence(candidate, headerAudit) {
  if (candidate.site !== 'wefut') return candidate;
  const rawFields = { ...(candidate.rawFields ?? {}) };
  const embedded = rawFields.wefutHeaderEvidence ?? null;
  const existingRef = rawFields.wefutHeaderEvidenceRef ?? null;
  const sourceEvidence = candidate.attributeSourceEvidence ?? null;
  const edition = Number(candidate.edition ?? embedded?.edition ?? existingRef?.edition ?? sourceEvidence?.edition);
  const sharedHeader = headerForEdition(headerAudit, edition);
  const claimedHash = embedded?.headerSha256 ?? sourceEvidence?.headerSha256 ?? existingRef?.sha256 ?? null;

  if (typeof claimedHash !== 'string' || !/^[a-f0-9]{64}$/.test(claimedHash)) return candidate;
  if (!sharedHeader?.headerSha256 || sharedHeader.headerSha256 !== claimedHash) {
    throw new Error(`WeFUT header hash cannot be resolved to the shared audit for edition ${edition}.`);
  }
  delete rawFields.wefutHeaderEvidence;
  delete rawFields.attributeSourceEvidence;
  if (sharedHeader?.headerSha256 && claimedHash === sharedHeader.headerSha256) {
    rawFields.wefutHeaderEvidenceRef = {
      path: 'results/wefut-edition-headers.json', edition, sha256: sharedHeader.headerSha256,
    };
  } else delete rawFields.wefutHeaderEvidenceRef;

  const attributeSourceEvidence = sourceEvidence ? { ...sourceEvidence } : sourceEvidence;
  if (attributeSourceEvidence) delete attributeSourceEvidence.presentSourceColumns;
  return { ...candidate, rawFields, attributeSourceEvidence };
}

function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function preservedCandidateBaseline(previous, currentBytes, dataHash, idsHash, reportText = '') {
  if (previous?.candidateDataProjectionSha256 !== dataHash || previous?.candidateIdProjectionSha256 !== idsHash) return currentBytes;
  if (Number.isSafeInteger(previous.originalBytes) && previous.originalBytes >= currentBytes) return previous.originalBytes;
  const documented = Number(reportText.match(/压缩前\s+([\d,]+)\s+字节/)?.[1]?.replaceAll(',', ''));
  return Number.isSafeInteger(documented) && documented >= currentBytes ? documented : currentBytes;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const document = JSON.parse(await readFile(CANDIDATES_PATH, 'utf8'));
  const headerAudit = JSON.parse(await readFile(HEADERS_PATH, 'utf8'));
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(document.candidates)) throw new Error('Candidate output must contain a candidates array.');
  const { size: inputBytes } = await stat(CANDIDATES_PATH);
  const beforeProjectionHash = digest(document.candidates.map(candidateDataProjection));
  const beforeIdsHash = digest(document.candidates.map((candidate) => [candidate.site, candidate.searchEntityKey, candidate.edition ?? null, candidate.sourceIdNamespace ?? null, candidate.sourceCardId ?? null, candidate.cardId ?? null, candidate.sourceUrl ?? null, candidate.detailUrl ?? null]));
  const reportText = await readFile(REPORT_PATH, 'utf8');
  const originalBytes = preservedCandidateBaseline(manifest.compaction, inputBytes, beforeProjectionHash, beforeIdsHash, reportText);
  let headerReferenceCount = 0;
  document.candidates = document.candidates.map((candidate) => {
    const compacted = compactCandidateEvidence(candidate, headerAudit);
    if (compacted.site === 'wefut' && compacted.rawFields?.wefutHeaderEvidenceRef) headerReferenceCount++;
    return compacted;
  });
  const afterProjectionHash = digest(document.candidates.map(candidateDataProjection));
  const afterIdsHash = digest(document.candidates.map((candidate) => [candidate.site, candidate.searchEntityKey, candidate.edition ?? null, candidate.sourceIdNamespace ?? null, candidate.sourceCardId ?? null, candidate.cardId ?? null, candidate.sourceUrl ?? null, candidate.detailUrl ?? null]));
  if (beforeProjectionHash !== afterProjectionHash || beforeIdsHash !== afterIdsHash) throw new Error('Compaction changed candidate IDs, raw source values, URLs, or normalized attributes.');
  const tempPath = `${CANDIDATES_PATH}.compact.tmp`;
  await mkdir(dirname(CANDIDATES_PATH), { recursive: true });
  const serialized = `${JSON.stringify(document)}\n`;
  await writeFile(tempPath, serialized, 'utf8');
  await rename(tempPath, CANDIDATES_PATH);
  const { size } = await stat(CANDIDATES_PATH);
  const scriptBytes = await readFile(fileURLToPath(import.meta.url));
  manifest.postprocessingCodeSha256 ??= {};
  manifest.postprocessingCodeSha256['scripts/compact-candidates.mjs'] = sha256(scriptBytes);
  manifest.compaction = {
    generatedAt: new Date().toISOString(),
    operation: 'share_repeated_wefut_header_evidence',
    candidateCount: document.candidates.length,
    originalBytes,
    inputBytes,
    compactedBytes: size,
    savedBytes: originalBytes - size,
    wefutHeaderReferences: headerReferenceCount,
    candidateDataProjectionSha256: afterProjectionHash,
    candidateIdProjectionSha256: afterIdsHash,
    headerEvidencePath: 'results/wefut-edition-headers.json',
    headerAuditSha256: sha256(await readFile(HEADERS_PATH)),
  };
  manifest.outputs ??= {};
  const sampleArtifacts = (await readdir(resolve(DIR, 'results'))).filter((name) => /^sample-.+-candidates\.json$/.test(name)).sort();
  const artifactSha256 = {
    'results/candidates.json': sha256(serialized),
    'results/coverage-report.json': sha256(await readFile(COVERAGE_PATH)),
    'results/wefut-edition-headers.json': sha256(await readFile(HEADERS_PATH)),
    'results/report.md': sha256(await readFile(REPORT_PATH)),
  };
  for (const name of sampleArtifacts) artifactSha256[`results/${name}`] = sha256(await readFile(resolve(DIR, 'results', name)));
  manifest.outputs.artifactSha256 = artifactSha256;
  manifest.outputs.candidateBytes = size;
  const manifestTemp = `${MANIFEST_PATH}.compact.tmp`;
  await writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(manifestTemp, MANIFEST_PATH);
  console.log(JSON.stringify({ result: 'PASS', candidates: document.candidates.length, wefutHeaderReferences: headerReferenceCount, preservedDataProjectionSha256: afterProjectionHash, candidateIdProjectionSha256: afterIdsHash, inputBytes, originalBytes, compactedBytes: size, savedBytes: originalBytes - size, output: 'results/candidates.json', sharedHeaderEvidence: 'results/wefut-edition-headers.json' }, null, 2));
}

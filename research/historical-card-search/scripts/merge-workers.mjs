import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWefutHeaderSchemasFromCache, mergeWorkerProgress } from './worker-merge.mjs';

const DIR = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REPO = resolve(DIR, '../..');
const sites = ['wefut', 'fo4', 'fo3', 'nexon-fco'];
const args = process.argv.slice(2);
function option(name, fallback) { return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback; }
const pathKey = (path) => resolve(path).replace(/[\\/]+$/, '').toLowerCase();
function containsPath(parent, child) {
  const base = pathKey(parent), candidate = pathKey(child);
  return candidate === base || candidate.startsWith(`${base}${sep.toLowerCase()}`);
}
function pathsOverlap(first, second) { return containsPath(first, second) || containsPath(second, first); }
function inResearch(path) {
  const absolute = resolve(DIR, path);
  if (absolute === DIR || !containsPath(DIR, absolute)) throw new Error(`Output path must name a file under ${relative(REPO, DIR)}: ${path}`);
  return absolute;
}
async function realpathFuture(path) {
  let current = resolve(path);
  const tail = [];
  while (true) {
    try { return resolve(await realpath(current), ...tail.reverse()); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      tail.push(basename(current));
      current = parent;
    }
  }
}
async function assertSafeOutputs(outputs, workerRoots, inputArtifacts) {
  const researchRoot = await realpathFuture(DIR);
  const resultsRoot = await realpathFuture(resolve(DIR, 'results'));
  const mergedCacheRoot = await realpathFuture(resolve(DIR, '.cache/merged'));
  const defaultCheckpoint = resolve(DIR, '.cache/full-progress.json');
  const defaultCheckpointPaths = new Set([
    pathKey(await realpathFuture(defaultCheckpoint)),
    pathKey(await realpathFuture(`${defaultCheckpoint}.merge.tmp`)),
  ]);
  const targets = Object.entries(outputs).flatMap(([key, path]) => [
    { key, label: key, path }, { key, label: `${key} temporary file`, path: `${path}.merge.tmp` },
  ]);
  const canonicalTargets = await Promise.all(targets.map(async (target) => ({ ...target, canonical: await realpathFuture(target.path) })));
  for (const target of canonicalTargets) {
    if (!containsPath(researchRoot, target.canonical)) throw new Error(`Output ${target.label} resolves outside the research directory: ${target.path}`);
    const permitted = target.key === 'checkpoint'
      ? containsPath(mergedCacheRoot, target.canonical) || defaultCheckpointPaths.has(pathKey(target.canonical))
      : containsPath(resultsRoot, target.canonical);
    if (!permitted) throw new Error(`Output ${target.label} must be inside an approved generated-output directory: ${target.path}`);
  }
  for (let i = 0; i < canonicalTargets.length; i++) {
    for (let j = i + 1; j < canonicalTargets.length; j++) {
      if (pathsOverlap(canonicalTargets[i].canonical, canonicalTargets[j].canonical))
        throw new Error(`Output paths overlap: ${canonicalTargets[i].label} and ${canonicalTargets[j].label}`);
    }
  }
  const rootsToProtect = [
    ...Object.entries(workerRoots).map(([site, path]) => ({ label: `${site} worker input root`, path })),
    { label: 'script source', path: resolve(DIR, 'scripts') },
    { label: 'input data', path: resolve(DIR, 'inputs') },
    { label: 'HTTP/raw response cache', path: resolve(DIR, '.cache/http') },
  ];
  const canonicalRoots = await Promise.all(rootsToProtect.map(async ({ label, path }) => ({ label, path: await realpathFuture(path) })));
  const canonicalInputs = await Promise.all(inputArtifacts.map(async (path) => ({ path, canonical: await realpathFuture(path) })));
  for (const target of canonicalTargets) {
    for (const root of canonicalRoots) {
      if (pathsOverlap(target.canonical, root.path)) throw new Error(`Output ${target.label} overlaps protected ${root.label}: ${target.path}`);
    }
    for (const input of canonicalInputs) {
      if (pathsOverlap(target.canonical, input.canonical)) throw new Error(`Output ${target.label} overlaps an input artifact: ${input.path}`);
    }
  }
}
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.merge.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}
function cacheKey(url) { return createHash('sha256').update(`GET ${url}`).digest('hex'); }

const playersDoc = await readJson(resolve(DIR, 'inputs/players.json'));
const seasonsDoc = await readJson(resolve(DIR, 'inputs/player-seasons.json'));
const sourceSummary = await readJson(resolve(DIR, 'inputs/source-summary.json'));
const workerRoots = Object.fromEntries(sites.map((site) => [site, resolve(DIR, option(`${site}-root`, `.cache/full-run-workers/${site}`))]));
const checkpointPaths = Object.fromEntries(sites.map((site) => [site, resolve(DIR, option(`${site}-progress`, site === 'nexon-fco' ? '.cache/nexon-reparse-progress.json' : `.cache/full-run-workers/${site}/.cache/full-progress.json`))]));
const checkpointPath = inResearch(option('out-progress', '.cache/full-progress.json'));
const candidatesPath = inResearch(option('out-candidates', 'results/candidates.json'));
const manifestPath = inResearch(option('out-manifest', 'results/run-manifest.json'));
const outputs = { checkpoint: checkpointPath, candidates: candidatesPath, manifest: manifestPath };
const originalCheckpoints = sites.map((site) => resolve(workerRoots[site], '.cache/full-progress.json'));
const staticCacheInputs = [
  'https://open.api.nexon.com/static/fconline/meta/spid.json',
  'https://open.api.nexon.com/static/fconline/meta/seasonid.json',
].map((url) => resolve(workerRoots['nexon-fco'], '.cache/http', `${cacheKey(url)}.json`));
const protectedInputs = [
  resolve(DIR, 'inputs/players.json'), resolve(DIR, 'inputs/player-seasons.json'), resolve(DIR, 'inputs/source-summary.json'),
  ...Object.values(checkpointPaths), ...originalCheckpoints, ...staticCacheInputs,
];
await assertSafeOutputs(outputs, workerRoots, protectedInputs);
const sourceDocs = Object.fromEntries(await Promise.all(sites.map(async (site) => [site, await readJson(checkpointPaths[site])])))
const wefutHeaderSchemas = await loadWefutHeaderSchemasFromCache([
  resolve(workerRoots.wefut, '.cache/http'),
  resolve(DIR, '.cache/http'),
]);
const merged = mergeWorkerProgress(playersDoc.players, sourceDocs, sites, { wefutSchemas: wefutHeaderSchemas });
const generatedAt = new Date().toISOString();
merged.generatedAt = generatedAt;
merged.inputCounts = { distinctPlayers: playersDoc.players.length, playerSeasons: seasonsDoc.playerSeasons.length, teams: sourceSummary.counts?.teams ?? null };
merged.sourceSummary = sourceSummary.counts ?? {};
merged.runPolicy = 'Each site checkpoint must contain an attempted job for each of the 95 input entities. Site-and-entity filtering excludes foreign sample seeds. Failed jobs remain pending; no worker or network state is changed by this merge.';

const workerCodeFiles = ['scripts/search.mjs', 'scripts/http-transport.mjs', 'scripts/job-retry.mjs', 'scripts/search-entity-key.mjs'];
const currentPostprocessFiles = ['scripts/identity-evidence.mjs', 'scripts/source-card-identity.mjs', 'scripts/nexon-attributes.mjs', 'scripts/reparse-nexon-cache.mjs', 'scripts/worker-merge.mjs', 'scripts/merge-workers.mjs', 'scripts/build-report.mjs'];
const inputsToHash = ['inputs/players.json', 'inputs/player-seasons.json', 'inputs/source-summary.json'];
const inputHashes = Object.fromEntries(await Promise.all(inputsToHash.map(async (path) => [path, await sha256(resolve(DIR, path))])))
const workerSnapshots = {};
for (const site of sites) {
  const codeHashes = {};
  for (const path of workerCodeFiles) {
    const absolute = resolve(workerRoots[site], path);
    try { codeHashes[path] = await sha256(absolute); } catch { codeHashes[path] = null; }
  }
  const acquisitionCheckpoint = resolve(workerRoots[site], '.cache/full-progress.json');
  const recordedTimes = Object.values(sourceDocs[site].completed ?? {}).map((state) => state?.at).filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const recordedOffsets = [...new Set(recordedTimes.map((value) => value.match(/(?:Z|[+-]\d{2}:\d{2})$/)?.[0]).filter(Boolean))];
  workerSnapshots[site] = {
    checkpointUsedForMerge: relative(DIR, checkpointPaths[site]),
    checkpointUsedForMergeSha256: await sha256(checkpointPaths[site]),
    originalAcquisitionCheckpoint: relative(DIR, acquisitionCheckpoint),
    originalAcquisitionCheckpointSha256: await sha256(acquisitionCheckpoint),
    acquisitionWorkerRoot: relative(DIR, workerRoots[site]),
    acquisitionCodeSha256: codeHashes,
    checkpointJobTimestampRangeRaw: recordedTimes.length ? { first: recordedTimes[0], last: recordedTimes.at(-1), observedOffsets: recordedOffsets } : null,
    mergedAccounting: merged.sourceAccounting[site],
  };
}
const postprocessingCodeHashes = Object.fromEntries(await Promise.all(currentPostprocessFiles.map(async (path) => [path, await sha256(resolve(DIR, path))])))
const metadataCache = {};
const nexonHttpCache = resolve(workerRoots['nexon-fco'], '.cache/http');
for (const [label, url] of Object.entries({
  spid: 'https://open.api.nexon.com/static/fconline/meta/spid.json',
  seasonid: 'https://open.api.nexon.com/static/fconline/meta/seasonid.json',
})) {
  const cachePath = resolve(nexonHttpCache, `${cacheKey(url)}.json`);
  try {
    const response = await readJson(cachePath);
    const parsed = JSON.parse(response.text);
    metadataCache[label] = { url, status: response.status, cachedResponse: relative(DIR, cachePath), bodySha256: createHash('sha256').update(response.text).digest('hex'), entries: parsed.length, fields: Object.keys(parsed[0] ?? {}) };
  } catch (error) { metadataCache[label] = { url, status: 'cache_missing_or_invalid', error: String(error.message) }; }
}

const candidateOutput = {
  schemaVersion: 'historical-card-search-candidates/1', generatedAt,
  playerCount: playersDoc.players.length, playerSeasonCount: seasonsDoc.playerSeasons.length,
  candidates: merged.candidates, observations: merged.observations, errors: merged.errors,
  sourceAccounting: merged.sourceAccounting,
};
const manifest = {
  schemaVersion: 'historical-card-search-run-manifest/1', generatedAt,
  runtime: { node: process.version, platform: process.platform, defaultPerOriginDelayMs: 900, acquisitionPerOriginDelayMs: null, acquisitionRateNote: 'The worker delay defaults to 900 ms and can be overridden with HISTORICAL_CARD_RATE_MS. The acquisition process environment is not saved in checkpoints, so this manifest does not assert the effective historical value.' },
  timestampProvenance: {
    taskClockUtcAtMerge: option('task-clock-utc', null),
    workerCheckpointTimestampsPreservedRaw: true,
    note: 'Acquisition timestamps are copied as recorded; this merge does not normalize, rewrite, or imply a fresh fetch time.',
  },
  inputCounts: merged.inputCounts,
  inputSha256: inputHashes,
  inputSearchEntityKeysSha256: createHash('sha256').update(playersDoc.players.map((player) => player.searchEntityKey).sort().join('\n')).digest('hex'),
  acquisition: { note: 'Search responses were acquired by the frozen isolated worker copies listed below. The final namespace confidence and Nexon attribute normalization are offline enrichment, and do not imply raw responses were acquired with the current post-processing code.', sites: workerSnapshots },
  postprocessingCodeSha256: postprocessingCodeHashes,
  nexonStaticMetadataCache: metadataCache,
  outputs: {
    checkpoint: relative(DIR, checkpointPath), candidateFile: relative(DIR, candidatesPath), runManifest: relative(DIR, manifestPath), reportCommand: 'node scripts/build-report.mjs',
    attemptedSiteJobs: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].attemptedInputJobs])),
    pendingRetryJobs: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].jobsPendingRetry])),
    candidateCounts: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].candidatesIncluded])),
  },
};
await saveJson(checkpointPath, merged);
await saveJson(candidatesPath, candidateOutput);
await saveJson(manifestPath, manifest);
console.log(JSON.stringify({
  result: 'PASS', generatedAt,
  attemptedJobs: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].attemptedInputJobs])),
  pendingRetries: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].jobsPendingRetry])),
  candidates: Object.fromEntries(sites.map((site) => [site, merged.sourceAccounting[site].candidatesIncluded])),
  outputs: { checkpoint: relative(DIR, checkpointPath), candidates: relative(DIR, candidatesPath), manifest: relative(DIR, manifestPath) },
}, null, 2));

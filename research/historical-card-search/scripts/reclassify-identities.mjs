import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchEntityKeyFor } from './search-entity-key.mjs';
import { applySourceLocalCardIdentity } from './source-card-identity.mjs';
import { refreshCandidateIdentity } from './identity-evidence.mjs';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const progressArg = args.find((arg) => arg.startsWith('--progress='))?.slice('--progress='.length);
if (!progressArg) throw new Error('Usage: node scripts/reclassify-identities.mjs --progress=<checkpoint-or-candidate-json>');
const progressPath = resolve(process.cwd(), progressArg);
const playersDoc = JSON.parse(await readFile(resolve(DIR, 'inputs/players.json'), 'utf8'));
const playersByKey = new Map(playersDoc.players.map((player) => [player.searchEntityKey ?? searchEntityKeyFor(player), player]));
const document = JSON.parse(await readFile(progressPath, 'utf8'));
if (!Array.isArray(document.candidates)) throw new Error('Input must contain a candidates array.');
const levels = { high: 0, low: 0, none: 0, unverified: 0 };
let reclassified = 0, unmatched = 0;
document.candidates = document.candidates.map((candidate) => {
  const player = playersByKey.get(candidate.searchEntityKey);
  if (!player) { unmatched++; return candidate; }
  const refreshed = refreshCandidateIdentity(player, applySourceLocalCardIdentity(candidate));
  levels[refreshed.identity_confidence] = (levels[refreshed.identity_confidence] ?? 0) + 1;
  if (refreshed.identityConfidenceRefresh) reclassified++;
  return refreshed;
});
document.identityRefresh = {
  policy: 'Cross-source numeric identity requires an explicit same-namespace contract or documented crosswalk. Current site-local card IDs do not meet that requirement.',
  processedCandidates: document.candidates.length - unmatched,
  reclassifiedCandidates: reclassified,
  unmatchedCandidates: unmatched,
  candidatesByIdentityConfidence: levels,
};
const tempPath = `${progressPath}.identity-refresh.tmp`;
await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await rename(tempPath, progressPath);
console.log(JSON.stringify(document.identityRefresh, null, 2));

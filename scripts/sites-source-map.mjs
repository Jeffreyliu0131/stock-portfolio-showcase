import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readRegular, sha256 } from './artifact-integrity.mjs';
import { captureSourceState } from './source-fingerprint.mjs';

export const SOURCE_MAP_PATH = '.publication/source-map.json';
const CONFIG_PATH = '.openai/hosting.json';
export function gitSourcePaths(cwd) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
}
export function projectFiles(cwd, paths) {
  return [...paths].sort().map(path => { const bytes = readRegular(cwd, path); return { path, bytes: bytes.length, sha256: sha256(bytes) }; });
}
export function projectedFingerprint(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(file.path + '\0' + file.sha256 + '\0');
  return hash.digest('hex');
}
export function publicationMapping(cwd, sourcePaths = gitSourcePaths(cwd)) {
  if (!existsSync(resolve(cwd, SOURCE_MAP_PATH))) return null;
  const map = JSON.parse(readRegular(cwd, SOURCE_MAP_PATH));
  if (map.formatVersion !== 1 || !/^[a-f0-9]{40}$/.test(map.canonicalSourceSha) || !Array.isArray(map.files) || !map.files.length) throw new Error('Invalid canonical source map');
  const paths = map.files.map(file => file.path);
  if (new Set(paths).size !== paths.length || paths.includes(SOURCE_MAP_PATH) || paths.includes(CONFIG_PATH) || paths.some(path => /^(?:\.git|\.deployment|\.publication|node_modules|dist|\.next)(?:\/|$)/.test(path) || (path !== '.env.example' && /(^|\/)(\.env(?:\.|$)|\.dev\.vars(?:\.|$))/.test(path)))) throw new Error('Invalid canonical file set');
  const files = projectFiles(cwd, paths);
  if (JSON.stringify(files) !== JSON.stringify(map.files) || projectedFingerprint(files) !== map.canonicalSourceFingerprint) throw new Error('Mirror source differs from canonical export');
  const allowed = new Set([...paths, SOURCE_MAP_PATH, CONFIG_PATH]);
  if (sourcePaths.some(path => !allowed.has(path)) || paths.some(path => !sourcePaths.includes(path)) || !sourcePaths.includes(SOURCE_MAP_PATH)) throw new Error('Mirror has missing canonical files, an untracked map, or unapproved extra source files');
  if (existsSync(resolve(cwd, CONFIG_PATH))) {
    const hosting = JSON.parse(readRegular(cwd, CONFIG_PATH));
    if (Object.keys(hosting).sort().join(',') !== 'd1,project_id,r2' || hosting.d1 !== 'DB' || hosting.r2 !== null || !/^appgprj_[a-f0-9]{28,32}$/.test(hosting.project_id ?? '')) throw new Error('Mirror hosting overlay is not whitelisted');
    const expectedBytes = Buffer.from(JSON.stringify({ project_id: hosting.project_id, d1: 'DB', r2: null }, null, 2) + '\n');
    if (!readRegular(cwd, CONFIG_PATH).equals(expectedBytes)) throw new Error('Normalize the private hosting overlay formatting in the reviewed mirror commit before building');
  }
  return { canonicalSourceSha: map.canonicalSourceSha, canonicalSourceFingerprint: map.canonicalSourceFingerprint, files };
}

// Export only to an empty staging directory. Never modify a mirror or Git refs.
export function exportCanonicalSource(destination, { cwd = process.cwd(), readSource, sourcePaths = gitSourcePaths } = {}) {
  if (!readSource) throw new Error('Source snapshot reader required');
  const before = readSource(cwd);
  if (before.dirty || existsSync(resolve(cwd, SOURCE_MAP_PATH))) throw new Error('Export requires clean committed canonical source, not a publication mirror');
  if (existsSync(destination) && readdirSync(destination).length) throw new Error('Export destination must be empty');
  const files = projectFiles(cwd, sourcePaths(cwd));
  const fingerprint = projectedFingerprint(files);
  if (before.fingerprint !== fingerprint) throw new Error('Canonical source file set differs from snapshot');
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const output = resolve(destination, file.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, readRegular(cwd, file.path));
  }
  const after = readSource(cwd);
  if (JSON.stringify(after) !== JSON.stringify(before) || projectedFingerprint(projectFiles(destination, files.map(file => file.path))) !== fingerprint) throw new Error('Canonical source changed during export; staging is unusable');
  const map = { formatVersion: 1, canonicalSourceSha: before.sha, canonicalSourceFingerprint: fingerprint, files };
  mkdirSync(resolve(destination, '.publication'), { recursive: true });
  writeFileSync(resolve(destination, SOURCE_MAP_PATH), JSON.stringify(map, null, 2) + '\n');
  return map;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'verify') {
    const mapping = publicationMapping(process.cwd());
    if (!mapping) throw new Error('Not a mapped publication checkout');
    const mirror = captureSourceState();
    if (mirror.dirty) throw new Error('Publication checkout must be clean');
    console.log(JSON.stringify({ canonicalSourceSha: mapping.canonicalSourceSha, canonicalSourceFingerprint: mapping.canonicalSourceFingerprint, actualMirrorSha: mirror.sha, canonicalFiles: mapping.files.length }));
  } else if (process.argv[2] === 'export' && process.argv[3]) {
    execFileSync(process.execPath, ['scripts/public-snapshot-audit.mjs'], { stdio: 'inherit' });
    const result = exportCanonicalSource(resolve(process.argv[3]), { readSource: captureSourceState });
    console.log(`Exported canonical ${result.canonicalSourceSha}; no mirror or remote was changed.`);
  } else throw new Error('Use sites-source-map.mjs export <empty-staging-directory> or verify');
}

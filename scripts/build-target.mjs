import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureSourceState, assertSameSource } from './source-fingerprint.mjs';
import { deploymentConfig } from './deployment-config.mjs';
import { artifactManifest, outputDirectory, sha256 } from './artifact-integrity.mjs';

// These are the only framework-owned edits that may be restored. Any unrelated
// edit is a source change, not a license to overwrite another actor's work.
function normalizedGenerated(path, bytes) {
  const text = bytes.toString('utf8');
  if (path === 'next-env.d.ts') return text.split('\n').filter(line => !/^import "(?:\.\/\.next(?:-demo)?\/(?:dev\/)?types\/(?:routes|root-params)\.d\.ts|vinext\/types\/augmentations)";$/.test(line)).join('\n');
  const config = JSON.parse(text);
  config.include = config.include?.filter(value => !/^\.next(?:-demo)?\/(?:dev\/)?types\/(?:\*\*\/\*\.ts|routes\.d\.ts)$/.test(value));
  return JSON.stringify(config);
}
function compileTarget(config, cwd) {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_PORTFOLIO_TARGET: config.target,
    NEXT_PUBLIC_PORTFOLIO_EXPERIENCE: config.experience, NEXT_PUBLIC_SITES_ORIGIN: config.sitesOrigin,
    NEXT_PUBLIC_PROVIDER_ORIGIN: config.providerOrigin, WRANGLER_LOG_PATH: '.wrangler/build.log', WRANGLER_WRITE_LOGS: 'false' };
  const args = config.target === 'sites' ? ['node_modules/vinext/dist/cli.js', 'build'] : ['node_modules/next/dist/bin/next', 'build', '--webpack'];
  const built = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env });
  return built.status ?? 1;
}

export function runBuild(config, { cwd = process.cwd(), readSource = captureSourceState, compile = compileTarget } = {}) {
  const before = readSource(cwd);
  const originals = new Map(['next-env.d.ts', 'tsconfig.json'].map(path => [path, readFileSync(resolve(cwd, path))]));
  const output = outputDirectory(config.target);
  // A failed/interrupted build must not leave a prior seal or old runtime file
  // eligible for reuse. All removed paths are ignored generated output.
  rmSync(resolve(cwd, output), { recursive: true, force: true });
  for (const path of ['.next/types', '.next-demo/types']) rmSync(resolve(cwd, path), { recursive: true, force: true });
  if (config.target === 'sites') {
    mkdirSync(resolve(cwd, '.openai'), { recursive: true });
    const expected = { project_id: config.projectId, d1: 'DB', r2: null };
    const hostingPath = resolve(cwd, '.openai/hosting.json');
    if (existsSync(resolve(cwd, '.publication/source-map.json')) && existsSync(hostingPath)) {
      const actual = JSON.parse(readFileSync(hostingPath));
      if (actual.project_id !== expected.project_id || actual.d1 !== 'DB' || actual.r2 !== null) throw new Error('Tracked mirror hosting overlay differs from selected Site');
      // Preserve the private tracked overlay's bytes; no dirty rewrite at build time.
    } else writeFileSync(hostingPath, JSON.stringify(expected, null, 2) + '\n');
  }
  let code;
  let compilationError;
  try { code = compile(config, cwd); } catch (error) { compilationError = error; }
  for (const [path, bytes] of originals) {
    if (normalizedGenerated(path, bytes) !== normalizedGenerated(path, readFileSync(resolve(cwd, path)))) throw new Error(`Source config changed during build: ${path}`);
  }
  // Compare before restoring generated files, overriding only changes already
  // verified as framework-generated. A commit switch is independently rejected.
  const after = readSource(cwd, originals);
  // The dirty flag can include harmless generator edits; compare it after restore.
  assertSameSource({ ...before, dirty: false }, { ...after, dirty: false });
  for (const [path, bytes] of originals) writeFileSync(resolve(cwd, path), bytes);
  assertSameSource(before, readSource(cwd));
  if (compilationError) throw compilationError;
  if (code !== 0) throw new Error(`Compiler failed with exit code ${code}; artifacts are not sealed`);
  const manifest = artifactManifest(config, before, cwd);
  // Detect changes during artifact collection too, before minting a seal.
  assertSameSource(before, readSource(cwd));
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  const provenance = { ...config, sourceSha: before.sha, sourceFingerprint: before.fingerprint, dirty: before.dirty,
    canonicalSourceSha: before.canonicalSourceSha ?? before.sha, canonicalSourceFingerprint: before.canonicalSourceFingerprint ?? before.fingerprint,
    artifactManifestSha256: sha256(manifestBytes), deploymentReady: !before.dirty && !config.checkOnly && config.target !== 'demo' };
  writeFileSync(resolve(cwd, output, 'artifact-manifest.json'), manifestBytes);
  writeFileSync(resolve(cwd, output, 'build-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBuild(deploymentConfig(process.argv[2] ?? process.env.PORTFOLIO_TARGET ?? 'provider'));
}

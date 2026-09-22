import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportCanonicalSource, projectFiles, projectedFingerprint, publicationMapping, SOURCE_MAP_PATH } from '../sites-source-map.mjs';
import { runBuild } from '../build-target.mjs';
import { releasePreflight } from '../release-preflight.mjs';

const canonicalSha = '1'.repeat(40);
const mirrorSha = '2'.repeat(40); // Different history; never pretend it is canonicalSha.
const projectId = 'appgprj_' + '0'.repeat(32);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-mirror-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const canonical = join(root, 'canonical'), mirror = join(root, 'publication');
  const paths = ['app/page.tsx', 'next-env.d.ts', 'tsconfig.json', 'public/icon.png', 'drizzle/0000_initial.sql', 'drizzle/meta/_journal.json', 'drizzle/meta/0000_snapshot.json'].sort();
  const write = (cwd, path, content) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), content); };
  for (const path of paths) write(canonical, path, path.endsWith('.json') ? '{}' : 'synthetic canonical source');
  write(canonical, 'tsconfig.json', '{"include":[]}');
  write(canonical, 'drizzle/meta/_journal.json', JSON.stringify({ entries: [{ idx: 0, tag: '0000_initial' }] }));
  const readCanonical = () => ({ sha: canonicalSha, fingerprint: projectedFingerprint(projectFiles(canonical, paths)), dirty: false });
  const map = exportCanonicalSource(mirror, { cwd: canonical, readSource: readCanonical, sourcePaths: () => paths });
  const mirrorPaths = [...paths, SOURCE_MAP_PATH, '.openai/hosting.json'];
  write(mirror, '.openai/hosting.json', JSON.stringify({ project_id: projectId, d1: 'DB', r2: null }, null, 2) + '\n');
  return { root, canonical, mirror, paths, mirrorPaths, map, write, readCanonical };
}
test('export stages identical canonical files without modifying mirror history or requiring the same SHA', t => {
  const f = fixture(t);
  const mapping = publicationMapping(f.mirror, f.mirrorPaths);
  assert.equal(mapping.canonicalSourceSha, canonicalSha);
  assert.equal(mapping.canonicalSourceFingerprint, f.readCanonical().fingerprint);
  assert.notEqual(canonicalSha, mirrorSha);
  assert.equal(existsSync(join(f.mirror, '.git')), false); // Export makes files, never Git state.
  assert.deepEqual(readFileSync(join(f.canonical, 'app/page.tsx')), readFileSync(join(f.mirror, 'app/page.tsx')));
});
test('mirror edits, stale executable files and non-whitelisted config are rejected', t => {
  const f = fixture(t);
  assert.throws(() => publicationMapping(f.mirror, [...f.mirrorPaths, 'app/old-private-route.ts']), /extra source/);
  f.write(f.mirror, '.openai/hosting.json', JSON.stringify({ project_id: projectId, d1: 'DB', r2: null, unexpected: true }));
  assert.throws(() => publicationMapping(f.mirror, f.mirrorPaths), /whitelisted/);
  f.write(f.mirror, 'app/page.tsx', 'locally developed feature');
  assert.throws(() => publicationMapping(f.mirror, f.mirrorPaths), /differs/);
});
test('export refuses dirty source and non-empty destinations without overwriting files', t => {
  const f = fixture(t);
  assert.throws(() => exportCanonicalSource(join(f.root, 'new'), { cwd: f.canonical, readSource: () => ({ ...f.readCanonical(), dirty: true }), sourcePaths: () => f.paths }), /clean committed/);
  assert.equal(existsSync(join(f.root, 'new')), false);
  assert.throws(() => exportCanonicalSource(f.mirror, { cwd: f.canonical, readSource: f.readCanonical, sourcePaths: () => f.paths }), /empty/);
});
test('mapped Sites build binds actual mirror SHA and verifies canonical projection plus private overlay', t => {
  const f = fixture(t);
  const config = { target: 'sites', projectId, sitesOrigin: 'https://sites.test', providerOrigin: 'https://provider.test', experience: 'production', checkOnly: false };
  const readSource = () => {
    const map = publicationMapping(f.mirror, f.mirrorPaths);
    return { sha: mirrorSha, fingerprint: projectedFingerprint(projectFiles(f.mirror, f.mirrorPaths)), dirty: false,
      canonicalSourceSha: map.canonicalSourceSha, canonicalSourceFingerprint: map.canonicalSourceFingerprint };
  };
  const overlay = readFileSync(join(f.mirror, '.openai/hosting.json'));
  const provenance = runBuild(config, { cwd: f.mirror, readSource, compile() {
    for (const path of ['server/index.js', 'server/ssr/index.js', 'client/main.js', 'client/style.css']) f.write(f.mirror, `dist/${path}`, 'synthetic runtime');
    for (const path of f.paths.filter(p => p.startsWith('drizzle/'))) f.write(f.mirror, `dist/.openai/${path}`, readFileSync(join(f.mirror, path)));
    f.write(f.mirror, 'dist/client/icon.png', readFileSync(join(f.mirror, 'public/icon.png')));
    f.write(f.mirror, 'dist/.openai/hosting.json', overlay);
    return 0;
  } });
  assert.equal(provenance.sourceSha, mirrorSha);
  assert.equal(provenance.canonicalSourceSha, canonicalSha);
  assert.equal(provenance.canonicalSourceFingerprint, f.map.canonicalSourceFingerprint);
  assert.deepEqual(readFileSync(join(f.mirror, '.openai/hosting.json')), overlay);
  assert.equal(releasePreflight(config, { cwd: f.mirror, readSource }).sha, mirrorSha);
  f.write(f.mirror, 'app/page.tsx', 'divergent functionality');
  assert.throws(() => releasePreflight(config, { cwd: f.mirror, readSource }), /differs/);
});

test('CLI exports a clean committed tree and rejects later uncommitted changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-source-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const canonical = join(root, 'canonical');
  mkdirSync(join(canonical, 'scripts'), { recursive: true });
  writeFileSync(join(canonical, 'source.txt'), 'synthetic source');
  // Isolate the CLI/module-loading contract from the separately tested boundary audit.
  writeFileSync(join(canonical, 'scripts/public-snapshot-audit.mjs'), 'process.exit(0);');
  for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'synthetic fixture']]) {
    const result = spawnSync('git', args, { cwd: canonical, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const cli = fileURLToPath(new URL('../sites-source-map.mjs', import.meta.url));
  const destination = join(root, 'export');
  const result = spawnSync(process.execPath, [cli, 'export', destination], { cwd: canonical, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Exported canonical/);
  const map = JSON.parse(readFileSync(join(destination, SOURCE_MAP_PATH), 'utf8'));
  assert.equal(map.canonicalSourceSha, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: canonical, encoding: 'utf8' }).stdout.trim());
  assert.equal(readFileSync(join(destination, 'source.txt'), 'utf8'), 'synthetic source');
  writeFileSync(join(canonical, 'source.txt'), 'uncommitted change');
  const rejected = spawnSync(process.execPath, [cli, 'export', join(root, 'rejected')], { cwd: canonical, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /clean committed canonical source/);
  assert.equal(existsSync(join(root, 'rejected')), false);
});

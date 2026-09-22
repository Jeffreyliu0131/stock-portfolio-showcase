import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { sourceFingerprint } from '../source-fingerprint.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runBuild } from '../build-target.mjs';
import { releasePreflight } from '../release-preflight.mjs';
import { outputDirectory, sha256 } from '../artifact-integrity.mjs';

const SHA = 'a'.repeat(40);
function fixture(t, target) {
  const cwd = mkdtempSync(join(tmpdir(), 'portfolio-integrity-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, bytes) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), bytes); };
  const json = (path, value) => write(path, JSON.stringify(value, null, 2) + "\n");
  const config = { target, sitesOrigin: 'https://sites.test', providerOrigin: 'https://provider.test', experience: 'production', checkOnly: false, ...(target === 'sites' ? { projectId: 'synthetic-project' } : {}) };
  const output = outputDirectory(target);
  write('next-env.d.ts', '/// <reference types="next" />\n'); json('tsconfig.json', { compilerOptions: { strict: true }, include: ['app/**/*.ts'] });
  write('app/source.ts', 'original source'); write('public/icons/synthetic.png', 'synthetic public asset');
  let head = SHA;
  let dirty = false;
  const readSource = () => ({ sha: head, fingerprint: sha256(readFileSync(join(cwd, 'app/source.ts'))), dirty });
  const compile = () => {
    if (target === 'sites') {
      write('dist/server/index.js', 'export default { fetch() { return new Response("ok") } };');
      write('dist/server/ssr/index.js', 'export const render = () => "synthetic";');
      write('dist/client/main.js', 'console.log("synthetic client");'); write('dist/client/style.css', 'body { color: black }');
      write('dist/client/icons/synthetic.png', 'synthetic public asset');
      json('dist/.openai/hosting.json', { project_id: config.projectId, d1: 'DB', r2: null });
      for (const root of ['drizzle', 'dist/.openai/drizzle']) {
        write(`${root}/0000_initial.sql`, 'CREATE TABLE synthetic (id TEXT PRIMARY KEY);');
        json(`${root}/meta/_journal.json`, { entries: [{ idx: 0, tag: '0000_initial' }] });
        json(`${root}/meta/0000_snapshot.json`, { version: '6', tables: {} });
      }
    } else {
      write(`${output}/BUILD_ID`, 'synthetic-build-id');
      json(`${output}/required-server-files.json`, { files: [`${output}/BUILD_ID`, `${output}/routes-manifest.json`] });
      json(`${output}/routes-manifest.json`, { version: 3, dynamicRoutes: [] });
      json(`${output}/build-manifest.json`, { rootMainFiles: ['static/main.js'], pages: { '/': ['static/style.css'] } });
      json(`${output}/server/app-paths-manifest.json`, { '/page': 'app/page.js', '/data-safety/page': 'app/data-safety/page.js', '/api/portfolio/route': 'app/api/portfolio/route.js' });
      for (const path of ['app/page.js', 'app/data-safety/page.js', 'app/api/portfolio/route.js']) write(`${output}/server/${path}`, 'module.exports = "synthetic route";');
      write(`${output}/static/main.js`, 'console.log("synthetic client");'); write(`${output}/static/style.css`, 'body { color: black }');
      write('node_modules/synthetic-runtime/index.js', 'module.exports = "synthetic dependency";');
      json(`${output}/next-server.js.nft.json`, { files: ['../node_modules/synthetic-runtime/index.js'] });
    }
    return 0;
  };
  const build = compiler => runBuild(config, { cwd, readSource, compile: compiler ?? compile });
  const gate = () => releasePreflight(config, { cwd, readSource });
  return { cwd, write, json, config, output, readSource, compile, build, gate, setHead: value => { head = value; }, setDirty: value => { dirty = value; } };
}

for (const target of ['provider', 'sites']) {
  test(`${target}: complete synthetic runtime passes, byte replacement is rejected`, t => {
    const f = fixture(t, target); f.build(); assert.ok(f.gate().files > 5);
    const entry = target === 'sites' ? 'dist/server/index.js' : '.next/server/app/page.js';
    const original = readFileSync(join(f.cwd, entry));
    f.write(entry, Buffer.alloc(original.length, 'x')); // Same byte count, different content.
    assert.throws(f.gate, /changed/);
  });
  test(`${target}: copied metadata cannot stand in for a missing runtime`, t => {
    const f = fixture(t, target); f.build();
    rmSync(join(f.cwd, f.output, 'server'), { recursive: true });
    // Even a rewritten manifest with a matching checksum cannot waive required entries.
    const provenance = JSON.parse(readFileSync(join(f.cwd, f.output, 'build-provenance.json')));
    const manifest = JSON.stringify({ formatVersion: 1, target, sourceSha: SHA, sourceFingerprint: f.readSource().fingerprint, files: [] });
    f.write(`${f.output}/artifact-manifest.json`, manifest);
    provenance.artifactManifestSha256 = sha256(manifest);
    f.json(`${f.output}/build-provenance.json`, provenance);
    assert.throws(f.gate, /ENOENT|Missing|required/);
  });
  test(`${target}: missing client assets and added old build chunks are rejected`, t => {
    const f = fixture(t, target); f.build();
    const client = target === 'sites' ? 'dist/client/main.js' : '.next/static/main.js';
    rmSync(join(f.cwd, client)); assert.throws(f.gate);
    f.build(); f.write(`${f.output}/server/old-build-chunk.js`, 'old version'); assert.throws(f.gate, /extra/);
  });
  test(`${target}: file and ancestor symlinks cannot redirect a sealed publication`, t => {
    const f = fixture(t, target); f.build();
    const entry = target === 'sites' ? 'dist/server/index.js' : '.next/server/app/page.js';
    const bytes = readFileSync(join(f.cwd, entry)); f.write('elsewhere.js', bytes);
    rmSync(join(f.cwd, entry)); symlinkSync(join(f.cwd, 'elsewhere.js'), join(f.cwd, entry));
    assert.throws(f.gate, /symlink/);
    f.build();
    const directory = target === 'sites' ? 'dist/client' : '.next/static';
    rmSync(join(f.cwd, directory), { recursive: true }); mkdirSync(join(f.cwd, 'elsewhere'), { recursive: true });
    symlinkSync(join(f.cwd, 'elsewhere'), join(f.cwd, directory)); assert.throws(f.gate, /symlink/);
  });
  test(`${target}: build starts from an empty output and failed compilation invalidates old seals`, t => {
    const f = fixture(t, target); f.build(); f.write(`${f.output}/server/stale.js`, 'old code');
    f.build(() => { assert.equal(existsSync(join(f.cwd, f.output, 'server/stale.js')), false); return f.compile(); });
    assert.ok(f.gate());
    assert.throws(() => f.build(() => 1), /Compiler failed/);
    assert.equal(existsSync(join(f.cwd, f.output, 'build-provenance.json')), false);
    assert.throws(f.gate);
  });
  test(`${target}: source edit or new clean commit during compilation cannot acquire a seal`, t => {
    const f = fixture(t, target);
    assert.throws(() => f.build(() => { f.compile(); f.write('app/source.ts', 'changed during compile'); return 0; }), /Source changed/);
    assert.equal(existsSync(join(f.cwd, f.output, 'build-provenance.json')), false);
    assert.throws(() => f.build(() => { f.compile(); f.setHead('b'.repeat(40)); f.setDirty(false); return 0; }), /Source changed/);
    assert.equal(existsSync(join(f.cwd, f.output, 'artifact-manifest.json')), false);
  });
  test(`${target}: unrelated tsconfig edits are preserved and reject the build`, t => {
    const f = fixture(t, target);
    assert.throws(() => f.build(() => { f.compile(); f.json('tsconfig.json', { compilerOptions: { strict: false }, include: ['app/**/*.ts'] }); return 0; }), /Source config changed/);
    assert.equal(JSON.parse(readFileSync(join(f.cwd, 'tsconfig.json'))).compilerOptions.strict, false);
  });
}
test('Next: traced dependencies and separately served public assets are sealed', t => {
  const f = fixture(t, 'provider'); f.build();
  f.write('node_modules/synthetic-runtime/index.js', 'different dependency'); assert.throws(f.gate, /changed/);
  f.build(); f.write('public/icons/synthetic.png', 'different public icon'); assert.throws(f.gate, /changed/);
});
test('Next: explicit non-public cache/types are ignored, arbitrary extra files are not', t => {
  const f = fixture(t, 'provider'); f.build();
  f.write('.next/cache/runtime-cache', 'ephemeral'); f.write('.next/types/routes.d.ts', 'generated type'); assert.ok(f.gate());
  f.write('.next/unexpected.json', '{}'); assert.throws(f.gate, /extra/);
});
test('Sites: SQL, journal, snapshots and extra migration files are all checked against source', t => {
  const f = fixture(t, 'sites');
  for (const path of ['0000_initial.sql', 'meta/_journal.json', 'meta/0000_snapshot.json']) {
    f.build(); f.write(`dist/.openai/drizzle/${path}`, '{}'); assert.throws(f.gate);
  }
  f.build(); f.write('dist/.openai/drizzle/0001_unapproved.sql', 'DROP TABLE synthetic;'); assert.throws(f.gate, /file set/);
});
test('Build restores only known generator edits and seals the original source snapshot', t => {
  const f = fixture(t, 'provider');
  const provenance = f.build(() => {
    f.compile();
    f.json('tsconfig.json', { compilerOptions: { strict: true }, include: ['app/**/*.ts', '.next/types/**/*.ts'] });
    f.write('next-env.d.ts', '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n');
    return 0;
  });
  assert.equal(provenance.sourceSha, SHA);
  assert.deepEqual(JSON.parse(readFileSync(join(f.cwd, 'tsconfig.json'))).include, ['app/**/*.ts']);
  assert.ok(f.gate());
});

test('Sites: packager source metadata cannot change the sealed hosting output', t => {
  const f = fixture(t, 'sites'); f.build();
  f.json('.openai/hosting.json', { project_id: 'other-project', d1: 'DB', r2: null });
  assert.throws(f.gate, /hosting/);
  f.build();
  const existing = JSON.parse(readFileSync(join(f.cwd, '.openai/hosting.json')));
  f.write('.openai/hosting.json', JSON.stringify(existing)); // Same values, different packaging bytes.
  assert.throws(f.gate, /canonical bytes/);
});

test('source fingerprint refuses credential paths before dereferencing their contents', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'portfolio-source-boundary-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', cwd]);
  symlinkSync(join(cwd, 'nonexistent-secret-target'), join(cwd, '.env.local'));
  assert.throws(() => sourceFingerprint(cwd), /Credential configuration/);
});

test('Vercel adapter aliases are sealed by resolved path and bytes', t => {
  const f = fixture(t, 'provider');
  f.build(() => {
    f.compile();
    f.write('.next/output/functions/page.func/index.js', 'synthetic function');
    symlinkSync('page.func', join(f.cwd, '.next/output/functions/alias.func'));
    return 0;
  });
  assert.ok(f.gate());
  const manifest = JSON.parse(readFileSync(join(f.cwd, '.next/artifact-manifest.json')));
  const alias = manifest.files.find(x => x.path === '.next/output/functions/alias.func/index.js');
  assert.equal(alias.resolvedPath, '.next/output/functions/page.func/index.js');
  f.write('.next/output/functions/page.func/index.js', 'tampered function');
  assert.throws(f.gate, /changed/);
});
test('Vercel adapter rejects escaping aliases and directory cycles', t => {
  const f = fixture(t, 'provider');
  f.write('outside/index.js', 'must not be published');
  assert.throws(() => f.build(() => {
    f.compile(); mkdirSync(join(f.cwd, '.next/output/functions'), { recursive: true });
    symlinkSync(join(f.cwd, 'outside'), join(f.cwd, '.next/output/functions/escape.func'));
    return 0;
  }), /escapes output/);
  assert.throws(() => f.build(() => {
    f.compile(); mkdirSync(join(f.cwd, '.next/output/functions'), { recursive: true });
    symlinkSync('..', join(f.cwd, '.next/output/functions/cycle'));
    return 0;
  }), /Cyclic/);
});

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKPORTED_ADVISORY = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
// Reviewed published 3.0.3 source plus the five bounded-depth backports.
const BACKPORT_HASHES = {
  "LICENSE": "35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2",
  "index.js": "332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4",
  "lib/compile.js": "b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195",
  "lib/constants.js": "f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c",
  "lib/expand.js": "7ea3e14c2b2b256ef244fd3d83b8fcaa20aa2232b4e6d768c3bb6ab567f66cf5",
  "lib/parse.js": "72aabaadaa555cdfbd07fbd7c7f743373e4dc8eec04a97550cc57bbeec30eb6c",
  "lib/stringify.js": "49dc2d8bafa74f34715a18a845bcb82ce66caaf3bab4cf117998e06b1f9a50a9",
  "lib/utils.js": "b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7",
  "package.json": "5d00475beab4f16d5667844aa58a810d34b699ef04bf6e6a1dc77d4bbbc4acbc"
};
const BUILD_CHAIN = new Set(['braces', 'micromatch', 'fast-glob', 'vite-plugin-dynamic-import', 'vite-plugin-commonjs', 'vinext']);
const root = fileURLToPath(new URL('../', import.meta.url));

export function verifyBackportSource(base = root) {
  const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  if (manifest.devDependencies?.braces !== 'file:vendor/braces' || manifest.overrides?.braces !== '$braces') {
    throw new Error('The reviewed development-only braces override is missing');
  }
  for (const [path, expected] of Object.entries(BACKPORT_HASHES)) {
    const actual = createHash('sha256').update(readFileSync(join(base, 'vendor/braces', path))).digest('hex');
    if (actual !== expected) throw new Error(`Backport source differs from the reviewed patch: ${path}`);
  }
  const require = createRequire(join(base, 'package.json'));
  const fromMicromatch = createRequire(require.resolve('micromatch'));
  const expected = realpathSync(join(base, 'vendor/braces/index.js'));
  if (realpathSync(require.resolve('braces')) !== expected || realpathSync(fromMicromatch.resolve('braces')) !== expected) {
    throw new Error('The installed build consumer is not using the reviewed backport');
  }
}

export function classifyAudit(report, lock) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('Dependency audit did not return a complete supported report');
  }
  const findings = report.vulnerabilities;
  const isBackportedChain = (name, seen = new Set()) => {
    if (!BUILD_CHAIN.has(name) || seen.has(name)) return false;
    const finding = findings[name];
    if (!finding || !Array.isArray(finding.nodes) || !finding.nodes.length || !Array.isArray(finding.via) || !finding.via.length) return false;
    if (!finding.nodes.every(path => {
      if (path !== `node_modules/${name}` && !(name === 'braces' && path === 'vendor/braces')) return false;
      let entry = lock.packages?.[path];
      if (entry?.link) {
        if (name !== 'braces' || entry.resolved !== 'vendor/braces') return false;
        entry = lock.packages?.[entry.resolved];
      }
      return entry?.dev === true;
    })) return false;
    return finding.via.every(via => typeof via === 'string'
      ? isBackportedChain(via, new Set([...seen, name]))
      : name === 'braces' && via.name === 'braces' && via.dependency === 'braces'
        && via.url === BACKPORTED_ADVISORY && via.range === '<=3.0.3' && via.severity === 'high');
  };
  const high = Object.entries(findings).filter(([, value]) => ['high', 'critical'].includes(value.severity));
  const expected = report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical;
  if (!Number.isFinite(expected) || high.length !== expected) throw new Error('Dependency audit severity totals are inconsistent');
  return {
    backported: high.filter(([name]) => isBackportedChain(name)).map(([name]) => name),
    blocking: high.filter(([name]) => !isBackportedChain(name)).map(([name]) => name),
  };
}

export function auditDependencies(base = root) {
  verifyBackportSource(base);
  const audit = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], {
    cwd: base, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000,
  });
  if (audit.error || audit.signal || ![0, 1].includes(audit.status)) throw new Error('Unable to complete the registry audit');
  let report;
  try { report = JSON.parse(audit.stdout); } catch { throw new Error('Registry audit returned invalid JSON'); }
  const lock = JSON.parse(readFileSync(join(base, 'package-lock.json'), 'utf8'));
  const result = classifyAudit(report, lock);
  console.log(`Registry audit: ${JSON.stringify(report.metadata.vulnerabilities)}`);
  if (result.blocking.length) throw new Error(`Unremediated high/critical dependencies: ${result.blocking.join(', ')}`);
  const regression = spawnSync(process.execPath, ['--test', 'scripts/tests/dependency-hardening.test.mjs'], {
    cwd: base, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, timeout: 30000,
  });
  if (regression.error || regression.status !== 0) {
    console.error(regression.stdout ?? '');
    console.error(regression.stderr ?? '');
    throw new Error('The maintained security backport failed its installed-consumer regression tests');
  }
  if (result.backported.length) {
    console.log(`Remediated locally, still reported upstream: ${BACKPORTED_ADVISORY}`);
    console.log(`Verified source hashes, development-only paths and installed-consumer regressions: ${result.backported.join(', ')}`);
  }
  console.log('Dependency security gate passed. All other high/critical findings remain blocking.');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { auditDependencies(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Dependency security audit failed');
    process.exitCode = 1;
  }
}

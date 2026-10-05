import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { BACKPORTED_ADVISORY, classifyAudit, verifyBackportSource } from '../dependency-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture() {
  const report = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { high: 2, critical: 0 } },
    vulnerabilities: {
      braces: { severity: 'high', nodes: ['node_modules/braces', 'vendor/braces'], via: [{ name: 'braces', dependency: 'braces', severity: 'high', range: '<=3.0.3', url: BACKPORTED_ADVISORY }] },
      micromatch: { severity: 'high', nodes: ['node_modules/micromatch'], via: ['braces'] },
    },
  };
  const lock = { packages: {
    'node_modules/braces': { link: true, resolved: 'vendor/braces' },
    'vendor/braces': { dev: true },
    'node_modules/micromatch': { dev: true },
  } };
  return { report, lock };
}

test('only the exact backported advisory and its development-only chain are recognized', () => {
  const { report, lock } = fixture();
  assert.deepEqual(classifyAudit(report, lock), { backported: ['braces', 'micromatch'], blocking: [] });
});

test('another advisory in the same package blocks both that package and its consumers', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: 'braces', dependency: 'braces', severity: 'high', range: '<=3.0.3', url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx' });
  assert.deepEqual(classifyAudit(report, lock).blocking, ['braces', 'micromatch']);
});

test('a newly vulnerable package remains blocking', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.next = { severity: 'critical', nodes: ['node_modules/next'], via: [] };
  report.metadata.vulnerabilities.critical++;
  assert.deepEqual(classifyAudit(report, lock).blocking, ['next']);
});

test('production use, unknown paths, cycles and changed advisory details fail closed', () => {
  for (const change of [
    ({ lock }) => { lock.packages['vendor/braces'].dev = false; },
    ({ report }) => { report.vulnerabilities.braces.nodes.push('node_modules/unreviewed/node_modules/braces'); },
    ({ report }) => { report.vulnerabilities.braces.via = ['micromatch']; },
    ({ report }) => { report.vulnerabilities.braces.via[0].range = '*'; },
    ({ report }) => { report.vulnerabilities.braces.via[0].severity = 'critical'; },
  ]) {
    const f = fixture(); change(f);
    assert.deepEqual(classifyAudit(f.report, f.lock).blocking, ['braces', 'micromatch']);
  }
  const f = fixture(); f.lock.packages['node_modules/micromatch'].dev = false;
  assert.deepEqual(classifyAudit(f.report, f.lock).blocking, ['micromatch']);
});

test('network/error/partial reports cannot become a passing audit', () => {
  for (const report of [{}, { error: { code: 'ENETUNREACH' } }, { auditReportVersion: 2, vulnerabilities: {} }]) {
    assert.throws(() => classifyAudit(report, {}), /complete supported report/);
  }
  const f = fixture(); f.report.metadata.vulnerabilities.high = 0;
  assert.throws(() => classifyAudit(f.report, f.lock), /totals are inconsistent/);
});

test('the installed reviewed source passes, and changing one patched byte is rejected', () => {
  verifyBackportSource(root);
  const temporary = mkdtempSync(join(tmpdir(), 'dependency-integrity-'));
  try {
    cpSync(join(root, 'vendor/braces'), join(temporary, 'vendor/braces'), { recursive: true });
    cpSync(join(root, 'package.json'), join(temporary, 'package.json'));
    const compile = join(temporary, 'vendor/braces/lib/compile.js');
    writeFileSync(compile, readFileSync(compile, 'utf8') + '\n// changed\n');
    assert.throws(() => verifyBackportSource(temporary), /differs from the reviewed patch/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

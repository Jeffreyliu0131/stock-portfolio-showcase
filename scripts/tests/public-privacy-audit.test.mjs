import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditContent, auditPath } from '../public-privacy-rules.mjs';
import { auditHistory } from '../public-history-audit.mjs';

const forbiddenEmail = ['synthetic-person', 'privacy-audit-fake.tld'].join('@');
const privateFact = ['产品', '所有者在 IBKR 留有现金。'].join('');
const historyCli = fileURLToPath(new URL('../public-history-audit.mjs', import.meta.url));
const snapshotCli = fileURLToPath(new URL('../public-snapshot-audit.mjs', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'public-privacy-audit-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic Test', GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Synthetic Test', GIT_COMMITTER_EMAIL: 'test@example.com' } }).trim();
  git('init', '--quiet', '--initial-branch=main');
  const write = (path, content) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), content); };
  const commit = (message = 'Synthetic source') => { git('add', '-A'); git('commit', '--quiet', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD'); };
  write('README.md', 'Generic source and synthetic examples.');
  commit();
  return { cwd, git, write, commit };
}

test('email allowlist admits reserved examples and GitHub noreply only', () => {
  for (const email of ['test@example.com', 'test@example.net', 'test@example.org', 'test@example.invalid', 'test@site.test', 'test@demo.example', '1+demo@users.noreply.github.com', 'web-flow@noreply.github.com']) {
    assert.deepEqual(auditContent(email), [], email);
  }
  assert.deepEqual(auditContent(forbiddenEmail), ['non-example-email']);
  assert.deepEqual(auditContent(['test', 'example.com.attacker.tld'].join('@')), ['non-example-email']);
  assert.deepEqual(auditContent(['test', 'notexample.com'].join('@')), ['non-example-email']);
  const serviceAddress = ['support', 'github.com'].join('@');
  assert.deepEqual(auditContent(`Signed-off-by: dependabot[bot] <${serviceAddress}>`, { metadata: true }), []);
  assert.deepEqual(auditContent(`author Synthetic <${serviceAddress}>`, { metadata: true }), ['non-example-email']);
  assert.deepEqual(auditContent(`Signed-off-by: someone <${serviceAddress}>`, { metadata: true }), ['non-example-email']);
  assert.deepEqual(auditContent(serviceAddress), ['non-example-email']);
  const noReply = ['noreply', 'github.com'].join('@');
  assert.deepEqual(auditContent(`committer GitHub <${noReply}> 1000000000 +0000`, { metadata: true }), []);
  assert.deepEqual(auditContent(`committer Synthetic <${noReply}> 1000000000 +0000`, { metadata: true }), ['non-example-email']);
  assert.deepEqual(auditContent('https://example.com/compare/vinext@1.0.0-beta.2...vinext@1.0.0-beta.3', { metadata: true }), []);
});

test('personal facts are rejected without banning generic privacy, confirmation, or broker support', () => {
  assert.deepEqual(auditContent(privateFact, { path: 'docs/adr/decision.md' }), ['personal-process-record']);
  assert.deepEqual(auditContent(['用户', '确认 2026-01-01'].join(''), { metadata: true }), ['personal-process-record']);
  assert.deepEqual(auditContent(['曾内置 ', '27 只持仓'].join(''), { path: 'README.md' }), ['personal-process-record']);
  assert.deepEqual(auditContent('禁止保存真实持仓。IBKR / moomoo 是支持的券商。需要用户确认导入，原子失败不写入。', { path: 'docs/privacy.md' }), []);
  assert.deepEqual(auditContent('用户确认文件已经保存。', { path: 'ui/backup.tsx' }), []);
  assert.deepEqual(auditContent('谨慎、可审计的个人组合决策支持分析员', { path: 'docs/ai.md' }), []);
});

test('deployment origins, identifiers, machine paths and credentials do not pass as source', () => {
  const origin = 'synthetic-deployment' + '.vercel.app';
  const site = 'synthetic-owner' + '.chatgpt.site';
  assert.deepEqual(auditContent(origin + ' ' + site), ['deployment-origin']);
  assert.deepEqual(auditContent('appgdep_' + 'a'.repeat(32)), ['deployment-identity']);
  assert.deepEqual(auditContent('appgprj_' + 'a'.repeat(32)), ['deployment-identity']);
  assert.deepEqual(auditContent('/Users/' + 'synthetic-local/private/'), ['private-machine-path']);
  assert.deepEqual(auditContent('/home/' + 'synthetic-local/private/'), ['private-machine-path']);
  assert.deepEqual(auditContent('C:' + '\\Users\\' + 'synthetic-local\\private\\'), ['private-machine-path']);
  assert.deepEqual(auditContent('sk-' + 'x'.repeat(30)), ['credential-format']);
  assert.deepEqual(auditContent('NEXT_' + 'PUBLIC_API_KEY'), ['client-secret-prefix']);
  assert.deepEqual(auditContent('https://provider.example.com https://sites.test http://localhost:3000'), []);
});

test('private filenames remain forbidden while the environment example is allowed', () => {
  for (const path of ['.env.local', '.deployment/config.json', '.vercel/project.json', 'capture.har', 'broker-export-fixture.csv']) assert.deepEqual(auditPath(path), ['private-data-path']);
  assert.deepEqual(auditPath('.env.example'), []);
});

test('snapshot CLI audits untracked publishable files and does not print private matches', t => {
  const f = fixture(t);
  f.write('.env.example', ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY']
    .map(name => `${name}=replace-with-synthetic-value`).join('\n'));
  const clean = spawnSync(process.execPath, [snapshotCli], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  f.write('new-notes.md', forbiddenEmail);
  const failed = spawnSync(process.execPath, [snapshotCli], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /new-notes.md.*non-example-email/);
  assert.ok(!failed.stderr.includes(forbiddenEmail));
});

test('snapshot mapping parse errors never reproduce private input or stack traces', t => {
  const f = fixture(t);
  const sentinel = 'audit-private-sentinel-invalid-json';
  f.write('.publication/source-map.json', sentinel);
  const result = spawnSync(process.execPath, [snapshotCli], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid-publication-mapping/);
  assert.ok(!result.stderr.includes(sentinel));
  assert.ok(!result.stderr.includes('SyntaxError'));
  assert.ok(!result.stderr.includes(f.cwd));
});

test('history inspects deleted blobs and facts reachable only from PR refs', t => {
  const f = fixture(t);
  f.write('docs/removed.md', privateFact);
  const historical = f.commit();
  const blob = f.git('rev-parse', `${historical}:docs/removed.md`);
  f.git('update-ref', 'refs/pull/17/head', historical);
  f.git('reset', '--hard', 'HEAD~1');
  const result = auditHistory(f.cwd);
  assert.equal(result.commits, 2);
  assert.ok(result.failures.some(line => line.includes(blob) && line.includes('docs/removed.md') && line.includes('personal-process-record')));
  assert.ok(result.failures.every(line => !line.includes(privateFact)));
});

test('history checks author and committer identities plus messages, with redacted CLI output', t => {
  const f = fixture(t);
  const commitTree = (author, committer, message) => execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD'], {
    cwd: f.cwd, input: message, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic Test', GIT_AUTHOR_EMAIL: author,
      GIT_COMMITTER_NAME: 'Synthetic Test', GIT_COMMITTER_EMAIL: committer },
  }).trim();
  const authorSha = commitTree(forbiddenEmail, 'test@example.com', 'Synthetic author test');
  const committerSha = commitTree('test@example.com', forbiddenEmail, 'Synthetic committer test');
  const messageSha = commitTree('test@example.com', 'test@example.com', forbiddenEmail + '\n' + privateFact);
  for (const [name, sha] of [['author', authorSha], ['committer', committerSha], ['message', messageSha]]) f.git('update-ref', `refs/heads/${name}`, sha);
  const result = auditHistory(f.cwd);
  for (const sha of [authorSha, committerSha, messageSha]) assert.ok(result.failures.some(line => line.includes(sha) && line.includes('non-example-email')));
  assert.ok(result.failures.some(line => line.includes(messageSha) && line.includes('personal-process-record')));
  const cli = spawnSync(process.execPath, [historyCli], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.ok(cli.stderr.includes(authorSha));
  assert.ok(!cli.stderr.includes(forbiddenEmail));
  assert.ok(!cli.stderr.includes(privateFact));
});

test('annotated tag metadata is audited even when commit metadata is clean', t => {
  const f = fixture(t);
  f.git('tag', '-a', 'synthetic-tag', '-m', forbiddenEmail);
  const result = auditHistory(f.cwd);
  assert.ok(result.failures.some(line => line.includes('<tag-metadata>') && line.includes('non-example-email')));
});

test('all historical paths are checked even when a blob also has a safe name', t => {
  const f = fixture(t);
  f.write('safe.txt', 'synthetic value');
  f.write('capture.har', 'synthetic value');
  f.commit();
  f.git('rm', 'capture.har');
  f.commit();
  const result = auditHistory(f.cwd);
  assert.ok(result.failures.some(line => line.includes('capture.har') && line.includes('private-data-path')));
});

test('tags pointing directly at trees retain filename checks', t => {
  const f = fixture(t);
  f.write('capture.har', 'synthetic value');
  f.git('add', '-A');
  const tree = f.git('write-tree');
  f.git('tag', '-a', 'synthetic-tree', tree, '-m', 'Synthetic tree tag');
  f.git('reset', '--hard', 'HEAD');
  assert.ok(auditHistory(f.cwd).failures.some(line => line.includes('capture.har') && line.includes('private-data-path')));
});

test('binary text metadata, oversized blobs and symlinks are not silently skipped', t => {
  const f = fixture(t);
  f.write('public/image.png', Buffer.from('\0' + forbiddenEmail));
  f.write('oversized.txt', Buffer.alloc(2_000_001, 'a'));
  symlinkSync('README.md', join(f.cwd, 'source-link'));
  f.commit();
  const result = auditHistory(f.cwd);
  assert.ok(result.failures.some(line => line.includes('public/image.png') && line.includes('non-example-email')));
  assert.ok(result.failures.some(line => line.includes('oversized.txt') && line.includes('file-exceeds-audit-limit')));
  assert.ok(result.failures.some(line => line.includes('source-link') && line.includes('non-regular-source')));
});

test('clean full history passes; a shallow clone fails closed', t => {
  const f = fixture(t);
  f.write('docs/contract.md', 'Restore requires user confirmation; no real holdings in source.');
  f.commit();
  assert.deepEqual(auditHistory(f.cwd).failures, []);
  const shallow = join(f.cwd, 'shallow-copy');
  f.git('clone', '--quiet', '--depth=1', `file://${f.cwd}`, shallow);
  assert.throws(() => auditHistory(shallow), /incomplete-shallow-history/);
});

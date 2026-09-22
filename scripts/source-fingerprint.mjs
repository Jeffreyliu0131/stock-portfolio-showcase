import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { publicationMapping } from './sites-source-map.mjs';
export function sourceFingerprint(cwd = process.cwd(), overrides = new Map()) {
  const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const path of files) {
    if (path !== ".env.example" && /(^|\/)(\.env(?:\.|$)|\.dev\.vars(?:\.|$))/.test(path)) throw new Error("Credential configuration must not enter the source fingerprint");
    const content = overrides.get(path) ?? readFileSync(resolve(cwd, path));
    hash.update(path + '\0').update(createHash('sha256').update(content).digest('hex') + '\0');
  }
  return hash.digest('hex');
}
export function captureSourceState(cwd = process.cwd(), overrides = new Map()) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const sha = git(['rev-parse', 'HEAD']);
  const mapping = overrides.size ? null : publicationMapping(cwd);
  const fingerprint = sourceFingerprint(cwd, overrides);
  return { sha, fingerprint, dirty: git(['status', '--porcelain', '--untracked-files=normal']) !== '',
    canonicalSourceSha: mapping?.canonicalSourceSha ?? sha, canonicalSourceFingerprint: mapping?.canonicalSourceFingerprint ?? fingerprint };
}
export function assertSameSource(before, after) {
  if (before.sha !== after.sha || before.fingerprint !== after.fingerprint || before.dirty !== after.dirty) throw new Error('Source changed during build; artifacts are not sealed');
}

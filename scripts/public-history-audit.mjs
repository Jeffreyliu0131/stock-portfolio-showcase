import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditContent, auditPath, MAX_SCANNED_FILE_BYTES } from './public-privacy-rules.mjs';

// No network or ref mutations. --all covers every locally fetched ref, including
// PR refs in a separately prepared audit mirror. CI checks fetched branches/tags;
// inaccessible remote refs, platform caches and external copies need separate review.
export function auditHistory(cwd = process.cwd()) {
  const git = (args, input) => execFileSync('git', args, {
    cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('incomplete-shallow-history');
  if (existsSync(resolve(cwd, git(['rev-parse', '--git-path', 'info/grafts']).trim()))) throw new Error('unsupported-grafted-history');
  const roots = ['--all'];
  try { git(['rev-parse', '--verify', 'HEAD']); roots.push('HEAD'); } catch { /* Bare mirror may have no default branch. */ }
  const ids = git(['rev-list', '--objects', '--no-object-names', ...roots]).trim().split('\n').filter(Boolean);
  if (!ids.length) throw new Error('empty-history');
  const info = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], ids.join('\n') + '\n')
    .trim().split('\n').map(line => {
      const [sha, type, size] = line.split(' ');
      if (!/^[a-f0-9]{40,64}$/u.test(sha) || !['commit', 'tag', 'tree', 'blob'].includes(type) || !/^\d+$/u.test(size)) throw new Error('unreadable-history-object');
      return { sha, type, size: Number(size) };
    });
  const failures = new Set();
  const blobs = new Map();
  const add = (sha, path, rule) => failures.add(`${sha} ${JSON.stringify(path)}: ${rule}`);
  const commits = info.filter(object => object.type === 'commit');
  const treeRoots = new Set(commits.map(object => object.sha));
  const objectTypes = new Map(info.map(object => [object.sha, object.type]));
  // A tag/ref can point directly at a tree rather than a commit. Preserve its
  // paths too; otherwise a forbidden filename could disappear from the audit.
  for (const refSha of git(['rev-parse', ...roots]).trim().split('\n')) {
    let sha = refSha;
    const seen = new Set();
    while (objectTypes.get(sha) === 'tag' && !seen.has(sha)) {
      seen.add(sha);
      sha = /^object ([a-f0-9]{40,64})\n/u.exec(git(['cat-file', 'tag', sha]))?.[1];
    }
    if (objectTypes.get(sha) === 'tree') treeRoots.add(sha);
  }
  for (const sha of treeRoots) {
    const entries = git(['ls-tree', '-r', '-z', sha]).split('\0').filter(Boolean);
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      const [mode, type, objectSha] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (tab < 0) throw new Error('unreadable-history-tree');
      for (const rule of auditPath(path)) add(objectSha, path, rule);
      if (mode !== '100644' && mode !== '100755') add(objectSha, path, 'non-regular-source');
      if (type === 'blob') {
        if (!blobs.has(objectSha)) blobs.set(objectSha, new Set());
        blobs.get(objectSha).add(path);
      }
    }
  }
  let scannedBlobs = 0;
  for (const { sha, type, size } of info) {
    if (type === 'tree') continue;
    const paths = type === 'blob' ? (blobs.get(sha) ?? new Set(['<unpathed-blob>'])) : new Set([`<${type}-metadata>`]);
    if (size > MAX_SCANNED_FILE_BYTES) {
      for (const path of paths) add(sha, path, 'file-exceeds-audit-limit');
      continue;
    }
    const content = git(['cat-file', type, sha]);
    if (type === 'blob') scannedBlobs++;
    for (const path of paths) {
      for (const rule of auditContent(content, { path, metadata: type !== 'blob' || path === '<unpathed-blob>' })) add(sha, path, rule);
    }
  }
  return { commits: commits.length, blobs: scannedBlobs, failures: [...failures].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = auditHistory();
    if (result.failures.length) {
      console.error('Public history audit failed:\n' + result.failures.map(item => `- ${item}`).join('\n'));
      process.exitCode = 1;
    } else console.log(`Public history audit passed: ${result.commits} commits and ${result.blobs} blobs across all local refs.`);
  } catch {
    // Git errors can contain private paths, remote URLs or object contents.
    console.error('Public history audit could not complete; use a full, readable, ungrafted repository.');
    process.exitCode = 1;
  }
}

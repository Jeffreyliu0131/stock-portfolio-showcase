import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function outputDirectory(target) {
  if (!['provider', 'sites', 'demo'].includes(target)) throw new Error('Unknown build target');
  return target === 'sites' ? 'dist' : target === 'demo' ? '.next-demo' : '.next';
}
function validPath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.' || p === '')) throw new Error('Invalid publication path');
  return path;
}
function noLinks(cwd, path) {
  validPath(path);
  let cursor = cwd;
  for (const part of path.split('/')) {
    cursor = resolve(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Publication symlink rejected: ${path}`);
  }
  return cursor;
}
export function readRegular(cwd, path) {
  const file = noLinks(cwd, path);
  if (!lstatSync(file).isFile()) throw new Error(`Publication file required: ${path}`);
  return readFileSync(file);
}
function excluded(path, output, target) {
  if ([`${output}/artifact-manifest.json`, `${output}/build-provenance.json`].includes(path)) return true;
  if (target === 'sites') return false;
  const local = path.slice(output.length + 1);
  return ['cache', 'diagnostics', 'types'].some(p => local === p || local.startsWith(p + '/')) || ['trace', 'trace-build'].includes(local);
}
// Deployment adapters may alias routes inside their own complete output tree.
// Source files, standard Next output and Sites still prohibit all symlinks.
function publicationPath(cwd, path, adapterRoot) {
  validPath(path);
  if (!adapterRoot || !path.startsWith(adapterRoot + '/')) return noLinks(cwd, path);
  const boundary = realpathSync(noLinks(cwd, adapterRoot));
  const actual = realpathSync(resolve(cwd, path));
  const inside = relative(boundary, actual);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error(`Adapter symlink escapes output: ${path}`);
  return actual;
}
function walk(cwd, root, skip = () => false, adapterRoot = null) {
  noLinks(cwd, root);
  const paths = [];
  function visit(path, ancestors = new Set()) {
    const actual = publicationPath(cwd, path, adapterRoot);
    const stat = lstatSync(actual);
    if (skip(path)) return;
    if (stat.isDirectory()) {
      if (ancestors.has(actual)) throw new Error(`Cyclic publication symlink: ${path}`);
      const next = new Set(ancestors).add(actual);
      for (const child of readdirSync(actual).sort()) visit(`${path}/${child}`, next);
    } else if (stat.isFile()) paths.push(path);
    else throw new Error(`Unsupported publication entry: ${path}`);
  }
  visit(root);
  return paths;
}
function json(cwd, path) { return JSON.parse(readRegular(cwd, path).toString('utf8')); }
function nonempty(cwd, path) {
  if (readRegular(cwd, path).length === 0) throw new Error(`Empty required publication file: ${path}`);
}
function projectRelative(cwd, absolute) {
  return validPath(relative(resolve(cwd), absolute).split(sep).join('/'));
}

// The policy is independent of the saved manifest: required entries and the
// current complete file set are rediscovered from disk on every preflight.
export function publicationFiles(target, cwd = process.cwd()) {
  const output = outputDirectory(target);
  const adapterRoot = target === 'provider' ? `${output}/output` : null;
  const paths = new Set(walk(cwd, output, p => excluded(p, output, target), adapterRoot));
  const requireOutput = path => { nonempty(cwd, `${output}/${path}`); if (!paths.has(`${output}/${path}`)) throw new Error(`Unlisted runtime entry: ${path}`); };
  if (target === 'sites') {
    for (const path of ['server/index.js', 'server/ssr/index.js', '.openai/hosting.json', '.openai/drizzle/meta/_journal.json']) requireOutput(path);
    const sourceHosting = readRegular(cwd, '.openai/hosting.json');
    const hosting = JSON.parse(sourceHosting.toString('utf8'));
    if (Object.keys(hosting).sort().join(',') !== 'd1,project_id,r2') throw new Error('Unapproved source hosting fields');
    const normalizedHosting = Buffer.from(JSON.stringify({ project_id: hosting.project_id, d1: hosting.d1, r2: hosting.r2 }, null, 2) + '\n');
    if (!sourceHosting.equals(normalizedHosting) || !sourceHosting.equals(readRegular(cwd, `${output}/.openai/hosting.json`))) throw new Error('Source/built hosting must match the packager canonical bytes');
    const journal = json(cwd, `${output}/.openai/drizzle/meta/_journal.json`);
    if (!Array.isArray(journal.entries) || !journal.entries.length) throw new Error('Migration journal is missing entries');
    for (const entry of journal.entries) {
      if (!Number.isInteger(entry.idx) || entry.idx < 0 || !/^[a-zA-Z0-9_]+$/.test(entry.tag)) throw new Error('Invalid migration journal');
      requireOutput(`.openai/drizzle/${entry.tag}.sql`);
      requireOutput(`.openai/drizzle/meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`);
    }
    const expectedMigrations = walk(cwd, 'drizzle');
    const actualMigrations = [...paths].filter(p => p.startsWith(`${output}/.openai/drizzle/`));
    if (actualMigrations.length !== expectedMigrations.length) throw new Error('Packaged migration file set differs from source');
    for (const path of expectedMigrations) {
      const staged = `${output}/.openai/${path}`;
      if (!readRegular(cwd, path).equals(readRegular(cwd, staged))) throw new Error(`Packaged migration differs: ${path}`);
    }
    if (![...paths].some(p => p.startsWith('dist/client/') && p.endsWith('.js')) || ![...paths].some(p => p.startsWith('dist/client/') && p.endsWith('.css'))) throw new Error('Sites client JavaScript/CSS is missing');
  } else {
    for (const path of ['BUILD_ID', 'required-server-files.json', 'build-manifest.json', 'routes-manifest.json', 'server/app-paths-manifest.json', 'next-server.js.nft.json', 'server/app/page.js', 'server/app/data-safety/page.js', 'server/app/api/portfolio/route.js']) requireOutput(path);
    const required = json(cwd, `${output}/required-server-files.json`);
    if (!Array.isArray(required.files) || !required.files.length) throw new Error('Next required files are missing');
    for (const path of required.files) {
      validPath(path);
      if (!path.startsWith(output + '/')) throw new Error('Next required file escapes runtime output');
      requireOutput(path.slice(output.length + 1));
    }
    const routes = json(cwd, `${output}/server/app-paths-manifest.json`);
    for (const route of ['/page', '/data-safety/page', '/api/portfolio/route']) if (typeof routes[route] !== 'string') throw new Error(`Missing app route: ${route}`);
    for (const path of Object.values(routes)) requireOutput(`server/${validPath(path)}`);
    const build = json(cwd, `${output}/build-manifest.json`);
    function checkChunks(value) {
      if (typeof value === 'string') requireOutput(validPath(value));
      else if (Array.isArray(value)) value.forEach(checkChunks);
      else if (value && typeof value === 'object') Object.values(value).forEach(checkChunks);
    }
    checkChunks(build);
    if (![...paths].some(p => p.startsWith(`${output}/static/`) && p.endsWith('.js')) || ![...paths].some(p => p.startsWith(`${output}/static/`) && p.endsWith('.css'))) throw new Error('Next static JavaScript/CSS is missing');
    // Next's deployment traces name runtime dependencies outside .next too.
    for (const trace of [...paths].filter(p => p.endsWith('.nft.json') && !p.startsWith(`${adapterRoot}/`))) {
      const traced = json(cwd, trace);
      if (!Array.isArray(traced.files)) throw new Error(`Invalid dependency trace: ${trace}`);
      for (const dependency of traced.files) {
        if (typeof dependency !== 'string') throw new Error('Invalid dependency path');
        const path = projectRelative(cwd, resolve(cwd, dirname(trace), dependency));
        if (/(^|\/)(\.env(?:\.|$)|\.dev\.vars|\.deployment|\.git)(\/|$|\.)/.test(path)) throw new Error('Private file referenced by runtime trace');
        if (path.startsWith(output + '/') && excluded(path, output, target)) throw new Error('Runtime trace points at excluded build scratch');
        readRegular(cwd, path);
        paths.add(path);
      }
    }
  }
  // Public assets are served outside .next, and are copied into Sites client.
  for (const path of walk(cwd, 'public')) {
    if (target === 'sites') {
      const staged = `${output}/client/${path.slice('public/'.length)}`;
      if (!readRegular(cwd, path).equals(readRegular(cwd, staged))) throw new Error(`Public asset missing or changed: ${path}`);
    } else paths.add(path);
  }
  return [...paths].sort().map(path => {
    const actual = publicationPath(cwd, path, adapterRoot);
    if (!lstatSync(actual).isFile()) throw new Error(`Publication file required: ${path}`);
    const bytes = readFileSync(actual);
    const resolvedPath = validPath(relative(realpathSync(cwd), realpathSync(actual)).split(sep).join('/'));
    return { path, bytes: bytes.length, sha256: sha256(bytes), ...(resolvedPath !== path ? { resolvedPath } : {}) };
  });
}

export function artifactManifest(config, source, cwd = process.cwd()) {
  return { formatVersion: 1, target: config.target, sourceSha: source.sha, sourceFingerprint: source.fingerprint, canonicalSourceSha: source.canonicalSourceSha ?? source.sha, canonicalSourceFingerprint: source.canonicalSourceFingerprint ?? source.fingerprint, files: publicationFiles(config.target, cwd) };
}
export function verifyArtifacts(config, provenance, cwd = process.cwd()) {
  const output = outputDirectory(config.target);
  const bytes = readRegular(cwd, `${output}/artifact-manifest.json`);
  if (sha256(bytes) !== provenance.artifactManifestSha256) throw new Error('Artifact manifest seal differs');
  const actual = artifactManifest(config, { sha: provenance.sourceSha, fingerprint: provenance.sourceFingerprint, canonicalSourceSha: provenance.canonicalSourceSha, canonicalSourceFingerprint: provenance.canonicalSourceFingerprint }, cwd);
  const saved = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(saved) !== JSON.stringify(actual)) throw new Error('Publication artifacts missing, changed, or extra files present');
  if (config.target === 'sites') {
    const hosting = json(cwd, 'dist/.openai/hosting.json');
    if (hosting.project_id !== config.projectId || hosting.d1 !== 'DB' || hosting.r2 !== null) throw new Error('Sites identity or binding mismatch');
  }
  return actual.files.length;
}

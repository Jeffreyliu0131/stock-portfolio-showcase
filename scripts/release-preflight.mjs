import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploymentConfig } from './deployment-config.mjs';
import { captureSourceState } from './source-fingerprint.mjs';
import { outputDirectory, readRegular, verifyArtifacts } from './artifact-integrity.mjs';

export function releasePreflight(config, { cwd = process.cwd(), readSource = captureSourceState } = {}) {
  const output = outputDirectory(config.target);
  const provenance = JSON.parse(readRegular(cwd, `${output}/build-provenance.json`).toString('utf8'));
  const source = readSource(cwd);
  if (source.dirty || !provenance.deploymentReady || provenance.checkOnly || config.target === 'demo' || provenance.sourceSha !== source.sha || provenance.sourceFingerprint !== source.fingerprint) throw new Error('Release requires an unchanged, clean committed source and a fresh production build');
  if (provenance.canonicalSourceSha !== (source.canonicalSourceSha ?? source.sha) || provenance.canonicalSourceFingerprint !== (source.canonicalSourceFingerprint ?? source.fingerprint)) throw new Error('Canonical source mapping changed');
  for (const key of ['target', 'sitesOrigin', 'providerOrigin', 'experience', 'projectId', 'checkOnly']) {
    if (config[key] !== provenance[key]) throw new Error(`Build configuration changed: ${key}`);
  }
  const files = verifyArtifacts(config, provenance, cwd);
  return { sha: source.sha, files };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = deploymentConfig(process.argv[2]);
  const result = releasePreflight(config);
  console.log(`Local release preflight passed: ${config.target} ${result.sha}, ${result.files} verified publication files. Verify pushed remote SHA and platform access separately before publishing.`);
}

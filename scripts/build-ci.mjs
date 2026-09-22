import { spawnSync } from 'node:child_process';
const env = { ...process.env, PORTFOLIO_BUILD_MODE: 'check',
  PORTFOLIO_SITES_ORIGIN: 'https://sites.ci.invalid',
  PORTFOLIO_PROVIDER_ORIGIN: 'https://provider.ci.invalid',
  SITES_PROJECT_ID: 'appgprj_' + '0'.repeat(32), PORTFOLIO_EXPERIENCE: 'production',
};
for (const target of ['provider', 'sites']) {
  const result = spawnSync(process.execPath, ['scripts/build-target.mjs', target], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

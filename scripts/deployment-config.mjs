import { existsSync, readFileSync } from 'node:fs';

/**
 * @param {string} target
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string | undefined> | undefined} local
 */
export function deploymentConfig(target, env = process.env, local = undefined) {
  if (!['sites', 'provider', 'demo'].includes(target)) throw new Error('Select sites, provider, or demo');
  const demo = target === 'demo';
  const checkOnly = env.PORTFOLIO_BUILD_MODE === 'check';
  const config = demo ? {} : local ?? (existsSync('.deployment/config.json')
    ? JSON.parse(readFileSync('.deployment/config.json', 'utf8')) : {});
  const sitesOrigin = env.PORTFOLIO_SITES_ORIGIN ?? config.sitesOrigin ?? (demo ? 'https://portfolio.example.com' : '');
  const providerOrigin = env.PORTFOLIO_PROVIDER_ORIGIN ?? config.providerOrigin ?? (demo ? 'https://provider.example.com' : '');
  for (const value of [sitesOrigin, providerOrigin]) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Both deployment origins are required'); }
    if (url.origin !== value || url.protocol !== 'https:' || url.username || url.password ||
      (!demo && !checkOnly && /(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/.test(url.hostname))) {
      throw new Error('Deployment requires exact HTTPS origins, without placeholders, paths or credentials');
    }
  }
  if (sitesOrigin === providerOrigin) throw new Error('Sites and provider must use separate origins');
  const projectId = env.SITES_PROJECT_ID ?? config.projectId;
  if (target === 'sites' && !/^appgprj_[a-f0-9]{28,32}$/.test(projectId ?? '')) throw new Error('Existing Sites project id is required');
  const experience = env.PORTFOLIO_EXPERIENCE ?? config.experience ?? (demo ? 'research' : 'production');
  if (!['production', 'research'].includes(experience)) throw new Error('Invalid portfolio experience');
  return { target, sitesOrigin, providerOrigin, projectId, experience, checkOnly };
}

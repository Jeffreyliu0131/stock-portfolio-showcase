import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentConfig } from '../scripts/deployment-config.mjs';
import { GET, POST } from '../app/api/portfolio/route.ts';
import { installSitesRuntimeEnvironment } from '../application/runtime/server-environment.ts';
import { createPortfolioRepository } from '../application/portfolio-repository.ts';
import { CloudPortfolioRepository } from '../application/cloud/browser/cloud-portfolio-repository.ts';

const auth = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => auth.headers }));
afterEach(() => { vi.unstubAllEnvs(); auth.headers = new Headers(); installSitesRuntimeEnvironment({}); });

describe('deployment boundaries', () => {
  it('requires real exact deployment wiring and rejects example origins', () => {
    expect(() => deploymentConfig('provider', { NODE_ENV: 'test' }, {})).toThrow();
    for (const origin of ['https://portfolio.example.com', 'https://site.invalid', 'https://site.test', 'https://site.test/path', 'http://site.test', 'https://u:p@site.test', 'https://site.test/']) {
      expect(() => deploymentConfig('provider', { NODE_ENV: 'test' }, { sitesOrigin: origin, providerOrigin: 'https://provider.test' })).toThrow();
    }
    expect(deploymentConfig('provider', { NODE_ENV: 'test', PORTFOLIO_BUILD_MODE: 'check' }, { sitesOrigin: 'https://site.test', providerOrigin: 'https://provider.test' }).experience).toBe('production');
    expect(() => deploymentConfig('sites', { NODE_ENV: 'test' }, { sitesOrigin: 'https://site.test', providerOrigin: 'https://provider.test' })).toThrow();
    expect(deploymentConfig('demo', { NODE_ENV: 'test' }, {}).experience).toBe('research');
  });
  it('denies provider account API even with forged Sites headers and a DB binding', async () => {
    vi.stubEnv('NEXT_PUBLIC_PORTFOLIO_TARGET', 'provider');
    auth.headers = new Headers({ 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'synthetic@example.invalid' });
    const prepare = vi.fn();
    installSitesRuntimeEnvironment({ DB: { prepare } });
    expect((await GET()).status).toBe(404);
    expect((await POST(new Request('https://provider.test/api/portfolio', { method: 'POST' }))).status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects missing Sites identity before touching D1', async () => {
    vi.stubEnv('NEXT_PUBLIC_PORTFOLIO_TARGET', 'sites');
    const prepare = vi.fn();
    installSitesRuntimeEnvironment({ DB: { prepare } });
    expect((await GET()).status).toBe(401);
    expect((await POST(new Request('https://site.test/api/portfolio', { method: 'POST' }))).status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('uses cloud current on Sites and local legacy current on provider', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NEXT_PUBLIC_PORTFOLIO_TARGET', 'sites');
    expect(createPortfolioRepository()).toBeInstanceOf(CloudPortfolioRepository);
    vi.stubEnv('NEXT_PUBLIC_PORTFOLIO_TARGET', 'provider');
    expect(createPortfolioRepository()).not.toBeInstanceOf(CloudPortfolioRepository);
  });
});

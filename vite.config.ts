import { readFileSync } from 'node:fs';
import { sites } from '@openai/sites-vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig(async () => {
  if (process.env.NEXT_PUBLIC_PORTFOLIO_TARGET !== 'sites') throw new Error('Use npm run build:sites for Worker builds');
  const hosting = JSON.parse(readFileSync('.openai/hosting.json', 'utf8')) as { d1: string };
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    define: Object.fromEntries(['NEXT_PUBLIC_PORTFOLIO_TARGET', 'NEXT_PUBLIC_PORTFOLIO_EXPERIENCE', 'NEXT_PUBLIC_SITES_ORIGIN', 'NEXT_PUBLIC_PROVIDER_ORIGIN'].map(name => [`process.env.${name}`, JSON.stringify(process.env[name])])),
    plugins: [vinext(), sites(), cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: {
        main: './worker/index.ts',
        compatibility_date: '2026-09-18',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [{ binding: hosting.d1, database_name: 'stock-portfolio-cloud', database_id: '00000000-0000-4000-8000-000000000000' }],
        r2_buckets: [],
      },
    })],
  };
});

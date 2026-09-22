// Local synthetic smoke only. Never points at a hosted current or calls an AI provider.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const provider = JSON.parse(readFileSync('.next/build-provenance.json', 'utf8'));
const children = [];
async function start(args, port) {
  let logs = '';
  const child = spawn(process.execPath, args, { env: { ...process.env, PORTFOLIO_AI_ENABLED: 'false', BUFFETT_RESEARCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.wrangler/smoke.log' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  for (let i = 0; i < 80; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/portfolio`); return; } catch {}
    if (child.exitCode !== null) throw new Error(`Local server exited: ${logs.slice(-2000)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local server unavailable: ${logs.slice(-2000)}`);
}
try {
  await start(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4193'], 4193);
  const providerUrl = 'http://127.0.0.1:4193';
  for (const method of ['GET', 'POST']) {
    const result = await fetch(`${providerUrl}/api/portfolio`, { method, headers: { 'oai-authenticated-user-id': 'synthetic-forged', 'oai-authenticated-user-email': 'test@example.invalid' } });
    assert.equal(result.status, 404, 'provider cannot access account current');
  }
  const preflight = await fetch(`${providerUrl}/api/quotes`, { method: 'OPTIONS', headers: { Origin: provider.sitesOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), provider.sitesOrigin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.equal((await fetch(`${providerUrl}/api/quotes`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.invalid', 'Access-Control-Request-Method': 'POST' } })).status, 403);
  const icon = await fetch(`${providerUrl}/icons/apple-touch-icon-aurora.png`);
  assert.equal(icon.status, 200); assert.match(icon.headers.get('content-type'), /image\/png/);
  assert.equal(icon.headers.get('access-control-allow-origin'), '*');
  const localSafety = await fetch(providerUrl + '/data-safety');
  assert.equal(localSafety.status, 200);
  const localCopy = await localSafety.text();
  assert.match(localCopy, /当前浏览器旧域名本地数据/);
  assert.doesNotMatch(localCopy, /当前资产按 ChatGPT 登录账号保存在 Sites 云端/);
  const legacy = await fetch(providerUrl);
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /data-experience="production"/);
  await start(['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--ip', '127.0.0.1', '--port', '4194', '--local', '--persist-to', resolve('.wrangler/smoke-state')], 4194);
  const sitesUrl = 'http://127.0.0.1:4194';
  const account = await fetch(`${sitesUrl}/api/portfolio`);
  assert.equal(account.status, 401, 'anonymous Sites current must be rejected');
  assert.match(account.headers.get('cache-control'), /no-store/);
  assert.equal((await fetch(`${sitesUrl}/api/quotes`, { method: 'POST' })).status, 404, 'Worker cannot run provider endpoints');
  const cloudSafety = await fetch(sitesUrl + '/data-safety', { headers: { 'oai-authenticated-user-id': 'synthetic-review-user', 'oai-authenticated-user-email': 'synthetic@example.invalid' } });
  assert.equal(cloudSafety.status, 200);
  const cloudCopy = await cloudSafety.text();
  assert.match(cloudCopy, /当前资产按 ChatGPT 登录账号保存在 Sites 云端/);
  assert.doesNotMatch(cloudCopy, /当前浏览器旧域名本地数据/);
  const page = await fetch(sitesUrl, { redirect: 'manual' });
  assert.equal(page.status, 307);
  assert.match(page.headers.get('location'), /^\/signin-with-chatgpt/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  console.log('Built targets smoke passed: correct local/cloud data-safety copy, provider current blocked, exact CORS, public icons, legacy page, Sites auth and provider isolation. No live provider or account data used.');
} finally { for (const child of children) child.kill('SIGTERM'); }

// Synthetic visual smoke; all non-local browser requests are blocked.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const originals = ['next-env.d.ts', 'tsconfig.json'].map(path => [path, readFileSync(path)]);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '4195'], { env: { ...process.env, NEXT_PUBLIC_PORTFOLIO_TARGET: 'demo', NEXT_PUBLIC_PORTFOLIO_EXPERIENCE: 'production', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch('http://127.0.0.1:4195/?fixture=ready'); if (response.ok) break; } catch {}
    if (server.exitCode !== null) throw new Error('Synthetic preview exited');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors = [];
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  mkdirSync('test-results', { recursive: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://127.0.0.1:4195/?fixture=ready');
    await page.getByText('本地合成预览数据，不代表真实持仓或实时行情。').waitFor();
    assert.equal(await page.getByRole('button', { name: '录入资产', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `page overflow at ${width}`);
    await page.locator(".portfolio-trend__plot svg").waitFor();
    await page.screenshot({ path: `test-results/production-synthetic-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  const unexpectedConsoleErrors = consoleErrors.filter(message => !message.startsWith("eval() is not supported in this environment."));
  assert.deepEqual(unexpectedConsoleErrors, []);
  if (consoleErrors.length) console.log("Expected development-only React eval notice under unchanged strict CSP; production does not use eval.");
  console.log('Synthetic production presentation passed at 320, 390 and 1280px: no page overflow, one entry CTA, no page exceptions; screenshots in ignored test-results.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
  for (const [path, content] of originals) writeFileSync(path, content);
}

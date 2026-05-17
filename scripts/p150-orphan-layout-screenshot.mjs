/* v0.10.4 #150 — orphan layout screenshot evidence.
 *
 * Fixture: 3 prefix groups (5+3+4 = 12 grouped) + 5 distinct-prefix
 * singletons (orphans). Pre-#150 the singletons appeared scattered
 * in centred bands between cluster boxes. Post-#150 they all bundle
 * into one "其他" cluster box at the bottom. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const out = process.argv[2] || 'screenshots/v0.10.4-150-orphans/after';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Force grid layout so the orphan band is visible
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});
const fresh = new Date(Date.now() - 60_000).toISOString();
const sessions = [];
// Group 1: ai-insight × 5
for (let i = 1; i <= 5; i++) sessions.push({
  alias: `ai-insight-node-${i}`, status: i === 1 ? 'working' : 'idle',
  model: 'claude-opus-4', runtime: 'claude-code-cli',
  network_id: 'default', project_dir: null,
  created_at: fresh, updated_at: fresh, last_seen_at: fresh,
});
// Group 2: agent-network-dashboard × 3
for (let i = 1; i <= 3; i++) sessions.push({
  alias: `agent-network-dashboard-${i}`, status: i === 1 ? 'working' : 'idle',
  model: 'gpt-4o', runtime: 'codex-sdk',
  network_id: 'default', project_dir: null,
  created_at: fresh, updated_at: fresh, last_seen_at: fresh,
});
// Group 3: p-station × 4
for (let i = 1; i <= 4; i++) sessions.push({
  alias: `p-station-worker-${i}`, status: i === 1 ? 'working' : 'idle',
  model: 'minimax/abab6', runtime: 'http-api',
  network_id: 'default', project_dir: null,
  created_at: fresh, updated_at: fresh, last_seen_at: fresh,
});
// Orphans: 5 distinct-prefix singletons — should bundle into "其他" bottom band
['monitor-prod', 'dispatcher-bot', 'runner-helper', 'oracle-svc', 'cron-worker'].forEach((alias, idx) => {
  sessions.push({
    alias, status: idx % 2 === 0 ? 'working' : 'idle',
    model: 'claude-sonnet-4', runtime: 'claude-agent-sdk',
    network_id: 'default', project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length >= 17, { timeout: 30000 });
await page.waitForTimeout(800);
const box = await page.evaluate(() => {
  const chrome = document.querySelector('[data-topo-chrome]');
  let card = chrome?.parentElement;
  while (card && !card.querySelector(':scope > svg')) card = card?.parentElement;
  if (!card) return null;
  card.scrollIntoView({ block: 'start' });
  return new Promise(resolve => requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    resolve({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height });
  }));
});
await page.waitForTimeout(400);
if (box && box.width > 100) {
  await page.screenshot({ path: `${out}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1200) } });
}
console.log(`✅ wrote ${out}.png`);
await browser.close();

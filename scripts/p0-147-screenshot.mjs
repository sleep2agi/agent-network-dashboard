import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const out = process.argv[2] || 'screenshots/v0.11.0-147/after';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); localStorage.setItem('anet-topo-layout', 'grid'); } catch {} });
const fresh = new Date(Date.now() - 60_000).toISOString();
// Build a multi-prefix-group fleet (4 prefixes × 5 nodes = 20 nodes — triggers grid + multiple cluster boxes)
const sessions = [];
const prefixes = ['ai-insight', 'agent-network-dashboard', 'p-station', 'pay-blueleap'];
const models = ['claude-opus-4', 'gpt-4o', 'internlm/internlm2', 'minimax/abab6'];
prefixes.forEach((prefix, gIdx) => {
  for (let i = 1; i <= 5; i++) {
    sessions.push({
      alias: `${prefix}-node-${i}`,
      status: i === 1 ? 'working' : 'idle',
      model: models[gIdx],
      runtime: 'claude-code-cli',
      network_id: 'default', project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
  }
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
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length >= 20, { timeout: 30000 });
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
  await page.screenshot({ path: `${out}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 980) } });
}
console.log(`✅ wrote ${out}.png`);
await browser.close();

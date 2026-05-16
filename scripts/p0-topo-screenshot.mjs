/* P0 (Vincent 5222) baseline + after screenshot of TopoGraph with a
 * realistic 4-agent mixed-vendor fleet. Usage:
 *   node scripts/p0-topo-screenshot.mjs <out-prefix>
 * Writes <out-prefix>-full.png (1600×900) and <out-prefix>-svg.png
 * (just the SVG bbox, cropped). */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const outPrefix = process.argv[2] || 'screenshots/r293-p0/baseline';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model, status = 'working') => ({
    alias, status, model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('claude-1',  'claude-opus-4'),
    mk('claude-2',  'claude-sonnet-4', 'idle'),
    mk('codex-1',   'gpt-4o'),
    mk('intern-1',  'internlm/internlm2'),
    mk('minimax-1', 'minimax/abab6', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from: 'claude-1', to: 'codex-1',  text: 'review the diff please', ts: fresh },
  { from: 'codex-1',  to: 'claude-1', text: 'lgtm, ship', ts: fresh },
  { from: 'intern-1', to: 'claude-1', text: 'logs uploaded', ts: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length >= 4, { timeout: 30000 });
await page.waitForTimeout(800);

// Scroll the topology card into view + measure.
const topoBox = await page.evaluate(() => {
  const chromeEl = document.querySelector('[data-topo-chrome]');
  if (!chromeEl) return null;
  // Walk up to find the topology card container — has the SVG inside.
  let card = chromeEl.parentElement;
  while (card && !card.querySelector(':scope > svg')) card = card.parentElement;
  if (!card) return null;
  card.scrollIntoView({ block: 'start' });
  // Allow scroll to settle.
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      resolve({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height });
    });
  });
});
await page.waitForTimeout(400);

await page.screenshot({ path: `${outPrefix}-full.png`, fullPage: false });
if (topoBox && topoBox.width > 100 && topoBox.height > 100) {
  // Re-measure after settling.
  const box2 = await page.evaluate(() => {
    const chromeEl = document.querySelector('[data-topo-chrome]');
    let card = chromeEl?.parentElement;
    while (card && !card.querySelector(':scope > svg')) card = card?.parentElement;
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
  });
  if (box2) {
    await page.screenshot({ path: `${outPrefix}-topo.png`, clip: box2 });
  }
}
console.log(`✅ wrote ${outPrefix}-full.png + ${outPrefix}-topo.png`);
await browser.close();

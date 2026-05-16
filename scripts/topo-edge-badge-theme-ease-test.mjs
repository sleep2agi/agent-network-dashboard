/* Round 251 verification: edge midpoint badge circle picks up fill +
 * opacity in its transition list, closing the last per-edge theme-
 * toggle snap.
 *
 * Pre-R251 transition was 'r 180ms ease-out, stroke 300ms ease-out,
 * stroke-width 300ms ease-out'. Two theme-driven props snapped:
 *   · fill (pal.legendBox.fill: cyber #020617 ↔ light #ffffff)
 *   · opacity (cyber 0.82 ↔ light 0.95)
 *
 * R251 adds 'fill 200ms ease-out, opacity 200ms ease-out' so all
 * five transition properties co-ease.
 *
 * Test: render with a single flow link (count ≥ 3 → badge visible),
 * probe [data-edge-badge-lifted] (the badge circle carries this
 * attribute). Verify transition list contains all 5 properties at
 * their respective durations.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
// 5 messages alpha→beta → link.count=5 ≥ 3 → badge visible
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-badge-lifted]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-lifted]');
  if (!el) return null;
  return {
    transition: el.style.transition,
    fillAttr:   el.getAttribute('fill'),
    opacityAttr: el.getAttribute('opacity'),
  };
});
await browser.close();

const hasProp = (s, prop, durations) =>
  durations.some(d => new RegExp(`${prop}\\s+(?:${d}ms|0\\.${(d / 100).toString().replace(/^0\./, '')}s)`).test(s || ''));

// Helper: 180 → 0.18s, 200 → 0.2s, 300 → 0.3s
const has = (prop, ms) =>
  new RegExp(`${prop}\\s+(?:${ms}ms|0\\.${(ms / 1000).toString().replace(/^0\./, '')}s)`).test(probe?.transition || '');

const results = {
  badge_present:                probe !== null,
  has_r_180ms:                  has('r', 180),
  has_stroke_300ms:             has('stroke', 300),
  has_stroke_width_300ms:       has('stroke-width', 300),
  has_fill_200ms:               has('fill', 200),
  has_opacity_200ms:            has('opacity', 200),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge theme ease:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);

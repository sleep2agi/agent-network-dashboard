/* Round 172 verification: edges fade-in alongside R9 staggered
 * node reveal.
 *
 * Pre-R172 nodes used `anet-fade-in` with R9 stagger
 * (animationDelay = tier×180 + nodeIdx×25 / nodeIdx×25 capped
 * at 24) but edges appeared instantly. First-paint sequence:
 * nodes ease in over ~600ms while edges already at full
 * visibility — reveal looks inconsistent.
 *
 * R172 wraps each edge <g> in:
 *   className="anet-fade-in"
 *   style={{ animationDelay: '280ms + index*35ms (cap 20)' }}
 *   data-edge-group={link.key}
 *
 * Edges start fading in 280ms after first paint (after node
 * stagger lands), staggered by 35ms intra-edge offset.
 *
 * Test:
 *   1. Mock 4 sessions + 3 flows
 *   2. Probe each edge <g[data-edge-group]>
 *   3. Verify .anet-fade-in className present
 *   4. Verify animation-delay attribute increments by 35ms
 *      starting from 280ms (clamped at idx=20)
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
// 3 distinct flow links so we can probe stagger across multiple indices
const msgs = [
  { id: 'a', from_alias: 'alpha', to_alias: 'beta',  content: 'hi', network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: 'b', from_alias: 'beta',  to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 10000).toISOString() },
  { id: 'c', from_alias: 'gamma', to_alias: 'delta', content: 'hi', network_id: 'default', created_at: new Date(now - 15000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-group]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const edges = [...document.querySelectorAll('[data-edge-group]')];
  return edges.map(e => ({
    key:            e.getAttribute('data-edge-group'),
    hasFadeClass:   (e.getAttribute('class') || '').includes('anet-fade-in'),
    animationDelay: e.style.animationDelay || getComputedStyle(e).animationDelay,
  }));
});

await browser.close();

if (probe.length < 3) {
  console.log(`❌ wrong edge count: expected 3+, got ${probe.length}`, probe);
  process.exit(1);
}

// Parse animationDelay (e.g. "280ms" or "0.28s") → number in ms
const parseDelay = (s) => {
  if (!s) return null;
  if (s.endsWith('ms')) return parseFloat(s);
  if (s.endsWith('s')) return parseFloat(s) * 1000;
  return parseFloat(s);
};
const delays = probe.map(p => parseDelay(p.animationDelay));

const results = {
  three_plus_edges:         probe.length >= 3,
  all_have_fadeClass:       probe.every(p => p.hasFadeClass),
  all_have_delay:           delays.every(d => d !== null && d >= 280),
  first_edge_280ms:         Math.abs(delays[0] - 280) < 0.5,
  second_edge_315ms:        Math.abs(delays[1] - 315) < 0.5,
  third_edge_350ms:         Math.abs(delays[2] - 350) < 0.5,
  delays_strictly_increase: delays[0] < delays[1] && delays[1] < delays[2],
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge fade-in:`, JSON.stringify(results),
  `\n  edges =`, probe,
  `\n  delays (ms) =`, delays);
process.exit(ok ? 0 : 1);

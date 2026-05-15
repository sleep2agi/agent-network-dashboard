/* Round 174 verification: tier guide rings (ring layout) fade-in
 * alongside R9/R172/R173 first-paint wave.
 *
 * Pre-R174 the structural scaffolding for ring layout — R54
 * dashed concentric guide rings — appeared instantly while
 * nodes inside eased in via R9/R72. Closes the symmetry with
 * R173 group boxes (grid layout's structural frame).
 *
 * R174 wraps each tier ring <circle> in:
 *   className="anet-fade-in"
 *   style.animationDelay: tierIdx × 60ms (cap 8)
 *   transition list grows opacity 250ms ease-out
 *   data-tier-fade-delay={...}
 *
 * Test:
 *   1. Force ring layout
 *   2. Mock 16 sessions → triggers triple-tier render (>14)
 *   3. Probe all [data-tier-ring] circles
 *   4. Each has .anet-fade-in className + correct fade-delay
 *   5. Delays strictly increase by 60ms
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  // 16 sessions → R98 triple-tier (threshold > 14)
  const sessions = [];
  for (let i = 0; i < 16; i++) {
    sessions.push({
      alias: `n${i}`,
      status: 'working',
      model: 'claude-opus-4',
      runtime: 'cli-claude-code',
      network_id: nid,
      project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
  }
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 16, { timeout: 30000 });
await page.waitForSelector('[data-tier-ring]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const rings = [...document.querySelectorAll('[data-tier-ring]')];
  return rings.map(r => ({
    radius:         parseFloat(r.getAttribute('data-tier-ring') || ''),
    occupancy:      parseFloat(r.getAttribute('data-tier-occupancy') || ''),
    hasFadeClass:   (r.getAttribute('class') || '').includes('anet-fade-in'),
    fadeDelayAttr:  parseFloat(r.getAttribute('data-tier-fade-delay') || ''),
    animationDelay: r.style.animationDelay || getComputedStyle(r).animationDelay,
    transition:     r.style.transition || getComputedStyle(r).transition,
  }));
});

await browser.close();

const parseDelay = (s) => {
  if (!s) return null;
  if (s.endsWith('ms')) return parseFloat(s);
  if (s.endsWith('s')) return parseFloat(s) * 1000;
  return parseFloat(s);
};
const delays = probe.map(p => parseDelay(p.animationDelay));

const expectedDelays = probe.map((_, i) => Math.min(i, 8) * 60);

const results = {
  three_tiers_found:        probe.length === 3,
  all_have_fade_class:      probe.every(p => p.hasFadeClass),
  all_have_opacity_in_transition: probe.every(p =>
    (p.transition || '').includes('opacity')),
  delay_attrs_match:        probe.every((p, i) => p.fadeDelayAttr === expectedDelays[i]),
  delays_match:             delays.every((d, i) => Math.abs(d - expectedDelays[i]) < 0.5),
  delays_strictly_increase: delays[0] < delays[1] && delays[1] < delays[2],
  first_delay_0ms:          delays[0] === 0,
  third_delay_120ms:        delays[2] === 120,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier-ring fade-in:`, JSON.stringify(results),
  `\n  rings =`, probe,
  `\n  delays (ms) =`, delays,
  `\n  expected =`, expectedDelays);
process.exit(ok ? 0 : 1);

/* Round 173 verification: group boxes (grid layout) fade-in
 * alongside the R9/R172 first-paint wave.
 *
 * Pre-R173 the structural box frames appeared instantly while
 * nodes inside eased in via R9 (0-540ms) and edges via R172
 * (280-980ms). The reveal felt like 'frame slams down, nodes
 * drift in'.
 *
 * R173 wraps each group box <g> in:
 *   className="transition-opacity anet-fade-in"
 *   style={{ animationDelay: 'boxIdx × 60ms (cap 8)' }}
 *   data-group-fade-delay={boxIdx × 60}
 *
 * Test:
 *   1. Force grid layout
 *   2. Mock 4 prefix-clustered sessions → 2 groups
 *   3. Probe each [data-group] wrapper
 *   4. Assert anet-fade-in className present
 *   5. Assert animation-delay 0ms, 60ms
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
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
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
  // 2 distinct prefix groups, 2 sessions each → 2 group boxes
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1'), mk('agents-a2'),
    mk('infra-b1'),  mk('infra-b2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-group]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('g[data-group]')];
  return boxes.map(b => ({
    key:            b.getAttribute('data-group'),
    hasFadeClass:   (b.getAttribute('class') || '').includes('anet-fade-in'),
    fadeDelayAttr:  parseFloat(b.getAttribute('data-group-fade-delay') || ''),
    animationDelay: b.style.animationDelay || getComputedStyle(b).animationDelay,
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

const results = {
  two_boxes_found:        probe.length === 2,
  all_have_fade_class:    probe.every(p => p.hasFadeClass),
  box0_delay_attr_0:      probe[0]?.fadeDelayAttr === 0,
  box1_delay_attr_60:     probe[1]?.fadeDelayAttr === 60,
  box0_anim_delay_0ms:    delays[0] === 0,
  box1_anim_delay_60ms:   Math.abs(delays[1] - 60) < 0.5,
  delays_strictly_increase: delays[0] < delays[1],
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} groupbox fade-in:`, JSON.stringify(results),
  `\n  boxes =`, probe,
  `\n  delays (ms) =`, delays);
process.exit(ok ? 0 : 1);

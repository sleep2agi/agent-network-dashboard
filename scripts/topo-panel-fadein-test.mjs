/* Round 175 verification: corner panels fade-in after the
 * canvas content reveal.
 *
 * Pre-R175 the recent-signal (top-left) + legend (top-right)
 * panels appeared instantly while nodes/edges/group boxes/tier
 * rings staggered in around them. The panels felt like 'already
 * there' before the content showed up.
 *
 * R175 adds .anet-fade-in + 700ms / 800ms animation-delay on
 * the two panel <g> wrappers — fifth surface in the first-paint
 * reveal family (after R9 nodes / R172 edges / R173 group boxes
 * / R174 tier rings).
 *
 * Test:
 *   1. Mock 3 sessions in ring layout
 *   2. Probe [data-topo-panel="recent"] and [="legend"]
 *   3. Both have .anet-fade-in className
 *   4. recent panel animationDelay = 700ms
 *   5. legend panel animationDelay = 800ms
 *   6. data-topo-panel-fade-delay attributes match
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-panel="recent"]', { timeout: 10000 });
await page.waitForSelector('[data-topo-panel="legend"]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const grab = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      hasFadeClass:   (el.getAttribute('class') || '').includes('anet-fade-in'),
      fadeDelayAttr:  parseFloat(el.getAttribute('data-topo-panel-fade-delay') || ''),
      animationDelay: el.style.animationDelay || getComputedStyle(el).animationDelay,
    };
  };
  return {
    recent: grab('[data-topo-panel="recent"]'),
    legend: grab('[data-topo-panel="legend"]'),
  };
});

await browser.close();

const parseDelay = (s) => {
  if (!s) return null;
  if (s.endsWith('ms')) return parseFloat(s);
  if (s.endsWith('s')) return parseFloat(s) * 1000;
  return parseFloat(s);
};
const recentDelay = parseDelay(probe.recent?.animationDelay);
const legendDelay = parseDelay(probe.legend?.animationDelay);

const results = {
  recent_panel_found:        probe.recent !== null,
  legend_panel_found:        probe.legend !== null,
  recent_has_fade_class:     probe.recent?.hasFadeClass === true,
  legend_has_fade_class:     probe.legend?.hasFadeClass === true,
  recent_delay_attr_700:     probe.recent?.fadeDelayAttr === 700,
  legend_delay_attr_800:     probe.legend?.fadeDelayAttr === 800,
  recent_anim_delay_700ms:   recentDelay === 700,
  legend_anim_delay_800ms:   legendDelay === 800,
  legend_lags_recent_100ms:  legendDelay - recentDelay === 100,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel fade-in:`, JSON.stringify(results),
  `\n  recent =`, probe.recent, `delay=${recentDelay}`,
  `\n  legend =`, probe.legend, `delay=${legendDelay}`);
process.exit(ok ? 0 : 1);

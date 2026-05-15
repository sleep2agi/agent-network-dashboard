/* Round 191 verification: recent-signal row timestamp text
 * (right edge) picks up the freshness ramp.
 *
 * Pre-R191 the timestamp was static opacity=0.55 regardless of
 * recency. R191 mirrors R160's left-edge pip with its own
 * alpha range:
 *   ≤30s   → 0.85
 *   30-300s → 0.85 → 0.30 smooth decay
 *   >300s  → 0.30 (stale floor)
 *
 * Test:
 *   3 flows at 5s / 90s / 360s ago. Probe their timestamp text
 *   on the right of each row.
 *   - Fresh:  opacity ≈ 0.85
 *   - Mid:    opacity in (0.55, 0.80)
 *   - Stale:  opacity ≈ 0.30 (floor)
 *   - all have data-recent-row-ts-alpha attr matching
 *   - all have transition 'opacity 200ms ease-out'
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
const msgs = [
  { id: 'f', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: 'm', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 90000).toISOString() },
  { id: 's', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 360000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row-ts]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tss = [...document.querySelectorAll('[data-recent-row-ts]')];
  return tss.map(t => ({
    key:        t.getAttribute('data-recent-row-ts'),
    opacity:    parseFloat(t.getAttribute('opacity') || ''),
    alphaAttr:  parseFloat(t.getAttribute('data-recent-row-ts-alpha') || ''),
    transition: t.style.transition || getComputedStyle(t).transition,
    text:       t.textContent,
  }));
});

await browser.close();

// Rows are sorted by recency (newest first)
const [pFresh, pMid, pStale] = probe;
const hasOpacityTransition = (s) =>
  (s.transition || '').includes('opacity 200ms') ||
  /opacity\s+0\.2s|opacity\s+200ms/.test(s.transition || '');

const results = {
  three_timestamps:         probe.length === 3,
  fresh_opacity_0p85:       Math.abs(pFresh?.opacity - 0.85) < 0.05,
  mid_opacity_window:       pMid && pMid.opacity > 0.55 && pMid.opacity < 0.80,
  stale_opacity_0p30:       Math.abs(pStale?.opacity - 0.30) < 0.05,
  fresh_alpha_attr_matches: Math.abs(pFresh?.alphaAttr - pFresh?.opacity) < 0.01,
  mid_alpha_attr_matches:   Math.abs(pMid?.alphaAttr - pMid?.opacity) < 0.01,
  stale_alpha_attr_matches: Math.abs(pStale?.alphaAttr - pStale?.opacity) < 0.01,
  ladder_descends:          pFresh && pMid && pStale && pFresh.opacity > pMid.opacity && pMid.opacity > pStale.opacity,
  all_have_transition:      probe.every(p => hasOpacityTransition(p)),
  fresh_text_5s:            /^5s$/.test(pFresh?.text || ''),
  mid_text_1m_or_2m:        /^[12]m$/.test(pMid?.text || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row ts freshness:`, JSON.stringify(results),
  `\n  probes=`, probe);
process.exit(ok ? 0 : 1);

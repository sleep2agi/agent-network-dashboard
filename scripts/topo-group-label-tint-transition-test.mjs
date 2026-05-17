/* Round 459 verification: group-label tint hitbox rect transition
 * cadence sync 150ms → 200ms to match codex preview.125 parent
 * <text> transition list. The R107 hitbox rect carried legacy 150ms
 * cadence; codex's #147 P1 lifted the parent label to 200ms across
 * every axis. R459 closes the 50ms desync so tint + label flip as
 * one motion-coherent unit on hover / pin / unpin.
 *
 * Contract:
 *   - every <rect data-group-label-tint-transition="200ms">
 *     renders inside the group cluster boundary (i.e. there's at
 *     least one when fixtures have prefix-group clusters)
 *   - source-file style string is 'fill 200ms ease-out, opacity
 *     200ms ease-out' on the rect just below #147 Hero D pivot
 *     comment, NOT 'fill 150ms, opacity 150ms'
 *   - source-file the data attr `data-group-label-tint-transition`
 *     is wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tints = [...document.querySelectorAll('[data-group-label-tint-transition]')];
  return {
    count: tints.length,
    transitions: tints.map(t => ({
      value: t.getAttribute('data-group-label-tint-transition'),
      style: t.getAttribute('style') || '',
      computedTransition: getComputedStyle(t).transition,
    })),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired200 = /data-group-label-tint-transition="200ms"[\s\S]{0,300}?fill 200ms ease-out, opacity 200ms ease-out/.test(src);
// negative: there must NOT be a legacy 150ms transition WITHIN the
// same JSX element as data-group-label-tinted (the hitbox rect).
// other elements may still legitimately use 150ms (e.g. recent-row,
// legend-row at lines 8597 / 9458 — those are NOT the hitbox).
const tintRectBlockMatch = src.match(/data-group-label-tinted=[\s\S]{0,2000}?\/>/);
const tintRectBlock = tintRectBlockMatch ? tintRectBlockMatch[0] : '';
const sourceNoLegacy150 = !!tintRectBlock && !tintRectBlock.includes('fill 150ms');

await browser.close();

const tintCountGe2     = probe.count >= 2;
const allDataAttr200   = probe.transitions.every(t => t.value === '200ms');
const allStyle200      = probe.transitions.every(t => /fill 200ms ease-out, opacity 200ms ease-out/.test(t.style));

const results = {
  tint_rect_count_ge_2:   tintCountGe2,
  all_data_attr_200:      allDataAttr200,
  all_style_200ms:        allStyle200,
  source_wired_200:       sourceWired200,
  source_no_legacy_150:   sourceNoLegacy150,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label tint transition 150→200:`, JSON.stringify(results),
  '\n  count:', probe.count,
  '\n  first tint style:', probe.transitions[0]?.style);
process.exit(ok ? 0 : 1);

/* Round 215 verification: edge midpoint count badge always-mounts;
 * visibility crossfades via wrapper <g> opacity instead of mount/
 * unmount on link.count >= 3 threshold. Closes the canvas-edge
 * surface of the always-mount-opacity-gate family.
 *
 * Pre-R215 a flow's first 2 → 3 message snap-popped the badge in
 * one frame, and a hot flow tapering 3 → 2 vanished in one frame.
 * R215 always-mounts and opacity-gates, giving 300ms ease through
 * the threshold crossing.
 *
 * Test (cyber dark, mock 3 flows below + at + above threshold):
 *   1. flow A: count=2 (below threshold) → badge in DOM but
 *      visible='false', opacity 0, pointerEvents 'none',
 *      aria-hidden='true', role unset, tabIndex=-1
 *   2. flow B: count=3 (at threshold)    → badge visible='true',
 *      opacity > 0, pointerEvents 'all', role='button', tabIndex=0
 *   3. flow C: count=12 (hot)            → badge visible='true',
 *      hot='true', opacity > 0, all interactive
 *   4. Every wrapper has inline transition: 'opacity 300ms ease-out'
 *   5. text content always matches link.count (even the hidden one)
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

const now = Date.now();
const msgs = [];
// flow A: alpha → beta · count=2 (below threshold, badge hidden)
for (let i = 0; i < 2; i++) {
  msgs.push({ id: `A${i}`, from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString() });
}
// flow B: alpha → gamma · count=3 (at threshold, badge visible)
for (let i = 0; i < 3; i++) {
  msgs.push({ id: `B${i}`, from_alias: 'alpha', to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - (5000 + i * 50)).toISOString() });
}
// flow C: alpha → delta · count=12 (hot)
for (let i = 0; i < 12; i++) {
  msgs.push({ id: `C${i}`, from_alias: 'alpha', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 50)).toISOString() });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-edge-count-badge]')].map(el => {
    const cs = getComputedStyle(el);
    const txt = el.querySelector('text')?.textContent;
    return {
      key:           el.getAttribute('data-edge-count-badge'),
      visible:       el.getAttribute('data-edge-count-badge-visible'),
      hot:           el.getAttribute('data-edge-count-badge-hot'),
      role:          el.getAttribute('role'),
      tabIndex:      el.getAttribute('tabindex'),
      ariaHidden:    el.getAttribute('aria-hidden'),
      opacity:       parseFloat(el.getAttribute('opacity') || ''),
      computedPointer: cs.pointerEvents,
      transition:    el.style.transition,
      text:          txt,
    };
  });
});

await browser.close();

const flowA = probe.find(p => p.key === 'alpha->beta');   // count=2
const flowB = probe.find(p => p.key === 'alpha->gamma');  // count=3
const flowC = probe.find(p => p.key === 'alpha->delta');  // count=12

const results = {
  // All 3 wrappers present in DOM (always-mount)
  three_badges_in_dom:       probe.length === 3,
  flowA_present:             !!flowA,
  flowB_present:             !!flowB,
  flowC_present:             !!flowC,

  // flow A (count=2, hidden)
  A_visible_false:           flowA?.visible === 'false',
  A_opacity_0:               flowA?.opacity === 0,
  A_pointer_none:            flowA?.computedPointer === 'none',
  A_aria_hidden:             flowA?.ariaHidden === 'true',
  A_role_unset:              flowA?.role === null || flowA?.role === '',
  A_text_2:                  flowA?.text === '2',

  // flow B (count=3, just visible)
  B_visible_true:            flowB?.visible === 'true',
  B_opacity_positive:        (flowB?.opacity ?? 0) > 0,
  B_pointer_all:             flowB?.computedPointer === 'all',
  B_role_button:             flowB?.role === 'button',
  B_text_3:                  flowB?.text === '3',
  B_not_hot:                 flowB?.hot === 'false',

  // flow C (count=12, hot)
  C_visible_true:            flowC?.visible === 'true',
  C_hot_true:                flowC?.hot === 'true',
  C_opacity_positive:        (flowC?.opacity ?? 0) > 0,
  C_text_12:                 flowC?.text === '12',

  // All have transition with opacity 300ms (even hidden ones — they
  // need the transition for when count crosses back into threshold)
  all_have_transition:       probe.every(p => /opacity\s+(?:300ms|0\.3s)/.test(p.transition || '')),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge crossfade:`, JSON.stringify(results),
  `\n  flowA (count=2 hidden):`, flowA,
  `\n  flowB (count=3 visible):`, flowB,
  `\n  flowC (count=12 hot):`, flowC);
process.exit(ok ? 0 : 1);

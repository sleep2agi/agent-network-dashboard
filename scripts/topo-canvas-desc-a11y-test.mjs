/* Round 734 — SVG <desc> stable structural description on root canvas
 * + aria-describedby linkage. Different a11y mechanism from R730-R733:
 *   R730-R733 add <title> children as accessible NAMES on individual
 *              decorative elements (watermark, brand logo, hub, etc.)
 *   R734 adds  <desc> as a stable DESCRIPTION on the canvas root,
 *              complementing the existing dynamic aria-label (R7/R469).
 *
 * WAI-ARIA name + description pair: SR announces the accessible name
 * (label) first, then optionally reads the description on follow-up.
 *
 * Assertions:
 *   - Root <svg> has aria-describedby="anet-topo-canvas-desc"
 *   - <desc id="anet-topo-canvas-desc"> exists as a child of root <svg>
 *   - desc content mentions key structural surfaces: hub, ring/grid,
 *     recent-signal, legend, chrome strip
 *   - desc content mentions key interactions: Tab, double-click, l-key
 *   - aria-label (R7/R469 dynamic) still present and not replaced
 *   - aria-roledescription (R-original) still present
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
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-canvas-aria]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const desc = document.getElementById('anet-topo-canvas-desc');
  return {
    aria_describedby:   svg?.getAttribute('aria-describedby') ?? null,
    aria_label:         svg?.getAttribute('aria-label') ?? null,
    aria_roledescr:     svg?.getAttribute('aria-roledescription') ?? null,
    desc_present:       !!desc,
    desc_text:          desc?.textContent ?? null,
    desc_is_child_of_svg: desc?.parentElement === svg,
  };
});

await browser.close();

const text = state.desc_text ?? '';
const textLower = text.toLowerCase();
const mentionsStructural = ['hub', 'ring', 'grid', 'recent-signal', 'legend', 'chrome strip'].every(k => textLower.includes(k));
const mentionsInteractions = ['Tab', 'double-click', 'l '].every(k => text.includes(k));

const results = {
  aria_describedby_correct:     state.aria_describedby === 'anet-topo-canvas-desc',
  desc_element_present:         state.desc_present === true,
  desc_is_direct_child:         state.desc_is_child_of_svg === true,
  desc_mentions_structural:     mentionsStructural,
  desc_mentions_interactions:   mentionsInteractions,
  aria_label_preserved:         typeof state.aria_label === 'string' && state.aria_label.includes('Agent network topology'),
  aria_roledescription_kept:    state.aria_roledescr === 'agent network topology',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R734 SVG <desc> + aria-describedby on root canvas (WAI-ARIA name + description pair):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`);
process.exit(ok ? 0 : 1);

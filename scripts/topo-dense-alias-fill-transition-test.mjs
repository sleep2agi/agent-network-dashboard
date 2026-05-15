/* Round 212 verification: dense plain-text alias (used when
 * denseLayout > 16 nodes) gains fill transition on status flip,
 * extending R211's card-mode coverage to the dense fallback path
 * users see most on busy fleets.
 *
 * Pre-R212 the dense alias snap-cut its fill on tier change while
 * the status ring smoothly transitioned (R167). R212 inline
 * transition combines R26 transform 200ms (hover lift) with R212
 * fill 300ms (status flip ease).
 *
 * Test (cyber dark, 17 sessions in mixed status → denseLayout=true):
 *   1. 17+ [data-node-dense-alias-text] elements present (one per
 *      session — confirms denseLayout path fired, not card mode).
 *   2. Inline transition includes BOTH 'transform 200ms' AND
 *      'fill 300ms' (composite spliced, group-hover lift unbroken).
 *   3. group-hover:-translate-y-[1.5px] className preserved (lift
 *      still wires via CSS pseudo-class).
 *   4. Mixed-status fleet renders different fills per tier (working
 *      green ≠ idle teal ≠ offline gray family).
 *   5. paintOrder: stroke + stroke attribute preserved (R110 halo).
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
// Build 17 sessions: mostly working, a couple idle + offline so fill
// colors visibly differ.
const statuses = [
  ...Array(13).fill('working'),
  'working', 'idle', 'idle', 'offline',
];
const aliases = statuses.map((_, i) => `node-${(i + 1).toString().padStart(2, '0')}`);

await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  await route.fulfill({ response: r, json: { ...b, sessions: aliases.map((alias, i) => ({
    alias, status: statuses[i], model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  })) } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 17, { timeout: 30000 });
await page.waitForSelector('[data-node-dense-alias-text]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-node-dense-alias-text]')].map(el => ({
    alias:      el.getAttribute('data-node-dense-alias-text'),
    text:       el.textContent,
    fill:       el.getAttribute('fill'),
    className:  el.getAttribute('class') || '',
    transition: el.style.transition,
    paintOrder: el.style.paintOrder,
    stroke:     el.getAttribute('stroke'),
  }));
});

await browser.close();

const hasTransformT = (s) => /transform\s+(?:200ms|0\.2s)/.test(s || '');
const hasFillT      = (s) => /fill\s+(?:300ms|0\.3s)/.test(s || '');

const workingAlias = probe.find(p => p.alias === 'node-01');  // first working
const idleAlias    = probe.find(p => p.alias === 'node-15');  // first idle
const offlineAlias = probe.find(p => p.alias === 'node-17');  // offline

const results = {
  dense_mode_fired:           probe.length >= 17,
  // R211 [data-node-alias-text] should NOT be present (card path skipped)
  card_path_skipped:          true,  // implicit — if dense path fired, card path didn't render its texts
  all_have_transition_fill:   probe.every(p => hasFillT(p.transition)),
  all_have_transition_trans:  probe.every(p => hasTransformT(p.transition)),
  all_keep_group_hover:       probe.every(p => /group-hover:-translate-y/.test(p.className)),
  all_have_paint_order:       probe.every(p => p.paintOrder === 'stroke'),
  all_have_halo_stroke:       probe.every(p => !!p.stroke && p.stroke !== 'none'),
  working_idle_fill_differs:  workingAlias?.fill && idleAlias?.fill
                              && workingAlias.fill !== idleAlias.fill,
  working_offline_fill_differs: workingAlias?.fill && offlineAlias?.fill
                              && workingAlias.fill !== offlineAlias.fill,
  alias_text_rendered:        workingAlias?.text === 'node-01',
};

// Verify card path skipped — no R211 card-mode texts at >16 nodes
const cardAliasCount = await chromium.launch({ headless: true }).then(async (b2) => {
  const ctx2 = await b2.newContext();
  await ctx2.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx2.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx2.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const bj = await r.json();
    const nid = (bj.sessions || [])[0]?.network_id || 'default';
    await route.fulfill({ response: r, json: { ...bj, sessions: aliases.map((alias, i) => ({
      alias, status: statuses[i], model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    })) } });
  });
  await ctx2.route('**/api/hub/messages*', (rr) => rr.fulfill({ json: { messages: [] } }));
  await ctx2.route('**/api/hub/tasks*', (rr) => rr.fulfill({ json: { tasks: [] } }));
  const p2 = await ctx2.newPage();
  await p2.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 17, { timeout: 30000 });
  await p2.waitForTimeout(300);
  const c = await p2.evaluate(() =>
    document.querySelectorAll('[data-node-alias-text]').length);
  await b2.close();
  return c;
});
results.card_path_skipped = cardAliasCount === 0;

const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} dense alias fill transition:`, JSON.stringify(results),
  `\n  sample (first 3):`, probe.slice(0, 3),
  `\n  cardAliasCount:`, cardAliasCount);
process.exit(ok ? 0 : 1);

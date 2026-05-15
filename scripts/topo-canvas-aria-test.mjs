/* Round 158 verification: main canvas SVG gains aria-label +
 * aria-roledescription.
 *
 * R151-R157 closed a11y across every interactive surface INSIDE
 * the canvas (nodes / group labels / edge badges / recent rows /
 * legend rows / chrome buttons / minimap). The canvas <svg> root
 * itself was a nameless 1000×680 box — a screen-reader user who
 * landed on it before tab-diving into children heard nothing
 * identifying the surface.
 *
 * R158 closes that gap:
 *   aria-roledescription="agent network topology"
 *   aria-label live-updates with snapshot:
 *     "Agent network topology — 5 agents online · 3 working ·
 *      1 offline · 2 active links. Tab to navigate nodes,
 *      double-click canvas to reset view."
 *
 * No role override — default SVG role (graphics-document) keeps
 * children navigable; role="img" would flatten the SVG to a
 * single opaque image and hide all the R151-R157 work.
 *
 * Test:
 *   1. Mock 3 working + 2 idle online + 1 offline + 2 active links
 *   2. Assert canvas SVG has both ARIA attrs
 *   3. Assert aria-label contains all four count fragments + gesture hints
 *   4. Assert no role="img" (would defeat children a11y)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, last) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: last, updated_at: last, last_seen_at: last,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1', 'working', fresh),
    mk('agents-a2', 'working', fresh),
    mk('agents-a3', 'working', fresh),
    mk('infra-b1',  'idle',    fresh),
    mk('infra-b2',  'idle',    fresh),
    mk('legacy-c1', 'offline', stale),
  ] } });
});

const now = Date.now();
// 4 a1↔a2 msgs (R100 threshold for edge badge) + 1 a2↔a3 = 2 flowLinks
const msgs = [];
for (let i = 0; i < 4; i++) {
  msgs.push({ id: `m${i}`, from_alias: 'agents-a1', to_alias: 'agents-a2', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 500)).toISOString() });
}
msgs.push({ id: 'mx', from_alias: 'agents-a2', to_alias: 'agents-a3', content: 'hi',
  network_id: 'default', created_at: new Date(now - 14000).toISOString() });
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// 5 online + 1 offline = 6 g[data-node]
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-canvas-aria]');
  if (!el) return null;
  return {
    tagName:            el.tagName.toLowerCase(),
    role:               el.getAttribute('role'),
    roledesc:           el.getAttribute('aria-roledescription'),
    label:              el.getAttribute('aria-label'),
  };
});

await browser.close();

const label = probe?.label || '';
const results = {
  canvas_found:               probe !== null,
  is_svg:                     probe?.tagName === 'svg',
  no_role_img:                probe?.role !== 'img',
  has_roledescription:        probe?.roledesc === 'agent network topology',
  label_mentions_online:      /5 agents online/.test(label),
  label_mentions_working:     /3 working/.test(label),
  label_mentions_offline:     /1 offline/.test(label),
  label_mentions_links:       /2 active links/.test(label),
  label_mentions_tab:         /Tab to navigate/.test(label),
  label_mentions_doubleclick: /double-click/.test(label),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} canvas SVG aria:`, JSON.stringify(results),
  `\n  probe=`, probe);
process.exit(ok ? 0 : 1);

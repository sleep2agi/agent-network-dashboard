/* Round 104 verification: recent-signal panel rows get a subtle
 * row-background tint on hover. R56 already brightens the matching
 * edge on the canvas, but the panel row itself stayed flat — the
 * row now has visible feedback at the source surface.
 *
 * Driver: 3 flow rows. Initial state — all hitbox rects are
 * transparent. Hover row 0 — its rect fills with the accent colour
 * at low alpha + data-recent-row-hovered="true"; the other two rows
 * stay transparent + "false". Mouseleave — back to all-false.
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
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta',  20 * 1000),
  mkMsg('m2', 'gamma', 'delta', 30 * 1000),
  mkMsg('m3', 'alpha', 'gamma', 40 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });
await page.waitForTimeout(400);

const readRows = () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-recent-row]')].map(g => {
    const rect = g.querySelector('rect');
    return {
      key:       g.getAttribute('data-recent-row'),
      hovered:   g.getAttribute('data-recent-row-hovered'),
      rectFill:  rect?.getAttribute('fill') || '',
      rectOpac:  rect?.getAttribute('opacity') || '',
    };
  });
});

const before = await readRows();

// Hover the first row.
await page.locator('[data-recent-row]').first().hover();
await page.waitForTimeout(250);
const duringHover = await readRows();

// Move pointer away.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeave = await readRows();

await browser.close();

const results = {
  before_allTransparent:      before.every(r => r.rectFill === 'transparent' && r.hovered === 'false'),
  hover_firstRowTinted:       duringHover[0]?.hovered === 'true' && duringHover[0]?.rectFill !== 'transparent',
  hover_otherRowsUnchanged:   duringHover.slice(1).every(r => r.hovered === 'false' && r.rectFill === 'transparent'),
  hover_opacityVisibleButLow: duringHover[0] && parseFloat(duringHover[0].rectOpac) > 0 && parseFloat(duringHover[0].rectOpac) < 0.3,
  leave_restored:             afterLeave.every(r => r.rectFill === 'transparent' && r.hovered === 'false'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row tint:`, JSON.stringify(results),
  `\n  before=`,     before,
  `\n  duringHover=`, duringHover,
  `\n  afterLeave=`,  afterLeave);
process.exit(ok ? 0 : 1);

/* Round 115 verification: hub center hover-state visual feedback.
 * R52 made the hub clickable (fit view) + cursor:pointer, but
 * hovering showed nothing. Now a thin r=14 stroke ring fades in on
 * hover and out on leave. Sits inside the existing r=18 halo so
 * overlap footprint unchanged.
 *
 * Probes:
 *   - baseline: ring opacity 0, data-topo-hub-hovered="false"
 *   - hover hub: ring opacity > 0, hovered="true"
 *   - mouseleave: opacity 0, hovered="false"
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-hub]', { timeout: 10000 });
await page.waitForTimeout(400);

const read = () => page.evaluate(() => {
  const hub  = document.querySelector('[data-topo-hub]');
  const ring = document.querySelector('[data-topo-hub-hover-ring]');
  return {
    hovered:    hub?.getAttribute('data-topo-hub-hovered') || '',
    ringOpacity: +(ring?.getAttribute('opacity') || '0'),
  };
});

const before = await read();

await page.locator('[data-topo-hub]').hover();
await page.waitForTimeout(300);
const onHover = await read();

// Move pointer far away.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterLeave = await read();

await browser.close();

const results = {
  before_notHovered:    before.hovered === 'false',
  before_ringHidden:    before.ringOpacity === 0,
  hover_attrTrue:       onHover.hovered === 'true',
  hover_ringVisible:    onHover.ringOpacity > 0.5,
  leave_attrFalse:      afterLeave.hovered === 'false',
  leave_ringHidden:     afterLeave.ringOpacity === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-hover ring:`, JSON.stringify(results),
  `\n  before=`,    before,
  `\n  onHover=`,   onHover,
  `\n  afterLeave=`, afterLeave);
process.exit(ok ? 0 : 1);

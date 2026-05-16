/* Round 242 verification: chat-target ring (R183) transition list
 * grows to include stroke + filter alongside the existing opacity
 * gate, so a chat-target node's status flips (green→teal etc.) and
 * the glow toggle (cyber theme) both ease over 200ms instead of
 * snapping.
 *
 * The ring is always-mounted (R183 idiom) with opacity gated by
 * isChat. Without setting a chat target, opacity stays at 0 — but
 * the transition wiring is in style.transition regardless, so we
 * can probe it without needing to demonstrate the easing live.
 *
 * Test scope per ring:
 *   - data-chat-target-ring attr present (probe entry)
 *   - data-chat-target-active='false' (no chat at default state)
 *   - style.transition includes opacity / stroke / filter
 *     each at 200ms (or 0.2s browser-normalised)
 *   - stroke attribute present (color from status.primary)
 *   - opacity attribute = 0 (gated by isChat=false)
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-chat-target-ring]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const rings = Array.from(document.querySelectorAll('[data-chat-target-ring]'));
  return rings.map((r) => ({
    active:     r.getAttribute('data-chat-target-active'),
    stroke:     r.getAttribute('stroke'),
    opacity:    r.getAttribute('opacity'),
    transition: r.style.transition,
  }));
});
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  four_rings:                    probe.length === 4,
  all_inactive:                  probe.every(r => r.active === 'false'),
  all_have_stroke:               probe.every(r => typeof r.stroke === 'string' && r.stroke.length > 0),
  all_opacity_zero:              probe.every(r => r.opacity === '0'),
  all_transition_has_opacity:    probe.every(r => hasProp(r.transition, 'opacity')),
  all_transition_has_stroke:     probe.every(r => hasProp(r.transition, 'stroke')),
  all_transition_has_filter:     probe.every(r => hasProp(r.transition, 'filter')),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chat-target ring ease:`, JSON.stringify(results),
  '\n  rings:', probe.map(r => ({ a: r.active, stroke: r.stroke, t: r.transition.slice(0, 80) })));
process.exit(ok ? 0 : 1);

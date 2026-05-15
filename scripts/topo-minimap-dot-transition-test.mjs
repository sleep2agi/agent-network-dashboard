/* Round 198 verification: minimap node dots get smooth opacity /
 * fill / r transitions so a session flipping working→idle or going
 * offline doesn't snap on the minimap mirror.
 *
 * Pre-R198 the canvas itself eased status changes (R167 stroke-width
 * transition, R10 freshness alpha ramp, R3 fade-in chain), but the
 * minimap below kept snap-cut. R198 brings the minimap dots in
 * rhythm with the main canvas at 200ms.
 *
 * The minimap only mounts when isDefaultView=false (zoomed or panned),
 * so the test must trigger a zoom-in first to populate it.
 *
 * Test:
 *   Mock 3 working + 1 offline session. Default view → no minimap.
 *   Click zoom-in → minimap mounts.
 *   Probe each minimap dot:
 *     1. 4 dots present with data-topo-minimap-dot=<alias>
 *     2. Online dots: r=1.7, opacity=0.9, data-...-online='true'
 *     3. Offline dot: r=1.2, opacity=0.5, data-...-online='false'
 *     4. Every dot's style.transition includes 'opacity 200ms',
 *        'fill 200ms', and 'r 200ms'
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha',   'working'),
    mk('beta',    'working'),
    mk('gamma',   'working'),
    mk('delta',   'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 10000 });
await page.waitForTimeout(300);

// Default view → minimap not mounted
const minimapBeforeZoom = await page.evaluate(() =>
  document.querySelector('[data-topo-minimap]') !== null);

// Trigger zoom-in to mount the minimap
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(450);  // past 280ms smoothView crossfade + margin
await page.waitForSelector('[data-topo-minimap-dot]', { timeout: 5000 });
await page.waitForTimeout(200);

const minimapAfterZoom = await page.evaluate(() =>
  document.querySelector('[data-topo-minimap]') !== null);

const dots = await page.evaluate(() =>
  [...document.querySelectorAll('[data-topo-minimap-dot]')].map(el => ({
    alias:      el.getAttribute('data-topo-minimap-dot'),
    online:     el.getAttribute('data-topo-minimap-dot-online'),
    r:          parseFloat(el.getAttribute('r') || ''),
    opacity:    parseFloat(el.getAttribute('opacity') || ''),
    fill:       el.getAttribute('fill'),
    transition: el.style.transition,
  })));

await browser.close();

const onlineDots  = dots.filter(d => d.online === 'true');
const offlineDots = dots.filter(d => d.online === 'false');

const trans = (s) => s || '';
const hasOpacityT = (d) => /opacity\s+(0\.2s|200ms)/.test(trans(d.transition));
const hasFillT    = (d) => /fill\s+(0\.2s|200ms)/.test(trans(d.transition));
const hasRT       = (d) => /\br\s+(0\.2s|200ms)/.test(trans(d.transition));

const results = {
  minimap_hidden_at_default:  minimapBeforeZoom === false,
  minimap_shown_after_zoom:   minimapAfterZoom === true,
  four_dots_present:          dots.length === 4,
  three_online:               onlineDots.length === 3,
  one_offline:                offlineDots.length === 1,
  online_r_1p7:               onlineDots.every(d => Math.abs(d.r - 1.7) < 0.01),
  online_opacity_0p9:         onlineDots.every(d => Math.abs(d.opacity - 0.9) < 0.01),
  offline_r_1p2:              offlineDots.every(d => Math.abs(d.r - 1.2) < 0.01),
  offline_opacity_0p5:        offlineDots.every(d => Math.abs(d.opacity - 0.5) < 0.01),
  all_have_opacity_transition: dots.every(hasOpacityT),
  all_have_fill_transition:    dots.every(hasFillT),
  all_have_r_transition:       dots.every(hasRT),
  online_fill_truthy:          onlineDots.every(d => d.fill && d.fill !== 'none'),
  offline_fill_truthy:         offlineDots.every(d => d.fill && d.fill !== 'none'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap dot transition:`, JSON.stringify(results),
  `\n  dots:`, dots);
process.exit(ok ? 0 : 1);

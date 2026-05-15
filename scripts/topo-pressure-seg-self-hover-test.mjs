/* Round 210 verification: pressure-bar segments deepen their OWN
 * colour on hover via filter: brightness(1.2). Closes the chip-row
 * "hover deepens own identity" family at a 6th surface (the
 * pressure-bar scope previously had R83 wire setHoveredStatus but
 * the segment itself stayed flat).
 *
 * Pre-R210 hovering a segment fired R55 canvas dim via
 * setHoveredStatus, but the segment's own background stayed at the
 * unmodified tier color. R210 makes the cause element (segment)
 * light up the same gesture it fires on the canvas (effect element).
 *
 * Test (cyber dark, 2 working + 1 idle + 1 offline → 3 segments):
 *   1. 3 [data-pressure-seg] segments rendered.
 *   2. Idle: every segment has hovered='false', filter='none' (or
 *      no filter style set).
 *   3. Inline transition includes 'filter 150ms' alongside the
 *      existing R165 width 220ms + R60 box-shadow 150ms.
 *   4. Hover working segment → working hovered='true', filter
 *      'brightness(1.2)'.
 *   5. Other (idle/offline) segments stay hovered='false', no filter.
 *   6. Move away → working back to hovered='false', no filter.
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
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
    mk('delta', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-pressure-seg="working"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-pressure-seg]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      key:        el.getAttribute('data-pressure-seg'),
      hovered:    el.getAttribute('data-pressure-seg-hovered'),
      filter:     cs.filter,
      inlineFilter: el.style.filter,
      transition: el.style.transition,
    };
  });
});

const idle = await probe();

await page.hover('[data-pressure-seg="working"]');
await page.waitForTimeout(180);
const hovered = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(180);
const settled = await probe();

await browser.close();

const idleWorking    = idle.find(s => s.key === 'working');
const idleIdle       = idle.find(s => s.key === 'idle');
const idleOffline    = idle.find(s => s.key === 'offline');
const hovWorking     = hovered.find(s => s.key === 'working');
const hovIdle        = hovered.find(s => s.key === 'idle');
const settledWorking = settled.find(s => s.key === 'working');

const isNoFilter = (s) => !s || s === 'none' || s === '';
const hasBrightness = (s) => /brightness\s*\(\s*1\.2/.test(s || '');

const results = {
  three_segments_present:   idle.length === 3,
  working_found:            !!idleWorking,
  idle_found:               !!idleIdle,
  offline_found:            !!idleOffline,

  // Idle: no filter, hovered='false', transitions present
  idle_all_not_hovered:     idle.every(s => s.hovered === 'false'),
  idle_all_no_filter:       idle.every(s => isNoFilter(s.inlineFilter)),
  transitions_have_filter:  idle.every(s => /filter\s+(?:150ms|0\.15s)/.test(s.transition || '')),
  transitions_keep_width:   idle.every(s => /width\s+(?:220ms|0\.22s)/.test(s.transition || '')),
  transitions_keep_bs:      idle.every(s => /box-shadow\s+(?:150ms|0\.15s)/.test(s.transition || '')),

  // Hover working: brightness applied
  hov_working_hovered_true: hovWorking?.hovered === 'true',
  hov_working_has_filter:   hasBrightness(hovWorking?.inlineFilter)
                            || hasBrightness(hovWorking?.filter),
  // Other segments stay idle
  hov_idle_stays_false:     hovIdle?.hovered === 'false',
  hov_idle_no_filter:       isNoFilter(hovIdle?.inlineFilter),

  // Settled: back to idle
  settled_hovered_false:    settledWorking?.hovered === 'false',
  settled_no_filter:        isNoFilter(settledWorking?.inlineFilter),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-seg self-hover:`, JSON.stringify(results),
  `\n  idle:`,    idle,
  `\n  hovered:`, hovered,
  `\n  settled:`, settled);
process.exit(ok ? 0 : 1);

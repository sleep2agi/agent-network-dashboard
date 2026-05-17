/* Round 470 verification: group <g> wrapper opacity transition
 * cadence sync 150ms → 200ms. The R8 out-of-focus dim was the
 * last cluster surface still at Tailwind's `transition-opacity`
 * default cadence (150ms); R470 lifts it to 200ms ease-out to
 * match the rest of the Hero D #147 200ms motion vocabulary.
 *
 * Contract:
 *   - every <g data-group> carries className containing
 *     'transition-opacity duration-200 ease-out'
 *   - data-group-fade-transition='200ms' attr exposed
 *   - computed transition-duration is '0.2s' (200ms)
 *   - source-file utility classes wired
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
await page.waitForSelector('[data-group][data-group-fade-transition]', { timeout: 15000 });
await page.waitForTimeout(400);

const groups = await page.evaluate(() => {
  const gs = [...document.querySelectorAll('[data-group]')];
  return gs.map(g => {
    const cs = getComputedStyle(g);
    return {
      key:       g.getAttribute('data-group'),
      className: g.getAttribute('class') || '',
      fadeAttr:  g.getAttribute('data-group-fade-transition'),
      duration:  cs.transitionDuration,
      timing:    cs.transitionTimingFunction,
      property:  cs.transitionProperty,
    };
  });
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceCN  = /className="transition-opacity duration-200 ease-out anet-fade-in"/.test(src);
const sourceAttr = /data-group-fade-transition="200ms"/.test(src);

await browser.close();

const allCN200    = groups.every(g => /transition-opacity duration-200 ease-out/.test(g.className));
const allAttr200  = groups.every(g => g.fadeAttr === '200ms');
const allDur200   = groups.every(g => g.duration === '0.2s' || /(^|, )0\.2s/.test(g.duration));
const allEaseOut  = groups.every(g => /ease(-out)?|cubic-bezier\(0,\s*0,\s*0\.2,\s*1\)/.test(g.timing) || g.timing.includes('cubic-bezier'));

const results = {
  groups_count_ge_2:   groups.length >= 2,
  all_classname_200:   allCN200,
  all_attr_200:        allAttr200,
  all_computed_200ms:  allDur200,
  all_easing_ease_out: allEaseOut,
  source_classname:    sourceCN,
  source_attr:         sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group <g> fade cadence 150→200:`, JSON.stringify(results),
  '\n  sample:', JSON.stringify(groups[0]));
process.exit(ok ? 0 : 1);

/* Round 76 verification: source-side dispatch pulse renders for high-
 * traffic edges only (link.count >= 3), bookending the R75 destination
 * ping. Quiet edges (count < 3) skip the source pulse to keep the
 * canvas calm. Reduced-motion users see neither pulse nor ping.
 *
 *  - Busy alpha→beta (5 messages, fresh) → dispatch pulse present at
 *    source AND arrival ping at destination.
 *  - Quiet gamma→delta (1 message, fresh) → arrival ping only, no
 *    dispatch pulse.
 *  - Reduced-motion: no dispatch pulses, no arrival pings.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(reducedMotion) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1500 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
      sessionStorage.removeItem('anet-topo-pinned-status');
      sessionStorage.removeItem('anet-topo-pinned-group');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = ['alpha', 'beta', 'gamma', 'delta'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  // 5 busy messages alpha→beta + 1 quiet gamma→delta.
  const now = new Date().toISOString();
  const msgs = [
    ...Array.from({ length: 5 }).map(() => ({ from_alias: 'alpha', to_alias: 'beta', content: 'm', created_at: now })),
    { from_alias: 'gamma', to_alias: 'delta', content: 'm', created_at: now },
  ];
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForTimeout(600);
  const elements = await page.evaluate(() => {
    return {
      dispatchPulses: [...document.querySelectorAll('[data-dispatch-pulse]')].map(el => el.getAttribute('data-dispatch-pulse')),
      arrivalPings:   [...document.querySelectorAll('[data-arrival-ping]')].map(el => el.getAttribute('data-arrival-ping')),
    };
  });
  await ctx.close();
  return elements;
}

const normal  = await probe(false);
const reduced = await probe(true);
await browser.close();

const has = (arr, key) => arr.includes(key);
const results = {
  normal_busyHasDispatch:   has(normal.dispatchPulses, 'alpha->beta'),
  normal_quietHasNoDispatch: !has(normal.dispatchPulses, 'gamma->delta'),
  normal_busyHasArrival:    has(normal.arrivalPings, 'alpha->beta'),
  normal_quietHasArrival:   has(normal.arrivalPings, 'gamma->delta'),
  reduced_noDispatchPulses: reduced.dispatchPulses.length === 0,
  reduced_noArrivalPings:   reduced.arrivalPings.length === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} dispatch pulse:`, JSON.stringify(results),
  `\n  normal=`,  normal,
  `\n  reduced=`, reduced);
process.exit(ok ? 0 : 1);

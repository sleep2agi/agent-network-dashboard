/* Round 75 verification: each fresh flow edge gets an "arrival ping"
 * circle at the destination, synchronised to the particle period via
 * `begin = -0.92 * dur`. Stale edges (fresh ≤ 0.5) skip the ping;
 * reduced-motion users see none at all.
 *
 *  - Fresh edge alpha→beta (created now) + stale edge gamma→delta (5 min
 *    old) → ping[alpha->beta] present, ping[gamma->delta] absent.
 *  - Reduced-motion context: no ping anywhere.
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
  // alpha→beta fresh (0s ago); gamma→delta stale (6 min ago) so fresh
  // value drops below 0.5 (the 5-min half-life is roughly 0.4 at 6min).
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
    { from_alias: 'alpha', to_alias: 'beta',  content: 'm', created_at: now },
    { from_alias: 'gamma', to_alias: 'delta', content: 'm', created_at: old },
  ] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForTimeout(600);
  const pings = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-arrival-ping]')) {
      out.push({
        key: el.getAttribute('data-arrival-ping'),
        cx: el.getAttribute('cx'),
        cy: el.getAttribute('cy'),
        stroke: el.getAttribute('stroke'),
        animateCount: el.querySelectorAll('animate').length,
      });
    }
    return out;
  });
  await ctx.close();
  return pings;
}

const normal  = await probe(false);
const reduced = await probe(true);
await browser.close();

const has = (rows, key) => rows.some(p => p.key === key);
const results = {
  normal_freshPingPresent:    has(normal, 'alpha->beta'),
  normal_stalePingAbsent:     !has(normal, 'gamma->delta'),
  normal_twoAnimateChildren:  normal.find(p => p.key === 'alpha->beta')?.animateCount === 2,
  reduced_noPings:            reduced.length === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} arrival ping:`, JSON.stringify(results),
  `\n  normal=`,  normal,
  `\n  reduced=`, reduced);
process.exit(ok ? 0 : 1);

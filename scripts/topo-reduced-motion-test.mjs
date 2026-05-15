/* Round 36 verification: prefers-reduced-motion disables all SMIL
 * animations in the topology. Round 29 zeroed CSS via media query;
 * SVG <animate> / <animateMotion> elements need JS to opt out and
 * this round wires that via the useReducedMotion hook. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe({ reduce, layout }) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((lay) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', lay);
      localStorage.setItem('anet-topo-view', JSON.stringify({ zoom: 1, x: 0, y: 0 }));
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, layout);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    // Include a 'working' status so the working pulse path renders.
    const sessions = [
      { alias: 'wkr', status: 'working', network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'idl', status: 'idle', network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    ];
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  // Inject a tiny message so a flow link + particle render.
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
    { from_alias: 'wkr', to_alias: 'idl', content: 'hi', created_at: fresh },
  ] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
  await page.waitForTimeout(600);
  // Click a node so the click ripple is invoked (it should NOT render under reduced motion).
  await page.locator('g[data-node="wkr"]').click().catch(() => {});
  await page.waitForTimeout(120);
  const counts = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return {
      animate: svg.querySelectorAll('animate').length,
      animateMotion: svg.querySelectorAll('animateMotion').length,
    };
  });
  await ctx.close();
  return counts;
}

// Baseline (no reduce) — many SMIL elements expected.
const normalRing = await probe({ reduce: false, layout: 'ring' });
// Reduced motion — every SMIL element should be gone.
const reducedRing = await probe({ reduce: true, layout: 'ring' });
const reducedGrid = await probe({ reduce: true, layout: 'grid' });

await browser.close();
const results = {
  baselineHasAnimations: normalRing.animate + normalRing.animateMotion > 0,
  reducedRingDropsAll: reducedRing.animate === 0 && reducedRing.animateMotion === 0,
  reducedGridDropsAll: reducedGrid.animate === 0 && reducedGrid.animateMotion === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} reduced motion:`, JSON.stringify(results),
  `\n  normalRing=`, normalRing, `\n  reducedRing=`, reducedRing, `\n  reducedGrid=`, reducedGrid);
process.exit(ok ? 0 : 1);

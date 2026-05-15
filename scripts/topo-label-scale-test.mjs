/* Round 15 verification: at nodeScale=S the label card + fonts step down
 * one tier (rect 100×42 → 88×36, alias 12 → 11, sub 9 → 8); M and L keep
 * the existing sizes. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function measure(scaleVal) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((s) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', 'grid');
      localStorage.setItem('anet-topo-nodescale', s);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, scaleVal);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    // 4 nodes only → sparse, so the full-card label path renders.
    const sessions = ['lab1', 'lab2', 'lab3', 'lab4'].map(a => ({
      alias: a, status: 'idle', network_id: nid, project_dir: null,
      created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z',
      last_seen_at: new Date().toISOString(),
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length === 4;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  const m = await page.$eval('g[data-node="lab1"]', g => {
    // label card = the <g transform="translate(...)" > inside the node <g>
    // that contains the rect+two texts; pick the rect we just changed.
    const labelG = [...g.querySelectorAll('g')].find(x => x.querySelector('rect') && x.querySelectorAll('text').length === 2);
    if (!labelG) return null;
    const rect = labelG.querySelector('rect');
    const texts = labelG.querySelectorAll('text');
    return {
      w: +rect.getAttribute('width'),
      h: +rect.getAttribute('height'),
      aliasFs: +texts[0].getAttribute('font-size'),
      subFs: +texts[1].getAttribute('font-size'),
    };
  });
  await ctx.close();
  return m;
}

const S = await measure('0.7');
const M = await measure('0.84');
const L = await measure('1');
await browser.close();

const results = {
  smallCardW: S?.w === 88,
  smallCardH: S?.h === 36,
  smallAliasFs: S?.aliasFs === 11,
  smallSubFs: S?.subFs === 8,
  mediumKeepsW: M?.w === 100,
  mediumKeepsAliasFs: M?.aliasFs === 12,
  largeKeepsW: L?.w === 100,
  largeKeepsAliasFs: L?.aliasFs === 12,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} label scale:`, JSON.stringify(results), 'S=', S, 'M=', M, 'L=', L);
process.exit(ok ? 0 : 1);

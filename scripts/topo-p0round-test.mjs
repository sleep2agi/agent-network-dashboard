/* Combined verification for the #112 + #113 + #111-workdir round:
 *  #111-workdir — nodes sharing a project_dir group together (diff prefix)
 *  #112         — grid nodes are never occluded by the overlay panels
 *  #113         — S/M/L node-size control resizes nodes + persists */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-112', { recursive: true });
const browser = await chromium.launch({ headless: true });

async function load(theme, layout, fleet, pinScale) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(({ th, lay, pin }) => {
    try {
      localStorage.setItem('anet-theme', th);
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', lay);
      if (pin) localStorage.setItem('anet-topo-nodescale', pin);
      else localStorage.removeItem('anet-topo-nodescale');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, { th: theme, lay: layout, pin: pinScale });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = fleet.map(f => ({
      alias: f.alias, status: 'idle', network_id: nid, project_dir: f.project_dir ?? null,
      created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z', last_seen_at: '2026-05-15T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page };
}

const results = {};

// --- #111-workdir: same project_dir, different prefixes → one group ---
{
  const fleet = [
    { alias: 'aaa', project_dir: '/home/v/ai-insight' },
    { alias: 'mmm', project_dir: '/home/v/ai-insight' },
    { alias: 'zzz', project_dir: '/home/v/ai-insight' },
    { alias: 'solo', project_dir: '/home/v/other-proj' }, // singleton dir
  ];
  const { ctx, page } = await load('cyber', 'grid', fleet);
  const groups = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-group]', els => els.map(e => e.getAttribute('data-group')));
  // aaa/mmm/zzz share ai-insight → one group labelled 'ai-insight'; solo alone → no box
  results.workdirGroups = groups.length === 1 && groups[0] === 'ai-insight';
  await ctx.close();
}

// --- #112: grid nodes never occluded by the overlay panels ---
{
  const fleet = Array.from({ length: 22 }, (_, i) => ({ alias: `A站${i + 1}号` }));
  const { ctx, page } = await load('cyber', 'grid', fleet, '1');
  results.panelOcclusion = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    // overlay panels: <g transform="translate(28, 34)"> and translate(720, 34)
    const panels = [...svg.querySelectorAll(':scope > g[transform^="translate(16, 16)"], :scope > g[transform^="translate(760, 16)"]')]
      .map(g => {
        const m = g.getAttribute('transform').match(/translate\(([\d.]+),\s*([\d.]+)\)/);
        const rect = g.querySelector('rect');
        const tx = +m[1], ty = +m[2];
        return { x: tx, y: ty, w: +rect.getAttribute('width'), h: +rect.getAttribute('height') };
      });
    if (panels.length !== 2) return false;
    // node centres (any circle in the node <g> shares the node centre)
    let clear = true;
    for (const g of svg.querySelectorAll('g[data-node]')) {
      const c = g.querySelector('circle');
      if (!c) continue;
      const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
      for (const p of panels) {
        // occluded if the centre is inside the panel rect expanded by ~28px
        if (cx > p.x - 28 && cx < p.x + p.w + 28 && cy > p.y - 28 && cy < p.y + p.h + 28) clear = false;
      }
    }
    return clear;
  });
  // panels exist and are OUTSIDE the zoom/pan transform group (direct svg children)
  results.panelsOutsideTransform = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    const panels = [...svg.querySelectorAll(':scope > g[transform^="translate(16, 16)"], :scope > g[transform^="translate(760, 16)"]')];
    return panels.length === 2; // :scope > = direct children, not inside the view <g>
  });
  await page.screenshot({ path: '/tmp/anet-issue-112/grid-occlusion.png' });
  await ctx.close();
}

// --- #113: S/M/L node-size control resizes + persists ---
{
  const fleet = Array.from({ length: 8 }, (_, i) => ({ alias: `node${i + 1}` }));
  const { ctx, page } = await load('cyber', 'grid', fleet); // no pin → default M
  const onlineR = () => page.$$eval('svg[viewBox="0 0 1000 680"] g[data-node] circle[stroke-width="3"]',
    els => els.length ? +els[0].getAttribute('r') : null);
  const rM = await onlineR();                       // default M = round(26*0.84)=22
  await page.locator('button[title="Node size: small"]').click();
  await page.waitForTimeout(300);
  const rS = await onlineR();                       // S = round(26*0.7)=18
  await page.locator('button[title="Node size: large"]').click();
  await page.waitForTimeout(300);
  const rL = await onlineR();                       // L = 26
  results.sizeMDefault = rM === 22;
  results.sizeShrinks = rS === 18 && rS < rM;
  results.sizeGrows = rL === 26 && rL > rM;
  results.sizePersists = (await page.evaluate(() => localStorage.getItem('anet-topo-nodescale'))) === '1';
  await ctx.close();
}

// --- #112 umbrella: ghost age-out — offline >24h is dropped from the topo ---
{
  const dayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-nodescale', '1');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    await route.fulfill({ response: r, json: { ...b, sessions: [
      { alias: 'alive-1', status: 'idle', network_id: nid, last_seen_at: fresh, created_at: fresh, updated_at: fresh },
      { alias: 'recently-offline', status: 'offline', network_id: nid, last_seen_at: fresh, created_at: fresh, updated_at: fresh },
      { alias: 'ghost-deleted', status: 'offline', network_id: nid, last_seen_at: dayAgo, created_at: dayAgo, updated_at: dayAgo },
    ] } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const nodes = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-node]', els => els.map(e => e.getAttribute('data-node')));
  results.ghostAgedOut = nodes.includes('alive-1') && nodes.includes('recently-offline') && !nodes.includes('ghost-deleted');
  await ctx.close();
}

await browser.close();
const ok = results.workdirGroups && results.panelOcclusion && results.panelsOutsideTransform &&
  results.sizeMDefault && results.sizeShrinks && results.sizeGrows && results.sizePersists &&
  results.ghostAgedOut;
console.log(`${ok ? '✅' : '❌'} #112+#113+#111-workdir:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);

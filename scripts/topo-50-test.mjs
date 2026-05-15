import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); localStorage.removeItem('anet-brand'); localStorage.removeItem('anet-topo-view'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch(); const b = await r.json();
  const nid = (b.sessions||[])[0]?.network_id || 'default';
  const fleet = Array.from({length: 50}, (_, i) => ({
    alias: `书小生${i+1}号`, status: i % 4 === 0 ? 'working' : 'idle', network_id: nid,
    created_at:'2026-05-14T00:00:00Z', updated_at:'2026-05-14T00:00:00Z', last_seen_at:'2026-05-14T00:00:00Z',
  }));
  await route.fulfill({ response: r, json: { ...b, sessions: fleet } });
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length >= 40;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
// detect label-over-avatar overlaps: does any label rect intersect any OTHER node's avatar circle?
const overlap = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const nodeGs = [...svg.querySelectorAll('g')].filter(g =>
    g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]') &&
    g.querySelector(':scope > g > rect'));
  const nodes = nodeGs.map(g => {
    const ring = g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]');
    const cx = parseFloat(ring.getAttribute('cx')), cy = parseFloat(ring.getAttribute('cy'));
    const rr = parseFloat(ring.getAttribute('r'));
    const labelG = g.querySelector(':scope > g[transform^="translate"]');
    const m = labelG.getAttribute('transform').match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
    const lx = parseFloat(m[1]), ly = parseFloat(m[2]);
    // label rect: x -50..50, y -14..28 in local frame
    return { cx, cy, rr, labelRect: { x1: lx-50, x2: lx+50, y1: ly-14, y2: ly+28 } };
  });
  let labelCoversAvatar = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const lr = nodes[i].labelRect, n = nodes[j];
      // does label rect i overlap avatar circle j (bbox approx)?
      const ax1=n.cx-n.rr, ax2=n.cx+n.rr, ay1=n.cy-n.rr, ay2=n.cy+n.rr;
      if (lr.x1 < ax2 && lr.x2 > ax1 && lr.y1 < ay2 && lr.y2 > ay1) { labelCoversAvatar++; break; }
    }
  }
  return { total: nodes.length, labelCoversAvatar };
});
console.log(JSON.stringify(overlap));
await page.locator('section:has(h2:text("Command mesh"))').screenshot({ path: '/tmp/anet-issue-50/topo-50-before.png' });
await browser.close();
console.log('done');

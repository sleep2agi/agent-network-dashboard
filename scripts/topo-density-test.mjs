import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });

async function run(nodeCount, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); localStorage.removeItem('anet-brand'); localStorage.removeItem('anet-topo-view'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch(); const b = await r.json();
    const nid = (b.sessions||[])[0]?.network_id || 'default';
    const fleet = Array.from({length: nodeCount}, (_, i) => ({
      alias: `书小生${i+1}号`, status: i % 4 === 0 ? 'working' : 'idle', network_id: nid,
      created_at:'2026-05-14T00:00:00Z', updated_at:'2026-05-14T00:00:00Z', last_seen_at:'2026-05-14T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions: fleet } });
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length >= Math.min(n, 4);
  }, nodeCount, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    const nodeGs = [...svg.querySelectorAll('g')].filter(g =>
      g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]'));
    const labelCards = [...svg.querySelectorAll('g > g[transform^="translate"] > rect[width="100"]')];
    // count label rects covering any OTHER node's avatar
    const nodes = nodeGs.map(g => {
      const ring = g.querySelector(':scope > circle[r="26"], :scope > circle[r="18"]');
      return { cx:+ring.getAttribute('cx'), cy:+ring.getAttribute('cy'), rr:+ring.getAttribute('r'),
        label: g.querySelector(':scope > g[transform^="translate"]') };
    });
    let covers = 0;
    nodes.forEach(ni => {
      if (!ni.label) return;
      const m = ni.label.getAttribute('transform').match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
      const lx=+m[1], ly=+m[2]; const lr={x1:lx-50,x2:lx+50,y1:ly-14,y2:ly+28};
      for (const nj of nodes) {
        if (nj===ni) continue;
        if (lr.x1<nj.cx+nj.rr && lr.x2>nj.cx-nj.rr && lr.y1<nj.cy+nj.rr && lr.y2>nj.cy-nj.rr) { covers++; break; }
      }
    });
    return { nodeCount: nodes.length, labelsRendered: labelCards.length, labelCoversAvatar: covers };
  });
  console.log(label + ':', JSON.stringify(r));
  await page.locator('section:has(h2:text("Command mesh"))').screenshot({ path: `/tmp/anet-issue-50/topo-density-${nodeCount}.png` });
  await ctx.close();
}

await run(1, '1-node ');
await run(5, '5-node ');
await run(50, '50-node');
await browser.close();
console.log('done');

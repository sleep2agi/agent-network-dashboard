/* Issue #112 acceptance: ZERO overlap in the topology (Vincent's hard
 * done-criterion). At ~30 nodes, in both ring and grid layouts, asserts:
 *   - node ↔ node       — status rings don't intersect
 *   - node ↔ panel      — no node circle intersects an overlay panel rect
 *   - node ↔ group-label — no group-box label text covers a node
 *   - group-box ↔ box   — no two group boxes overlap */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-112', { recursive: true });
const browser = await chromium.launch({ headless: true });

// ~30 nodes: 4 prefix groups + a workdir group + singletons
const FLEET = [
  ...['A站内容', 'A站评测', 'A站数据', 'A站设计', 'A站运营', 'A站工程'].map(a => ({ alias: a })),
  ...['B站产品', 'B站工程', 'B站测试', 'B站运维', 'B站运营'].map(a => ({ alias: a })),
  ...['P站产品', 'P站工程', 'P站测试', 'P站运维'].map(a => ({ alias: a })),
  ...['通信龙', '通信牛', '通信马', '通信SDK马'].map(a => ({ alias: a })),
  ...['srv-a', 'srv-b', 'srv-c'].map(a => ({ alias: a, project_dir: '/home/v/agent-orchestra' })),
  ...['群星马', '书生1号', '微信马', '飞书马', '独立节点', '研究员1号', '研究员2号', '游侠马'].map(a => ({ alias: a })),
];

const overlaps1D = (a0, a1, b0, b1, tol) => a0 < b1 - tol && b0 < a1 - tol;

async function check(layout) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((lay) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.removeItem('anet-topo-nodescale'); // default M
      localStorage.setItem('anet-topo-layout', lay);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, layout);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = FLEET.map((f, i) => ({
      alias: f.alias, status: i % 5 === 0 ? 'working' : 'idle', network_id: nid,
      project_dir: f.project_dir ?? null,
      created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z', last_seen_at: new Date().toISOString(),
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('g[data-node]').length > 20;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);

  const data = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    // node status rings: stroke-width 3 (online) / 1.5 (offline), centred on the node
    const nodes = [...svg.querySelectorAll('g[data-node]')].map(g => {
      const ring = g.querySelector('circle[stroke-width="3"], circle[stroke-width="1.5"]');
      if (!ring) return null;
      return { alias: g.getAttribute('data-node'), cx: +ring.getAttribute('cx'), cy: +ring.getAttribute('cy'), r: +ring.getAttribute('r') };
    }).filter(Boolean);
    // overlay panels (direct svg children, fixed)
    const panels = [...svg.querySelectorAll(':scope > g[transform^="translate(28, 34)"], :scope > g[transform^="translate(720, 34)"]')].map(g => {
      const m = g.getAttribute('transform').match(/translate\(([\d.]+),\s*([\d.]+)\)/);
      const rect = g.querySelector('rect');
      return { x: +m[1], y: +m[2], w: +rect.getAttribute('width'), h: +rect.getAttribute('height') };
    });
    // group boxes + their label text bounding boxes
    const groups = [...svg.querySelectorAll('g[data-group]')].map(g => {
      const rect = g.querySelector('rect');
      const text = g.querySelector('text');
      const bb = text.getBBox();
      return {
        box: { x: +rect.getAttribute('x'), y: +rect.getAttribute('y'), w: +rect.getAttribute('width'), h: +rect.getAttribute('height') },
        label: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
      };
    });
    return { nodes, panels, groups };
  });

  const TOL = 2; // px slack — touching edges is fine, real overlap is not
  let nodeNode = 0, nodePanel = 0, nodeLabel = 0, boxBox = 0;

  // node ↔ node
  for (let i = 0; i < data.nodes.length; i++) {
    for (let j = i + 1; j < data.nodes.length; j++) {
      const a = data.nodes[i], b = data.nodes[j];
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d < a.r + b.r - TOL) nodeNode++;
    }
  }
  // node ↔ panel  (circle vs rect)
  for (const n of data.nodes) {
    for (const p of data.panels) {
      const qx = Math.max(p.x, Math.min(n.cx, p.x + p.w));
      const qy = Math.max(p.y, Math.min(n.cy, p.y + p.h));
      if (Math.hypot(n.cx - qx, n.cy - qy) < n.r - TOL) nodePanel++;
    }
  }
  // node ↔ group label  (circle vs label text bbox)
  for (const n of data.nodes) {
    for (const g of data.groups) {
      const L = g.label;
      const qx = Math.max(L.x, Math.min(n.cx, L.x + L.w));
      const qy = Math.max(L.y, Math.min(n.cy, L.y + L.h));
      if (Math.hypot(n.cx - qx, n.cy - qy) < n.r - TOL) nodeLabel++;
    }
  }
  // group box ↔ group box
  for (let i = 0; i < data.groups.length; i++) {
    for (let j = i + 1; j < data.groups.length; j++) {
      const a = data.groups[i].box, b = data.groups[j].box;
      if (overlaps1D(a.x, a.x + a.w, b.x, b.x + b.w, TOL) &&
          overlaps1D(a.y, a.y + a.h, b.y, b.y + b.h, TOL)) boxBox++;
    }
  }

  await page.screenshot({ path: `/tmp/anet-issue-112/overlap-${layout}.png` });
  await ctx.close();
  const ok = nodeNode === 0 && nodePanel === 0 && nodeLabel === 0 && boxBox === 0;
  console.log(`${ok ? '✅' : '❌'} [${layout}] nodes=${data.nodes.length} groups=${data.groups.length} — ` +
    `node↔node:${nodeNode} node↔panel:${nodePanel} node↔label:${nodeLabel} box↔box:${boxBox}`);
  return ok;
}

const all = [];
all.push(await check('grid'));
all.push(await check('ring'));
await browser.close();
const pass = all.every(Boolean);
console.log(pass ? '\n✅ ZERO OVERLAP' : '\n❌ OVERLAP DETECTED');
process.exit(pass ? 0 : 1);

/* Issue #112 acceptance: ZERO overlap in the topology (Vincent's hard
 * done-criterion). At ~30 nodes, in both ring and grid layouts, asserts:
 *   - node ↔ node       — status rings don't intersect
 *   - node ↔ panel      — no node circle intersects an overlay panel rect
 *   - node ↔ group-label — no group-box label text covers a node
 *   - group-box ↔ box   — no two group boxes overlap
 *   - label ↔ label     — no two text labels overlap (Round 27 — caught
 *                         the dense-node-label vs group-label collision
 *                         Vincent reported in preview.29) */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-112', { recursive: true });
const browser = await chromium.launch({ headless: true });

// ~30 nodes: 4 prefix groups + a workdir group + singletons.
// #170 tree-view MVP — the fleet now also carries `runtime` so the org-
// chart layout can derive team leads (claude-code-cli) and deputies
// (codex-sdk). The first node in each prefix group is the cli lead, the
// second is the codex deputy; the rest are plain members. ring/grid
// ignore `runtime` so their overlap geometry is unchanged.
const lead = (a) => ({ alias: a, runtime: 'claude-code-cli' });
const dep = (a) => ({ alias: a, runtime: 'codex-sdk' });
const mem = (a) => ({ alias: a, runtime: 'claude-agent-sdk' });
const FLEET = [
  // commander roots — exercise the layer-0 / layer-1 derivation
  lead('总指挥'), lead('副指挥A'), lead('副指挥B'),
  [lead, dep, mem, mem, mem, mem].map((f, i) => f(['A站内容', 'A站评测', 'A站数据', 'A站设计', 'A站运营', 'A站工程'][i])),
  [lead, dep, mem, mem, mem].map((f, i) => f(['B站产品', 'B站工程', 'B站测试', 'B站运维', 'B站运营'][i])),
  [lead, dep, mem, mem].map((f, i) => f(['P站产品', 'P站工程', 'P站测试', 'P站运维'][i])),
  [lead, dep, mem, mem].map((f, i) => f(['通信龙', '通信牛', '通信马', '通信SDK马'][i])),
  ['srv-a', 'srv-b', 'srv-c'].map(a => ({ alias: a, runtime: 'http-api', project_dir: '/home/v/agent-orchestra' })),
  // orphan singletons — collected into the 未分组 bucket in tree mode
  ['群星马', '书生1号', '微信马', '飞书马', '独立节点', '研究员1号', '研究员2号', '游侠马'].map(a => mem(a)),
].flat();

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
      runtime: f.runtime ?? null,
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

  // Round 463 / Loop: zombie-build guard — consumes R462's
  // svg[data-dashboard-version] surface (preview.130+). Before
  // reporting collision metrics, verify the dash is actually
  // serving the build that matches package.json. This catches
  // the dash-zombie-port-3000 failure mode (next-server cached
  // chunks from earlier preview) that bit R441 + R460 — those
  // rounds reported false-positive overlap-test green because
  // probes ran against stale code. Test scripts shipping before
  // R462 don't have the attr; we tolerate its absence (older
  // dash) but fail hard on mismatch. The `expected` value comes
  // from this script's CWD package.json — co-located with the
  // working tree → it reflects whatever version was bumped this
  // round.
  const expected = JSON.parse(readFileSync('/home/vansin/agent-network-dashboard/package.json', 'utf8')).version;
  const live = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return svg ? svg.getAttribute('data-dashboard-version') : null;
  });
  if (live && live !== expected) {
    console.error(`❌ [${layout}] STALE BUILD — dash serves ${live} but package.json says ${expected}.`);
    console.error(`   Likely cause: zombie next-server (pkill -9 + restart). See feedback_dash_zombie_port_3000.md.`);
    await ctx.close();
    return { stale: true, live, expected };
  }
  if (!live) {
    // R462 attr not present — dash is on an older build than the
    // R462 surface ships in. Don't fail; just warn so the loop
    // operator notices. Real overlap metrics still run.
    console.warn(`⚠️  [${layout}] data-dashboard-version absent (dash pre-R462? expected ${expected}). Skipping zombie-guard.`);
  }

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
    // Round 27 / P0: every visible label bbox (node alias text + group
    // headings) so we can assert label↔label clearance. Skip elements
    // with empty bboxes (e.g., text inside an unrendered <g>).
    const allLabels = [];
    for (const t of svg.querySelectorAll('g[data-node] text, g[data-group] text')) {
      const bb = t.getBBox();
      if (bb.width === 0 || bb.height === 0) continue;
      allLabels.push({
        kind: t.closest('g[data-group]') ? 'group' : 'node',
        owner: (t.closest('g[data-group]')?.getAttribute('data-group')) || (t.closest('g[data-node]')?.getAttribute('data-node')) || '?',
        x: bb.x, y: bb.y, w: bb.width, h: bb.height,
      });
    }
    return { nodes, panels, groups, allLabels };
  });

  const TOL = 2; // px slack — touching edges is fine, real overlap is not
  let nodeNode = 0, nodePanel = 0, nodeLabel = 0, boxBox = 0, labelLabel = 0;

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
  // label ↔ label  (Round 27)
  // Same-node node-labels (e.g. alias + sub-status in the full card) are
  // intentionally close and adjacent — skip pairs that share an owner.
  for (let i = 0; i < data.allLabels.length; i++) {
    for (let j = i + 1; j < data.allLabels.length; j++) {
      const a = data.allLabels[i], b = data.allLabels[j];
      if (a.owner === b.owner) continue;
      if (overlaps1D(a.x, a.x + a.w, b.x, b.x + b.w, TOL) &&
          overlaps1D(a.y, a.y + a.h, b.y, b.y + b.h, TOL)) labelLabel++;
    }
  }

  await page.screenshot({ path: `/tmp/anet-issue-112/overlap-${layout}.png` });
  await ctx.close();
  const ok = nodeNode === 0 && nodePanel === 0 && nodeLabel === 0 && boxBox === 0 && labelLabel === 0;
  console.log(`${ok ? '✅' : '❌'} [${layout}] nodes=${data.nodes.length} groups=${data.groups.length} — ` +
    `node↔node:${nodeNode} node↔panel:${nodePanel} node↔label:${nodeLabel} box↔box:${boxBox} label↔label:${labelLabel}`);
  return ok;
}

const all = [];
all.push(await check('grid'));
all.push(await check('ring'));
// #170 tree-view MVP — the org-chart layout must be zero-overlap too.
all.push(await check('tree'));
await browser.close();
// R463: any non-boolean return is a sentinel (e.g. { stale: true }
// from the zombie-build guard). Treat as a hard fail — collision
// metrics from a stale build are meaningless, and reporting them
// as green would re-create the R441/R460 false-positive that hit
// us before the data-dashboard-version surface existed.
const stale = all.find(r => r && typeof r === 'object' && r.stale);
if (stale) {
  console.error(`\n❌ STALE BUILD — dash served ${stale.live}, expected ${stale.expected}. Restart dash + retry.`);
  process.exit(2);
}
const pass = all.every(r => r === true);
console.log(pass ? '\n✅ ZERO OVERLAP' : '\n❌ OVERLAP DETECTED');
process.exit(pass ? 0 : 1);

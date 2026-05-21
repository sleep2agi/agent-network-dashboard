/* Diagnostic: compare grid vs tree node frontend presentation.
 * Vincent UX complaint — tree view "没有像 grid 视图那样的前端展示".
 * Screenshots both layouts + dumps per-node visual element counts. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-tree-diag', { recursive: true });

const lead = (a) => ({ alias: a, runtime: 'claude-code-cli' });
const dep = (a) => ({ alias: a, runtime: 'codex-sdk' });
const mem = (a) => ({ alias: a, runtime: 'claude-agent-sdk' });
const FLEET = [
  lead('总指挥'), lead('副指挥A'), lead('副指挥B'),
  [lead, dep, mem, mem, mem, mem].map((f, i) => f(['A站内容', 'A站评测', 'A站数据', 'A站设计', 'A站运营', 'A站工程'][i])),
  [lead, dep, mem, mem, mem].map((f, i) => f(['B站产品', 'B站工程', 'B站测试', 'B站运维', 'B站运营'][i])),
  [lead, dep, mem, mem].map((f, i) => f(['P站产品', 'P站工程', 'P站测试', 'P站运维'][i])),
  [lead, dep, mem, mem].map((f, i) => f(['通信龙', '通信牛', '通信马', '通信SDK马'][i])),
  ['srv-a', 'srv-b', 'srv-c'].map(a => ({ alias: a, runtime: 'http-api', project_dir: '/home/v/agent-orchestra' })),
  ['群星马', '书生1号', '微信马', '飞书马', '独立节点', '研究员1号', '研究员2号', '游侠马'].map(a => mem(a)),
].flat();

const browser = await chromium.launch({ headless: true });

async function shot(layout) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((lay) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.removeItem('anet-topo-nodescale');
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
      project_dir: f.project_dir ?? null, runtime: f.runtime ?? null,
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
    return !!svg && svg.querySelectorAll('g[data-node]').length > 20;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    svg?.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(500);

  const facts = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    const nodes = [...svg.querySelectorAll('g[data-node]')];
    const sample = nodes.slice(0, 3).map(g => ({
      alias: g.getAttribute('data-node'),
      circles: g.querySelectorAll('circle').length,
      images: g.querySelectorAll('image').length,
      texts: g.querySelectorAll('text').length,
      paths: g.querySelectorAll('path').length,
    }));
    const viewG = svg.querySelector('g[data-topo-viewport], g[transform*="scale"]');
    const groups = svg.querySelectorAll('g[data-group]').length;
    return {
      nodeCount: nodes.length,
      groupBoxes: groups,
      viewportTransform: viewG ? viewG.getAttribute('transform') : null,
      sample,
    };
  });
  const svgEl = await page.$('svg[viewBox="0 0 1000 680"]');
  await svgEl.screenshot({ path: `/tmp/anet-tree-diag/${layout}.png`, animations: 'disabled' });
  await ctx.close();
  return facts;
}

for (const lay of ['grid', 'tree']) {
  const f = await shot(lay);
  console.log(`\n=== ${lay} ===`);
  console.log(JSON.stringify(f, null, 2));
}
await browser.close();
console.log('\nscreenshots: /tmp/anet-tree-diag/{grid,tree}.png');

/* Issue #111 verification: prefix-group boundary boxes in grid layout.
 * Mixed-prefix fleet → each multi-member group gets a box that encloses
 * exactly its nodes; singletons get no box; ring layout has no boxes. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
mkdirSync('/tmp/anet-issue-111', { recursive: true });
const browser = await chromium.launch({ headless: true });

// 3 multi-member prefix groups + 1 singleton
const FLEET = [
  'A站1号', 'A站2号', 'A站3号',
  '书生1号', '书生2号',
  '通信龙', '通信牛', '通信马',
  '独立号',
];

async function load(theme, layout) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(({ th, lay }) => {
    try {
      localStorage.setItem('anet-theme', th);
      localStorage.removeItem('anet-brand');
      localStorage.removeItem('anet-topo-view');
      localStorage.setItem('anet-topo-layout', lay);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, { th: theme, lay: layout });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = FLEET.map(alias => ({
      alias, status: 'idle', network_id: nid,
      created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z', last_seen_at: '2026-05-15T00:00:00Z',
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return !!svg && svg.querySelectorAll('circle[r="26"]').length > 0;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page };
}

const results = {};

// --- grid layout: boxes exist + enclose their groups ---
{
  const { ctx, page } = await load('cyber', 'grid');
  const svg = 'svg[viewBox="0 0 1000 680"]';
  const groups = await page.$$eval(`${svg} g[data-group]`, els => els.map(e => e.getAttribute('data-group')));
  results.gridBoxCount = groups.length;
  results.gridGroupsCorrect = ['A站', '书生', '通信'].every(g => groups.includes(g));
  results.gridNoSingletonBox = !groups.includes('独立号');

  // each box rect must enclose exactly its group's node centres
  results.gridBoxesEnclose = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    const nodeCenter = {};
    svg.querySelectorAll('g[style] circle[r="26"]').forEach(c => {
      // nearest ancestor <g> with the node's <title> tells us the alias
      const g = c.closest('g');
      const t = g?.querySelector('title')?.textContent || '';
      if (t) nodeCenter[t] = { x: +c.getAttribute('cx'), y: +c.getAttribute('cy') };
    });
    const expect = { 'A站': ['A站1号', 'A站2号', 'A站3号'], '书生': ['书生1号', '书生2号'], '通信': ['通信龙', '通信牛', '通信马'] };
    let allGood = true;
    for (const g of svg.querySelectorAll('g[data-group]')) {
      const key = g.getAttribute('data-group');
      const rect = g.querySelector('rect');
      const bx = +rect.getAttribute('x'), by = +rect.getAttribute('y');
      const bw = +rect.getAttribute('width'), bh = +rect.getAttribute('height');
      for (const alias of (expect[key] || [])) {
        const c = nodeCenter[alias];
        if (!c || c.x < bx || c.x > bx + bw || c.y < by || c.y > by + bh) allGood = false;
      }
    }
    return allGood;
  });

  // label text present for each group
  const labels = await page.$$eval(`${svg} g[data-group] text`, els => els.map(e => (e.textContent || '').trim()));
  results.gridLabels = ['A站', '书生', '通信'].every(g => labels.includes(g));

  await page.screenshot({ path: '/tmp/anet-issue-111/groupbox-grid-cyber.png' });
  await ctx.close();
}

// --- light theme grid: boxes still render ---
{
  const { ctx, page } = await load('light', 'grid');
  const n = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-group]', els => els.length);
  results.lightGridBoxes = n === 3;
  await page.screenshot({ path: '/tmp/anet-issue-111/groupbox-grid-light.png' });
  await ctx.close();
}

// --- ring layout: no boxes ---
{
  const { ctx, page } = await load('cyber', 'ring');
  const n = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-group]', els => els.length);
  results.ringNoBoxes = n === 0;
  await ctx.close();
}

await browser.close();
const ok = results.gridBoxCount === 3 && results.gridGroupsCorrect && results.gridNoSingletonBox &&
  results.gridBoxesEnclose && results.gridLabels && results.lightGridBoxes && results.ringNoBoxes;
console.log(`${ok ? '✅' : '❌'} #111 group boxes:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);

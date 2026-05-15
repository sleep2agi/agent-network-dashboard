/* Round 106 verification: legend panel gains a header matching the
 * recent-signal panel's "recent signal · N flows" format. Same
 * font/position vocabulary so the two side panels feel paired. The
 * fleet count is right-aligned at x=215 in the accent colour.
 *
 * Sanity-checks:
 *   - "legend" title text exists in the legend panel
 *   - "N node(s)" count matches sessions.length
 *   - Singular vs plural ("1 node" vs "5 nodes") correct
 *   - Existing rows still render (hover affordance preserved)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const probe = async (count) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [];
    for (let i = 0; i < count; i++) {
      sessions.push({
        alias: `n${i}`, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh,
      });
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, count, { timeout: 30000 });
  await page.waitForSelector('[data-legend-panel-count]', { timeout: 10000 });
  await page.waitForTimeout(400);

  const data = await page.evaluate(() => {
    const headerCount = document.querySelector('[data-legend-panel-count]')?.textContent;
    const headerTitle = (() => {
      // Find a <text> with "legend" content in the legend panel <g>
      const panel = document.querySelector('[data-topo-panel-elevation="legend"]')?.parentElement;
      if (!panel) return null;
      for (const t of panel.querySelectorAll('text')) {
        if (t.textContent === 'legend') return t.textContent;
      }
      return null;
    })();
    const legendRows = document.querySelectorAll('[data-legend-status]').length;
    return { headerCount, headerTitle, legendRows };
  });
  await ctx.close();
  return data;
};

const single = await probe(1);
const many   = await probe(5);
await browser.close();

const results = {
  single_hasTitle:        single.headerTitle === 'legend',
  single_count1Node:      single.headerCount === '1 node',
  many_hasTitle:          many.headerTitle === 'legend',
  many_count5Nodes:       many.headerCount === '5 nodes',
  many_rowsStillRender:   many.legendRows >= 1, // depends on which states are present
  // Sanity: singular vs plural
  singular_correct:       single.headerCount?.endsWith(' node'),
  plural_correct:         many.headerCount?.endsWith(' nodes'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend panel header:`, JSON.stringify(results),
  `\n  single (1 node)=`, single,
  `\n  many (5 nodes)=`,  many);
process.exit(ok ? 0 : 1);

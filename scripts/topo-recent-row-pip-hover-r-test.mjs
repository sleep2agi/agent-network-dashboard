/* Round 447 verification: recent-row freshness pip radius hover lift —
 * r 2.0 → 2.5 on (isRowHovered || isRowPinned).
 *
 * Contract:
 *   - rest: every pip reports data-recent-row-freshness-radius '2' +
 *     lifted='false'
 *   - hover one row: that row's pip lifts to '2.5' + lifted='true'
 *   - siblings stay rest
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta',  content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'pong', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-freshness]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('[data-recent-row-freshness]')];
  return ps.map(p => ({
    key:    p.getAttribute('data-recent-row-freshness'),
    r:      parseFloat(p.getAttribute('data-recent-row-freshness-radius') || '0'),
    lifted: p.getAttribute('data-recent-row-freshness-lifted'),
  }));
});

const rest = await readAll();
const firstKey = rest[0]?.key;

// Hover the corresponding data-recent-row wrapper
let hover = null;
if (firstKey) {
  const box = await page.evaluate((key) => {
    const g = document.querySelector(`[data-recent-row="${key}"]`);
    if (!g) return null;
    const b = g.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, firstKey);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(300);
    hover = await readAll();
    await page.mouse.move(0, 0);
  }
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /r:\s*`\$\{\(isRowHovered \|\| isRowPinned\) \? 2\.5 : 2\.0\}px`/.test(fileText);

await browser.close();

const restAll_2_0    = rest.every(r => r.r === 2.0);
const restNoLifted   = rest.every(r => r.lifted === 'false');
const hoveredEntry   = hover?.find(r => r.key === firstKey);
const hoverR_2_5     = hoveredEntry?.r === 2.5;
const hoverLifted    = hoveredEntry?.lifted === 'true';
const othersStayRest = hover ? hover.filter(r => r.key !== firstKey).every(r => r.r === 2.0 && r.lifted === 'false') : false;

const results = {
  rest_count_ge_2:        rest.length >= 2,
  rest_all_r_2_0:         restAll_2_0,
  rest_no_lifted:         restNoLifted,
  hover_target_r_2_5:     hoverR_2_5,
  hover_target_lifted:    hoverLifted,
  hover_others_stay:      othersStayRest,
  source_wired:           sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row pip hover r:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);

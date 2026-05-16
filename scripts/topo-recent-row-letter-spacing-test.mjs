/* Round 434 verification: recent-signal row text 3-tier letter-spacing —
 * rest 0 / hover 0.25 / pinned 0.5. Mirror of R433 legend-row pattern
 * at recent-signal scope. Hover-letter-spacing family becomes 10 anchors.
 *
 * Contract:
 *   - need flow messages to populate recent rows — fixture seeds
 *     alpha↔beta + alpha↔gamma so ≥2 rows mount
 *   - rest: every recent-row-text reports letter-spacing '0px' +
 *     hovered='false' + pinned='false'
 *   - hover one data-recent-row wrapper: that row's text reports
 *     letter-spacing '0.25px' + hovered='true' (R434 mid tier)
 *   - siblings stay rest
 *   - source-file probe confirms 3-tier conditional
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
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta',  content: 'ping1', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'ping2', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-recent-row-text]')];
  return ts.map(t => ({
    key:     t.getAttribute('data-recent-row-text'),
    ls:      t.style.letterSpacing,
    pinned:  t.getAttribute('data-recent-row-text-pinned'),
    hovered: t.getAttribute('data-recent-row-text-hovered'),
  }));
});

const rest = await readAll();
const firstKey = rest[0]?.key;

// Hover the data-recent-row <g> wrapper for the first row.
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
const sourceWired = /letterSpacing:\s*isRowPinned\s*\?\s*'0\.5px'\s*:\s*\n?\s*isRowHovered\s*\?\s*'0\.25px'\s*:\s*'0px'/.test(fileText);

await browser.close();

const isRest = (ls) => ls === '0px' || ls === '' || ls === 'normal';

const hoveredEntry  = hover?.find(r => r.key === firstKey);
const othersStayRest = hover ? hover.filter(r => r.key !== firstKey).every(r => isRest(r.ls) && r.hovered === 'false') : false;

const results = {
  rest_count_gte_2:           rest.length >= 2,
  rest_all_zero:              rest.every(r => isRest(r.ls)),
  rest_all_pinned_false:      rest.every(r => r.pinned === 'false'),
  rest_all_hovered_false:     rest.every(r => r.hovered === 'false'),
  hover_target_ls_0_25:       hoveredEntry?.ls === '0.25px',
  hover_target_hovered_true:  hoveredEntry?.hovered === 'true',
  hover_others_stay_rest:     othersStayRest,
  source_three_tier_wired:    sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row 3-tier letter-spacing:`, JSON.stringify(results),
  '\n  rest count:', rest.length,
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);

/* Round 432 verification: group label text 3-tier letter-spacing —
 * rest 0 / hover 0.25 / pinned 0.5. Extends R427 alias 3-tier and
 * R431 edge-badge 3-tier to group-label scope. Hover-letter-spacing
 * family now 8 anchors.
 *
 * Contract:
 *   - need >1 alias prefix group to mount group boxes (grid layout)
 *   - rest: every group-label reports letter-spacing '0px' (or
 *     'normal' computed), pinned=false, hovered=false
 *   - hover one label-hit: that group-label reports letter-spacing
 *     '0.25px' + hovered=true (R432 mid tier)
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
  // Force grid layout (the layout toggle persists in localStorage)
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
  // Sessions with alias prefix groups: alpha·X / beta·X / gamma·X
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
    mk('gamma·1', 'working'),
    mk('gamma·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-group-label]')];
  return ts.map(t => ({
    key:     t.getAttribute('data-group-label'),
    ls:      t.style.letterSpacing,
    pinned:  t.getAttribute('data-group-label-pinned'),
    hovered: t.getAttribute('data-group-label-hovered'),
  }));
});

const rest = await readAll();
const firstKey = rest[0]?.key;
let hover = null;
if (firstKey) {
  const box = await page.evaluate((key) => {
    // Hover the label-hit <g> wrapper which dispatches onPointerEnter →
    // setHoveredGroupLabel(key). The associated <text> shares the same
    // box.key as data-group-label.
    const hit = document.querySelector(`[data-group-label-hit="${key}"]`);
    if (!hit) return null;
    const b = hit.getBoundingClientRect();
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
const sourceWired = /letterSpacing:\s*isPinned\s*\?\s*'0\.5px'\s*:\s*\n?\s*isHovered\s*\?\s*'0\.25px'\s*:\s*'0px'/.test(fileText);

await browser.close();

const isRest = (ls) => ls === '0px' || ls === '' || ls === 'normal';

const hoveredEntry = hover?.find(r => r.key === firstKey);
const othersRest   = hover ? hover.filter(r => r.key !== firstKey).every(r => isRest(r.ls)) : false;

const results = {
  rest_count_gte_2:           rest.length >= 2,
  rest_all_zero:              rest.every(r => isRest(r.ls)),
  rest_all_pinned_false:      rest.every(r => r.pinned === 'false'),
  rest_all_hovered_false:     rest.every(r => r.hovered === 'false'),
  hover_target_ls_0_25:       hoveredEntry?.ls === '0.25px',
  hover_target_hovered_attr:  hoveredEntry?.hovered === 'true',
  hover_others_stay_rest:     othersRest,
  source_three_tier_wired:    sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label 3-tier letter-spacing:`, JSON.stringify(results),
  '\n  rest count:', rest.length,
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);

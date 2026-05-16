/* Round 427 verification: node alias label letter-spacing — 3-tier
 * scale rest 0 / hover 0.3 / chat-target 0.5. Extends the hover-
 * letter-spacing family (R344/R345/R347/R351/R420) to per-node alias
 * scope.
 *
 * Contract:
 *   - rest: every visible alias-text reports letter-spacing 0px
 *     (resolves to keyword 'normal' in computed style on some engines —
 *     R218 trap; accept either form)
 *   - hover a node: that node's alias-text reports letter-spacing 0.3px,
 *     all others stay at rest 0
 *   - source-file probe confirms the 3-tier conditional + transition list
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
  // small fleet (3 nodes) so labels are in card-mode, not dense
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-alias-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-node-alias-text]')];
  return ts.map(t => ({
    alias: t.getAttribute('data-node-alias-text'),
    ls:    t.style.letterSpacing,                       // inline style
    ls_c:  getComputedStyle(t).letterSpacing,           // computed (may be 'normal')
    chat:  t.getAttribute('data-node-alias-chat-target'),
    hover: t.getAttribute('data-node-alias-hovered'),
  }));
});

const rest = await readAll();

// Hover the first node's group (its bounding rect)
const firstAlias = rest[0]?.alias;
let hover = null;
if (firstAlias) {
  const box = await page.evaluate((alias) => {
    const t = document.querySelector(`[data-node-alias-text="${alias}"]`);
    if (!t) return null;
    // Walk up to the node group (data-node) for the group-hover hit.
    const node = t.closest('[data-node]');
    const target = node || t;
    const b = target.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, firstAlias);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(300);
    hover = await readAll();
    await page.mouse.move(0, 0);
  }
}

// Source-file probe
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /chatAlias\s*===\s*session\.alias\s*\?\s*'0\.5px'\s*:\s*\n\s*hoveredAlias\s*===\s*session\.alias\s*\?\s*'0\.3px'\s*:\s*'0px'/.test(fileText);
const sourceTransition = /transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out'/.test(fileText);

await browser.close();

const isRest = (ls) => ls === '0px' || ls === '' || ls === 'normal';
const isMid  = (ls) => ls === '0.3px';

const restAllZero = rest.length > 0 && rest.every(r => isRest(r.ls));
const hoveredEntry = hover?.find(r => r.alias === firstAlias);
const othersStillRest = hover ? hover.filter(r => r.alias !== firstAlias).every(r => isRest(r.ls)) : false;

const results = {
  rest_mounted_count_gte_3:  rest.length >= 3,
  rest_chat_all_false:       rest.every(r => r.chat === 'false'),
  rest_hover_all_false:      rest.every(r => r.hover === 'false'),
  rest_letter_spacing_zero:  restAllZero,
  hover_target_ls_0_3:       isMid(hoveredEntry?.ls || ''),
  hover_target_hover_attr:   hoveredEntry?.hover === 'true',
  hover_others_stay_rest:    othersStillRest,
  source_three_tier_wired:   sourceWired,
  source_transition_kept:    sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node alias letter-spacing 3-tier:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest), '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);

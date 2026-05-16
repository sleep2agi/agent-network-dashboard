/* Round 428 verification: node sub-text (status label line beneath
 * the alias) adopts hover letter-spacing tween 0 → 0.2px on
 * hoveredAlias. Sibling to R427 alias-text 0 → 0.3 — the alias is
 * primary identity (0.3 kerning), sub-text is secondary status (0.2).
 *
 * Contract:
 *   - rest: every sub-text has letter-spacing '0px' and hover='false'
 *   - hover one node: that sub-text has letter-spacing '0.2px' and
 *     hover='true'; siblings stay at rest
 *   - alias-text and sub-text tween together on the same hovered node
 *     (R427 0.3 + R428 0.2)
 *   - source-file probe confirms conditional + transition extended
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
  // small fleet — card-mode labels
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
await page.waitForSelector('[data-node-sub-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const subs = [...document.querySelectorAll('[data-node-sub-text]')];
  const alis = [...document.querySelectorAll('[data-node-alias-text]')];
  return {
    sub: subs.map(t => ({
      alias: t.getAttribute('data-node-sub-text'),
      ls:    t.style.letterSpacing,
      hover: t.getAttribute('data-node-sub-text-hovered'),
    })),
    alias: alis.map(t => ({
      alias: t.getAttribute('data-node-alias-text'),
      ls:    t.style.letterSpacing,
      hover: t.getAttribute('data-node-alias-hovered'),
    })),
  };
});

const rest = await readAll();
const firstAlias = rest.sub[0]?.alias;
let hover = null;
if (firstAlias) {
  const box = await page.evaluate((alias) => {
    const t = document.querySelector(`[data-node-alias-text="${alias}"]`);
    if (!t) return null;
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
const sourceWired         = /data-node-sub-text-hovered.*\n.*letterSpacing:\s*hoveredAlias\s*===\s*session\.alias\s*\?\s*'0\.2px'\s*:\s*'0px'/s.test(fileText);
const sourceTransition    = /transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out'/.test(fileText);

await browser.close();

const isRest = (ls) => ls === '0px' || ls === '' || ls === 'normal';
const hoveredSubEntry   = hover?.sub.find(r => r.alias === firstAlias);
const hoveredAliasEntry = hover?.alias.find(r => r.alias === firstAlias);
const othersSubRest = hover ? hover.sub.filter(r => r.alias !== firstAlias).every(r => isRest(r.ls)) : false;

const results = {
  rest_sub_count_gte_3:        rest.sub.length >= 3,
  rest_sub_all_zero:           rest.sub.every(r => isRest(r.ls)),
  rest_sub_all_hover_false:    rest.sub.every(r => r.hover === 'false'),
  hover_sub_target_ls_0_2:     hoveredSubEntry?.ls === '0.2px',
  hover_sub_target_attr_true:  hoveredSubEntry?.hover === 'true',
  hover_sub_others_stay_rest:  othersSubRest,
  // R427/R428 sibling parity — alias and sub-text tween together on same hovered node
  hover_alias_target_ls_0_3:   hoveredAliasEntry?.ls === '0.3px',
  source_conditional_wired:    sourceWired,
  source_transition_wired:     sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node sub-text letter-spacing hover:`, JSON.stringify(results),
  '\n  hover sub:', JSON.stringify(hoveredSubEntry),
  '\n  hover alias:', JSON.stringify(hoveredAliasEntry));
process.exit(ok ? 0 : 1);

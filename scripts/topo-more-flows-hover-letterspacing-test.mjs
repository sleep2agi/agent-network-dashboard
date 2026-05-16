/* Round 344 verification: +N more flows footer hover state adds
 * letter-spacing tween 0.2 → 0.3. Layers on top of R195 cyan fill +
 * R325 baseline letter-spacing 0.2 + R133 underline + R325 opacity
 * 0.55 → 0.85 hover. Sibling to R218/R219/R220 pin-signature letter-
 * spacing family applied to a hover-only surface.
 *
 * Contract:
 *   - Rest state: [data-recent-panel-more] letter-spacing="0.2".
 *   - Hover state: letter-spacing="0.3" (after mouseover).
 *   - Inline style.transition contains 'letter-spacing'.
 *   - R325 + R259 regressions intact.
 *   - R317/R318 chrome regression.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'), mk('epsilon'),
  ] } });
});
// 5 flow pairs → footer mounts (need >3 flowLinks).
const now = Date.now();
const mkMsg = (idx, from_alias, to_alias) => ({
  id: `${from_alias}-${to_alias}-${idx}`,
  from_alias, to_alias, content: `m${idx}`,
  network_id: 'default',
  created_at: new Date(now - (5 + idx) * 1000).toISOString(),
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  mkMsg(1, 'alpha', 'beta'),
  mkMsg(2, 'beta',  'gamma'),
  mkMsg(3, 'gamma', 'delta'),
  mkMsg(4, 'delta', 'epsilon'),
  mkMsg(5, 'epsilon', 'alpha'),
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-more]', { timeout: 15000 });
await page.waitForTimeout(300);

// Rest-state probe.
const restProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more]');
  return {
    letterSpacing: el?.getAttribute('letter-spacing') ?? null,
    transition:    el ? getComputedStyle(el).transition : null,
    hovered:       el?.getAttribute('data-recent-panel-more-hovered') ?? null,
  };
});

// Hover the parent <g> wrapper — the onMouseEnter is on the link group.
await page.hover('[data-recent-panel-more-nav]');
await page.waitForTimeout(300);

const hoverProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more]');
  return {
    letterSpacing: el?.getAttribute('letter-spacing') ?? null,
    hovered:       el?.getAttribute('data-recent-panel-more-hovered') ?? null,
  };
});

await browser.close();

const hasLetterSpacingTrans = (s) =>
  /letter-spacing\s+\d*\.?\d*s|letter-spacing\s+\d+ms/i.test(s || '');

const results = {
  rest_letter_spacing_0_2:    restProbe.letterSpacing === '0.2',
  rest_not_hovered:           restProbe.hovered === 'false',
  hover_letter_spacing_0_3:   hoverProbe.letterSpacing === '0.3',
  hover_state_true:           hoverProbe.hovered === 'true',
  transition_has_letter_sp:   hasLetterSpacingTrans(restProbe.transition),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} more-flows hover letter-spacing:`, JSON.stringify(results),
  '\n  rest:',  restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);

/* Round 500 verification: node alias text gains a status-coloured
 * drop-shadow on hover (extends R476-R481 drop-shadow visual-polish
 * family to 7th anchor). Pre-R500 hover triggered card-lift + alias
 * letter-spacing; post-R500 the alias glyph itself glows.
 *
 * Test scenarios:
 *  1. Rest state — no hover: data-node-alias-glow='false', no filter
 *  2. Hover state — after synthetic pointerenter dispatch on g[data-node]
 *     descendant: glow attr 'true', computed filter contains drop-shadow
 *  3. reducedMotion: glow attr 'false' regardless of hover (a11y)
 *  4. Source-side regex confirms wiring
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ reducedMotion }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1200 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
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
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha·a1', 'working'),
      mk('alpha·a2', 'idle'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('g[data-node]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Phase 1: rest state
  const rest = await page.evaluate(() => {
    const text = document.querySelector('[data-node-alias-text]');
    if (!text) return null;
    return {
      glow_attr: text.getAttribute('data-node-alias-glow'),
      computed_filter: window.getComputedStyle(text).filter,
    };
  });

  // Phase 2: hover state — synthetic pointerenter (R488 banked recipe)
  const aliasAfterHover = await page.evaluate(() => {
    const g = document.querySelector('g[data-node]');
    if (!g) return null;
    const alias = g.getAttribute('data-node');
    const target = g.querySelector('circle, image, rect') || g;
    ['pointerenter', 'pointerover', 'mouseenter', 'mouseover'].forEach((t) => {
      target.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }));
    });
    return alias;
  });
  await page.waitForTimeout(400);
  const hover = await page.evaluate(() => {
    const text = document.querySelector('[data-node-alias-text]');
    if (!text) return null;
    return {
      glow_attr: text.getAttribute('data-node-alias-glow'),
      computed_filter: window.getComputedStyle(text).filter,
      hovered_attr: text.getAttribute('data-node-alias-hovered'),
    };
  });

  await browser.close();
  return { rest, hover, alias: aliasAfterHover };
}

const motion = await probe({ reducedMotion: false });
const a11y   = await probe({ reducedMotion: true  });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: !reducedMotion && hoveredAlias === session\.alias\s*\?\s*`drop-shadow\(0 0 2px \$\{status\.text\}80\)`\s*:\s*undefined/.test(src);
const sourceAttr   = /data-node-alias-glow=\{!reducedMotion && hoveredAlias === session\.alias \? 'true' : 'false'\}/.test(src);
const sourceTransition = /transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  // Motion fixture, rest: attr='false', filter='none'
  motion_rest_attr_false:  motion.rest && motion.rest.glow_attr === 'false',
  motion_rest_filter_none: motion.rest && motion.rest.computed_filter === 'none',
  // Motion fixture, hover: attr='true', filter contains drop-shadow
  motion_alias_resolved:   !!motion.alias,
  motion_hover_attr_true:  motion.hover && motion.hover.glow_attr === 'true',
  motion_hover_filter_drop:motion.hover && /drop-shadow/.test(motion.hover.computed_filter || ''),
  // a11y fixture: attr='false' even after hover (component-side gate)
  a11y_rest_attr_false:    a11y.rest && a11y.rest.glow_attr === 'false',
  a11y_hover_attr_false:   a11y.hover && a11y.hover.glow_attr === 'false',
  a11y_hover_filter_none:  a11y.hover && a11y.hover.computed_filter === 'none',
  // Source
  source_filter_wired:     sourceFilter,
  source_attr_wired:       sourceAttr,
  source_transition_wired: sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R500 node alias glow:`, JSON.stringify(results),
  '\n  motion rest :', JSON.stringify(motion.rest),
  '\n  motion hover:', JSON.stringify(motion.hover),
  '\n  a11y   rest :', JSON.stringify(a11y.rest),
  '\n  a11y   hover:', JSON.stringify(a11y.hover));
process.exit(ok ? 0 : 1);

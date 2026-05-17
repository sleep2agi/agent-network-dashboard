/* Round 501 verification: vendor avatar <image> inside node circles
 * gains a hover-gated `filter: brightness(1.15)`. Closes the per-node
 * hover-affordance arc — every per-node element type now has a hover
 * treatment.
 *
 * Test fixture: claude-code-cli runtime → vendor.logo path renders the
 * <image> branch (vs monogram fallback). Verifies:
 *   1. rest: data-node-avatar-hovered='false', no brightness filter
 *   2. hover (synthetic pointerenter): attr='true', computed filter
 *      contains brightness(1.15)
 *   3. a11y: attr='false' even after hover (component gate)
 *   4. source-side regex confirms wiring
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
      // claude-code-cli renders the avatar <image> branch
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

  const rest = await page.evaluate(() => {
    const img = document.querySelector('[data-node-avatar]');
    if (!img) return { found: false };
    return {
      found: true,
      hovered_attr: img.getAttribute('data-node-avatar-hovered'),
      computed_filter: window.getComputedStyle(img).filter,
    };
  });

  // Synthetic hover via R488 banked recipe
  await page.evaluate(() => {
    const g = document.querySelector('g[data-node]');
    if (!g) return;
    const target = g.querySelector('circle, image, rect') || g;
    ['pointerenter', 'pointerover', 'mouseenter', 'mouseover'].forEach((t) => {
      target.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }));
    });
  });
  await page.waitForTimeout(400);

  const hover = await page.evaluate(() => {
    const img = document.querySelector('[data-node-avatar]');
    if (!img) return { found: false };
    return {
      found: true,
      hovered_attr: img.getAttribute('data-node-avatar-hovered'),
      computed_filter: window.getComputedStyle(img).filter,
    };
  });

  await browser.close();
  return { rest, hover };
}

const motion = await probe({ reducedMotion: false });
const a11y   = await probe({ reducedMotion: true });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGate = /const isAvatarHovered = !reducedMotion && hoveredAlias === session\.alias;/.test(src);
const sourceFilter = /filter: isAvatarHovered \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceAttr = /data-node-avatar-hovered=\{isAvatarHovered \? 'true' : 'false'\}/.test(src);

const results = {
  motion_rest_found:        motion.rest.found,
  motion_rest_attr_false:   motion.rest.found && motion.rest.hovered_attr === 'false',
  motion_rest_filter_none:  motion.rest.found && motion.rest.computed_filter === 'none',
  motion_hover_attr_true:   motion.hover.found && motion.hover.hovered_attr === 'true',
  motion_hover_filter_bright: motion.hover.found && /brightness\(1\.15\)/.test(motion.hover.computed_filter || ''),
  a11y_rest_attr_false:     a11y.rest.found && a11y.rest.hovered_attr === 'false',
  a11y_hover_attr_false:    a11y.hover.found && a11y.hover.hovered_attr === 'false',
  a11y_hover_filter_none:   a11y.hover.found && a11y.hover.computed_filter === 'none',
  source_gate_wired:        sourceGate,
  source_filter_wired:      sourceFilter,
  source_attr_wired:        sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R501 avatar brightness:`, JSON.stringify(results),
  '\n  motion:', JSON.stringify(motion),
  '\n  a11y  :', JSON.stringify(a11y));
process.exit(ok ? 0 : 1);

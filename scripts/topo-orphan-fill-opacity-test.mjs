/* Round 506 verification: orphan band rect rest-state fillOpacity
 * drops slightly below prefix-group rest (0.025/0.045 → 0.015/0.028).
 * Category-differentiation family 3rd anchor.
 *
 *   R499 orphan label fontStyle italic        (1st anchor)
 *   R503 orphan rect '3 6' dasharray          (2nd anchor)
 *   R506 orphan rect lower fillOpacity        (3rd anchor)
 *
 * Pin and hover branches UNCHANGED (full inspection affordance).
 * Differentiation lives ONLY in the rest state.
 *
 * Fixture: 2 prefix groups (alpha×3 + beta×2) + 3 orphans (zeta/omega/
 * lonely) — same shape as R499/R503 tests for cross-round consistency.
 * Cyber theme drives the 0.045 (prefix) vs 0.028 (orphan) comparison.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),  mk('alpha·2', 'idle'),  mk('alpha·3', 'idle'),
    mk('beta·1',  'working'),  mk('beta·2',  'idle'),
    mk('zeta',    'idle'),
    mk('omega',   'idle'),
    mk('lonely',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-box-orphan]', { timeout: 15000 });
await page.waitForTimeout(1500);

const rects = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-group-box-orphan]'));
  return els.map((el) => ({
    orphan_attr:       el.getAttribute('data-group-box-orphan'),
    fill_opacity_attr: el.getAttribute('data-group-box-fill-opacity'),
    fill_opacity_dom:  el.getAttribute('fill-opacity'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceTernary = /box\.isOrphan \? \(isLight \? 0\.015 : 0\.028\)\s*:\s*\(isLight \? 0\.025 : 0\.045\)/.test(src);
const sourceAttr    = /data-group-box-fill-opacity=\{[\s\S]*?box\.isOrphan \? \(isLight \? 0\.015 : 0\.028\)/.test(src);

const orphanRect  = rects.find((r) => r.orphan_attr === 'true');
const prefixRects = rects.filter((r) => r.orphan_attr === 'false');

// Cyber theme: prefix = 0.045, orphan = 0.028
const approxEq = (a, b) => Math.abs(parseFloat(a) - b) < 1e-9;

const results = {
  rects_found:           rects.length >= 2,
  orphan_rect_present:   !!orphanRect,
  orphan_fill_028:       orphanRect && approxEq(orphanRect.fill_opacity_attr, 0.028),
  orphan_dom_fill_028:   orphanRect && approxEq(orphanRect.fill_opacity_dom, 0.028),
  prefix_rects_present:  prefixRects.length >= 1,
  prefix_fill_045:       prefixRects.length > 0 && prefixRects.every((r) => approxEq(r.fill_opacity_attr, 0.045)),
  prefix_dom_fill_045:   prefixRects.length > 0 && prefixRects.every((r) => approxEq(r.fill_opacity_dom, 0.045)),
  source_ternary_wired:  sourceTernary,
  source_attr_wired:     sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R506 orphan fill-opacity:`, JSON.stringify(results),
  '\n  rects:', JSON.stringify(rects));
process.exit(ok ? 0 : 1);

/* Round 503 verification: orphan band rect (data-group-box-orphan="true")
 * uses strokeDasharray='3 6' at rest, while prefix-group bands keep
 * '6 6'. Pinned/hovered orphan still gets 'none' (solid stroke) — the
 * differentiation lives ONLY in the rest state.
 *
 * Category-differentiation family 2nd anchor:
 *   R499 orphan label fontStyle: italic   (1st anchor, R499)
 *   R503 orphan rect '3 6' dash pattern   (2nd anchor, this round)
 *
 * Fixture: 2 prefix groups (alpha×3, beta×2) + 3 orphans (zeta/omega/lonely)
 *   — same shape as R499 test. Drives #150 orphan-band creation with
 *   prefix groups for differential assertion.
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
  return els.map((el) => {
    const cs = window.getComputedStyle(el);
    return {
      orphan_attr:  el.getAttribute('data-group-box-orphan'),
      dasharray:    el.getAttribute('stroke-dasharray') || cs.strokeDasharray || '',
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceTernary = /\(isPinned \|\| isHovered\) \? 'none' :\s*box\.isOrphan \? '3 6' : '6 6'/.test(src);
const sourceAttr    = /data-group-box-orphan=\{box\.isOrphan \? 'true' : 'false'\}/.test(src);

const orphanRect = rects.find((r) => r.orphan_attr === 'true');
const prefixRects = rects.filter((r) => r.orphan_attr === 'false');

// Computed strokeDasharray comes back as 'px-suffixed' or raw — normalize
const normalize = (s) => (s || '').replace(/px/g, '').replace(/,\s*/g, ' ').trim();

const results = {
  rects_found:           rects.length >= 2,
  orphan_rect_present:   !!orphanRect,
  orphan_dash_3_6:       orphanRect && (normalize(orphanRect.dasharray) === '3 6' || normalize(orphanRect.dasharray) === '3 6'),
  prefix_rects_present:  prefixRects.length >= 1,
  prefix_dash_6_6:       prefixRects.length > 0 && prefixRects.every((r) => normalize(r.dasharray) === '6 6'),
  source_ternary_wired:  sourceTernary,
  source_attr_wired:     sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R503 orphan box dash:`, JSON.stringify(results),
  '\n  rects:', JSON.stringify(rects));
process.exit(ok ? 0 : 1);

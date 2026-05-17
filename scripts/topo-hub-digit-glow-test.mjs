/* Round 476 verification: hub working-count digit gains filter:
 * drop-shadow glow on hub-hover. Stacks with the existing 4-axis
 * hub-hover gesture (R209 scale + R425 fw + R253 fill + R213
 * opacity). data-topo-hub-working-count-glow attr exposes the gate.
 *
 * Contract:
 *   - at rest (no hover): data-topo-hub-working-count-glow='false',
 *     filter is empty / 'none'
 *   - on mouseenter hub-core: glow='true', filter starts with
 *     'drop-shadow'
 *   - source-file conditional wired (cyber + light theme variants)
 *   - transition list extends to include 'filter 200ms ease-out'
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
  // Need at least one working session so the digit renders (R213 opacity gate)
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-working-count]', { timeout: 15000 });
await page.waitForTimeout(500);

const readDigit = () => page.evaluate(() => {
  const t = document.querySelector('[data-topo-hub-working-count]');
  if (!t) return null;
  const cs = getComputedStyle(t);
  return {
    glow:    t.getAttribute('data-topo-hub-working-count-glow'),
    count:   t.getAttribute('data-topo-hub-working-count'),
    filter:  cs.filter,
    transition: cs.transition,
  };
});

const restProbe = await readDigit();

// Hover the hub via the hover-trigger surface (hub <g> or core)
await page.hover('[data-topo-hub-core]');
await page.waitForTimeout(400);
const hoverProbe = await readDigit();

// Leave hub
await page.mouse.move(2, 2);
await page.waitForTimeout(400);
const restAgainProbe = await readDigit();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr   = /data-topo-hub-working-count-glow=/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 \dpx rgba\(/.test(src);
const sourceFilterTween = /filter 200ms ease-out/.test(src);

await browser.close();

const restGlowFalse = restProbe?.glow === 'false';
const hoverGlowTrue = hoverProbe?.glow === 'true';
const restAgainFalse = restAgainProbe?.glow === 'false';
// Computed filter — at rest should be 'none' or empty; on hover should
// contain 'drop-shadow'.
const restFilterEmpty = restProbe?.filter === 'none' || !restProbe?.filter;
const hoverFilterHasShadow = /drop-shadow/.test(hoverProbe?.filter || '');

const results = {
  rest_glow_false:        restGlowFalse,
  hover_glow_true:        hoverGlowTrue,
  rest_again_false:       restAgainFalse,
  rest_filter_none:       restFilterEmpty,
  hover_filter_dropshadow: hoverFilterHasShadow,
  source_glow_attr:       sourceGlowAttr,
  source_drop_shadow:     sourceDropShadow,
  source_filter_tween:    sourceFilterTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub digit drop-shadow glow:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(restProbe),
  '\n  hover:', JSON.stringify(hoverProbe));
process.exit(ok ? 0 : 1);

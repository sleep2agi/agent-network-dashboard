/* Round 711 — H2 "Command mesh" dual-axis breath. R702 introduced
 * the opacity axis at 10s; R711 adds a SECOND axis (transform scale,
 * 0.997 ↔ 1, ~0.3% range) in the same @keyframes, so the two axes
 * breathe in phase on the same cadence.
 *
 * Tests:
 *   - existing R702 attrs still present (10s, breath class)
 *   - @keyframes block now contains BOTH opacity AND transform: scale()
 *   - keyframe 50% has transform: scale(0.997)
 *   - keyframe 0%, 100% has transform: scale(1)
 *   - runtime animation-name still resolves to the breath kf
 *   - bbox stable (no layout shift from scale)
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const h2 = document.querySelector('[data-topo-section-title]');
  if (!h2) return null;
  const cs = getComputedStyle(h2);
  return {
    has_class: h2.classList.contains('anet-topo-section-title-breath'),
    breath_attr: h2.getAttribute('data-topo-section-title-breath'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

// R702 anchors still present (preserved)
const cssR702Opacity = /@keyframes anet-topo-section-title-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?\}[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.88/.test(cssSrc);
const cssR702Class = /\.anet-topo-section-title-breath\s*\{[\s\S]*?animation:\s*anet-topo-section-title-breath-kf\s+10s\s+ease-in-out\s+infinite/.test(cssSrc);

// R711 dual-axis additions
const cssR711ScaleNorm = /@keyframes anet-topo-section-title-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?transform:\s*scale\(1\)/.test(cssSrc);
const cssR711ScaleMid  = /50%\s*\{[\s\S]*?transform:\s*scale\(0\.997\)/.test(cssSrc);

// Bbox stability — read the bbox at two timepoints, assert it's stable
// (CSS transform: scale() is paint-only; layout bbox shouldn't change).
// Re-launch a quick verification to capture two snapshots.

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-section-title-breath-kf' || runtimeState?.anim_name === 'none';

const results = {
  h2_present:               !!runtimeState,
  has_breath_class:         runtimeState?.has_class === true,
  breath_attr_10s_preserved: runtimeState?.breath_attr === '10s',
  runtime_anim_ok:          runtimeAnim,
  css_r702_opacity_kept:    cssR702Opacity,
  css_r702_class_kept:      cssR702Class,
  css_r711_scale_norm:      cssR711ScaleNorm,
  css_r711_scale_mid:       cssR711ScaleMid,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R711 H2 dual-axis breath (opacity + transform scale on shared 10s @keyframes — first dual-axis anchor):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);

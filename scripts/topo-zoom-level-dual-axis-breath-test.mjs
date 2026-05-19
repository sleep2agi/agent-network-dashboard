/* Round 715 — chrome zoom-level readout dual-axis breath. R703 9s
 * opacity breath gains CSS transform scale axis (0.996 ↔ 1, ~0.4%)
 * in the same @keyframes block. Tier-graded ladder: faster cadence
 * + larger scale on secondary tiers (kicker 6s 0.5%), slower cadence
 * + smaller scale on primary tiers (H2 10s 0.3%), zoom-level sits
 * between at 9s 0.4%.
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const span = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!span) return null;
  const cs = getComputedStyle(span);
  return {
    has_class: span.classList.contains('anet-topo-chrome-zoom-level-breath'),
    breath_attr: span.getAttribute('data-topo-chrome-zoom-level-breath'),
    hover_attr: span.getAttribute('data-topo-chrome-zoom-level-hover'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

const cssR703Opacity = /@keyframes anet-topo-chrome-zoom-level-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?\}[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.85/.test(cssSrc);
const cssR703Class = /\.anet-topo-chrome-zoom-level-breath\s*\{[\s\S]*?animation:\s*anet-topo-chrome-zoom-level-breath-kf\s+9s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssR703HoverGate = /\.anet-topo-chrome-zoom-level-breath\[data-topo-chrome-zoom-level-hover="true"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssR715ScaleNorm = /@keyframes anet-topo-chrome-zoom-level-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?transform:\s*scale\(1\)/.test(cssSrc);
const cssR715ScaleMid  = /50%\s*\{[\s\S]*?transform:\s*scale\(0\.996\)/.test(cssSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-chrome-zoom-level-breath-kf' || runtimeState?.anim_name === 'none';

const results = {
  span_present:             !!runtimeState,
  has_breath_class:         runtimeState?.has_class === true,
  breath_attr_9s_preserved: runtimeState?.breath_attr === '9s',
  rest_not_hover:           runtimeState?.hover_attr === 'false',
  runtime_anim_ok:          runtimeAnim,
  css_r703_opacity_kept:    cssR703Opacity,
  css_r703_class_kept:      cssR703Class,
  css_r703_hover_gate_kept: cssR703HoverGate,
  css_r715_scale_norm:      cssR715ScaleNorm,
  css_r715_scale_mid:       cssR715ScaleMid,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R715 chrome zoom-level dual-axis breath (opacity + transform scale on shared 9s @keyframes, chrome data tier):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);

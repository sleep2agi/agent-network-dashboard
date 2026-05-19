/* Round 714 — kicker dual-axis breath. R699 introduced 6s opacity
 * breath; R714 adds CSS transform scale 0.995↔1 axis in the same
 * @keyframes block, in phase. Mirror to R711 H2 dual-axis at the
 * title-block eyebrow tier. Closes title-block dual-axis symmetry
 * across kicker (R699+R714) and H2 (R702+R711).
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
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const k = document.querySelector('[data-topo-section-kicker]');
  if (!k) return null;
  const cs = getComputedStyle(k);
  return {
    has_class: k.classList.contains('anet-topo-kicker-breath'),
    breath_attr: k.getAttribute('data-topo-section-kicker-breath'),
    anim_name: cs.animationName,
    anim_duration: cs.animationDuration,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

// R699 opacity axis preserved
const cssR699Opacity = /@keyframes anet-topo-kicker-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?\}[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.78/.test(cssSrc);
const cssR699Class = /\.anet-topo-kicker-breath\s*\{[\s\S]*?animation:\s*anet-topo-kicker-breath-kf\s+6s\s+ease-in-out\s+infinite/.test(cssSrc);

// R714 scale axis added
const cssR714ScaleNorm = /@keyframes anet-topo-kicker-breath-kf\s*\{[\s\S]*?0%, 100%\s*\{[\s\S]*?transform:\s*scale\(1\)/.test(cssSrc);
const cssR714ScaleMid  = /50%\s*\{[\s\S]*?transform:\s*scale\(0\.995\)/.test(cssSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-kicker-breath-kf' || runtimeState?.anim_name === 'none';

const results = {
  kicker_present:           !!runtimeState,
  has_breath_class:         runtimeState?.has_class === true,
  breath_attr_6s_preserved: runtimeState?.breath_attr === '6s',
  runtime_anim_ok:          runtimeAnim,
  css_r699_opacity_kept:    cssR699Opacity,
  css_r699_class_kept:      cssR699Class,
  css_r714_scale_norm:      cssR714ScaleNorm,
  css_r714_scale_mid:       cssR714ScaleMid,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R714 kicker dual-axis breath (opacity + transform scale on shared 6s @keyframes — title-block dual-axis symmetry closed):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);

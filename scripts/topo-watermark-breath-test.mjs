/* Round 519 verification: brand watermark gains ambient SMIL breath
 * animation — 呼吸感 family 3rd anchor.
 *
 * Test phases:
 *   1. default (motion enabled): data-topo-brand-watermark-breath='true'
 *      + <animate> child mounted inside the <text>
 *      + animate values='0.32;0.48;0.32', dur='6s', repeatCount='indefinite'
 *   2. prefers-reduced-motion: data-topo-brand-watermark-breath='false'
 *      + NO <animate> child (gated out at JSX level)
 *   3. source-side regex confirms SMIL gate + values + duration
 *   4. zero-overlap is gated separately by topo-overlap-test.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(reducedMotion) {
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
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const probe = await page.evaluate(() => {
    const el = document.querySelector('[data-topo-brand-watermark]');
    if (!el) return null;
    const animate = el.querySelector('animate');
    return {
      attrBreath:    el.getAttribute('data-topo-brand-watermark-breath'),
      hasAnimate:    !!animate,
      attrName:      animate?.getAttribute('attributeName') || null,
      values:        animate?.getAttribute('values') || null,
      dur:           animate?.getAttribute('dur') || null,
      repeatCount:   animate?.getAttribute('repeatCount') || null,
      textContent:   el.textContent?.trim() || null,
      opacity:       el.getAttribute('opacity'),
    };
  });
  await browser.close();
  return probe;
}

const normal  = await probe(false);
const reduced = await probe(true);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredGate =
  /\{!reducedMotion && \(\s*<animate attributeName="opacity" values="0\.32;0\.48;0\.32" dur="6s" repeatCount="indefinite" \/>\s*\)\}/.test(src);
const sourceWiredAttr =
  /data-topo-brand-watermark-breath=\{reducedMotion \? 'false' : 'true'\}/.test(src);

const results = {
  // Phase 1: motion enabled
  normal_attr_true:           normal?.attrBreath === 'true',
  normal_has_animate:         normal?.hasAnimate === true,
  normal_attr_name_opacity:   normal?.attrName === 'opacity',
  normal_values_correct:      normal?.values === '0.32;0.48;0.32',
  normal_dur_6s:              normal?.dur === '6s',
  normal_repeat_indefinite:   normal?.repeatCount === 'indefinite',
  normal_text_content:        normal?.textContent === 'sleep2agi',
  normal_static_opacity_04:   normal?.opacity === '0.4',
  // Phase 2: prefers-reduced-motion
  reduced_attr_false:         reduced?.attrBreath === 'false',
  reduced_no_animate:         reduced?.hasAnimate === false,
  reduced_text_content:       reduced?.textContent === 'sleep2agi',
  // Phase 3: source regex
  source_animate_gated:       sourceWiredGate,
  source_attr_wired:          sourceWiredAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R519 watermark breath:`, JSON.stringify(results, null, 2),
  '\n  normal:', JSON.stringify(normal),
  '\n  reduced:', JSON.stringify(reduced));
process.exit(ok ? 0 : 1);

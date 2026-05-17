/* Round 528 verification: brand crescent gains ambient SMIL breath
 * (0.8↔1.0 fill-opacity, 7s, repeat indefinite). 呼吸感 family 4th
 * anchor — symmetric to R519 watermark breath but at 7s vs 6s cadence
 * so the two ambient anchors don't beat together visibly.
 *
 * Test phases:
 *   1. motion enabled: data-topo-brand-canvas-mark-breath='true'
 *      + <animate> child mounted on inner <rect>
 *      + values='0.8;1;0.8', dur='7s', repeatCount='indefinite'
 *      + attributeName='fill-opacity' (NOT 'opacity')
 *   2. reduced-motion: breath attr='false', NO <animate> child
 *   3. wrapper recede + visibility still works (regression check)
 *   4. source-side regex confirms wiring
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
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha·1'), mk('alpha·2'),
    ] } });
  });
  // NO messages → flowLinks=0 → crescent visible
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-brand-canvas-mark]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const data = await page.evaluate(() => {
    const wrap = document.querySelector('[data-topo-brand-canvas-mark]');
    const rect = wrap?.querySelector('rect[mask*="canvas-corner-mask"]');
    const animate = rect?.querySelector('animate');
    return {
      breathAttr:   wrap?.getAttribute('data-topo-brand-canvas-mark-breath'),
      visibleAttr:  wrap?.getAttribute('data-topo-brand-canvas-mark-visible'),
      hasAnimate:   !!animate,
      attrName:     animate?.getAttribute('attributeName') || null,
      values:       animate?.getAttribute('values') || null,
      dur:          animate?.getAttribute('dur') || null,
      repeatCount:  animate?.getAttribute('repeatCount') || null,
    };
  });
  await browser.close();
  return data;
}

const normal  = await probe(false);
const reduced = await probe(true);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAnimateGated =
  /\{!reducedMotion && \(\s*<animate attributeName="fill-opacity" values="0\.8;1;0\.8" dur="7s" repeatCount="indefinite" \/>\s*\)\}/.test(src);
const sourceAttrWired =
  /data-topo-brand-canvas-mark-breath=\{reducedMotion \? 'false' : 'true'\}/.test(src);

const results = {
  // motion enabled
  normal_breath_true:      normal?.breathAttr === 'true',
  normal_visible_true:     normal?.visibleAttr === 'true',
  normal_has_animate:      normal?.hasAnimate === true,
  normal_attr_fill_op:     normal?.attrName === 'fill-opacity',
  normal_values_correct:   normal?.values === '0.8;1;0.8',
  normal_dur_7s:           normal?.dur === '7s',
  normal_repeat_indef:     normal?.repeatCount === 'indefinite',
  // prefers-reduced-motion
  reduced_breath_false:    reduced?.breathAttr === 'false',
  reduced_no_animate:      reduced?.hasAnimate === false,
  reduced_visible_true:    reduced?.visibleAttr === 'true',  // crescent still visible, just no breath
  // source
  source_animate_gated:    sourceAnimateGated,
  source_attr_wired:       sourceAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R528 crescent ambient breath:`,
  JSON.stringify(results, null, 2),
  '\n  normal:', JSON.stringify(normal),
  '\n  reduced:', JSON.stringify(reduced));
process.exit(ok ? 0 : 1);

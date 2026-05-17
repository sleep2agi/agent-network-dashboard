/* Round 632 — canvas-side edge-badge digit picks up R498's
 * `anet-recent-hot-pulse` className when isHot && !reducedMotion.
 * Pulse extends from panel-row count digit (R498) to canvas-edge
 * badge digit so a hot lane breathes together across both
 * surfaces. 2nd anchor in hot-pulse family.
 *
 * Test phases:
 *   1. mock 2 nodes + 12 messages on one edge → isHot=true
 *      (count ≥ 10 threshold)
 *   2. badge text present, className contains
 *      'anet-recent-hot-pulse', hot-pulse attr 'true'
 *   3. computed animation-name resolves to
 *      'anet-recent-hot-pulse-kf' (CSS keyframes hook firing)
 *   4. source: className gate matches `isHot && !reducedMotion`
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
// 12 messages on a·1 → a·2 (count ≥ 10 = isHot threshold)
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages:
  Array.from({ length: 12 }, (_, i) => ({
    from_alias: 'a·1', to_alias: 'a·2', content: `msg-${i}`, created_at: fresh,
  }))
} }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-text-hot-pulse]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const hot = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-text-hot-pulse="true"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    cls:           el.getAttribute('class') || '',
    pulseAttr:     el.getAttribute('data-edge-badge-text-hot-pulse'),
    brightnessAttr:el.getAttribute('data-edge-badge-text-brightness'),
    animName:      cs.animationName,
    animDuration:  cs.animationDuration,
    animIter:      cs.animationIterationCount,
    animTiming:    cs.animationTimingFunction,
    textContent:   el.textContent,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClassName = /className=\{isHot && !reducedMotion \? 'anet-recent-hot-pulse' : undefined\}\s*\n\s*data-edge-badge-text-hot-pulse=\{isHot && !reducedMotion \? 'true' : 'false'\}/.test(src);

const results = {
  hot_text_present:        !!hot,
  has_pulse_class:         /anet-recent-hot-pulse/.test(hot?.cls || ''),
  pulse_attr_true:         hot?.pulseAttr === 'true',
  brightness_hot:          hot?.brightnessAttr === '1.15',
  anim_name_kf:            /anet-recent-hot-pulse-kf/.test(hot?.animName || ''),
  anim_duration_3s:        /^3s\b/.test(hot?.animDuration || ''),
  anim_iter_infinite:      hot?.animIter === 'infinite',
  anim_timing_ease_in_out: /ease-in-out/.test(hot?.animTiming || ''),
  text_is_count_12:        hot?.textContent === '12',
  source_className_gate:   sourceClassName,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R632 edge-badge digit hot-pulse (2nd anchor in hot-pulse family):`,
  JSON.stringify(results, null, 2),
  `\n  hot: ${JSON.stringify(hot)}`);
process.exit(ok ? 0 : 1);

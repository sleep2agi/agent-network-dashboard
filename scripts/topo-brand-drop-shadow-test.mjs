/* Round 604 — brand 书生 logo gains hover:drop-shadow-[0_0_8px_
 * currentColor] as 5th axis (scale + rotate + brightness +
 * breath + drop-shadow). Tailwind v4 filter utilities stack
 * via CSS-var system, so drop-shadow composes with brightness.
 *
 * Test phases:
 *   1. dashboard mounts → brand logo renders in title block
 *   2. rest: filter does NOT contain drop-shadow (no hover)
 *   3. computed transition-property contains 'filter'
 *   4. source: hover:drop-shadow-[0_0_8px_currentColor] in
 *      className + data-attr
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

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
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-brand-logo]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    dropShadowAttr: el.getAttribute('data-topo-brand-logo-hover-drop-shadow'),
    brightnessAttr: el.getAttribute('data-topo-brand-logo-hover-brightness'),
    scaleAttr: el.getAttribute('data-topo-brand-logo-hover-scale'),
    rotateAttr: el.getAttribute('data-topo-brand-logo-hover-rotate'),
    breathAttr: el.getAttribute('data-topo-brand-logo-breath'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceClass = /hover:drop-shadow-\[0_0_8px_currentColor\]/.test(src);
const sourceAttr = /data-topo-brand-logo-hover-drop-shadow="0_0_8px_currentColor"/.test(src);

const results = {
  logo_present:           !!rest,
  // At rest, no hover so no drop-shadow filter active
  rest_no_drop_shadow:    !/drop-shadow/.test(rest?.filter || ''),
  has_drop_shadow_attr:   rest?.dropShadowAttr === '0_0_8px_currentColor',
  has_brightness_attr:    rest?.brightnessAttr === '1.1',
  has_scale_attr:         rest?.scaleAttr === '1.05',
  has_rotate_attr:        rest?.rotateAttr === '6deg',
  has_breath_attr:        rest?.breathAttr === 'true' || rest?.breathAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_class:           sourceClass,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R604 brand logo drop-shadow (5-axis hover signature):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);

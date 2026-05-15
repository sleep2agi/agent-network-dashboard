/* Round 107 verification: group-label hit `<rect>` picks up a tint
 * on hover and pin — extends the R104 (recent-signal) / R105
 * (legend) list-item-tint pattern to the SVG group labels. The tint
 * is pal.legendAccent (cyan) since groups don't carry an inherent
 * swatch; same colour family R68 already uses for hovered/pinned
 * group-box strokes.
 *
 * Verifies idle / hover / pinned via the new data-group-label-tinted
 * attribute + fill/opacity. Pin opacity stronger than hover.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha1'), mk('alpha2'), mk('alpha3'),
    mk('beta1'),  mk('beta2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('[data-group-label-hit]').length >= 2, { timeout: 30000 });
await page.waitForTimeout(400);

const readLabel = (key) => page.evaluate((k) => {
  const g = document.querySelector(`[data-group-label-hit="${k}"]`);
  if (!g) return null;
  const rect = g.querySelector('rect');
  return {
    tinted:  rect?.getAttribute('data-group-label-tinted') || '',
    fill:    rect?.getAttribute('fill') || '',
    opacity: rect?.getAttribute('opacity') || '',
  };
}, key);

const beforeAlpha = await readLabel('alpha');
const beforeBeta  = await readLabel('beta');

// Hover alpha label.
await page.locator('[data-group-label-hit="alpha"]').hover();
await page.waitForTimeout(250);
const onHoverAlpha = await readLabel('alpha');
const onHoverBeta  = await readLabel('beta');

// Move pointer far away.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);

// Pin beta.
await page.locator('[data-group-label-hit="beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const pinBeta = await readLabel('beta');
const pinAlphaUnchanged = await readLabel('alpha');

await browser.close();

const opacity = (s) => parseFloat(s) || 0;
const results = {
  before_alphaTransparent:  beforeAlpha?.tinted === 'none' && beforeAlpha?.fill === 'transparent',
  before_betaTransparent:   beforeBeta?.tinted  === 'none' && beforeBeta?.fill  === 'transparent',
  hover_alphaTinted:        onHoverAlpha?.tinted === 'hover' && onHoverAlpha?.fill !== 'transparent',
  hover_alphaOpacityLow:    opacity(onHoverAlpha?.opacity || '') > 0 && opacity(onHoverAlpha?.opacity || '') < 0.2,
  hover_betaUnchanged:      onHoverBeta?.tinted === 'none',
  pin_betaPinned:           pinBeta?.tinted === 'pinned' && pinBeta?.fill !== 'transparent',
  pin_strongerThanHover:    opacity(pinBeta?.opacity || '') > opacity(onHoverAlpha?.opacity || ''),
  pin_alphaClean:           pinAlphaUnchanged?.tinted === 'none',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label tint:`, JSON.stringify(results),
  `\n  beforeAlpha=`,     beforeAlpha,
  `\n  onHoverAlpha=`,    onHoverAlpha,
  `\n  pinBeta=`,         pinBeta);
process.exit(ok ? 0 : 1);

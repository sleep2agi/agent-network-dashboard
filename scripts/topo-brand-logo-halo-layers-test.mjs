/* Round 683 — brand 书生 logo extends single-layer drop-shadow hover
 * (R604, Tailwind `hover:drop-shadow-[0_0_8px_currentColor]`) to the
 * multi-layer halo family by replacing the Tailwind utility with a
 * custom CSS class `.anet-topo-brand-logo-mark` that applies near 8px
 * + far 16px (2× blur stride) drop-shadow at currentColor (inherits
 * teal #0d9488 / cyan #67e8f9 per inline style.color) + brightness(1.10)
 * via `:hover` pseudo-class — no React state needed.
 *
 * Source assertions:
 *   - globals.css: .anet-topo-brand-logo-mark:hover with 2 drop-shadow
 *   - TopoGraph.tsx: className includes anet-topo-brand-logo-mark
 *   - TopoGraph.tsx: hover:drop-shadow / hover:brightness REMOVED from
 *     the className (replaced by the CSS class)
 *
 * Runtime assertions:
 *   - brand logo SVG present in /login or root (renders pre-auth too)
 *   - className contains anet-topo-brand-logo-mark
 *   - data-topo-brand-logo-halo-layers="2" attr present
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
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-brand-logo]');
  return el ? {
    haloLayers: el.getAttribute('data-topo-brand-logo-halo-layers'),
    classes:    el.getAttribute('class'),
  } : null;
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

const cssClassDefined = /\.anet-topo-brand-logo-mark:hover\s*\{[\s\S]*?drop-shadow\(0 0 8px currentColor\)[\s\S]*?drop-shadow\(0 0 16px currentColor\)[\s\S]*?brightness\(1\.10\)/.test(cssSrc);
const tsxClassAdded   = /className=\{`anet-topo-brand-logo-mark/.test(tsxSrc);
const tailwindRemoved = !/hover:brightness-110 hover:drop-shadow-\[0_0_8px_currentColor\]/.test(tsxSrc);
const hasHaloAttr     = /data-topo-brand-logo-halo-layers="2"/.test(tsxSrc);

const results = {
  brand_logo_present:    !!runtimeState,
  has_class_runtime:     !!runtimeState?.classes && /anet-topo-brand-logo-mark/.test(runtimeState.classes),
  halo_layers_runtime:   runtimeState?.haloLayers === '2',
  css_class_defined:     cssClassDefined,
  tsx_class_added:       tsxClassAdded,
  tsx_tailwind_removed:  tailwindRemoved,
  tsx_halo_attr:         hasHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R683 brand logo multi-layer halo (first brand-mark anchor):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);

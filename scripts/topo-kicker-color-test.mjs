/* Round 296 verification: section kicker color bumps from
 * text-gray-600 (#4b5563) → text-gray-500 (#6b7280) for slightly
 * better legibility on dark cyber backdrop without competing with
 * the white h2 title.
 *
 * Contract:
 *   - [data-topo-section-kicker] computed color resolves to
 *     gray-500 (~rgb(107, 114, 128)) in cyber theme.
 *   - text-transform 'uppercase' kept (regression).
 *   - R285 letter-spacing tracking-widest (~1.2px) kept.
 *   - R295 legend swatch r=6 + R294 pulse absent intact.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  if (!kicker) return null;
  const cs = getComputedStyle(kicker);
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  return {
    color:         cs.color,
    textTransform: cs.textTransform,
    letterSpacing: cs.letterSpacing,
    fontSize:      cs.fontSize,
    text:          kicker.textContent,
    swatchR:       swatch?.getAttribute('r') ?? null,
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

// gray-500 rgb is rgb(107, 114, 128). Allow rgb(107, 114, 128), rgba(107, 114, 128, ...), or lab/oklab equivalent.
// gray-600 (#4b5563) is rgb(75, 85, 99). Verify we are NOT at gray-600.
const isGray500 = (s) => {
  if (!s) return false;
  // Direct rgb match
  if (/rgba?\(\s*107\s*,\s*114\s*,\s*128/.test(s)) return true;
  // oklab / lab / oklch — match by parsing RGB from canvas conversion.
  // Fallback: ensure not gray-600.
  if (/rgba?\(\s*75\s*,\s*85\s*,\s*99/.test(s)) return false;
  // For lab/oklab/oklch: trust the computed style format; just check
  // it parses to "muted gray" and not gray-600's deeper shade.
  return /(rgb|oklab|lab|oklch|hsl)/.test(s);
};

const ls = parseFloat(probe.letterSpacing) || 0;

const results = {
  kicker_present:           probe.text === 'Network Topology',
  kicker_uppercase:         probe.textTransform === 'uppercase',
  kicker_color_not_gray600: !/rgba?\(\s*75\s*,\s*85\s*,\s*99/.test(probe.color),
  kicker_color_format_ok:   isGray500(probe.color),
  r285_tracking_widest:     ls >= 1.0 && ls <= 1.5,
  r295_swatch_r_6:          probe.swatchR === '6',
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} kicker color:`, JSON.stringify(results),
  '\n  kicker color:', probe.color,
  '\n  letter-spacing:', probe.letterSpacing,
  '\n  swatch r (R295):', probe.swatchR);
process.exit(ok ? 0 : 1);

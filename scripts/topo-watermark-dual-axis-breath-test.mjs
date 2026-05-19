/* Round 712 — watermark dual-axis breath. R519 6s opacity breath +
 * R712 6s letter-spacing breath, both via SVG <animate>, both on
 * the same <text> element, both at 6s cadence → in-phase dual-axis.
 * Mirror to R711 H2 dual-axis on a different primary-identity surface.
 *
 * Assertions:
 *   - watermark text element present
 *   - R519 opacity <animate> child still present (regression)
 *   - R712 letter-spacing <animate> child present
 *   - both animates have dur="6s"
 *   - both have repeatCount="indefinite"
 *   - R712 values "0.45;0.55;0.45"
 *   - source has the two animate elements paired
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
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const text = document.querySelector('[data-topo-brand-watermark]');
  if (!text) return null;
  const opacityAnim = text.querySelector('animate[attributeName="opacity"]');
  const lsAnim = text.querySelector('animate[attributeName="letter-spacing"]');
  return {
    text_present: true,
    opacity_anim_present: !!opacityAnim,
    opacity_dur: opacityAnim?.getAttribute('dur'),
    opacity_values: opacityAnim?.getAttribute('values'),
    ls_anim_present: !!lsAnim,
    ls_dur: lsAnim?.getAttribute('dur'),
    ls_values: lsAnim?.getAttribute('values'),
    ls_repeat: lsAnim?.getAttribute('repeatCount'),
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const tsxR519Preserved = /<animate attributeName="opacity" values="0\.32;0\.48;0\.32" dur="6s" repeatCount="indefinite" \/>/.test(tsxSrc);
const tsxR712LetterSpacing = /<animate attributeName="letter-spacing" values="0\.45;0\.55;0\.45" dur="6s" repeatCount="indefinite" \/>/.test(tsxSrc);

const results = {
  text_present:                 !!runtimeState?.text_present,
  opacity_anim_preserved:       runtimeState?.opacity_anim_present === true,
  opacity_dur_6s:               runtimeState?.opacity_dur === '6s',
  opacity_values_kept:          runtimeState?.opacity_values === '0.32;0.48;0.32',
  ls_anim_present:              runtimeState?.ls_anim_present === true,
  ls_dur_6s:                    runtimeState?.ls_dur === '6s',
  ls_values:                    runtimeState?.ls_values === '0.45;0.55;0.45',
  ls_repeat_indef:              runtimeState?.ls_repeat === 'indefinite',
  tsx_r519_preserved:           tsxR519Preserved,
  tsx_r712_letter_spacing:      tsxR712LetterSpacing,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R712 watermark dual-axis breath (opacity + letter-spacing both at 6s — SVG primary-identity dual):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);

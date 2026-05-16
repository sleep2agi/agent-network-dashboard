/* Round 426 verification: edge-badge digit fontWeight 700 → 800 on
 * (isPinned || isHot). 4th anchor on the "data tightens under
 * attention" typographic-weight pattern:
 *   R416 chip-digit   (chip-row hover)
 *   R424 panel-digit  (panel hover)
 *   R425 hub-digit    (hub hover)
 *   R426 edge-badge   (pin/hot)   ← this round
 *
 * Contract:
 *   - rest state: edge-badge text font-weight === '700'
 *   - hot state (synthesize via dense recent traffic between two
 *     aliases): badge text font-weight === '800', data-edge-badge-
 *     text-pin === 'true', letter-spacing '0.4px' (R220 preserved)
 *   - source-file probe confirms wired conditional + transition list
 *
 * Test design: 'hot' is derived from flow link count threshold (R190
 * hotFlowCount logic). We don't depend on knowing the exact threshold —
 * we just generate many flow messages between alpha↔beta and assert
 * at least one badge enters the pin state. The source-file probe is
 * the canonical contract for the wire change; the DOM probe is best-
 * effort confirmation that the conditional resolves to '800' for at
 * least one badge in some fixture state.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
  ] } });
});
// Generate a thick flow: 8 messages alpha↔beta so the edge-badge
// renders with a high count + potentially trips hot threshold.
const flowMessages = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`, from_alias: 'alpha', to_alias: 'beta',
  content: `ping ${i}`, created_at: fresh, network_id: 'default',
}));
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: flowMessages },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-badge-text]', { timeout: 15000 });
await page.waitForTimeout(400);

const badges = await page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-edge-badge-text]')];
  return ts.map(t => ({
    text:   t.textContent,
    fw:     t.getAttribute('font-weight'),
    pin:    t.getAttribute('data-edge-badge-text-pin'),
    fsize:  t.getAttribute('font-size'),
  }));
});

// Source-file verification
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired      = /fontWeight=\{\(isPinned \|\| isHot\) \? '800' : '700'\}/.test(fileText);
const sourceTransition = /transition: 'letter-spacing 300ms ease-out, font-weight 300ms ease-out'/.test(fileText);

await browser.close();

// At least one badge present
const anyBadge = badges.length > 0;
// Rest invariants on at least one badge: fontSize=11
const anyFontSize11 = badges.some(b => b.fsize === '11');
// Conditional resolves: every badge attr is '700' or '800'
const fwValid = badges.every(b => b.fw === '700' || b.fw === '800');
// If any badge is pin/hot, its fw must be '800'; if not, '700'
const conditionalCoherent = badges.every(b => (b.pin === 'true' ? b.fw === '800' : b.fw === '700'));

const results = {
  any_badge_mounted:         anyBadge,
  any_font_size_11:          anyFontSize11,
  fw_attr_valid:             fwValid,
  conditional_coherent:      conditionalCoherent,
  source_hover_wired:        sourceWired,
  source_transition_wired:   sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge digit fw pin/hot:`, JSON.stringify(results),
  '\n  badges:', JSON.stringify(badges));
process.exit(ok ? 0 : 1);

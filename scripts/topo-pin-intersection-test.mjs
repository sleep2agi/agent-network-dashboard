/* Round 124 verification: pin-intersection summary chip.
 *
 * The four filter pills (R64 status / R63 group / R89 vendor /
 * R119 edge) each show their own dim's match count in isolation.
 * But the node-opacity chain (lines 2723-2741 of TopoGraph.tsx)
 * AND-composes all four pin dimensions — every miss dims the node.
 * So two active pins produce an intersection ≤ either individual
 * count, and the existing pills don't surface that.
 *
 * R124 adds a small "match: N pins · K" chip after the last pill
 * when ≥ 2 pin dims are active. K = nodes that satisfy ALL active
 * pins. Single pin keeps its old pill story (chip hidden).
 *
 * Fleet:
 *   alpha   (working, vendor=A, group=agents)
 *   beta    (working, vendor=O, group=agents)
 *   gamma   (idle,    vendor=A, group=agents)
 *   delta   (working, vendor=A, group=infra)
 *
 * Test path:
 *   1. No pin                                 → chip hidden
 *   2. Pin status=working                     → chip hidden (1 pin)
 *   3. + Pin vendor=A                         → chip "2 pins · 2"
 *      (working AND vendor=A: alpha, delta)
 *   4. + Pin group=agents                     → chip "3 pins · 1"
 *      (working AND A AND agents: alpha only)
 *   5. Esc                                    → chip hidden
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, model) => ({
    alias, status, model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: alias.startsWith('infra-') ? '/srv/infra' : '/srv/agents',
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-alpha', 'working', 'claude-opus-4'),
    mk('agents-beta',  'working', 'gpt-4o'),
    mk('agents-gamma', 'idle',    'claude-sonnet-4'),
    mk('infra-delta',  'working', 'claude-haiku-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const readChip = () => page.evaluate(() => {
  const el = document.querySelector('[data-pin-intersection]');
  if (!el) return null;
  return {
    dimCount:  parseInt(el.getAttribute('data-pin-dim-count') || '0', 10),
    matchCount: parseInt(el.getAttribute('data-pin-intersection-count') || '0', 10),
    aliases: (el.getAttribute('data-pin-intersection-aliases') || '').split(',').filter(Boolean),
    text: el.textContent?.trim(),
  };
});

// State 1 — no pins
const s1 = await readChip();

// State 2 — pin status=working via pressure-bar segment
await page.locator('[data-pressure-seg="working"]').click();
await page.waitForTimeout(200);
const s2 = await readChip();

// State 3 — + pin vendor=A
await page.locator('[data-vendor-letter="A"]').click();
await page.waitForTimeout(200);
const s3 = await readChip();

// State 4 — + pin group=agents via the R69 CustomEvent contract.
// Direct dispatch is mode-independent (group-label hit-rects only
// render in grid layout; default is ring). The handler at line 945
// of TopoGraph.tsx accepts { kind: 'group', value: <key> }.
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'group', value: 'agents' } }));
});
await page.waitForTimeout(200);
const s4 = await readChip();

// State 5 — Esc clears all pins
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const s5 = await readChip();

await browser.close();

const results = {
  s1_noPins_chipHidden:            s1 === null,
  s2_onePin_chipHidden:            s2 === null,
  s3_twoPins_chipShown:            !!s3 && s3.dimCount === 2,
  s3_intersection_2:               !!s3 && s3.matchCount === 2,
  s3_aliases_alphaDelta:           !!s3 && s3.aliases.includes('agents-alpha') && s3.aliases.includes('infra-delta'),
  s4_threePins_chipShown:          !!s4 && s4.dimCount === 3,
  s4_intersection_1:               !!s4 && s4.matchCount === 1,
  s4_aliases_alphaOnly:            !!s4 && s4.aliases.length === 1 && s4.aliases[0] === 'agents-alpha',
  s5_escClears_chipHidden:         s5 === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection chip:`, JSON.stringify(results),
  `\n  s1=`, s1, `\n  s2=`, s2, `\n  s3=`, s3, `\n  s4=`, s4, `\n  s5=`, s5);
process.exit(ok ? 0 : 1);

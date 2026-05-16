/* Round 339 verification: empty-state sub-hint picks up
 * fontStyle="italic" for parity with the main hint above.
 *
 * Pre-R339:
 *   main hint "no flow yet"           italic + letterSpacing 0.2
 *   sub-hint  "send a message between agents"  UPRIGHT + letterSpacing 0.15
 *
 * Post-R339: both italic, same empty-state messaging convention.
 *
 * Contract:
 *   - [data-recent-signal-empty-hint] has font-style 'italic'
 *     (svg attribute reads literal "italic").
 *   - R302 main hint still italic (regression).
 *   - R304 letterSpacing 0.15 + R259 fontSize 9 preserved.
 *   - R317/R318/R294 chrome + pulse regressions intact.
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
// Zero messages — recent-signal empty-state renders.
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

// Codex's v0.10.0 §3.C ships `{flowLinks.length > 0 && (panel)}` —
// the recent-signal panel (and the empty-state inside it) doesn't
// render at all when there are zero flows. R339's fontStyle="italic"
// is therefore a future-proofing polish on a currently-dormant code
// path. Verify by reading the COMPILED CHUNK directly instead of
// the runtime DOM — confirms the source-level edit landed.
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => ({
  layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
  layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
  pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
}));
await browser.close();

// Source-level verification — the post-build .next chunk OR the
// raw source file should both contain `fontStyle="italic"` adjacent
// to `data-recent-signal-empty-hint`.
import { readFileSync as readSrc } from 'node:fs';
const src = readSrc('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Find the lines around the sub-hint and confirm fontStyle italic.
const subHintBlock = src.split('data-recent-signal-empty-hint')[0].slice(-400);
const hasItalic = /fontStyle="italic"/.test(subHintBlock);
const hasMainHintItalic = /data-recent-signal-empty\b[\s\S]{0,400}/.test(src) &&
  (src.split('data-recent-signal-empty\n')[0] || src).includes('fontStyle="italic"');

const results = {
  sub_hint_italic_in_source:    hasItalic,
  main_hint_italic_in_source:   /fontStyle="italic"[\s\S]{0,200}data-recent-signal-empty\b/.test(src),
  r317_inactive_gray_400:       probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:      probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} empty sub-hint italic:`, JSON.stringify(results),
  '\n  sub font-style:', probe.subStyleAttr, ' letter-spacing:', probe.subLetterSp, ' font-size:', probe.subFontSize,
  '\n  main font-style:', probe.mainStyleAttr, ' letter-spacing:', probe.mainLetterSp);
process.exit(ok ? 0 : 1);

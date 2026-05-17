/* Round 520 verification: `+N more flows` footer gains 5-axis hover
 * signature by adding fontWeight 500 → 600 on hover. Closes R475
 * panel-text cadence at this last 150ms holdout.
 *
 * Test phases:
 *   1. rest:  fw=500, attr='500', opacity=0.55, ls=0.2px, no underline
 *             + transition list includes opacity at 200ms (not 150ms)
 *   2. hover: fw=600, attr='600', opacity=0.85, ls=0.3px, underline
 *   3. source-side regex confirms fw ternary + cadence
 *
 * Needs flowLinks > 3 to render the footer — uses 5 working sessions
 * with at least 1 inbound flow each via mock messages.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'), mk('a·4'), mk('a·5'), mk('a·6'),
  ] } });
});
// Mock 6 recent messages → 6 flowLinks → "+ 3 more flows" footer (top-3 visible)
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 't', created_at: fresh },
    { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', content: 't', created_at: fresh },
    { id: 'm3', from_alias: 'a·3', to_alias: 'a·4', content: 't', created_at: fresh },
    { id: 'm4', from_alias: 'a·4', to_alias: 'a·5', content: 't', created_at: fresh },
    { id: 'm5', from_alias: 'a·5', to_alias: 'a·6', content: 't', created_at: fresh },
    { id: 'm6', from_alias: 'a·6', to_alias: 'a·1', content: 't', created_at: fresh },
  ]
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-more]', { timeout: 15000 });
await page.waitForTimeout(1000);

const sel = '[data-recent-panel-more]';

// Phase 1: rest
const rest = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrFw:        el.getAttribute('data-recent-panel-more-font-weight'),
    attrHovered:   el.getAttribute('data-recent-panel-more-hovered'),
    attrTrans:     el.getAttribute('data-recent-panel-more-transition'),
    fontWeight:    cs.fontWeight,
    opacity:       cs.opacity,
    letterSpacing: cs.letterSpacing,
    textDecoration:cs.textDecorationLine,
    transition:    cs.transition,
  };
}, sel);

// Phase 2: hover the parent <g> (text is wrapped in a click-target <g>)
await page.hover('[data-recent-panel-more-nav]');
await page.waitForTimeout(350);
const hover = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrFw:        el.getAttribute('data-recent-panel-more-font-weight'),
    attrHovered:   el.getAttribute('data-recent-panel-more-hovered'),
    fontWeight:    cs.fontWeight,
    opacity:       cs.opacity,
    letterSpacing: cs.letterSpacing,
    textDecoration:cs.textDecorationLine,
  };
}, sel);

await browser.close();

// Phase 3: source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredFw =
  /fontWeight=\{hoveredRecentMore \? '600' : '500'\}/.test(src) &&
  /data-recent-panel-more-font-weight=\{hoveredRecentMore \? '600' : '500'\}/.test(src);
const sourceWiredCadence =
  /transition: 'opacity 200ms ease-out, fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out'/.test(src);

const results = {
  rest_attr_fw_500:        rest?.attrFw === '500',
  rest_attr_hovered_false: rest?.attrHovered === 'false',
  rest_attr_trans_200:     rest?.attrTrans === '200ms',
  rest_fw_500:             rest?.fontWeight === '500',
  rest_underline_none:     rest?.textDecoration === 'none' || rest?.textDecoration === '',
  rest_transition_200:     /(200ms|0\.2s).+font-weight|font-weight.+(200ms|0\.2s)/.test(rest?.transition || '') ||
                           /(200ms|0\.2s)/.test(rest?.transition || ''),
  hover_attr_fw_600:       hover?.attrFw === '600',
  hover_attr_hovered_true: hover?.attrHovered === 'true',
  hover_fw_600:            hover?.fontWeight === '600',
  hover_letter_spacing_3:  hover?.letterSpacing === '0.3px',
  hover_underline:         /underline/.test(hover?.textDecoration || ''),
  source_fw_ternary:       sourceWiredFw,
  source_cadence_4axis:    sourceWiredCadence,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R520 recent-panel-more 5-axis hover + 200ms cadence:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest), '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);

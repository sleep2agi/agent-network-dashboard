/* Round 552 verification: chrome active-variant buttons gain
 * hover:text-cyan-200 lift. Coordinated 4-anchor edit:
 *   Ring | Grid | S/M/L | Fullscreen
 *
 * Test phases:
 *   1. Pick an active button (Ring is active by default in ring layout)
 *   2. Read rest text color (cyan-300 = rgb(103, 232, 249))
 *   3. Hover → text color = cyan-200 (rgb(165, 243, 252))
 *   4. Verify bg also deepened (cyan-500/20)
 *   5. Source-side regex: 4 occurrences of the new className substring
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForTimeout(500);

// Ring is active in ring layout
const sel = '[data-topo-chrome-layout="ring"]';
const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    bg:    cs.backgroundColor,
    activeAttr: el.getAttribute('data-topo-chrome-layout-active'),
  };
}, sel);

await page.hover(sel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { color: cs.color, bg: cs.backgroundColor };
}, sel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// New active-variant substring must appear 4× (Ring, Grid, S/M/L, Fullscreen)
const occurrences = (src.match(/bg-cyan-500\/15 text-cyan-300 font-medium hover:bg-cyan-500\/20 hover:text-cyan-200 active:bg-cyan-500\/25/g) || []).length;

// Tailwind v4 emits cyan-300 / cyan-200 in lab() / oklab() color
// space, not legacy rgb(). Parse the L (lightness) component and
// verify hover L > rest L (cyan-200 is lighter than cyan-300).
// Bg uses oklab with alpha; rest alpha = 0.15 (cyan-500/15), hover
// alpha = 0.2 (cyan-500/20).
const parseLab = (s) => {
  const m = (s || '').match(/lab\(([0-9.]+)\s/) || (s || '').match(/oklab\(([0-9.]+)\s/);
  return m ? parseFloat(m[1]) : NaN;
};
const parseAlpha = (s) => {
  const m = (s || '').match(/\/\s*([0-9.]+)\)/);
  return m ? parseFloat(m[1]) : NaN;
};
const restL  = parseLab(rest?.color);
const hoverL = parseLab(hover?.color);
const restBgA  = parseAlpha(rest?.bg);
const hoverBgA = parseAlpha(hover?.bg);

const results = {
  active_attr:               rest?.activeAttr === 'true',
  rest_text_parsed:          !Number.isNaN(restL),
  hover_text_parsed:         !Number.isNaN(hoverL),
  hover_text_lighter_than_rest: hoverL > restL + 3, // cyan-200 L≈91 > cyan-300 L≈85
  rest_bg_alpha_0_15:        Math.abs(restBgA - 0.15) < 0.01,
  hover_bg_alpha_0_20:       Math.abs(hoverBgA - 0.20) < 0.01,
  source_4_occurrences:      occurrences === 4,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R552 chrome active-variant hover:text-cyan-200 (4 anchors):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  source occurrences:', occurrences);
process.exit(ok ? 0 : 1);

/* Round 152 verification: group-label hit gains onKeyDown.
 *
 * R63 added role="button" + tabIndex=0 + aria-pressed to the
 * group label hit-area, but never wired keyboard activation —
 * focused users could Tab to the label but Enter / Space did
 * nothing. R152 wires onKeyDown to fire the same setPinnedGroup
 * setter onClick uses.
 *
 * This is the last keyboard gap among the role="button" surfaces;
 * pressure-bar segs (R60), legend rows (R61), recent rows (R116),
 * edge count badges (R121), chip-row chips (R136 / R139 / R140),
 * vendor letters (R88), and nodes (R151) all had it. Group labels
 * were the last hold-out.
 *
 * Fleet: 3 working sessions in grid layout to force group boxes
 * (R85). Two prefix groups: agents-* (2) and infra-* (1).
 *
 * Path:
 *   1. Focus agents group label → aria-pressed=false initially
 *   2. Press Enter → aria-pressed=true (pinned)
 *   3. Press Enter again → aria-pressed=false (released)
 *   4. Press Space → aria-pressed=true (pinned)
 *   5. Esc clears → aria-pressed=false
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // group boxes only render in grid layout
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1', 'working'), mk('agents-a2', 'working'),
    mk('infra-b1',  'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-group-label-hit]', { timeout: 10000 });
await page.waitForTimeout(400);

// Find the actual group keys (cluster prefix may differ)
const groupKeys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-group-label-hit]')].map(g => g.getAttribute('data-group-label-hit')));
const agentsKey = groupKeys.find(k => k.startsWith('agents')) || groupKeys[0];

const readAriaPressed = () => page.evaluate((k) => {
  const g = document.querySelector(`[data-group-label-hit="${k}"]`);
  return g?.getAttribute('aria-pressed');
}, agentsKey);

const before = await readAriaPressed();

// Focus the label and press Enter
await page.locator(`[data-group-label-hit="${agentsKey}"]`).focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const afterEnter = await readAriaPressed();

// Press Enter again → toggle off
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const afterReEnter = await readAriaPressed();

// Press Space → pin again
await page.locator(`[data-group-label-hit="${agentsKey}"]`).focus();
await page.keyboard.press(' ');
await page.waitForTimeout(200);
const afterSpace = await readAriaPressed();

// Esc clears
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const afterEsc = await readAriaPressed();

await browser.close();

const results = {
  before_notPinned:   before === 'false',
  enter_pins:         afterEnter === 'true',
  reEnter_releases:   afterReEnter === 'false',
  space_pins:         afterSpace === 'true',
  esc_clears:         afterEsc === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label a11y:`, JSON.stringify(results),
  `\n  groupKey=${agentsKey}`,
  `\n  before=${before} enter=${afterEnter} reEnter=${afterReEnter} space=${afterSpace} esc=${afterEsc}`);
process.exit(ok ? 0 : 1);

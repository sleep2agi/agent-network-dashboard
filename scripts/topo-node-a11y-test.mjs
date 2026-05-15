/* Round 151 verification: node <g> gains a11y compliance.
 *
 * Node clickable for chat since R45, but tab-unreachable +
 * screen-reader-unannounced. R151 matches the pattern R116 /
 * R139 / R140 / R148 / R149 applied to other interactive
 * surfaces:
 *   role="button"
 *   tabIndex={0}
 *   aria-label="Chat with {alias} ({status})"
 *   aria-pressed={chatAlias === session.alias}
 *   onKeyDown(Enter / Space) → setChatAlias
 *
 * Three checks:
 *   1. All nodes carry role=button, tabIndex=0, aria-label, aria-
 *      pressed=false by default
 *   2. Pressing Enter on a focused node opens chat (aria-pressed
 *      flips to true, chat popover renders)
 *   3. Pressing Space on a different node moves the open chat
 *      target — only one aria-pressed=true at a time
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    mk('alpha', 'working'), mk('beta', 'idle'), mk('gamma', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const inspectAll = () => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('g[data-node]')];
  return nodes.map(n => ({
    alias:    n.getAttribute('data-node'),
    role:     n.getAttribute('role'),
    tabIndex: n.getAttribute('tabindex'),
    ariaLabel: n.getAttribute('aria-label'),
    ariaPressed: n.getAttribute('aria-pressed'),
  }));
});

const before = await inspectAll();

// Focus alpha node and press Enter → opens chat
await page.locator('g[data-node="alpha"]').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const afterAlpha = await inspectAll();
const popoverPresentA = await page.locator('.anet-chat-popover, [data-chat-popover]').count() > 0
                       || await page.evaluate(() => !!document.querySelector('[role="dialog"]'));

// Focus gamma node and press Space → moves chat target (only one pressed)
await page.locator('g[data-node="gamma"]').focus();
await page.keyboard.press(' ');
await page.waitForTimeout(250);
const afterGamma = await inspectAll();

await browser.close();

const results = {
  // Baseline shape
  threeNodes:         before.length === 3,
  allRoleButton:      before.every(n => n.role === 'button'),
  allTabIndex0:       before.every(n => n.tabIndex === '0'),
  allAriaLabel:       before.every(n => /^Chat with /.test(n.ariaLabel || '')),
  allAriaPressedFalse: before.every(n => n.ariaPressed === 'false'),

  // After Enter on alpha
  enterOpensChat:     afterAlpha.find(n => n.alias === 'alpha')?.ariaPressed === 'true',
  popoverShown:       popoverPresentA,
  othersStillFalse:   afterAlpha.filter(n => n.alias !== 'alpha').every(n => n.ariaPressed === 'false'),

  // After Space on gamma (chat target moved)
  spaceMovesTarget:   afterGamma.find(n => n.alias === 'gamma')?.ariaPressed === 'true',
  alphaUnpressed:     afterGamma.find(n => n.alias === 'alpha')?.ariaPressed === 'false',
  onlyOnePressed:     afterGamma.filter(n => n.ariaPressed === 'true').length === 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node a11y:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterAlpha=`, afterAlpha,
  `\n  afterGamma=`, afterGamma);
process.exit(ok ? 0 : 1);

/* Round 80 verification: hovering a vendor letter in the distribution
 * chip dims nodes from other vendors. Composes with R55/R77/R79 dim
 * mechanic — same 0.28 dim weight, distinct filter dimension.
 *
 * Fleet: 2 Claude nodes (alpha, gamma) + 1 GPT node (beta). The chip
 * renders "C:2 G:1" (with the unknown bucket if any models don't
 * resolve). Hover `C` → alpha + gamma stay bright, beta dims. Hover
 * `G` → beta stays, alpha + gamma dim. Mouseleave restores.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha', status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',  status: 'idle', model: 'gpt-5',         runtime: 'codex-cli',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'gamma', status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(500);

const opacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['alpha', 'beta', 'gamma']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});
const vendorLetters = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-vendor-letter]')].map(el => el.getAttribute('data-vendor-letter'));
});

const before = await opacities();

// vendorIdentity maps Anthropic→`A`, OpenAI→`O` (initials, not first
// letter of the model name). Find which sessions land in which bucket
// dynamically — `alpha` + `gamma` use claude-opus-4 (Anthropic = A),
// `beta` uses gpt-5 (OpenAI = O).
const aLetter = vendorLetters.find(l => l === 'A') || vendorLetters[0];
const oLetter = vendorLetters.find(l => l === 'O') || vendorLetters[1];

await page.locator(`[data-vendor-letter="${aLetter}"]`).hover();
await page.waitForTimeout(250);
const onClaude = await opacities();

await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterClaude = await opacities();

if (oLetter) {
  await page.locator(`[data-vendor-letter="${oLetter}"]`).hover();
  await page.waitForTimeout(250);
}
const onGpt = await opacities();

await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterGpt = await opacities();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:        bright(before.alpha) && bright(before.beta) && bright(before.gamma),
  vendorLetters_atLeast2: vendorLetters.length >= 2,
  anthropicLetter_A:      vendorLetters.includes('A'),
  openaiLetter_O:         vendorLetters.includes('O'),
  hoverA_keepsClaudes:    bright(onClaude.alpha) && bright(onClaude.gamma),
  hoverA_dimsGPT:         dim(onClaude.beta),
  leaveA_restoresAll:     bright(afterClaude.alpha) && bright(afterClaude.beta) && bright(afterClaude.gamma),
  hoverO_keepsGPT:        bright(onGpt.beta),
  hoverO_dimsClaudes:     dim(onGpt.alpha) && dim(onGpt.gamma),
  leaveO_restoresAll:     bright(afterGpt.alpha) && bright(afterGpt.beta) && bright(afterGpt.gamma),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor-chip hover:`, JSON.stringify(results),
  `\n  vendorLetters=`, vendorLetters,
  `\n  before=`,        before,
  `\n  onClaude=`,      onClaude,
  `\n  onGpt=`,         onGpt);
process.exit(ok ? 0 : 1);

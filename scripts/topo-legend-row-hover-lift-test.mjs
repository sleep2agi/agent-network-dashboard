/* Round 144 verification: legend panel rows lift 1px on hover or
 * pin. Symmetric extension of R143 (recent-signal rows) to the
 * sibling overlay panel.
 *
 * Now both side panels share matching row-level affordances:
 *   recent-signal row (R143): hover/pin → translateY(-1px)
 *   legend row       (R144): hover/pin → translateY(-1px)
 *
 * Each row composes inside its panel's hover-shadow (R135) — two
 * layers of feedback simultaneously when hovering a row.
 *
 * Path:
 *   1. idle: working/idle/offline rows all flat
 *   2. hover working row → that row lifts; others stay flat
 *   3. leave hover → restored
 *   4. click to pin idle row → idle lifted+pinned; working flat
 *   5. Esc clears pin → idle flat again
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
await page.waitForSelector('[data-legend-status="working"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspectAll = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-legend-status]')];
  return rows.map(row => ({
    key:        row.getAttribute('data-legend-status'),
    lifted:     row.getAttribute('data-legend-row-lifted'),
    pressed:    row.getAttribute('aria-pressed'),
    transform:  row.getAttribute('style')?.match(/translateY\([^)]+\)/)?.[0],
  }));
});

const s1 = await inspectAll();

await page.locator('[data-legend-status="working"]').hover();
await page.waitForTimeout(250);
const s2 = await inspectAll();
const s2_working = s2.find(r => r.key === 'working');
const s2_idle    = s2.find(r => r.key === 'idle');

await page.mouse.move(20, 20);
await page.waitForTimeout(250);
const s3 = await inspectAll();
const s3_working = s3.find(r => r.key === 'working');

await page.locator('[data-legend-status="idle"]').click();
await page.waitForTimeout(250);
await page.mouse.move(20, 20);
await page.waitForTimeout(250);
const s4 = await inspectAll();
const s4_idle    = s4.find(r => r.key === 'idle');
const s4_working = s4.find(r => r.key === 'working');

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const s5 = await inspectAll();
const s5_idle = s5.find(r => r.key === 'idle');

await browser.close();

const liftStr = 'translateY(-1px)';
const results = {
  s1_threeRows:           s1.length === 3,
  s1_allFlat:             s1.every(r => r.lifted === 'false' && !r.transform),

  s2_workingLifted:       s2_working?.lifted === 'true' && s2_working?.transform === liftStr,
  s2_idleStillFlat:       s2_idle?.lifted === 'false' && !s2_idle?.transform,

  s3_workingRestored:     s3_working?.lifted === 'false' && !s3_working?.transform,

  s4_idlePinned:          s4_idle?.pressed === 'true' && s4_idle?.lifted === 'true' && s4_idle?.transform === liftStr,
  s4_workingNotLifted:    s4_working?.lifted === 'false' && !s4_working?.transform,

  s5_idleCleared:         s5_idle?.lifted === 'false' && !s5_idle?.transform && s5_idle?.pressed === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row hover lift:`, JSON.stringify(results),
  `\n  s1=`, s1, `\n  s2=`, s2, `\n  s3=`, s3, `\n  s4=`, s4, `\n  s5=`, s5);
process.exit(ok ? 0 : 1);

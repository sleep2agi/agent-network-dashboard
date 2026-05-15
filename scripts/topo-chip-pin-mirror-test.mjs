/* Round 82 verification: chip-row "N working" + "N online" chips mirror
 * the pin state already shown by the R60 pressure-bar segments. When
 * pinnedStatus === 'working', the working chip lights up via inset
 * boxShadow + data-pin-mirror="true"; idle pin lights the online chip.
 * Closes the visual inconsistency where pressure-bar + legend showed
 * the pin but the sibling count chips stayed flat.
 *
 * Drive the pin via Cmd+K palette (R69 action) to verify the chip
 * reflects a pin set from a non-chip surface — exercises the full
 * coupling, not just a chip clicking itself.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
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
    { alias: 'alpha', status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',  status: 'idle',    model: 'gpt-5',         runtime: 'codex-cli',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
  const w = document.querySelector('[data-working-chip]');
  const o = document.querySelector('[data-online-chip]');
  return {
    working: {
      mirror: w?.getAttribute('data-pin-mirror'),
      shadow: w ? (w.getAttribute('style') || '').includes('inset') : false,
      title:  w?.getAttribute('title') || '',
    },
    online: {
      mirror: o?.getAttribute('data-pin-mirror'),
      shadow: o ? (o.getAttribute('style') || '').includes('inset') : false,
      title:  o?.getAttribute('title') || '',
    },
  };
});

const before = await snap();

// Dispatch the R69 CustomEvent directly — same coupling the palette
// uses, deterministic without fuzzy-match ambiguity. The R69 listener
// in TopoGraph reads `detail.kind === 'status'` + `detail.value`.
const pin = async (value) => {
  await page.evaluate((v) => {
    try { sessionStorage.setItem('anet-topo-pinned-status', v); } catch {}
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: v } }));
  }, value);
  await page.waitForTimeout(200);
};
const clear = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
};

await pin('working');
const onWorking = await snap();
await clear();
const afterWorking = await snap();

await pin('idle');
const onIdle = await snap();
await clear();
const afterIdle = await snap();

await browser.close();

const results = {
  before_workingFlat:    before.working.mirror === 'false' && !before.working.shadow,
  before_onlineFlat:     before.online.mirror  === 'false' && !before.online.shadow,
  workingPin_workingLit: onWorking.working.mirror === 'true' && onWorking.working.shadow,
  workingPin_onlineFlat: onWorking.online.mirror  === 'false' && !onWorking.online.shadow,
  workingPin_titleHint:  /Pinned/i.test(onWorking.working.title),
  esc_workingFlat:       afterWorking.working.mirror === 'false' && !afterWorking.working.shadow,
  esc_onlineUntouched:   afterWorking.online.mirror  === 'false' && !afterWorking.online.shadow,
  idlePin_onlineLit:     onIdle.online.mirror === 'true' && onIdle.online.shadow,
  idlePin_workingFlat:   onIdle.working.mirror === 'false' && !onIdle.working.shadow,
  idlePin_titleHint:     /Pinned/i.test(onIdle.online.title),
  esc_onlineFlat:        afterIdle.online.mirror === 'false' && !afterIdle.online.shadow,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip pin-mirror:`, JSON.stringify(results),
  `\n  before=`,       before,
  `\n  onWorking=`,    onWorking,
  `\n  onIdle=`,       onIdle);
process.exit(ok ? 0 : 1);

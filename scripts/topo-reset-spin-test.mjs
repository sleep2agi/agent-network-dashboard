/* Round 184 verification: chrome reset button gets a one-shot
 * icon spin on click — visual confirmation that the click
 * registered.
 *
 * Pre-R184 the reset button triggered R168 smoothView crossfade
 * on the canvas but the button itself had no on-button feedback.
 * R184 arms resetSpinning for 460ms on click; the SVG icon
 * picks up `.anet-reset-spin` CSS animation (450ms ease-out,
 * -360°).
 *
 * Test:
 *   1. Idle: data-topo-chrome-reset-spinning='false',
 *            SVG icon has NO 'anet-reset-spin' className
 *   2. Click reset → flag='true' within 50ms,
 *                    SVG icon has 'anet-reset-spin' className
 *   3. Wait 500ms → flag='false', className removed
 *   4. CSS animation keyframe 'anet-reset-spin' exists in stylesheet
 *      (rotates -360deg)
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-reset]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-reset]');
  const icon = document.querySelector('[data-topo-chrome-reset-icon]');
  return {
    btnSpinningAttr: btn?.getAttribute('data-topo-chrome-reset-spinning'),
    iconClass:       icon?.getAttribute('class') || '',
  };
});

const idle = await probe();

// First zoom in so reset has visible effect (not strictly needed for the
// spin test, but exercises the resetView path alongside the spin)
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(200);

// Click reset button — spin should arm
await page.locator('[data-topo-chrome-reset]').click();
await page.waitForTimeout(50);
const duringSpin = await probe();

// Wait past the 460ms window
await page.waitForTimeout(500);
const afterSpin = await probe();

// Verify the CSS keyframe exists in the stylesheet (rotates negatively)
const cssCheck = await page.evaluate(() => {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      // CSSKeyframesRule has .name and .cssText listing keyframes
      if (rule.type === 7 /* KEYFRAMES_RULE */ && rule.name === 'anet-reset-spin') {
        return {
          found: true,
          cssText: rule.cssText,
        };
      }
    }
  }
  return { found: false, cssText: '' };
});

await browser.close();

const results = {
  idle_attr_false:       idle.btnSpinningAttr === 'false',
  idle_no_spin_class:    !idle.iconClass.includes('anet-reset-spin'),

  spin_attr_true:        duringSpin.btnSpinningAttr === 'true',
  spin_has_class:        duringSpin.iconClass.includes('anet-reset-spin'),

  after_attr_false:      afterSpin.btnSpinningAttr === 'false',
  after_no_spin_class:   !afterSpin.iconClass.includes('anet-reset-spin'),

  keyframe_found:        cssCheck.found,
  keyframe_negative_360: cssCheck.cssText.includes('-360deg') ||
                         cssCheck.cssText.includes('rotate(-360'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} reset-spin:`, JSON.stringify(results),
  `\n  idle:`, idle,
  `\n  duringSpin:`, duringSpin,
  `\n  afterSpin:`, afterSpin,
  `\n  keyframe:`, cssCheck);
process.exit(ok ? 0 : 1);

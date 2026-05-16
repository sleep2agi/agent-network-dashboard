/* Round 315 verification: FreshnessChip (R275 conditional warning
 * chip, renders only when stale > 10s) joins the R313-R314 chip-row
 * data-weight family with font-medium. Sibling parity — when it
 * appears, it sits next to working/online/active-links/vendor chips
 * which all carry font-medium (500) per R313/R314.
 *
 * Test trap: chip is conditionally rendered. We need to mock the
 * SWR delivery path to keep sessions stable for >10s — easiest way
 * is to inject the chip's stale state by waiting in test. Below we
 * load the page and wait 12s to surface the chip.
 *
 * Contract:
 *   - [data-freshness-chip] eventually appears with stale=true.
 *   - Its className includes 'font-medium' + 'font-mono'.
 *   - Computed font-weight === 500.
 *   - R314 vendor chip + R313 main chip + R294 pulse all preserved.
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
// Lock the status response so SWR re-fetches return the same
// session reference; the chip detects staleness by the absence of
// payload-reference change for >10s. We achieve this by serving
// a static body repeatedly.
let status = null;
await ctx.route('**/api/hub/status*', async (route) => {
  if (!status) {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, model) => ({
      alias, status: 'working', model, runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    status = { ...b, sessions: [
      mk('alpha', 'claude-opus-4'),
      mk('beta',  'gpt-4o'),
    ] };
  }
  await route.fulfill({ json: status });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// FreshnessChip stale gate is sec > 10. Wait 12s to ensure stale.
await page.waitForTimeout(12500);
await page.waitForSelector('[data-freshness-chip]', { timeout: 5000 });

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const chip = sel('[data-freshness-chip]');
  return {
    chipPresent:  chip !== null,
    chipCls:      chip?.className ?? '',
    chipFw:       chip ? getComputedStyle(chip).fontWeight : null,
    chipText:     chip?.textContent?.trim() ?? null,
    chipStale:    chip?.getAttribute('data-freshness-chip-stale') ?? null,
    vendorChipCls: sel('[data-vendor-letter]')?.className ?? '',
    workingChipCls: sel('[data-working-chip]')?.className ?? '',
    recentCountFw:  sel('[data-recent-panel-count]')?.getAttribute('font-weight') ?? null,
    pulseCount:     document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  freshness_chip_present:      probe.chipPresent,
  freshness_chip_stale:        probe.chipStale === 'true',
  freshness_chip_has_medium:   probe.chipCls.includes('font-medium'),
  freshness_chip_has_mono:     probe.chipCls.includes('font-mono'),
  freshness_chip_fw_500:       String(probe.chipFw) === '500',
  r313_working_chip_kept:      probe.workingChipCls.includes('font-medium'),
  r311_recent_count_fw_600:    probe.recentCountFw === '600',
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness chip weight:`, JSON.stringify(results),
  '\n  chip text:', JSON.stringify(probe.chipText), 'fw=', probe.chipFw);
process.exit(ok ? 0 : 1);

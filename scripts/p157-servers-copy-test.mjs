/* #157 fix verification (v0.10.8 lean ship — Fix #1 only per 通信龙 5573).
 *
 * Pre-fix the Servers panel showed:
 *   "agent rollup pending hub ≥ 0.8.2-preview"
 *   "disk metric pending hub ≥ 0.8.2-preview"
 * commhub-server@0.8.2 is LIVE on prod but still doesn't ship `agents[]`
 * or `disk_*` — the version-pinned text was misleading.
 *
 * Post-fix:
 *   "agent rollup not reported by hub"
 *   "disk metric not reported by hub"
 * + data-server-agents-missing + data-server-disk-missing test attrs.
 *
 * Test:
 *   1. Open dashboard, expand Servers drawer (localStorage flag)
 *   2. Expand first server card (localStorage flag)
 *   3. Assert visible copy lacks "0.8.2-preview"
 *   4. Assert test-surface attrs present
 *   5. Source-side regex confirms new copy + attrs wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Force servers drawer open
    localStorage.setItem('anet-servers-drawer', '1');
  } catch {}
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500); // wait for SWR fetch + servers to render

// Expand first server card by clicking it
const firstCard = await page.$('[data-server-host], [data-server-card], button:has-text("iZ")');
// Simpler: just probe the drawer body text after expansion attempt
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  // Find server card expand toggles by their host text
  const candidates = buttons.filter(b => /iZ|elaine/.test(b.textContent || ''));
  if (candidates[0]) candidates[0].click();
});
await page.waitForTimeout(800);

const probe = await page.evaluate(() => {
  // Probe drawer body for the placeholder text
  const drawer = document.querySelector('[data-servers-body]') || document.body;
  const text = drawer.textContent || '';
  const agentsMissing = document.querySelectorAll('[data-server-agents-missing="true"]');
  const diskMissing   = document.querySelectorAll('[data-server-disk-missing="true"]');
  return {
    body_text_excerpt: text.slice(0, 1500),
    has_stale_copy: /0\.8\.2-preview/.test(text),
    has_new_agents_copy: /agent rollup not reported by hub/.test(text),
    has_new_disk_copy:   /disk metric not reported by hub/.test(text),
    agents_missing_count: agentsMissing.length,
    disk_missing_count:   diskMissing.length,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/ServersDrawer.tsx', 'utf8');
// The OLD strings should be gone from rendered text. The comment block keeps the
// historical "0.8.2-preview" reference for audit — that's OK because comments
// don't render. So source check: look for the NEW visible strings AND the test
// attrs, not for the absence of "0.8.2-preview".
const sourceNewAgentsCopy = /agent rollup not reported by hub/.test(src);
const sourceNewDiskCopy   = /disk metric not reported by hub/.test(src);
const sourceAgentsAttr    = /data-server-agents-missing="true"/.test(src);
const sourceDiskAttr      = /data-server-disk-missing="true"/.test(src);

const results = {
  dom_no_stale_copy:    !probe.has_stale_copy,
  dom_new_agents_copy:  probe.has_new_agents_copy,
  dom_new_disk_copy:    probe.has_new_disk_copy,
  agents_attr_present:  probe.agents_missing_count > 0,
  disk_attr_present:    probe.disk_missing_count > 0,
  source_new_agents:    sourceNewAgentsCopy,
  source_new_disk:      sourceNewDiskCopy,
  source_agents_attr:   sourceAgentsAttr,
  source_disk_attr:     sourceDiskAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} #157 servers copy fix:`, JSON.stringify(results),
  '\n  agents_missing_count:', probe.agents_missing_count, ' disk_missing_count:', probe.disk_missing_count,
  '\n  body_excerpt:', probe.body_text_excerpt.replace(/\s+/g, ' ').slice(0, 400));
process.exit(ok ? 0 : 1);

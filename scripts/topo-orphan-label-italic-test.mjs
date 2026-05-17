/* Round 499 verification: orphan band "其他" label gets fontStyle:
 * italic, while prefix-group labels (alpha/beta/etc.) stay roman.
 * Pure typography differentiation — no opacity / weight / fill / bbox
 * change. data-group-label-orphan attr surfaces the gate for tests.
 *
 * Fixture: 2 prefix groups (alpha×3, beta×2) + 3 orphans (zeta/omega/
 * lonely) — forces #150 orphan-band creation with at least 1 orphan
 * and ≥ 1 prefix-group for differential assertion.
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
    // grid layout required for groupBoxes to render
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),  mk('alpha·2', 'idle'),  mk('alpha·3', 'idle'),
    mk('beta·1',  'working'),  mk('beta·2',  'idle'),
    mk('zeta',    'idle'),
    mk('omega',   'idle'),
    mk('lonely',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(1500);

const labels = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-group-label]'));
  return els.map((el) => {
    const cs = window.getComputedStyle(el);
    return {
      key:        el.getAttribute('data-group-label'),
      orphan_attr:el.getAttribute('data-group-label-orphan'),
      font_style: cs.fontStyle,
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceTypeWired = /groupBoxes: \[\] as \{ key: string; isOrphan\?: boolean;/.test(src);
const sourceFieldWired = /isOrphan: !!band\.isOrphan,/.test(src);
const sourceStyleWired = /fontStyle: box\.isOrphan \? 'italic' : undefined/.test(src);
const sourceAttrWired  = /data-group-label-orphan=\{box\.isOrphan \? 'true' : 'false'\}/.test(src);

const orphanLabel  = labels.find((l) => l.key === '其他');
const prefixLabels = labels.filter((l) => l.key !== '其他' && l.key !== '');

const results = {
  found_labels:                labels.length >= 2,
  orphan_label_present:        !!orphanLabel,
  orphan_attr_true:            orphanLabel && orphanLabel.orphan_attr === 'true',
  orphan_font_italic:          orphanLabel && orphanLabel.font_style === 'italic',
  prefix_labels_present:       prefixLabels.length >= 1,
  prefix_attrs_false:          prefixLabels.length > 0 && prefixLabels.every((p) => p.orphan_attr === 'false'),
  prefix_font_normal:          prefixLabels.length > 0 && prefixLabels.every((p) => p.font_style !== 'italic'),
  source_type_wired:           sourceTypeWired,
  source_field_wired:          sourceFieldWired,
  source_style_wired:          sourceStyleWired,
  source_attr_wired:           sourceAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R499 orphan label italic:`, JSON.stringify(results),
  '\n  labels:', JSON.stringify(labels));
process.exit(ok ? 0 : 1);

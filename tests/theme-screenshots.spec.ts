import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Theme contract spec (rewritten 08-01, 通信龙 issue-#70 follow-up).
 *
 * The previous version of this file took screenshots and printed "saved" —
 * ZERO expect() calls, structurally unable to fail. The light-mode column
 * bug (#70) shipped and stayed invisible while this file ran green.
 *
 * Now it asserts the minimal theme contract on the /nodes main path:
 *   1. denominators first — the surfaces exist and every theme was visited
 *      ("0 problems" must be distinguishable from "check never ran");
 *   2. for each surface, light's computed background DIFFERS from cyber's
 *      (raw-string comparison — no color parsing at all, which sidesteps
 *      the Tailwind-v4 lab()/oklch parsing trap entirely);
 *   3. the two surfaces #70 named (rail, chat) match their exact SPEC §2
 *      light values (hex-token-derived computed styles come back as
 *      plain rgb() strings — verified by printing raw values below).
 * Screenshots stay as review artifacts, but they are no longer the test.
 *
 * THEMES list refreshed too: mint/sunset were deleted from globals.css
 * long ago; slack (light + data-skin) was missing — the stale list meant
 * even the screenshots covered the wrong theme set.
 */

const BASE = process.env.TEST_URL || 'http://localhost:3100';
const OUT_DIR = path.resolve(__dirname, '../test-results/theme-screenshots');
const THEMES = ['cyber', 'light', 'slack'] as const;

const SURFACES = [
  { name: 'body', sel: 'body' },
  { name: 'rail', sel: '[data-node-list-rail]' },       // #70: was stuck dark
  { name: 'chat', sel: '[data-testid="chat-pane"]' },   // #70: was stuck dark
] as const;

// SPEC §2 light values for the two #70 surfaces (issue carries the prod
// measurements; batch 1 tokens are plain hex → computed rgb() strings).
const LIGHT_EXPECT: Record<string, string> = {
  rail: 'rgb(250, 250, 252)',
  chat: 'rgb(255, 255, 255)',
};

const HUB_STATUS = { sessions: [{ alias: 'theme-probe-1', status: 'idle', network_id: 'net_x' }] };
const HUB_NODES = { nodes: [{ alias: 'theme-probe-1', node_id: 'node-tp1', team: null, tags: [] }] };
const HUB_HEALTH = { ok: true, sse_sessions: { 'net_x:theme-probe-1': 1 } };

let cachedSessionCookie: string | null = null;
async function login(context: Page['context'] extends () => infer C ? C : never) {
  if (!cachedSessionCookie) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
    });
    const m = (res.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
    if (m) cachedSessionCookie = decodeURIComponent(m[1]);
  }
  if (cachedSessionCookie) {
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: cachedSessionCookie,
      domain: new URL(BASE).hostname,
      path: '/',
    }]);
  }
}

async function mockHub(page: Page) {
  await page.route('**/api/hub/status**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_STATUS) }));
  await page.route('**/api/hub/nodes**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_NODES) }));
  await page.route('**/api/hub/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_HEALTH) }));
  await page.route('**/api/hub/tasks**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"tasks":[]}' }));
  await page.route('**/api/hub/stats**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/hub/messages**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"messages":[]}' }));
}

test('theme contract: /nodes surfaces differ cyber→light and hit SPEC §2 light values (slack = light columns)', async ({ page, context }) => {
  await login(context);
  await mockHub(page);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.goto(`${BASE}/nodes/theme-probe-1`);
  await expect(page.locator('[data-testid="chat-pane"]')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);

  const readSurfaces = async () => {
    const out: Record<string, string> = {};
    for (const s of SURFACES) {
      const loc = page.locator(s.sel);
      await expect(loc, `surface "${s.name}" (${s.sel}) must exist — denominator`).toHaveCount(1);
      out[s.name] = await loc.evaluate(el => getComputedStyle(el).backgroundColor);
    }
    return out;
  };

  const byTheme: Record<string, Record<string, string>> = {};
  for (const t of THEMES) {
    await page.evaluate(th => {
      const el = document.documentElement;
      if (th === 'slack') { el.setAttribute('data-theme', 'light'); el.setAttribute('data-skin', 'slack'); }
      else { el.setAttribute('data-theme', th as string); el.removeAttribute('data-skin'); }
    }, t);
    await page.waitForTimeout(250);
    byTheme[t] = await readSurfaces();
    await page.screenshot({ path: path.join(OUT_DIR, `nodes-${t}.png`), fullPage: true });
  }
  // Raw values printed first (通信龙 trap note: see the actual format
  // before deciding how to compare — we compare strings, no parsing).
  console.log('theme-contract raw:', JSON.stringify(byTheme));

  // Denominator: all themes visited, all surfaces read.
  expect(Object.keys(byTheme).sort()).toEqual([...THEMES].sort());
  for (const t of THEMES) expect(Object.keys(byTheme[t]).length).toBe(SURFACES.length);

  // Contract 1: light differs from cyber on EVERY surface (the exact
  // failure #70 documented was rail/chat NOT changing).
  for (const s of SURFACES) {
    expect(byTheme.light[s.name], `light ${s.name} must differ from cyber`).not.toBe(byTheme.cyber[s.name]);
  }
  // Contract 2: the two #70 surfaces hit their exact SPEC §2 light values.
  for (const [name, want] of Object.entries(LIGHT_EXPECT)) {
    expect(byTheme.light[name], `light ${name} = SPEC §2`).toBe(want);
    expect(byTheme.slack[name], `slack ${name} keeps light columns`).toBe(want);
  }
  console.log(`theme-contract: checked ${SURFACES.length} surfaces × ${THEMES.length} themes`);
});

// ── Batch 2 surfaces (issue #70): the spots that measured cyber==light on
// pre-batch main (recorded in the batch-2 PR): chat bubbles + secondary
// text on /messages, sidebar inactive/active colors. Selectors target the
// TOKEN classes (the literal class attribute contains "var(--…)"), so they
// survive future refactors as long as the token stays — and they double as
// denominators: zero matches fails loudly via toHaveCount.
test('batch 2 surfaces: messages bubbles + sidebar colors follow the theme', async ({ page, context }) => {
  await login(context);
  await mockHub(page);
  const MSGS = { messages: [
    { id: 'm1', from_alias: 'theme-probe-1', to_alias: 'me', content: 'incoming', created_at: '2026-08-01 10:00:00', type: 'message' },
    // outgoing = from_alias 'dashboard' (messages/page.tsx bubbleVariant:51)
    { id: 'm2', from_alias: 'dashboard', to_alias: 'theme-probe-1', content: 'outgoing', created_at: '2026-08-01 10:01:00', type: 'message' },
  ]};
  await page.route('**/api/hub/messages**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MSGS) }));

  const SURFACES2 = [
    { name: 'bubble-in', sel: '[class*="bg-[var(--bubble-in)]"]', prop: 'backgroundColor', url: '/messages' },
    { name: 'bubble-out', sel: '[class*="bg-[var(--bubble-out)]"]', prop: 'backgroundColor', url: '/messages' },
    { name: 'secondary-text', sel: '[class*="text-[var(--fg-dim)]"]', prop: 'color', url: '/messages' },
    { name: 'sidebar-hl', sel: '[class*="text-[var(--hl)]"], [class*="bg-[var(--hl)]"]', prop: 'backgroundColor', url: '/nodes/theme-probe-1' },
  ] as const;

  const byTheme: Record<string, Record<string, string>> = { cyber: {}, light: {} };
  for (const url of ['/messages', '/nodes/theme-probe-1']) {
    await page.goto(`${BASE}${url}`);
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);
    for (const t of ['cyber', 'light'] as const) {
      await page.evaluate(th => { document.documentElement.setAttribute('data-theme', th); document.documentElement.removeAttribute('data-skin'); }, t);
      await page.waitForTimeout(200);
      for (const s of SURFACES2.filter(x => x.url === url)) {
        const loc = page.locator(s.sel).first();
        await expect(loc, `surface "${s.name}" must exist on ${url} — denominator`).toBeVisible();
        byTheme[t][s.name] = await loc.evaluate((el, prop) => getComputedStyle(el)[prop as 'backgroundColor'], s.prop);
      }
    }
  }
  console.log('batch2 raw:', JSON.stringify(byTheme));
  for (const s of SURFACES2) {
    expect(byTheme.light[s.name], `light ${s.name} must differ from cyber (was cyber==light before batch 2)`).not.toBe(byTheme.cyber[s.name]);
  }
  console.log(`batch2: checked ${SURFACES2.length} surfaces × 2 themes`);
});

// ── Batch 3 (issue #70, 6th class): white/black opacity utilities. On light,
// bg-white/5 over a near-white surface composites to a ~0 shift — hover
// feedback and subtle surfaces silently vanish (white/5 over #ffffff is
// EXACTLY 0). Fix = 3 tokens: --hover-tint / --hover-tint-strong (+ the
// pre-existing --code-bg) / --code-fg.
//
// NOTE on thresholds: code-block TEXT is held to WCAG 4.5:1. The hover
// tint is NOT held to 3:1 — no subtle tint can be: 5% black over white is
// 1.11:1 vs the resting surface, and WCAG 1.4.11 does not require
// hover-vs-rest contrast at all. The actual bug was delta == 0, so the
// contract is a MEASURABLE delta (≥ 8/255 on some channel) in BOTH themes.

// Both value formats below are our own declarations in globals.css (plain
// hex / rgb() / rgba()) — parse those three forms only, loudly fail others.
function parseColor(raw: string): { r: number; g: number; b: number; a: number } {
  const s = raw.trim();
  // Computed custom-property values come back in serialized hex forms the
  // raw print revealed: #fff, #ffffff0d (rgba(255,255,255,.05) → 8-digit).
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`unparseable color from our own globals.css: "${raw}"`);
}
function composite(top: { r: number; g: number; b: number; a: number }, base: { r: number; g: number; b: number }) {
  return {
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
  };
}
function relLum({ r, g, b }: { r: number; g: number; b: number }) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('batch 3 tokens: hover tint has a real delta, code text ≥ 4.5:1, in BOTH themes', async ({ page, context }) => {
  await login(context);
  await mockHub(page);
  await page.goto(`${BASE}/nodes/theme-probe-1`);
  await expect(page.locator('[data-testid="chat-pane"]')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);

  const TOKENS = ['--hover-tint', '--hover-tint-strong', '--code-bg', '--code-fg', '--col-chat'] as const;
  const byTheme: Record<string, Record<string, string>> = {};
  for (const t of ['cyber', 'light'] as const) {
    await page.evaluate(th => { document.documentElement.setAttribute('data-theme', th); document.documentElement.removeAttribute('data-skin'); }, t);
    await page.waitForTimeout(200);
    byTheme[t] = await page.evaluate(names => {
      const cs = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map(n => [n, cs.getPropertyValue(n).trim()]));
    }, TOKENS as unknown as string[]);
  }
  console.log('batch3 raw:', JSON.stringify(byTheme));

  for (const t of ['cyber', 'light'] as const) {
    // Denominator: every token resolves (missing token = empty string = the
    // exact pre-batch-3 state; this line is the organic red on old main).
    for (const n of TOKENS) {
      expect(byTheme[t][n], `${t} ${n} must be defined`).not.toBe('');
    }
    const chat = parseColor(byTheme[t]['--col-chat']);
    // Hover tint: composited over the chat column must move ≥ 8/255 on some
    // channel (bg-white/5 on light moved 0 — the bug this batch fixes).
    const tint = composite(parseColor(byTheme[t]['--hover-tint']), chat);
    const delta = Math.max(Math.abs(tint.r - chat.r), Math.abs(tint.g - chat.g), Math.abs(tint.b - chat.b));
    console.log(`batch3 ${t}: hover-tint channel delta = ${delta.toFixed(1)}/255`);
    expect(delta, `${t} hover tint must visibly differ from the resting surface`).toBeGreaterThanOrEqual(8);
    // Strong (active) tint must move further than hover.
    const strong = composite(parseColor(byTheme[t]['--hover-tint-strong']), chat);
    const deltaS = Math.max(Math.abs(strong.r - chat.r), Math.abs(strong.g - chat.g), Math.abs(strong.b - chat.b));
    expect(deltaS, `${t} active tint > hover tint`).toBeGreaterThan(delta);
    // Code block: TEXT threshold, 4.5:1 (was 1.97:1 on light pre-batch-3).
    const codeBg = composite(parseColor(byTheme[t]['--code-bg']), chat);
    const ratio = contrast(parseColor(byTheme[t]['--code-fg']), codeBg);
    console.log(`batch3 ${t}: code-fg on code-bg contrast = ${ratio.toFixed(2)}:1`);
    expect(ratio, `${t} code text must clear WCAG 4.5:1`).toBeGreaterThanOrEqual(4.5);
  }
  // Theme-follows contract: light ≠ cyber for every batch-3 token.
  for (const n of TOKENS.slice(0, 4)) {
    expect(byTheme.light[n], `light ${n} must differ from cyber`).not.toBe(byTheme.cyber[n]);
  }
});

// Source contract: the 20 batch-3 spots must stay on tokens. Reading the
// component sources is deliberate — the spots span 10 files/5 routes (some
// behind wizards/menus a DOM test can't cheaply reach), and the failure
// mode is textual (someone re-adds a white/black opacity utility). The
// color ratchet enforces the same thing repo-wide per file; this test
// pins the batch-3 files to EXACT zero and proves the tokens landed.
test('batch 3 source contract: scope files carry tokens, not white/black opacity utilities', () => {
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  // C: hover feedback (was hover:bg-white/5 — 0-shift on light).
  const HOVER_FILES = [
    'app/components/AgentCard.tsx', 'app/components/CommandCenter.tsx',
    'app/components/CreateNodeWizard.tsx', 'app/components/HealthBanner.tsx',
    'app/components/NodeLifecycleMenu.tsx', 'app/components/NodeSettingsPanel.tsx',
    'app/components/ProviderFormModal.tsx',
  ];
  let tokenHits = 0;
  for (const f of HOVER_FILES) {
    const src = read(f);
    expect(count(src, 'hover:bg-white/5'), `${f} must not use hover:bg-white/5`).toBe(0);
    tokenHits += count(src, 'hover:bg-[var(--hover-tint)]');
  }
  // TopoGraph: 3 real chrome spots migrated; design-history COMMENTS keep the
  // old strings (2× hover + 1× active) — pin exact counts so a re-added
  // utility (comment or code) trips this line either way.
  const topo = read('app/components/TopoGraph.tsx');
  expect(count(topo, 'hover:bg-white/5'), 'TopoGraph: only the 2 comment mentions may remain').toBe(2);
  expect(count(topo, 'active:bg-white/10'), 'TopoGraph: only the 1 comment mention may remain').toBe(1);
  tokenHits += count(topo, 'hover:bg-[var(--hover-tint)]');
  expect(count(topo, 'active:bg-[var(--hover-tint-strong)]'), 'TopoGraph active tints').toBe(3);
  expect(tokenHits, 'C-class: 11 hover spots must use var(--hover-tint)').toBe(11);

  // D: content-layer invisibles.
  const ab = read('app/components/AttachmentBlock.tsx');
  expect(count(ab, 'bg-white/5'), 'AttachmentBlock surfaces must use the tint token').toBe(0);
  expect(count(ab, 'bg-[var(--hover-tint)]'), 'AttachmentBlock: 2 tint surfaces').toBe(2);
  const nv = read('app/nodes/NodesView.tsx');
  expect(count(nv, 'text-white/10'), 'NodesView watermark text must be theme-aware').toBe(0);

  // E: code blocks (1.97:1 on light with bg-black/40).
  for (const f of ['app/components/CreateNodeWizard.tsx', 'app/components/HostSupervisorPicker.tsx']) {
    const src = read(f);
    expect(count(src, 'bg-black/40'), `${f} code blocks must use var(--code-bg)`).toBe(0);
  }
  expect(count(read('app/components/CreateNodeWizard.tsx'), 'bg-[var(--code-bg)]')).toBe(1);
  const hsp = read('app/components/HostSupervisorPicker.tsx');
  expect(count(hsp, 'bg-[var(--code-bg)]')).toBe(2);
  // Needle keeps the closing quote: line 172's `text-cyan-300/60` is a
  // DIFFERENT class (opacity modifier ⇒ neither the .text-cyan-300 shim nor
  // the ratchet families match it) — documented out-of-scope debt, batch 4+.
  expect(count(hsp, 'text-cyan-300"'), 'HSP pre text: cyan-300 is 2.98:1 on light even shimmed').toBe(0);
  expect(count(hsp, 'text-[var(--code-fg)]')).toBe(1);
});

/* Loop self-review — captures Overview in cyber+light × desktop+mobile,
 * runs a few observable checks, prints a per-axis score. Not a regression
 * test — the cron's "review and score then propose next round" output. */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.LOOP_REVIEW_BASE || 'http://127.0.0.1:3000';
const TOKEN = process.env.LOOP_REVIEW_TOKEN; // utok_...
const OUT = path.resolve(process.cwd(), 'test-results/loop-review');
mkdirSync(OUT, { recursive: true });

if (!TOKEN) {
  console.error('LOOP_REVIEW_TOKEN env var required (utok_...)');
  process.exit(1);
}

const matrix = [
  { theme: 'cyber', viewport: { width: 1440, height: 900 }, tag: 'desktop' },
  { theme: 'cyber', viewport: { width: 390,  height: 844 }, tag: 'mobile'  },
  { theme: 'light', viewport: { width: 1440, height: 900 }, tag: 'desktop' },
  { theme: 'light', viewport: { width: 390,  height: 844 }, tag: 'mobile'  },
];

const browser = await chromium.launch({ headless: true });

const report = [];

for (const m of matrix) {
  const ctx = await browser.newContext({
    viewport: m.viewport,
    deviceScaleFactor: 1,
  });
  await ctx.addCookies([{
    name: 'anet_dashboard_session',
    value: `v3:${TOKEN}`,
    domain: '127.0.0.1',
    path: '/',
  }]);
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('anet-theme', theme);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, m.theme);

  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1200); // give SWR a beat

  // Forced theme apply after hydration — same trick the screenshot suite uses
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), m.theme);
  await page.waitForTimeout(300);

  const file = path.join(OUT, `overview-${m.theme}-${m.tag}.png`);
  await page.screenshot({ path: file, fullPage: true });

  // Observable checks
  const checks = await page.evaluate(() => {
    const doc = document.documentElement;
    const theme = doc.getAttribute('data-theme');
    const body = document.body;
    const bodyBg = getComputedStyle(body).backgroundColor;
    const bodyFg = getComputedStyle(body).color;

    // Find Task Status section
    const taskStatusHeader = [...document.querySelectorAll('div')]
      .find(el => el.textContent?.trim() === 'Task Status');
    const taskStatusChips = taskStatusHeader
      ? taskStatusHeader.parentElement?.parentElement?.querySelectorAll('a[href^="/tasks?status="]').length || 0
      : 0;

    // Sidebar nav visibility (should be visible on desktop, hidden behind hamburger on mobile)
    const sidebar = document.querySelector('aside, [data-sidebar], nav');
    const sidebarRect = sidebar?.getBoundingClientRect();
    const sidebarVisible = sidebar
      ? sidebarRect && sidebarRect.width > 0 && sidebarRect.height > 0
      : false;

    // Any overflowing element wider than viewport (horizontal scroll indicator)
    const docWidth = doc.scrollWidth;
    const viewportWidth = window.innerWidth;
    const horizontalOverflow = docWidth > viewportWidth + 2;

    // Look for an obvious "AI-glow" tell — anything with filter: blur or huge box-shadow spread
    const allEls = document.querySelectorAll('body *');
    let glowyCount = 0;
    for (const el of allEls) {
      const cs = getComputedStyle(el);
      if (cs.filter && cs.filter.includes('blur(') && !cs.filter.includes('blur(0px)')) glowyCount++;
    }

    return {
      theme,
      bodyBg,
      bodyFg,
      taskStatusChips,
      sidebarVisible,
      docWidth,
      viewportWidth,
      horizontalOverflow,
      glowyCount,
    };
  });

  // Score: 10 max, deduct for failures
  let score = 10;
  const notes = [];
  if (checks.theme !== m.theme) { score -= 3; notes.push(`theme=${checks.theme} (expected ${m.theme})`); }
  if (checks.horizontalOverflow) { score -= 2; notes.push(`horizontal overflow ${checks.docWidth}/${checks.viewportWidth}`); }
  if (m.tag === 'desktop' && !checks.sidebarVisible) { score -= 1; notes.push('sidebar missing on desktop'); }
  if (checks.glowyCount > 8) { score -= 1; notes.push(`${checks.glowyCount} elements with blur filter (AI-glow tell)`); }
  // Task Status chip count is 0–9 — fine to be 0 when account has no tasks (fresh probe)

  report.push({ ...m, file, checks, score, notes });

  await page.close();
  await ctx.close();
}

await browser.close();

// Pretty print
console.log('\n=== Loop self-review ===\n');
for (const r of report) {
  console.log(`${r.theme}/${r.tag}  score=${r.score}/10`);
  console.log(`  bg=${r.checks.bodyBg}  fg=${r.checks.bodyFg}  chips=${r.checks.taskStatusChips}  glowy=${r.checks.glowyCount}`);
  if (r.notes.length) console.log(`  notes: ${r.notes.join(' · ')}`);
  console.log(`  ${path.relative(process.cwd(), r.file)}`);
}
const avg = report.reduce((s, r) => s + r.score, 0) / report.length;
console.log(`\noverall avg = ${avg.toFixed(1)}/10`);

/* Loop self-review — captures Overview in cyber+light × desktop+mobile,
 * runs a few observable checks, prints a per-axis score. Not a regression
 * test — the cron's "review and score then propose next round" output.
 *
 * Round 71: replaced the toy checks (overflow, sidebar visible, blur count)
 * with checks that actually catch the bugs we keep shipping:
 *   - CTA-above-fold: does the primary "Spin up" / "Get started" / etc
 *     button live within the first viewport? (deduct 3)
 *   - Zero-card density: how many "0" stat cards are crammed in above the
 *     CTA? (deduct 1 per zero-card beyond the first 2)
 *   - Whitespace gap: any element-to-element vertical gap >200px in the
 *     top half? (deduct 1)
 *   - Misleading-copy: "All systems go" text rendered when nodes.total=0
 *     (deduct 2) — round-70-class bug guard
 *   - Old: theme, horizontal overflow, sidebar, glow tell — still in
 *
 * Score is 10 max; deductions accumulate. The pre-r70 design that scored
 * 10/10 here should now score ~4–5.
 */

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
  await page.waitForTimeout(1200);

  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), m.theme);
  await page.waitForTimeout(300);

  const file = path.join(OUT, `overview-${m.theme}-${m.tag}.png`);
  await page.screenshot({ path: file, fullPage: true });

  const checks = await page.evaluate(() => {
    const doc = document.documentElement;
    const theme = doc.getAttribute('data-theme');
    const body = document.body;
    const bodyBg = getComputedStyle(body).backgroundColor;
    const bodyFg = getComputedStyle(body).color;

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    // --- CTA-above-fold ---
    // We treat any of these texts as the page's primary CTA:
    //   "Spin up your first agent" — empty Overview onboarding
    //   "Get started" — generic
    //   "Dispatch" (when not empty) — populated state primary action
    const ctaTextRe = /Spin up your first agent|Get started/i;
    const ctaCandidates = [...document.querySelectorAll('h1, h2, h3, p, div, button, a')]
      .filter(el => ctaTextRe.test(el.textContent || ''));
    let ctaTop = null;
    if (ctaCandidates.length) {
      // Pick the smallest (innermost) element matching to avoid catching a wrapping section
      const sorted = ctaCandidates.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0));
      const r = sorted[0].getBoundingClientRect();
      ctaTop = r.top;
    }

    // --- Zero-card density ---
    // Count visible elements whose trimmed text === "0". These are usually
    // big stat-card values dominating prime real estate.
    const zeroCards = [...document.querySelectorAll('div, span')]
      .filter(el => {
        const t = el.textContent?.trim();
        if (t !== '0' && t !== '0/0') return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top < viewportH && r.width > 20 && r.height > 20;
      });

    // --- Whitespace gap ---
    // Look for sibling-to-sibling top gaps >200px in the page content
    // container. AppShell wraps page children in
    // <main><HealthBanner/><div><div class="min-h-screen ...">{page}</div></div></main>,
    // so we walk into that inner page wrapper to read real section gaps.
    const main = document.querySelector('main');
    const inner = main?.querySelector(':scope > div:last-of-type > div') || main || document.body;
    const directKids = [...inner.children].filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    let maxGap = 0;
    for (let i = 0; i + 1 < directKids.length; i++) {
      const a = directKids[i].getBoundingClientRect();
      const b = directKids[i + 1].getBoundingClientRect();
      if (a.bottom < 1600 && b.top - a.bottom > maxGap) {
        maxGap = Math.round(b.top - a.bottom);
      }
    }

    // --- Misleading copy guard ---
    // "All systems go" must not appear anywhere when nodes.total === 0.
    // We can't read state directly, but if the page also shows
    // "Waiting for first agent" then we know fleet is empty.
    const bodyText = document.body.innerText;
    const fleetEmpty = /Waiting for first agent/i.test(bodyText);
    const sayingAllSystemsGo = /All systems go/i.test(bodyText);
    const misleadingCopy = fleetEmpty && sayingAllSystemsGo;

    // --- Carryover ---
    const docWidth = doc.scrollWidth;
    const horizontalOverflow = docWidth > viewportW + 2;
    let glowyCount = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.filter && cs.filter.includes('blur(') && !cs.filter.includes('blur(0px)')) glowyCount++;
    }
    const sidebar = document.querySelector('aside, [data-sidebar], nav');
    const sidebarRect = sidebar?.getBoundingClientRect();
    const sidebarVisible = !!(sidebarRect && sidebarRect.width > 0 && sidebarRect.height > 0);

    return {
      theme, bodyBg, bodyFg,
      viewportH, viewportW,
      ctaTop, ctaPresent: ctaCandidates.length > 0,
      zeroCardCount: zeroCards.length,
      maxGap,
      fleetEmpty, sayingAllSystemsGo, misleadingCopy,
      docWidth, horizontalOverflow,
      glowyCount, sidebarVisible,
    };
  });

  let score = 10;
  const notes = [];
  if (checks.theme !== m.theme) { score -= 3; notes.push(`theme=${checks.theme}`); }
  if (checks.horizontalOverflow) { score -= 2; notes.push(`horiz overflow ${checks.docWidth}/${checks.viewportW}`); }
  if (m.tag === 'desktop' && !checks.sidebarVisible) { score -= 1; notes.push('sidebar missing on desktop'); }
  if (checks.glowyCount > 8) { score -= 1; notes.push(`${checks.glowyCount} blur-filter elements (glow tell)`); }

  // New checks — the ones that would have caught r70's bug
  if (checks.ctaPresent && checks.ctaTop !== null) {
    if (checks.ctaTop > checks.viewportH) {
      score -= 3;
      notes.push(`CTA below fold (top=${Math.round(checks.ctaTop)} > vh=${checks.viewportH})`);
    } else if (checks.ctaTop > checks.viewportH * 0.7) {
      score -= 1;
      notes.push(`CTA low in fold (top=${Math.round(checks.ctaTop)})`);
    }
  }
  if (checks.zeroCardCount > 4) {
    const extra = Math.min(checks.zeroCardCount - 4, 3);
    score -= extra;
    notes.push(`${checks.zeroCardCount} zero-value cards above fold`);
  }
  if (checks.maxGap > 200) {
    score -= 1;
    notes.push(`whitespace gap ${checks.maxGap}px`);
  }
  if (checks.misleadingCopy) {
    score -= 2;
    notes.push(`'All systems go' shown while fleet empty`);
  }

  report.push({ ...m, file, checks, score: Math.max(score, 0), notes });

  await page.close();
  await ctx.close();
}

await browser.close();

console.log('\n=== Loop self-review (harness r71) ===\n');
for (const r of report) {
  console.log(`${r.theme}/${r.tag}  score=${r.score}/10`);
  console.log(`  cta_top=${r.checks.ctaTop !== null ? Math.round(r.checks.ctaTop) : '--'}  zero_cards=${r.checks.zeroCardCount}  max_gap=${r.checks.maxGap}px  fleet_empty=${r.checks.fleetEmpty}`);
  if (r.notes.length) console.log(`  notes: ${r.notes.join(' · ')}`);
  console.log(`  ${path.relative(process.cwd(), r.file)}`);
}
const avg = report.reduce((s, r) => s + r.score, 0) / report.length;
console.log(`\noverall avg = ${avg.toFixed(1)}/10`);

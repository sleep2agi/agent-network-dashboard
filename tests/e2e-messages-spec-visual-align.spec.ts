import { test, expect, Page, BrowserContext } from '@playwright/test';

// /messages visual-alignment guardrail — pins the numbers that SPEC.md
// §2/§5/§6 dictate for the chat area.
//
// Method (per 07-31 通信龙 判据 "断言事实，不是声明"):
//   values are read from getComputedStyle() on the real rendered DOM,
//   NOT from any data-* attribute that would just restate the class
//   value. If the visual token drifts, the number drifts, the assertion
//   goes red — assertion side is same-source with reality (the browser's
//   computed style), not with the declaration (the Tailwind class).
//
// Witnessed-red discipline (per 07-31 通信龙 判据 "一条一条打，不是整体打"):
//   each assertion is its own `test(...)` block so witnessed-red on any
//   ONE token (revert only that class, re-run) turns exactly ONE test
//   red. If reverting shell bg turned two assertions red, that would
//   prove they're coupled — not each guarding its own thing.

const BASE = process.env.TEST_URL || 'http://localhost:3200';

const MOCK_MESSAGES = {
  messages: [
    // First bubble in the list — outgoing task alpha→beta, so bubble
    // background hits the SPEC #1E3A5F "self" color.
    {
      id: 'm1',
      type: 'task',
      from_alias: 'alpha',
      to_alias: 'beta',
      priority: 'normal',
      content: 'ALPHA_TO_BETA_BODY',
      created_at: '2026-07-31 12:00:00',
      task_id: 't1',
    },
    // Second — incoming reply from beta→alpha, so we can also probe
    // the SPEC #1E293B "other" color separately.
    {
      id: 'm2',
      type: 'reply',
      from_alias: 'beta',
      to_alias: 'alpha',
      priority: 'normal',
      content: 'BETA_TO_ALPHA_BODY',
      created_at: '2026-07-31 12:00:05',
    },
    // Third — broadcast, verifies the SPEC §5 "left 2px accent bar"
    // pattern that we reused for broadcast distinction.
    {
      id: 'm3',
      type: 'broadcast',
      from_alias: 'admin',
      priority: 'high',
      content: 'BROADCAST_BODY',
      created_at: '2026-07-31 12:00:10',
    },
  ],
};

// Rate-limit avoidance (10/15min/IP): one login per worker, reuse the
// cookie across all tests in this file. With --workers=1 the module
// var is truly shared. If the first login gets 429 (limit exhausted),
// throw immediately — otherwise every subsequent test would re-attempt
// and burn budget further while all failing the same way.
let cachedSessionCookie: string | null = null;
let loginErr: Error | null = null;
async function login(context: BrowserContext) {
  if (loginErr) throw loginErr;
  if (!cachedSessionCookie) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
    });
    if (res.status() === 429) {
      loginErr = new Error(
        'Login rate-limited (10/15min). Restart dev to clear the counter.',
      );
      throw loginErr;
    }
    // playwright merges multi-value headers with newlines in headers();
    // set-cookie is often multi-value so parse from headersArray instead.
    const headers = res.headersArray();
    const cookies = headers.filter((h) => h.name.toLowerCase() === 'set-cookie');
    for (const c of cookies) {
      const m = c.value.match(/anet_dashboard_session=([^;]+)/);
      if (m) {
        cachedSessionCookie = decodeURIComponent(m[1]);
        break;
      }
    }
    if (!cachedSessionCookie) {
      loginErr = new Error(
        `login 200 but no anet_dashboard_session cookie in headers: ${JSON.stringify(cookies)}`,
      );
      throw loginErr;
    }
  }
  await context.addCookies([
    {
      name: 'anet_dashboard_session',
      value: cachedSessionCookie,
      domain: new URL(BASE).hostname,
      path: '/',
    },
  ]);
}

async function mockAll(page: Page) {
  await page.route('**/api/hub/messages**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MESSAGES),
    }),
  );
  await page.route('**/api/hub/status**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"sessions":[]}' }),
  );
  await page.route('**/api/hub/nodes**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"nodes":[]}' }),
  );
  await page.route('**/api/hub/health', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true,"sse_sessions":{}}',
    }),
  );
}

async function gotoMessages(page: Page) {
  await login(page.context());
  await mockAll(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  // Wait for the actual mocked message content — NOT just any
  // rounded-2xl, because the loading skeleton is also rounded-2xl
  // (h-20 rounded-2xl bg-gray-800/20). Waiting for the literal
  // mock body text pins that SWR has settled and rendered.
  // See feedback_checker_scope_bug_vacuous_pass.md.
  await page.waitForFunction(
    () => document.body.textContent?.includes('ALPHA_TO_BETA_BODY') || false,
    undefined,
    // Turbopack sometimes rebuilds after a source edit — first mount
    // can take 10-20s. Give the ceiling headroom for CI-cold dev servers.
    { timeout: 25_000 },
  );
}

// Read computedStyle from the bubble that contains a known mock text.
// Text-anchored so the query is stable against other rounded-2xl chrome
// (headers, nav, etc.) — and independent of DOM ordering.
async function bubbleStyleByContent(page: Page, needle: string) {
  return await page.evaluate((n) => {
    const bubbles = Array.from(document.querySelectorAll('div.rounded-2xl'));
    const bubble = bubbles.find(
      (el) =>
        (el.textContent || '').includes(n) &&
        Array.from(el.classList).some((c) => c.startsWith('bg-')),
    );
    if (!bubble) return null;
    const cs = getComputedStyle(bubble);
    return {
      maxWidth: cs.maxWidth,
      backgroundColor: cs.backgroundColor,
      borderLeftColor: cs.borderLeftColor,
      borderLeftWidth: cs.borderLeftWidth,
    };
  }, needle);
}

async function broadcastBubbleStyle(page: Page) {
  return bubbleStyleByContent(page, 'BROADCAST_BODY');
}

test.describe('/messages · SPEC visual alignment', () => {
  // ── 1. SHELL BG · SPEC §2 chat area #141826 ──────────────────
  test('shell bg is SPEC #141826 (rgb 20,24,38)', async ({ page }) => {
    await gotoMessages(page);
    const bg = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="messages-shell"]');
      if (!shell) return null;
      return getComputedStyle(shell).backgroundColor;
    });
    // #141826 rendered as computed rgb(20, 24, 38) by every browser.
    expect(bg).toBe('rgb(20, 24, 38)');
  });

  // ── 2. BUBBLE MAX-WIDTH · SPEC §5 min(640px, 65%) ───────────
  test('bubble max-width is SPEC min(640px, 65%)', async ({ page }) => {
    await gotoMessages(page);
    // Non-broadcast bubble — mock m1 body "ALPHA_TO_BETA_BODY".
    const s = await bubbleStyleByContent(page, 'ALPHA_TO_BETA_BODY');
    expect(s).not.toBeNull();
    // Browser normalizes without spaces around the comma.
    expect(s!.maxWidth).toBe('min(640px, 65%)');
  });

  // ── 3. BUBBLE BG · SPEC §6 tokens (either #1E3A5F self or #1E293B other) ──
  test('bubble bg is one of the SPEC bubble tokens', async ({ page }) => {
    await gotoMessages(page);
    // Non-broadcast bubble — mock m1 body "ALPHA_TO_BETA_BODY".
    const s = await bubbleStyleByContent(page, 'ALPHA_TO_BETA_BODY');
    expect(s).not.toBeNull();
    // Accept-set = exactly the SPEC-defined bubble bg tokens; NOT a
    // shape match, NOT "any dark color" (see
    // feedback_tolerant_assertion_accepts_noncompliance.md +
    // feedback_allowlist_must_be_exact_value_not_shape_match.md).
    expect(['rgb(30, 41, 59)', 'rgb(30, 58, 95)']).toContain(s!.backgroundColor);
  });

  // ── 4. BROADCAST · SPEC §5 left 2px accent bar #7DD3FC ──────
  test('broadcast bubble has 2px left accent bar (#7DD3FC)', async ({ page }) => {
    await gotoMessages(page);
    const s = await broadcastBubbleStyle(page);
    expect(s).not.toBeNull();
    // #1E293B = the "other" bubble token — broadcast is not self.
    expect(s!.backgroundColor).toBe('rgb(30, 41, 59)');
    // 2px accent bar in SPEC accent color #7DD3FC = rgb(125, 211, 252).
    expect(s!.borderLeftWidth).toBe('2px');
    expect(s!.borderLeftColor).toBe('rgb(125, 211, 252)');
  });

  // ── 5. TIMESTAMP · SPEC §5 11px / #64748B ───────────────────
  test('timestamp is 11px in SPEC #64748B', async ({ page }) => {
    await gotoMessages(page);
    // The timestamp span sits at the end of each bubble header — pinned
    // by its ml-auto + text-[11px] combo. Query by containing formatted
    // time text ("ago" wording from timeAgo). We assert on ANY such
    // span — pipeline gives us multiple.
    const stamp = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      // Pick the first span whose Tailwind class list includes the
      // 11px arbitrary utility. That class is set only by the
      // timestamp render sites we changed.
      const el = spans.find((s) => s.className.includes('text-[11px]'));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, color: cs.color };
    });
    expect(stamp).not.toBeNull();
    expect(stamp!.fontSize).toBe('11px');
    // #64748B rendered as rgb(100, 116, 139).
    expect(stamp!.color).toBe('rgb(100, 116, 139)');
  });
});

import { test, expect } from '@playwright/test';
import { isOnline, sseCountFor } from '../app/lib/presence';

// #515 predicate unit test — the "narrow" companion to
// tests/e2e-515-presence.spec.ts. That one proves the three DOM
// consumers agree (integration). This one nails down the specific
// invariant every consumer now inherits from app/lib/presence.ts:
//
//   A node with `status='working'` but NO SSE entry MUST classify as
//   NOT online — because hub `status` doesn't age out on heartbeat
//   loss (see presence.ts and #520). Historically L4204's pinnedStatus
//   filter used pure `s.status !== 'offline'`, so pinning "offline"
//   dropped this zombie into "online" and it hid from the offline
//   filter — exactly the bug 通信龙 flagged as needing its own
//   assertion so a future refactor can't silently regress it.
//
// If any downstream consumer of `isOnline(...)` starts special-casing
// `status` again, THIS test goes red — matching the "unified predicate"
// contract more precisely than a UI-level test could without hitting
// the pin-intersection chip's two-dim activation requirement.

const NET = 'net_a';

test.describe('#515 predicate — SSE ground-truths presence, status alone lies', () => {
  test('SSE-reachable with any status → online', () => {
    const sse = { [`${NET}:working-sse`]: 1, [`${NET}:idle-sse`]: 1, [`${NET}:offline-sse`]: 2 };
    expect(isOnline({ alias: 'working-sse', network_id: NET }, sse)).toBe(true);
    expect(isOnline({ alias: 'idle-sse',    network_id: NET }, sse)).toBe(true);
    // Even a node the hub already flagged offline is "online" if SSE
    // is talking — the hub row is stale, the socket is ground truth.
    expect(isOnline({ alias: 'offline-sse', network_id: NET }, sse)).toBe(true);
  });

  test('SSE-less with status=working → NOT online (the L4204 zombie case)', () => {
    const sse = { [`${NET}:someone-else`]: 1 };
    // The regression bait — before #515 this same session slipped
    // through the pinned-offline filter and hid inside "online".
    expect(isOnline({ alias: 'working-no-sse', network_id: NET }, sse)).toBe(false);
  });

  test('SSE-less with any status → NOT online', () => {
    const sse = {};
    expect(isOnline({ alias: 'w', network_id: NET }, sse)).toBe(false);
    expect(isOnline({ alias: 'i', network_id: NET }, sse)).toBe(false);
    expect(isOnline({ alias: 'o', network_id: NET }, sse)).toBe(false);
  });

  test('legacy alias-only SSE key still resolves (no network_id scoping)', () => {
    const sse = { 'legacy-node': 1 };
    // Older hubs (< v0.7) key sse_sessions by bare alias. presence
    // falls back to bare-alias when scoped lookup misses.
    expect(isOnline({ alias: 'legacy-node' }, sse)).toBe(true);
    expect(isOnline({ alias: 'legacy-node', network_id: NET }, sse)).toBe(true);
    expect(sseCountFor({ alias: 'legacy-node' }, sse)).toBe(1);
  });

  test('undefined sseSessions map → NOT online (fail-closed)', () => {
    // If health hasn't loaded yet the map is undefined. Presence
    // MUST fail-closed — treating undefined as "everyone online"
    // would inflate the count during boot.
    expect(isOnline({ alias: 'x', network_id: NET }, undefined)).toBe(false);
  });

  test('SSE value === 0 → NOT online (PR #52 round-2 finding 1)', () => {
    // Older hubs may leave a zero-count entry in sse_sessions when the
    // last connection dropped without cleanup. `!== undefined` would
    // count this as online — inflating in exactly the direction #214 F2
    // set out to eliminate. `> 0` is the SSE-reachable ground truth.
    // page.tsx's old `!!sseLookup(s)` also treated 0 as false — so
    // preserving `> 0` keeps this a pure refactor for that call site.
    const sse = { [`${NET}:dead-edge`]: 0 };
    expect(sseCountFor({ alias: 'dead-edge', network_id: NET }, sse)).toBe(0);
    expect(isOnline({ alias: 'dead-edge', network_id: NET }, sse)).toBe(false);
  });
});

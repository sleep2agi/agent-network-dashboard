import { test, expect } from '@playwright/test';
import { presenceStatus } from '../app/lib/presence';

// #53 — three-state ambient presence. Companion to the
// e2e-53-blind-vs-empty DOM test: this one nails down the predicate
// contract every consumer inherits from presenceStatus().
//
// Two hand-computed fixtures cover the two states that must NEVER
// collapse to the same UI:
//   - sseSessions === undefined & health.sse_connections > 0 → 'blind'
//     (hub says there are live SSE, but the auth-gated map is missing
//     from THIS response — anonymous / wrong scope; must NOT render 0)
//   - sseSessions === {}         & health.sse_connections = 0 → 'ready'
//     (map is present and truly empty; safe to render 0 online)
//
// Also:
//   - sseSessions undefined & no health → 'loading' (boot)
//   - sseSessions undefined & health.sse_connections = 0 → 'loading'
//     (conservative — both look identical to us and neither should
//     inflate)

test.describe('#53 presenceStatus — undefined vs empty must NOT collapse', () => {
  test('sseSessions absent + hub reports live connections → blind', () => {
    expect(presenceStatus(undefined, { sse_connections: 97 })).toBe('blind');
    expect(presenceStatus(undefined, { sse_connections: 1  })).toBe('blind');
  });

  test('sseSessions absent + hub reports 0 connections → loading (conservative)', () => {
    // We can't tell "no map + 0 conns" from "hub-connection is stale on
    // its own reporting" — treat as loading and don't render "0 online".
    expect(presenceStatus(undefined, { sse_connections: 0 })).toBe('loading');
  });

  test('sseSessions absent + no health at all → loading (boot)', () => {
    expect(presenceStatus(undefined, null)).toBe('loading');
    expect(presenceStatus(undefined, undefined)).toBe('loading');
  });

  test('sseSessions present (even empty) → ready — trust the count', () => {
    // The whole point of #53: "map is {} " means "the caller CAN see
    // presence, and there's nothing to see". That is a DIFFERENT
    // condition from "map is missing entirely" and must render
    // differently.
    expect(presenceStatus({},                     { sse_connections: 0  })).toBe('ready');
    expect(presenceStatus({ 'net_a:one': 1 },     { sse_connections: 1  })).toBe('ready');
    // Even a self-contradictory response (map says 0 but conns > 0)
    // is still 'ready' at the map level — the map is authoritative
    // for who's online; the count-vs-map mismatch is a hub-side bug,
    // not a presence-blindness signal.
    expect(presenceStatus({},                     { sse_connections: 5  })).toBe('ready');
  });
});

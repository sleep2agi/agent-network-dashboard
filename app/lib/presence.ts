// #515 / #53: single source of truth for "is this node online?" across
// stats card / sidebar count / topology halos / chat popover / task
// panel @-mention picker. If you add a new place that decides "online"
// vs "offline", import isOnline() from here — don't roll your own.
//
// Definition: **SSE-reachable with at least one live connection**.
// Adopted by #214 F2 (originally in app/page.tsx). Consolidated here so
// consumers never disagree.
//
// Why `> 0` and not `!== undefined`:
// - Hub `getSSEStats()` writes `sessions[name] = arr.length` and the
//   three removal paths (cancel, rekey, dead-pushEvent) each `delete`
//   the key when the array empties. So on the current hub the value
//   is never `0` — but this JSON comes from a hub whose version this
//   dashboard doesn't control (see the legacy alias-only fallback
//   below for the version we already know we support), so treating
//   the map defensively costs nothing and keeps the definition
//   pointing the same direction #214 F2 took: SSE-reachable = "can I
//   talk to it right now", and a zero-count row is not that.
// - `!!sseLookup(s)` in the old page.tsx also treated 0 as false;
//   preserving that keeps this a pure refactor for page.tsx.
//
// SSE keys in health.sse_sessions are `network_id:alias` since v0.7+
// (per-network scoping). Legacy fallback: bare alias.

export type SseSessionsMap = Record<string, unknown>;

export type PresenceSubject = {
  alias: string;
  network_id?: string;
};

export function sseCountFor(session: PresenceSubject, sseSessions: SseSessionsMap | undefined): number | undefined {
  if (!sseSessions) return undefined;
  const scoped = session.network_id ? sseSessions[`${session.network_id}:${session.alias}`] : undefined;
  const value = (scoped ?? sseSessions[session.alias]) as number | undefined;
  return typeof value === 'number' ? value : undefined;
}

export function isOnline(session: PresenceSubject, sseSessions: SseSessionsMap | undefined): boolean {
  const n = sseCountFor(session, sseSessions);
  return typeof n === 'number' && n > 0;
}

// -----------------------------------------------------------------------
// #53: three-state ambient presence signal.
//
// `sse_sessions` on hub's /health is **auth-gated** (post `#495-followup`
// / `f28a6c1b`): an anonymous or wrong-scope caller gets the field
// **completely omitted** — indistinguishable at the JSON level from
// "no nodes connected".
//
// If we hand that state to isOnline() and only render numbers, the UI
// shows a confident, consistent, and *wrong* 0 online everywhere and
// the "three sites disagree" signal #515 used to have — which was
// itself the clue that something upstream was broken — is gone.
//
// So callers need to distinguish three cases:
//
//   'ready'    — sseSessions is present (even if empty {}). Trust the
//                count. `filter(isOnline).length` is the answer.
//   'blind'    — sseSessions is absent but hub `sse_connections > 0`.
//                Two fields contradict → we are seeing an anonymized
//                view. Do NOT render "0 online"; render an alert.
//   'loading'  — sseSessions is absent and no positive contradiction
//                (either health hasn't loaded, or hub reports 0
//                connections and no map). Render a placeholder — don't
//                inflate the count, but don't cry wolf either.
//
// Callers that render user-visible counts MUST branch on this. Callers
// that just need a per-node boolean (halos, chat-popover badges) can
// stay on isOnline() — those degrade gracefully to "everyone offline"
// which is the safer visual, while the ambient banner handles the
// "why".
// -----------------------------------------------------------------------

export type PresenceStatus = 'ready' | 'blind' | 'loading';

export type HealthShape = {
  sse_connections?: number;
} | null | undefined;

export function presenceStatus(
  sseSessions: SseSessionsMap | undefined,
  health: HealthShape,
): PresenceStatus {
  if (sseSessions !== undefined) return 'ready';
  // sseSessions is absent. Are we blind or truly empty/loading?
  const conns = health && typeof health.sse_connections === 'number' ? health.sse_connections : 0;
  // The contradiction case — hub says there are connections but the
  // map isn't in this response — is the strongest "you're anonymous"
  // signal we have.
  if (conns > 0) return 'blind';
  // No map AND hub reports 0 connections (or health hasn't loaded).
  // Both look identical to us, and both should render placeholders,
  // not "0 online" numbers. Conservative default = 'loading'.
  return 'loading';
}

/** Shared timestamp helpers for hub-sourced data.
 *
 *  Background — the CommHub serialises timestamps SQL-style without a
 *  zone ("2026-05-15 06:00:28"), but some test data uses full ISO
 *  ("…T06:00:28Z"). `Date.parse` on bare SQL is **local-time** in every
 *  browser the dashboard supports, so a UTC+8 operator silently sees
 *  every timestamp 8 h older than reality (Round 35 dug this out via
 *  the `isGhost` filter mis-fire).
 *
 *  Round 38 / Loop consolidates parsing — TopoGraph (R35), ChatPopover
 *  (R37) and utils.ts::timeAgo all mirrored the same SQL→UTC rewrite;
 *  one source of truth here. */

/** Parse a hub timestamp to ms-since-epoch, treating SQL-style strings
 *  as UTC. ISO strings (with `T`) bypass the rewrite and are parsed as-is.
 *  Returns null for empty / unparseable input. */
export function parseHubTime(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Format `dateStr` as a short relative-time string ("6m ago" / "2h ago").
 *  Future timestamps (clock skew) collapse to "just now". Returns null when
 *  the input doesn't parse — callers can decide on a fallback. */
export function relativeAgo(dateStr: string | null | undefined): string | null {
  const t = parseHubTime(dateStr);
  if (t === null) return null;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

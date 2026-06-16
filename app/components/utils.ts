/** Round 82: strip the most common markdown markup from agent-to-agent
 *  task / message bodies so single-line table previews read cleanly.
 *  Full original content stays in the expanded row / drawer / title=. */
export function previewContent(raw: string | null | undefined): string {
  if (!raw) return '--';
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // images: ![alt](src) → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // links:  [text](href) → text
    .replace(/`([^`]+)`/g, '$1')                // inline code: `x` → x
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim() || '--';
}

// Round 44 / Loop: timeAgo now delegates to the shared lib/time helper.
// The old in-line `replace + 'Z'` parse appended a Z to already-ISO
// inputs (producing "…ZZ", browser-fragile) — strict-superset semantics
// preserved for SQL-style inputs, fixed for ISO. Plus a 'just now' fallback
// when clock skew puts the timestamp in the future. Five callers benefit:
// /admin · /logs · /settings/networks · InboxPanel · /messages.
import { relativeAgo } from '../lib/time';
export function timeAgo(dateStr: string): string {
  return relativeAgo(dateStr) ?? '--';
}

export function statusColor(status: string, hasSse: boolean): string {
  if (hasSse && status === 'working') return 'bg-green-500';
  if (hasSse && status === 'idle') return 'bg-emerald-400';
  if (hasSse) return 'bg-blue-400';
  if (status === 'offline') return 'bg-gray-500';
  return 'bg-yellow-400';
}

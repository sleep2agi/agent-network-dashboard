/** Single source of truth for task status colors. Both `/tasks` (chip
 *  strip, badge, distribution bar) and the Overview Recent Activity row
 *  used to ship their own incomplete maps; round 66 consolidates them
 *  here so adding a new status updates every consumer at once.
 *
 *  Order in `TASK_STATUSES` is chronological-ish: lifecycle progress on
 *  the left, terminal-good (`closed`) in the middle, terminal-bad
 *  (`failed`/`cancelled`/`expired`) on the right. */

export const TASK_STATUSES = [
  'created',
  'delivered',
  'acked',
  'running',
  'replied',
  'closed',
  'failed',
  'cancelled',
  'expired',
] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

/** Pill / chip background+text+border. Tailwind classes, not inlined hex,
 *  because chips are static class names safe from purge. */
/** #217 D3 (OpenWebUI-style color restraint): the 9-hue rainbow is
 *  collapsed to a semantic triad — green = actively running, red =
 *  failed, gray = everything else (in-flight states in lighter gray,
 *  terminal states dimmer). Color now means something instead of
 *  decorating every enum value. */
export const STATUS_CHIP_CLASS: Record<string, string> = {
  created:   'bg-gray-500/10 text-gray-400 border-gray-500/20',
  delivered: 'bg-gray-500/10 text-gray-300 border-gray-500/20',
  acked:     'bg-gray-500/10 text-gray-300 border-gray-500/20',
  running:   'bg-green-500/10 text-green-300 border-green-500/20',
  replied:   'bg-gray-500/10 text-gray-300 border-gray-500/20',
  closed:    'bg-gray-500/10 text-gray-500 border-gray-500/20',
  failed:    'bg-red-500/10 text-red-300 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  expired:   'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

/** Inline hex dots — used wherever Tailwind would purge dynamic class
 *  names (`bg-${family}-400`). Style attribute carries the color. */
export const STATUS_DOT_HEX: Record<string, string> = {
  created:   '#9ca3af',
  delivered: '#9ca3af',
  acked:     '#9ca3af',
  running:   '#4ade80',
  replied:   '#9ca3af',
  closed:    '#6b7280',
  failed:    '#f87171',
  cancelled: '#6b7280',
  expired:   '#6b7280',
};

/** Session lifecycle (distinct from task lifecycle above). Shared by
 *  /nodes status pills and /admin Online Sessions row chips so an
 *  agent in `blocked` state reads the same color everywhere.
 *  Round 91 — extracted from app/nodes/page.tsx. */
/** D3: idle drops from blue to gray — only working (green), blocked
 *  (amber, actionable) and error (red) earn color. */
export const SESSION_STATUS_CHIP_CLASS: Record<string, string> = {
  working: 'bg-green-500/10 text-green-300 border-green-500/20',
  idle:    'bg-gray-500/10 text-gray-300 border-gray-500/20',
  blocked: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  error:   'bg-red-500/10 text-red-300 border-red-500/20',
  offline: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

/** Text-only color for session status. Used where a chip background
 *  would be too heavy — e.g. /node detail header status label. */
export const SESSION_STATUS_TEXT_CLASS: Record<string, string> = {
  working: 'text-green-400',
  idle:    'text-gray-400',
  blocked: 'text-yellow-400',
  error:   'text-red-400',
  offline: 'text-gray-500',
};

/** Solid bar segment background for the Tasks distribution bar. */
export const STATUS_BAR_CLASS: Record<string, string> = {
  created:   'bg-gray-500',
  delivered: 'bg-gray-400',
  acked:     'bg-gray-300',
  running:   'bg-green-500',
  replied:   'bg-gray-400',
  closed:    'bg-gray-600',
  failed:    'bg-red-500',
  cancelled: 'bg-gray-600',
  expired:   'bg-gray-600',
};

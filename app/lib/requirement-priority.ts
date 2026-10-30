/**
 * Priority display — the Hub stores high/normal/low/lowest, the APP shows
 * P0–P3. Keep the wire values untouched and translate only for humans.
 */
export const PRIORITY_KEYS = ['high', 'normal', 'low', 'lowest'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];

export const PRIORITY_LABEL: Record<string, string> = {
  high: 'P0',
  normal: 'P1',
  low: 'P2',
  lowest: 'P3',
};

export function priorityLabel(value: string): string {
  return PRIORITY_LABEL[value] ?? value;
}

/** Tooltip: “P0 · high”, so the wire value is never a mystery. */
export function priorityTitle(value: string): string {
  const label = PRIORITY_LABEL[value];
  return label ? `${label} · ${value}` : value;
}

export function isPriorityKey(value: string): value is PriorityKey {
  return (PRIORITY_KEYS as readonly string[]).includes(value);
}

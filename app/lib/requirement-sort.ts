/**
 * Requirement sorting — mirrors the APP's `sortRows` idea, but only over the
 * rows the page has already loaded. The UI must label it as loaded-result
 * sorting so nobody mistakes it for a Hub-wide order.
 */

export type SortKey = 'seq' | 'title' | 'priority' | 'due' | 'updated';
export type SortDir = 'asc' | 'desc';
export interface SortSpec { key: SortKey | ''; dir: SortDir }

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: 'seq', label: '序号' },
  { key: 'title', label: '标题' },
  { key: 'priority', label: '优先级' },
  { key: 'due', label: '截止' },
  { key: 'updated', label: '最近更新' },
];

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2, lowest: 3 };

export function parseSort(params: { get(key: string): string | null }): SortSpec {
  const key = params.get('sort');
  const dir = params.get('dir');
  return {
    key: key && SORT_KEYS.some(option => option.key === key) ? (key as SortKey) : '',
    dir: dir === 'desc' ? 'desc' : 'asc',
  };
}

interface SortableRequirement {
  id: string;
  seq: number;
  name: string;
  priority: string;
  due?: string | null;
  updatedAt?: string | null;
}

function dueValue(value?: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY; // missing due always sorts last
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function updatedValue(value?: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Stable: ties fall back to the sequence number, then id. */
export function sortRequirements<T extends SortableRequirement>(rows: readonly T[], spec: SortSpec): T[] {
  if (!spec.key) return [...rows];
  const sign = spec.dir === 'asc' ? 1 : -1;
  const base = (a: T, b: T) => a.seq - b.seq || a.id.localeCompare(b.id);
  // Missing due/updated values stay last in BOTH directions: "never scheduled"
  // or "never updated" is not the newest/oldest item.
  const missingLast = (aMissing: boolean, bMissing: boolean, delta: number): number => {
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? 1 : -1);
    return delta * sign;
  };
  const compare = (a: T, b: T): number => {
    switch (spec.key) {
      case 'seq': return (a.seq - b.seq) * sign;
      case 'title': return a.name.localeCompare(b.name, 'zh-Hans-CN') * sign;
      case 'priority': return ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)) * sign;
      case 'due': {
        const av = dueValue(a.due), bv = dueValue(b.due);
        return missingLast(!Number.isFinite(av), !Number.isFinite(bv), av - bv);
      }
      case 'updated': {
        const av = updatedValue(a.updatedAt), bv = updatedValue(b.updatedAt);
        return missingLast(!Number.isFinite(av), !Number.isFinite(bv), av - bv);
      }
      default: return 0;
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || base(a, b));
}

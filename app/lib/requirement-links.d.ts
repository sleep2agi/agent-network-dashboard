export function shortIdLabel(seq: unknown): string | null;

export function requirementDetailPath(id: unknown): string | null;

export function personLabel(
  ref: {
    kind?: string;
    id?: string;
    name?: string;
    display_name?: string;
    displayName?: string;
    alias?: string;
  } | null | undefined,
  people?: ReadonlyArray<{
    kind?: string;
    id?: string;
    name?: string;
    display_name?: string;
    displayName?: string;
    alias?: string;
  }>,
): string;

export function matchesRequirementQuery(
  item: { id?: string; name?: string; seq?: number | null } | null | undefined,
  query: string,
): boolean;

export function periodFromIso(period: string, now: number): string | null;

export type RequirementStats = {
  done: number;
  doing: number;
  pool: number;
  abandoned: number;
  leaders: Array<{ kind?: string; id?: string; n?: number; spark?: number[]; display_name?: string; name?: string; alias?: string }>;
  recent: Array<{ id: string; seq?: number | null; name?: string; completed_at?: string; completed_by?: { kind?: string; id?: string; display_name?: string; name?: string; alias?: string } | null }>;
  daily: Array<{ date: string; n?: number }>;
};

export function readStats(raw: unknown): RequirementStats | null;

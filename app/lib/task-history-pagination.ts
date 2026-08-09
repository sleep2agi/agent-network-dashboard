export interface TaskHistoryRow {
  task_id: string;
  created_at: string;
  client_request_id?: string;
}

export interface TaskHistoryCursor {
  task_id: string;
  created_at: string;
}

export function buildTaskHistoryUrl(
  alias: string,
  limit: number,
  cursor?: TaskHistoryCursor,
): string {
  const query = new URLSearchParams({ to_name: alias, limit: String(limit) });
  if (cursor) {
    query.set('before', cursor.created_at);
    query.set('before_task_id', cursor.task_id);
  }
  return `/api/hub/tasks?${query.toString()}`;
}

export function oldestTaskHistoryCursor(
  oldestFirstRows: readonly TaskHistoryRow[],
): TaskHistoryCursor | null {
  const row = oldestFirstRows.find((task) =>
    task.task_id
    && !task.task_id.startsWith('tmp-')
    && !task.client_request_id
    && task.created_at,
  );
  return row ? { task_id: row.task_id, created_at: row.created_at } : null;
}

function rowTime(value: string): number {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeTaskHistoryPage<T extends TaskHistoryRow>(
  current: readonly T[],
  newestFirstPage: readonly T[],
  persistedRequestIds: ReadonlySet<string> = new Set(),
): T[] {
  const fetchedIds = new Set(newestFirstPage.map((task) => task.task_id));
  const retained = current.filter((task) =>
    !fetchedIds.has(task.task_id)
    && (!task.client_request_id || !persistedRequestIds.has(task.client_request_id)),
  );
  return [...newestFirstPage, ...retained].sort((a, b) => {
    const timeDelta = rowTime(a.created_at) - rowTime(b.created_at);
    return timeDelta || a.task_id.localeCompare(b.task_id);
  });
}

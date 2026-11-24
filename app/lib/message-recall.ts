export interface RecallableTaskShape {
  task_id: string;
  status: string;
  content?: string | null;
  result?: string | null;
  meta_json?: string | null;
  meta?: Record<string, unknown> | null;
}

const RECALLABLE_STATUSES = new Set(['created', 'delivered', 'acked', 'running']);

export function parseTaskMetaObject(
  metaJson?: string | null,
  metaObj?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (metaObj && typeof metaObj === 'object' && !Array.isArray(metaObj)) return metaObj;
  if (!metaJson || typeof metaJson !== 'string') return null;
  try {
    const parsed = JSON.parse(metaJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed metadata JSON from legacy rows.
  }
  return null;
}

export function isRecalledTask(task: Pick<RecallableTaskShape, 'status' | 'meta_json' | 'meta'>): boolean {
  const meta = parseTaskMetaObject(task.meta_json, task.meta);
  return meta?.recalled === true;
}

export function canRecallDashboardTask(task: RecallableTaskShape, isOwn: boolean): boolean {
  if (!isOwn) return false;
  if (!task.task_id || task.task_id.startsWith('tmp-')) return false;
  if (isRecalledTask(task)) return false;
  if (typeof task.result === 'string' && task.result.trim().length > 0) return false;
  return RECALLABLE_STATUSES.has(task.status);
}

export function markDashboardTaskRecalled<T extends RecallableTaskShape>(
  task: T,
  recalledAt: string = new Date().toISOString(),
  recalledBy?: string,
): T {
  const existing = parseTaskMetaObject(task.meta_json, task.meta) ?? {};
  const nextMeta: Record<string, unknown> = {
    ...existing,
    recalled: true,
    recalled_at: recalledAt,
    ...(recalledBy ? { recalled_by: recalledBy } : {}),
  };
  return {
    ...task,
    status: 'cancelled',
    result: '',
    meta_json: JSON.stringify(nextMeta),
  };
}

export function reeditContentOf(content?: string | null): string {
  if (!content) return '';
  return content.replace(/\n*\[Dashboard 附件(?:待上传)?\][\s\S]*$/, '').trim();
}

'use client';

import { AliasAvatar } from './AliasAvatar';
import { previewContent } from './utils';
import { STATUS_CHIP_CLASS, STATUS_DOT_HEX } from '../lib/status';

// Task-list rail for the /tasks two-column layout (类飞书 "list + detail").
// Rendered inside TasksView's <aside> — this file is intentionally small
// and only owns the list-row shape, so the same component can back both
// desktop rail and (later) a mobile drawer without duplicating the row
// template.
//
// #Stage-tasks: mirrors NodeList.tsx narrow-rail pattern. Row click calls
// onSelect(task_id) so the parent can drive URL/state; row does NOT know
// about routing.

export interface TaskListItem {
  task_id: string;
  network_id?: string;
  from_name: string;
  to_name: string;
  status: string;
  priority: string;
  content: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: TaskListItem[];
  selectedId: string | null;
  onSelect: (task_id: string) => void;
}) {
  return (
    <div
      data-testid="task-list-rail"
      className="flex flex-col h-full max-h-screen overflow-y-auto"
    >
      {tasks.length === 0 ? (
        <div className="px-4 py-6 text-xs text-gray-600 text-center">
          没有匹配的任务
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[#1c1c1f]">
          {tasks.map((t) => {
            const active = t.task_id === selectedId;
            return (
              <li key={t.task_id}>
                <button
                  type="button"
                  data-task-row
                  data-task-id={t.task_id}
                  data-selected={active ? 'true' : 'false'}
                  onClick={() => onSelect(t.task_id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    active
                      ? 'bg-cyan-500/10 border-l-2 border-cyan-500'
                      : 'border-l-2 border-transparent hover:bg-[#1c1c1f]/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {/* status dot + label */}
                    <span
                      aria-hidden
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_DOT_HEX[t.status] || '#6b7280' }}
                    />
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        STATUS_CHIP_CLASS[t.status] ||
                        'bg-gray-500/10 text-gray-400 border-gray-500/20'
                      }`}
                    >
                      {t.status}
                    </span>
                    {t.priority === 'high' && (
                      <span className="text-[10px] text-red-400 shrink-0">HIGH</span>
                    )}
                    <span className="ml-auto text-[10px] text-gray-600 tabular-nums shrink-0">
                      {timeAgo(t.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-300 min-w-0 mb-1">
                    {t.from_name && <AliasAvatar alias={t.from_name} size={14} />}
                    <span className="truncate max-w-[35%]">{t.from_name || '--'}</span>
                    <span className="text-gray-600 shrink-0">→</span>
                    {t.to_name && <AliasAvatar alias={t.to_name} size={14} />}
                    <span className="truncate max-w-[35%]">{t.to_name || '--'}</span>
                  </div>
                  <div
                    className="text-[11px] text-gray-500 line-clamp-2 leading-snug"
                    title={t.content}
                  >
                    {previewContent(t.content) || <span className="italic">(no content)</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

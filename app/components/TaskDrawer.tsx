'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from './utils';
import Link from 'next/link';
import { AliasAvatar } from './AliasAvatar';

interface TaskDetail {
  task_id: string;
  from_name: string;
  to_name: string;
  status: string;
  priority: string;
  content: string;
  result: string;
  created_at: string;
  delivered_at: string;
  started_at: string;
  completed_at: string;
  expires_at: string;
}

interface TaskEvent {
  id: number;
  event_type: string;
  from_status: string;
  to_status: string;
  detail: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  created: 'text-gray-400', delivered: 'text-blue-400', running: 'text-green-400',
  replied: 'text-purple-400', failed: 'text-red-400', closed: 'text-gray-500',
};

interface TaskDrawerProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDrawer({ taskId, onClose }: TaskDrawerProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [taskRes, eventsRes] = await Promise.all([
          fetch(`/api/hub/tasks?task_id=${encodeURIComponent(taskId)}`),
          fetch(`/api/hub/task-events?task_id=${encodeURIComponent(taskId)}&limit=50`),
        ]);
        const taskData = await taskRes.json();
        const eventsData = await eventsRes.json();
        if (taskData.tasks?.[0]) setTask(taskData.tasks[0]);
        setEvents(eventsData.events || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [taskId]);

  /** Timeline steps — same 4 hops every task goes through. `time` is set
   *  when the hop has happened; missing time means pending. Round 36 adds
   *  `key` for the "current step" highlight + the `done` flag for layout. */
  const timeline = task ? [
    { key: 'created',   label: 'Created',   time: task.created_at,    color: 'bg-gray-400'  },
    { key: 'delivered', label: 'Delivered', time: task.delivered_at,  color: 'bg-blue-400'  },
    { key: 'started',   label: 'Started',   time: task.started_at,    color: 'bg-green-400' },
    { key: 'completed', label: 'Completed', time: task.completed_at,  color: 'bg-purple-400'},
  ].map(s => ({ ...s, done: !!s.time })) : [];

  /** Index of the highest-completed step. The step *after* this index is
   *  the "current" one (in-progress). When all are done, currentIdx = -1. */
  const currentStepIdx = timeline.findIndex(s => !s.done);
  const isActive = task && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'expired' && task.status !== 'cancelled';

  const duration = task?.started_at && task?.completed_at
    ? Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 1000)
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 anet-fade-in" onClick={onClose} />
      <div className="fixed top-0 right-0 h-[100dvh] w-full lg:w-[500px] bg-[#0b0b0d] border-l border-[#26262b] z-50 flex flex-col shadow-2xl shadow-black/60 overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#26262b] bg-[#111113] sticky top-0">
          <div>
            <div className="text-sm font-semibold text-white">Task Detail</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{taskId.slice(0, 16)}...</div>
          </div>
          {/* R16 of #190: same chat-panel close pattern — was ~32 px
              tap target; lift to a uniform 44 x 44 hit zone. */}
          <button onClick={onClose} aria-label="Close task drawer" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-500 hover:text-white rounded-lg hover:bg-[#1c1c1f]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : !task ? (
          <div className="text-center py-16 text-gray-500">Task not found</div>
        ) : (
          <div className="px-5 py-5 space-y-5">
            {/* Status + Priority */}
            <div className="flex items-center gap-3">
              <span className={`text-lg font-bold ${STATUS_COLORS[task.status] || 'text-gray-400'}`}>{task.status}</span>
              {task.priority !== 'normal' && (
                <span className={`text-xs px-2 py-0.5 rounded border ${task.priority === 'high' ? 'text-red-300 border-red-500/20' : 'text-gray-400 border-gray-600/20'}`}>{task.priority}</span>
              )}
              {duration !== null && (
                <span className="text-xs text-gray-500">⏱ {duration < 60 ? `${duration}s` : `${Math.floor(duration/60)}m ${duration%60}s`}</span>
              )}
            </div>

            {/* From → To — round 41: use AliasAvatar so from/to colours
                match the rest of the app instead of the legacy blue/cyan
                hardcode. */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              {task.from_name && <AliasAvatar alias={task.from_name} size={18} />}
              <span className="text-gray-200 font-medium">{task.from_name || '--'}</span>
              <span className="text-gray-600">&rarr;</span>
              {task.to_name && <AliasAvatar alias={task.to_name} size={18} />}
              <span className="text-gray-200 font-medium">{task.to_name || '--'}</span>
            </div>

            {/* Timeline — round 36 polish: relative timestamps, current-step
                pulse if task is still in flight, full ISO in title=. */}
            <div className="bg-[#161618] border border-[#26262b] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Timeline</div>
                {duration !== null && (
                  <div className="text-[10px] text-gray-600">
                    {duration < 60 ? `${duration}s` : `${Math.floor(duration/60)}m ${duration%60}s`} runtime
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {timeline.map((step, i) => {
                  const isCurrent = isActive && i === currentStepIdx;
                  const isNextDone = !!timeline[i+1]?.done;
                  return (
                    <div key={step.key} className="flex items-start gap-3">
                      <div className="flex flex-col items-center pt-0.5">
                        <span
                          className={`relative w-3 h-3 rounded-full shrink-0 ${
                            step.done ? step.color : 'bg-gray-700'
                          }`}
                        >
                          {isCurrent && (
                            <span
                              aria-hidden
                              className="absolute -inset-1 rounded-full border border-current opacity-60 anet-current-step-pulse"
                              style={{ borderColor: 'currentColor' }}
                            />
                          )}
                        </span>
                        {i < timeline.length - 1 && (
                          <div className={`w-0.5 h-5 mt-1 ${
                            step.done && isNextDone ? 'bg-gray-500' : step.done ? 'bg-gradient-to-b from-gray-500 to-gray-800' : 'bg-gray-800'
                          }`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium flex items-center gap-2 ${
                          step.done ? 'text-gray-200' : isCurrent ? 'text-cyan-300' : 'text-gray-600'
                        }`}>
                          <span>{step.label}</span>
                          {isCurrent && <span className="text-[9px] uppercase tracking-wide text-cyan-400">in&nbsp;progress</span>}
                        </div>
                        <div className="text-[10px] text-gray-500" title={step.time || undefined}>
                          {step.time ? timeAgo(step.time) : isCurrent ? '—' : 'Pending'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Content */}
            <div className="bg-[#161618] border border-[#26262b] rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase mb-2">Input</div>
              <div className="text-sm text-gray-300 whitespace-pre-wrap">{task.content || '--'}</div>
            </div>

            {/* Result */}
            {task.result && (
              <div className="bg-[#161618] border border-[#26262b] rounded-xl p-4">
                <div className="text-xs text-gray-500 uppercase mb-2">Output</div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{task.result}</div>
              </div>
            )}

            {/* Events */}
            {events.length > 0 && (
              <div className="bg-[#161618] border border-[#26262b] rounded-xl p-4">
                <div className="text-xs text-gray-500 uppercase mb-2">Events ({events.length})</div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {events.map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-[11px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        e.to_status === 'running' ? 'bg-green-400' : e.to_status === 'replied' ? 'bg-purple-400' : e.to_status === 'failed' ? 'bg-red-400' : 'bg-blue-400'
                      }`} />
                      <span className="text-gray-400">{e.event_type}</span>
                      {e.from_status && <span className="text-gray-600">{e.from_status}→{e.to_status}</span>}
                      <span className="text-gray-600 ml-auto">{timeAgo(e.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="text-[10px] text-gray-600 space-y-1">
              <div>Task ID: {task.task_id}</div>
              {task.expires_at && <div>Expires: {task.expires_at}</div>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

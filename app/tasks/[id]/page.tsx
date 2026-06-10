'use client';

import { use } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { timeAgo } from '../../components/utils';
import { STATUS_CHIP_CLASS } from '../../lib/status';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 401) { window.location.assign('/login'); throw new Error('unauthorized'); }
  return res.json();
};

interface TimelineStep {
  label: string;
  time: string | null;
  color: string;
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  const activeCount = steps.filter(s => s.time).length;

  return (
    <div className="relative">
      {steps.map((step, i) => {
        const done = !!step.time;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.label} className="flex gap-4 pb-6 last:pb-0">
            {/* Line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                done ? `${step.color} border-current` : 'border-gray-700 bg-transparent'
              }`} />
              {!isLast && (
                <div className={`w-0.5 flex-1 mt-1 ${
                  done && steps[i + 1]?.time ? 'bg-cyan-500/40' : 'bg-gray-800'
                }`} />
              )}
            </div>
            {/* Content */}
            <div className="min-w-0 -mt-0.5">
              <div className={`text-sm font-medium ${done ? 'text-gray-200' : 'text-gray-600'}`}>
                {step.label}
              </div>
              <div className="text-xs text-gray-500">
                {step.time ? `${timeAgo(step.time)} — ${step.time}` : 'Pending'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useSWR(
    `/api/hub/tasks?task_id=${encodeURIComponent(id)}`,
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: eventsData } = useSWR(
    `/api/hub/task-events?task_id=${encodeURIComponent(id)}&limit=50`,
    fetcher,
    { refreshInterval: 10000 },
  );

  const task = data?.tasks?.[0];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-800 rounded" />
          <div className="h-64 bg-gray-800/20 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 text-4xl mb-4">--</div>
          <p className="text-gray-400">Task not found</p>
          <Link href="/tasks" className="text-cyan-400 text-sm mt-2 inline-block">Back to tasks</Link>
        </div>
      </div>
    );
  }

  const statusColor = STATUS_CHIP_CLASS[task.status] || STATUS_CHIP_CLASS.created;
  const steps: TimelineStep[] = [
    { label: 'Created', time: task.created_at, color: 'text-gray-400' },
    { label: 'Delivered', time: task.delivered_at, color: 'text-blue-400' },
    { label: 'Started', time: task.started_at, color: 'text-green-400' },
    { label: 'Completed', time: task.completed_at, color: 'text-purple-400' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/tasks" className="text-gray-500 hover:text-gray-300 text-sm lg:ml-0 ml-10">&larr; Tasks</Link>
        <h1 className="text-xl font-bold text-white truncate">Task Detail</h1>
        <span className={`text-xs px-2 py-0.5 rounded-md border ${statusColor}`}>{task.status}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Timeline + Info */}
        <div className="space-y-4">
          <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Timeline</h2>
            <Timeline steps={steps} />
          </div>

          <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Info</h2>
            <div className="space-y-2 text-xs">
              {[
                ['Task ID', task.task_id],
                ['From', task.from_name],
                ['To', task.to_name],
                ['Priority', task.priority],
                ['Status', task.status],
                ['Expires', task.expires_at],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-300 truncate max-w-[200px]" title={String(val || '')}>{String(val || '--')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Content + Result */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-2">Content</h2>
            <div className="text-sm text-gray-300 whitespace-pre-wrap bg-[#0a0a15] rounded-lg px-4 py-3 border border-[#1a1a2a]">
              {task.content || '--'}
            </div>
          </div>

          {task.result && (
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">Result</h2>
              <div className="text-sm text-gray-300 whitespace-pre-wrap bg-[#0a0a15] rounded-lg px-4 py-3 border border-[#1a1a2a] max-h-96 overflow-y-auto">
                {task.result}
              </div>
            </div>
          )}

          {/* Task Events */}
          {eventsData?.events && eventsData.events.length > 0 && (
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Events ({eventsData.events.length})</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {eventsData.events.map((e: { id: number; event_type: string; from_status: string; to_status: string; detail: string; created_at: string }, i: number) => (
                  <div key={e.id || i} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      e.to_status === 'running' ? 'bg-green-400' : e.to_status === 'replied' ? 'bg-purple-400' : e.to_status === 'failed' ? 'bg-red-400' : 'bg-blue-400'
                    }`} />
                    <span className="text-gray-400">{e.event_type}</span>
                    {e.from_status && <span className="text-gray-600">{e.from_status} → {e.to_status}</span>}
                    <span className="text-gray-600 ml-auto shrink-0">{timeAgo(e.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

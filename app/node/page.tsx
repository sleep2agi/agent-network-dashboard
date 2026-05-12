'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { TaskChatPanel } from '../components/TaskChatPanel';
import { timeAgo } from '../components/utils';

interface SessionDetail {
  resume_id: string;
  alias: string;
  status: string;
  agent: string;
  server: string;
  hostname: string;
  task: string;
  output: string;
  progress: number;
  score: number;
  registered_at: string;
  updated_at: string;
  project_dir: string;
  tmux_name: string;
  ip: string;
  node_id: string;
  session_id: string;
  config_path: string;
  channels: string[];
  last_seen_at: string;
  model: string;
  version: string;
}

interface Message {
  id: string;
  content: string;
  from_session: string;
  priority: string;
  created_at: string;
  type: string;
}

function TmuxViewer({ tmuxName }: { tmuxName: string }) {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchTmux = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hub/tmux?name=${encodeURIComponent(tmuxName)}`);
      const data = await res.json();
      setOutput(data.output || data.error || 'No output');
    } catch { setOutput('Failed to fetch'); }
    setLoading(false);
  };

  return (
    <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-300">Terminal ({tmuxName})</h2>
        <div className="flex gap-2">
          <button onClick={fetchTmux} disabled={loading}
            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-gray-600">
            {loading ? 'Loading...' : 'Capture'}
          </button>
          {output && (
            <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500 hover:text-gray-300">
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>
      {output && (
        <pre className={`text-[11px] text-green-300 bg-[#050510] rounded-lg px-3 py-2 border border-[#1a1a2a] overflow-x-auto whitespace-pre font-mono ${expanded ? 'max-h-96' : 'max-h-32'} overflow-y-auto`}>
          {output}
        </pre>
      )}
      {!output && <p className="text-xs text-gray-600">Click Capture to view terminal output</p>}
    </div>
  );
}

function NodeDetailContent() {
  const searchParams = useSearchParams();
  const alias = searchParams.get('alias') || '';
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [inbox, setInbox] = useState<Message[]>([]);
  const [sse, setSse] = useState(0);
  const [error, setError] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    if (!alias) return;
    try {
      const res = await fetch(`/api/hub/session?alias=${encodeURIComponent(alias)}`);
      const data = await res.json();
      if (data.session) setSession(data.session);
      if (data.inbox) setInbox(data.inbox);
      setSse(data.sse || 0);
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, [alias]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const [sendError, setSendError] = useState('');

  const sendTask = async () => {
    if (!sendMsg.trim() || !alias) return;
    setSending(true);
    setSendError('');
    try {
      const res = await fetch('/api/hub/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias, task: sendMsg }),
      });
      const data = await res.json();
      if (data.ok) {
        setSendMsg('');
        setTimeout(fetchData, 2000);
      } else {
        setSendError(data.error || 'Send failed');
      }
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    }
    setSending(false);
  };

  if (!alias) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-6 font-mono flex items-center justify-center">
        <p className="text-gray-500">No alias specified. <Link href="/" className="text-blue-400 hover:underline">Back to dashboard</Link></p>
      </div>
    );
  }

  const statusColor = session?.status === 'working' ? 'text-green-400' :
    session?.status === 'idle' ? 'text-blue-400' : 'text-gray-500';

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/nodes" className="text-gray-500 hover:text-gray-300 text-sm lg:ml-0 ml-10">&larr; Nodes</Link>
        <div className="flex items-center gap-3">
          <span className={`inline-block w-3 h-3 rounded-full ${
            sse > 0 ? (session?.status === 'working' ? 'bg-green-500 animate-pulse' : 'bg-emerald-400') : 'bg-gray-500'
          }`} />
          <h1 className="text-2xl font-bold text-white">{alias}</h1>
          <span className={`text-sm ${statusColor}`}>{session?.status || 'unknown'}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-2 rounded-lg mb-6 text-sm">{error}</div>
      )}

      {/* Full-width tabbed layout */}
      <NodeFullPanel alias={alias} session={session} sse={sse} sendMsg={sendMsg} setSendMsg={setSendMsg} sending={sending} sendTask={sendTask} sendError={sendError} />
    </div>
  );
}

function NodeFullPanel({ alias, session, sse, sendMsg, setSendMsg, sending, sendTask, sendError }: {
  alias: string; session: any; sse: number; sendMsg: string; setSendMsg: (v: string) => void; sending: boolean; sendTask: () => void; sendError: string;
}) {
  const [tab, setTab] = useState<'chat' | 'events' | 'info'>('chat');
  const [events, setEvents] = useState<Array<{ id: number; event_type: string; from_status: string; to_status: string; detail: string; created_at: string }>>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  useEffect(() => {
    if (tab === 'events' && !eventsLoaded) {
      fetch('/api/hub/task-events?limit=50').then(r => r.json()).then(d => {
        setEvents(d.events || []);
        setEventsLoaded(true);
      }).catch(() => setEventsLoaded(true));
    }
  }, [tab, eventsLoaded]);

  return (
    <div className="bg-[#0d0d1a] border border-[#2a2a4a] rounded-xl overflow-hidden h-[calc(100vh-140px)] flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-[#2a2a4a] bg-[#0a0a15] shrink-0">
        {(['chat', 'events', 'info'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {t === 'chat' ? '💬 Chat' : t === 'events' ? '📋 Events' : '📊 Info'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' && (
          <TaskChatPanel alias={alias} onClose={() => {}} inline />
        )}

        {tab === 'events' && (
          <EventsTimeline events={events} loading={!eventsLoaded} />
        )}

        {tab === 'info' && (
          <div className="p-4 overflow-y-auto h-full space-y-4 max-w-2xl">
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Node Info</h2>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Node ID', value: session?.node_id, alwaysShow: true },
                { label: 'Session ID', value: session?.session_id, alwaysShow: true },
                { label: 'Resume ID', value: session?.resume_id, alwaysShow: true },
                { label: 'Alias', value: session?.alias, alwaysShow: true },
                { label: 'Agent', value: session?.agent, alwaysShow: true },
                { label: 'Model', value: session?.model, alwaysShow: true },
                { label: 'Version', value: session?.version },
                { label: 'Server', value: session?.server, alwaysShow: true },
                { label: 'Hostname', value: session?.hostname, alwaysShow: true },
                { label: 'IP', value: session?.ip, alwaysShow: true },
                { label: 'Project', value: session?.project_dir },
                { label: 'Config', value: session?.config_path, alwaysShow: true },
                { label: 'Channels', value: session?.channels?.length ? (Array.isArray(session.channels) ? session.channels.join(', ') : session.channels) : null, alwaysShow: true },
                { label: 'Tmux', value: session?.tmux_name },
                { label: 'SSE', value: sse > 0 ? `Connected (${sse})` : 'Disconnected', alwaysShow: true },
                { label: 'Progress', value: session?.progress ? `${session.progress}%` : null },
                { label: 'Score', value: session?.score },
                { label: 'Last Seen', value: session?.last_seen_at, alwaysShow: true },
                { label: 'Registered', value: session?.registered_at, alwaysShow: true },
                { label: 'Updated', value: session?.updated_at, alwaysShow: true },
              ].map(({ label, value, alwaysShow }) => (value || alwaysShow) ? (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-gray-500 shrink-0">{label}</span>
                  <span className="text-gray-300 truncate max-w-[200px]" title={value ? String(value) : '--'}>
                    {value ? String(value) : '--'}
                  </span>
                </div>
              ) : null)}
            </div>
          </div>

          {/* Current Task */}
          {session?.task && (
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">Current Task</h2>
              <p className="text-xs text-gray-400 whitespace-pre-wrap">{session.task}</p>
            </div>
          )}

          {/* Output */}
          {session?.output && (
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">Last Output</h2>
              <p className="text-xs text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto">{session.output}</p>
            </div>
          )}

          {/* Send Task */}
          <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-2">Send Task</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={sendMsg}
                onChange={e => setSendMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTask()}
                placeholder={`Send task to ${alias}...`}
                className="flex-1 bg-[#0a0a15] border border-[#2a2a4a] rounded px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={sendTask}
                disabled={sending || !sendMsg.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs rounded transition-colors"
              >
                {sending ? '...' : 'Send'}
              </button>
            </div>
            {sendError && <div className="mt-2 text-xs text-red-400">{sendError}</div>}
          </div>

          {/* Tmux Terminal */}
          {session?.tmux_name && (
            <TmuxViewer tmuxName={session.tmux_name} />
          )}
          </div>
        )}
      </div>
    </div>
  );
}

const EVENT_COLORS: Record<string, { dot: string; line: string; icon: string }> = {
  delivered: { dot: 'bg-blue-400', line: 'bg-blue-500/30', icon: '📬' },
  acked: { dot: 'bg-yellow-400', line: 'bg-yellow-500/30', icon: '✅' },
  running: { dot: 'bg-green-400', line: 'bg-green-500/30', icon: '⚡' },
  replied: { dot: 'bg-purple-400', line: 'bg-purple-500/30', icon: '💬' },
  failed: { dot: 'bg-red-400', line: 'bg-red-500/30', icon: '❌' },
  created: { dot: 'bg-gray-400', line: 'bg-gray-500/30', icon: '📝' },
};

function EventsTimeline({ events, loading }: { events: Array<{ id: number; event_type: string; from_status: string; to_status: string; detail: string; created_at: string; task_id?: string }>; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" /></div>;
  if (events.length === 0) return <div className="text-center py-12 text-gray-600 text-xs">No task events yet</div>;

  // Group by task_id
  const groups = new Map<string, typeof events>();
  events.forEach(e => {
    const key = (e as { task_id?: string }).task_id || `ungrouped-${e.id}`;
    const group = groups.get(key) || [];
    group.push(e);
    groups.set(key, group);
  });

  return (
    <div className="p-4 overflow-y-auto h-full space-y-4">
      {[...groups.entries()].map(([taskId, taskEvents]) => (
        <div key={taskId} className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
          <div className="text-[10px] text-gray-600 mb-3 truncate">Task: {taskId.slice(0, 20)}...</div>
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-[#1a1a2a]" />

            {taskEvents.map((e, i) => {
              const cfg = EVENT_COLORS[e.to_status] || EVENT_COLORS.created;
              return (
                <div key={e.id} className="relative pb-4 last:pb-0">
                  {/* Dot on line */}
                  <div className={`absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full ${cfg.dot} flex items-center justify-center text-[9px] z-10 border-2 border-[#111128]`}>
                    {cfg.icon.length <= 2 ? cfg.icon : ''}
                  </div>
                  {/* Content */}
                  <div className="ml-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${e.to_status === 'failed' ? 'text-red-400' : e.to_status === 'replied' ? 'text-purple-400' : 'text-gray-300'}`}>
                        {e.event_type}
                      </span>
                      {e.from_status && (
                        <span className="text-[10px] text-gray-600">{e.from_status} → {e.to_status}</span>
                      )}
                      <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(e.created_at)}</span>
                    </div>
                    {e.detail && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{e.detail.slice(0, 50)}{e.detail.length > 50 ? '...' : ''}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NodePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-6 font-mono">Loading...</div>}>
      <NodeDetailContent />
    </Suspense>
  );
}

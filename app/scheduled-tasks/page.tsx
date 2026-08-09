'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNetworkId } from '../lib/network-context';

type NodeRow = { node_id: string; alias?: string | null; node_name?: string | null; lifecycle_state?: string | null };
type ScheduleSpec =
  | { type: 'once'; run_at: string }
  | { type: 'interval'; every_seconds: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] };
type ScheduleRow = {
  schedule_id: string;
  name: string;
  target_node_id: string;
  target_alias: string;
  task_content: string;
  priority: string;
  schedule: ScheduleSpec;
  timezone: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  next_run_at?: string | null;
  last_run_at?: string | null;
  revision: number;
};
type RunRow = { run_id: string; scheduled_for: string; task_id?: string | null; status: string; error_code?: string | null; created_at: string };

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : value;
}

function describeSchedule(spec: ScheduleSpec, timezone: string) {
  if (spec.type === 'once') return `单次 · ${formatTime(spec.run_at)}`;
  if (spec.type === 'interval') {
    if (spec.every_seconds % 86400 === 0) return `每 ${spec.every_seconds / 86400} 天`;
    if (spec.every_seconds % 3600 === 0) return `每 ${spec.every_seconds / 3600} 小时`;
    return `每 ${spec.every_seconds / 60} 分钟`;
  }
  if (spec.type === 'daily') return `每天 ${spec.time} · ${timezone}`;
  return `每周 ${spec.weekdays.map(d => WEEKDAYS[d]).join('、')} ${spec.time} · ${timezone}`;
}

export default function ScheduledTasksPage() {
  const { networkId } = useNetworkId();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);

  const [name, setName] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [task, setTask] = useState('');
  const [priority, setPriority] = useState('normal');
  const [kind, setKind] = useState<ScheduleSpec['type']>('once');
  const [onceAt, setOnceAt] = useState('');
  const [every, setEvery] = useState('1');
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [clock, setClock] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const query = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
  const load = useCallback(async () => {
    if (!networkId) {
      setSchedules([]); setNodes([]); setLoading(false); setError('请先在左侧选择一个网络');
      return;
    }
    try {
      const [scheduleRes, nodeRes] = await Promise.all([
        fetch(`/api/hub/scheduled-tasks${query}`, { cache: 'no-store' }),
        fetch(`/api/hub/nodes${query}`, { cache: 'no-store' }),
      ]);
      const scheduleData = await scheduleRes.json();
      const nodeData = await nodeRes.json();
      if (!scheduleRes.ok) throw new Error(scheduleData.message || scheduleData.error || `HTTP ${scheduleRes.status}`);
      if (!nodeRes.ok) throw new Error(nodeData.message || nodeData.error || `HTTP ${nodeRes.status}`);
      setSchedules(scheduleData.schedules || []);
      setNodes((nodeData.nodes || []).filter((n: NodeRow) => n.node_id && n.alias));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [networkId, query]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const makeSchedule = (): ScheduleSpec => {
    if (kind === 'once') return { type: 'once', run_at: new Date(onceAt).toISOString() };
    if (kind === 'interval') {
      const multiplier = unit === 'minutes' ? 60 : unit === 'hours' ? 3600 : 86400;
      return { type: 'interval', every_seconds: Number(every) * multiplier };
    }
    if (kind === 'daily') return { type: 'daily', time: clock };
    return { type: 'weekly', time: clock, weekdays };
  };

  const createSchedule = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/hub/scheduled-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network_id: networkId, name, target_node_id: targetNodeId, task, priority, timezone, schedule: makeSchedule() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setShowForm(false); setName(''); setTask(''); setTargetNodeId('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const mutate = async (row: ScheduleRow, action: 'toggle' | 'run' | 'cancel') => {
    setBusy(true); setError('');
    try {
      let path = `/api/hub/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${query}`;
      let init: RequestInit;
      if (action === 'run') {
        path = `/api/hub/scheduled-tasks/${encodeURIComponent(row.schedule_id)}/run-now${query}`;
        init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
      } else if (action === 'cancel') init = { method: 'DELETE' };
      else init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: row.revision, status: row.status === 'active' ? 'paused' : 'active' }) };
      const res = await fetch(path, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const openHistory = async (row: ScheduleRow) => {
    if (historyFor === row.schedule_id) { setHistoryFor(null); return; }
    setHistoryFor(row.schedule_id); setRuns([]);
    const join = query ? `${query}&limit=50` : '?limit=50';
    const res = await fetch(`/api/hub/scheduled-tasks/${encodeURIComponent(row.schedule_id)}/runs${join}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setRuns(data.runs || []); else setError(data.error || `HTTP ${res.status}`);
  };

  const createDisabled = busy || !networkId || !name.trim() || !targetNodeId || !task.trim() ||
    (kind === 'once' && !onceAt) || (kind === 'interval' && (!Number(every) || Number(every) < 1)) ||
    (kind === 'weekly' && weekdays.length === 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 lg:px-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)] lg:ml-0 ml-10">定时任务</h1>
          <p className="mt-1 text-sm text-[var(--fg-dim)]">由 Hub 统一调度；节点只接收普通任务，离线时自动排队。</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--hl)] px-4 py-2 text-sm font-semibold text-[var(--bg)] hover:opacity-90">
          {showForm ? '收起' : '新建计划'}
        </button>
      </div>

      {error && <div className="mb-5 rounded-lg border border-[var(--danger)] bg-[var(--hover-tint)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      {showForm && (
        <section className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-[var(--fg-muted)]">名称<input value={name} onChange={e => setName(e.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]" placeholder="例如：每日发布巡检" /></label>
            <label className="text-sm text-[var(--fg-muted)]">执行节点<select value={targetNodeId} onChange={e => setTargetNodeId(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]"><option value="">选择节点</option>{nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.alias} · {n.node_id.slice(0, 12)}</option>)}</select></label>
            <label className="text-sm text-[var(--fg-muted)] md:col-span-2">任务内容<textarea value={task} onChange={e => setTask(e.target.value)} maxLength={10000} rows={4} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]" placeholder="节点收到的具体任务" /></label>
            <label className="text-sm text-[var(--fg-muted)]">计划类型<select value={kind} onChange={e => setKind(e.target.value as ScheduleSpec['type'])} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]"><option value="once">单次</option><option value="interval">固定间隔</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
            <label className="text-sm text-[var(--fg-muted)]">优先级<select value={priority} onChange={e => setPriority(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]"><option value="normal">普通</option><option value="high">高</option><option value="low">低</option></select></label>
            {kind === 'once' && <label className="text-sm text-[var(--fg-muted)]">执行时间<input type="datetime-local" value={onceAt} onChange={e => setOnceAt(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]" /></label>}
            {kind === 'interval' && <div className="flex gap-2"><label className="flex-1 text-sm text-[var(--fg-muted)]">间隔<input type="number" min="1" value={every} onChange={e => setEvery(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]" /></label><label className="text-sm text-[var(--fg-muted)]">单位<select value={unit} onChange={e => setUnit(e.target.value as typeof unit)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]"><option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option></select></label></div>}
            {(kind === 'daily' || kind === 'weekly') && <label className="text-sm text-[var(--fg-muted)]">时间<input type="time" value={clock} onChange={e => setClock(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--col-inset)] px-3 py-2 text-[var(--fg)]" /><span className="mt-1 block text-xs text-[var(--fg-dim)]">时区：{timezone}</span></label>}
            {kind === 'weekly' && <div className="flex flex-wrap items-end gap-2">{WEEKDAYS.map((day, index) => <button key={day} type="button" onClick={() => setWeekdays(v => v.includes(index) ? v.filter(x => x !== index) : [...v, index].sort())} className={`h-9 w-9 rounded-full text-sm ${weekdays.includes(index) ? 'bg-[var(--hl)] text-[var(--bg)]' : 'bg-[var(--hover-tint)] text-[var(--fg-muted)]'}`}>{day}</button>)}</div>}
          </div>
          <div className="mt-5 flex justify-end"><button disabled={createDisabled} onClick={createSchedule} className="rounded-lg bg-[var(--hl)] px-5 py-2 text-sm font-semibold text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? '保存中…' : '创建'}</button></div>
        </section>
      )}

      {loading ? <div className="py-20 text-center text-[var(--fg-dim)]">加载中…</div> : schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-20 text-center text-[var(--fg-dim)]">还没有 Hub 定时任务</div>
      ) : <div className="space-y-3">{schedules.map(row => (
        <section key={row.schedule_id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-semibold text-[var(--fg)]">{row.name}</h2><span className={`rounded-full bg-[var(--hover-tint)] px-2 py-0.5 text-xs ${row.status === 'active' ? 'text-[var(--success)]' : row.status === 'paused' ? 'text-[var(--warning)]' : 'text-[var(--fg-dim)]'}`}>{row.status}</span></div><p className="mt-1 text-sm text-[var(--hl)]">{row.target_alias}</p><p className="mt-2 line-clamp-2 text-sm text-[var(--fg-muted)]">{row.task_content}</p><p className="mt-3 text-xs text-[var(--fg-dim)]">{describeSchedule(row.schedule, row.timezone)} · 下次 {formatTime(row.next_run_at)} · 上次 {formatTime(row.last_run_at)}</p></div>
            <div className="flex flex-wrap gap-2"><button disabled={busy || !['active','paused'].includes(row.status)} onClick={() => mutate(row, 'toggle')} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)]">{row.status === 'active' ? '暂停' : '恢复'}</button><button disabled={busy || row.status === 'cancelled'} onClick={() => mutate(row, 'run')} className="rounded-md border border-[var(--hl)] px-3 py-1.5 text-xs text-[var(--hl)]">立即执行</button><button onClick={() => openHistory(row)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)]">记录</button><button disabled={busy || row.status === 'cancelled'} onClick={() => mutate(row, 'cancel')} className="rounded-md border border-[var(--danger)] px-3 py-1.5 text-xs text-[var(--danger)]">取消</button></div>
          </div>
          {historyFor === row.schedule_id && <div className="mt-4 overflow-x-auto border-t border-[var(--border)] pt-4"><table className="w-full text-left text-xs"><thead className="text-[var(--fg-dim)]"><tr><th className="pb-2">计划时间</th><th>状态</th><th>Task ID</th><th>错误</th></tr></thead><tbody>{runs.map(run => <tr key={run.run_id} className="border-t border-[var(--col-hairline)] text-[var(--fg-muted)]"><td className="py-2">{formatTime(run.scheduled_for)}</td><td>{run.status}</td><td className="font-mono">{run.task_id?.slice(0, 12) || '—'}</td><td className="text-[var(--danger)]">{run.error_code || '—'}</td></tr>)}</tbody></table>{runs.length === 0 && <p className="text-[var(--fg-dim)]">暂无执行记录</p>}</div>}
        </section>
      ))}</div>}
    </main>
  );
}

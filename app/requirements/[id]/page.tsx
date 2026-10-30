'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EmptyState } from '../../components/EmptyState';
import CommentMarkdown from '../../components/CommentMarkdown';
import { NetworkRequiredNotice } from '../../components/NetworkRequiredNotice';
import { useNetworkId } from '../../lib/network-context';
import { peopleOptions, readRequirementPeople, type PersonOption } from '../../lib/requirement-people';
import { TagChip, useRequirementTags } from '../TagFilter';
import { editorTagSuggestions, tagColor } from '../../lib/tag-catalog';
import { priorityLabel, priorityTitle } from '../../lib/requirement-priority';
import { addChecklistItem, checklistPayload, moveChecklistItem, removeChecklistItem, validateChecklist, CHECKLIST_MAX_ITEMS, type ChecklistItem as EditableChecklistItem } from '../../lib/checklist-model';

/**
 * One requirement — #1633 (read-only).
 *
 * Shows description, checklist, and the activity timeline. The write
 * surface (status/owner/tags/comments) is #1634 on purpose: the read
 * shape has to be right before anyone can edit against it.
 */

interface Person { kind: 'user' | 'node'; id: string; alias?: string }
interface ChecklistItem { id: string; text: string; done?: boolean }
interface Requirement {
  id: string; seq: number; name: string; column: string; priority: string;
  due?: string; start?: string; tags?: string[];
  owner?: Person | null; agent_owner?: Person | null; participants?: Person[];
  parent_id?: string | null;
  children?: { total: number; done: number };
  description?: string; checklist?: ChecklistItem[];
  createdAt?: string; updatedAt?: string;
  external_ref?: string | null; external_url?: string | null;
}
interface EventRow {
  id: string; kind: string; field?: string | null;
  actor?: Person | null;
  at?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

const COLUMN_CHIP: Record<string, string> = {
  pool: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  doing: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  abandoned: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const COLUMN_OPTIONS: { key: string; label: string }[] = [
  { key: 'pool', label: '需求池' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '完成' },
  { key: 'abandoned', label: '放弃' },
];
const PRIORITY_OPTIONS = ['high', 'normal', 'low', 'lowest'] as const;

function personLabel(p?: Person | null) {
  if (!p) return '—';
  return p.alias || p.id;
}

function describeEvent(ev: EventRow) {
  if (ev.kind === 'comment') {
    const text = typeof ev.new?.text === 'string' ? ev.new.text : '';
    return { label: 'comment', body: text };
  }
  if (ev.kind === 'created') return { label: 'created', body: '' };
  if (ev.field) {
    const from = ev.old == null ? '—' : typeof ev.old === 'object' ? JSON.stringify(ev.old) : String(ev.old);
    const to = ev.new == null ? '—' : typeof ev.new === 'object' ? JSON.stringify(ev.new) : String(ev.new);
    return { label: ev.field, body: `${from.slice(0, 120)} → ${to.slice(0, 120)}` };
  }
  return { label: ev.kind, body: '' };
}

function RequirementDetailContent({ networkId }: { networkId: string }) {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [req, setReq] = useState<Requirement | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  // #1634 — write surface. Every mutation goes through Hub's own rules; we
  // only show its error code back to the user instead of failing silently.
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [personChoices, setPersonChoices] = useState<PersonOption[] | null>(null);
  const [peopleError, setPeopleError] = useState('');
  const [peopleAttempt, setPeopleAttempt] = useState(0);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState<EditableChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [checklistError, setChecklistError] = useState('');
  const [childRows, setChildRows] = useState<Array<{ id: string; seq: number; name: string; column: string; priority: string }>>([]);
  const [childError, setChildError] = useState('');
  const [childDraft, setChildDraft] = useState('');
  const [childPriority, setChildPriority] = useState('normal');
  const [childBusy, setChildBusy] = useState(false);
  const [ancestors, setAncestors] = useState<Array<{ id: string; seq: number; name: string }>>([]);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const [parentResults, setParentResults] = useState<Array<{ id: string; seq: number; name: string; column: string; priority: string }>>([]);
  const [parentBusy, setParentBusy] = useState(false);
  const [parentError, setParentError] = useState('');
  const [editError, setEditError] = useState('');

  const reload = () => setReloadKey(k => k + 1);
  // Every read and write names the selected network: a user token can belong to
  // several networks and Hub then refuses to guess.
  const scope = `network_id=${encodeURIComponent(networkId)}`;
  const { catalog: tagCatalog } = useRequirementTags(networkId);

  useEffect(() => {
    let alive = true;
    setPeopleError('');
    (async () => {
      try {
        const res = await fetch(`/api/hub/requirements/people?${scope}`, { cache: 'no-store' });
        if (!res.ok) {
          if (alive) setPeopleError(res.status === 401 ? '人员目录登录已过期' : `人员目录读取失败（${res.status}）`);
          return;
        }
        const choices = peopleOptions(readRequirementPeople(await res.json()));
        if (alive) setPersonChoices(choices);
      } catch {
        if (alive) setPeopleError('人员目录读取失败，请重试');
      }
    })();
    return () => { alive = false; };
  }, [scope, peopleAttempt]);

  async function sendPatch(fields: Record<string, unknown>): Promise<boolean> {
    if (!id || busy) return false;
    setBusy(true); setActionError('');
    try {
      const res = await fetch(`/api/hub/requirements/${encodeURIComponent(id)}?${scope}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setActionError(data?.message || data?.error || `hub_${res.status}`); return false; }
      reload();
      return true;
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'patch failed');
      return false;
    } finally { setBusy(false); }
  }

  async function toggleItem(itemId: string, done: boolean) {
    if (!id || busy) return;
    setBusy(true); setActionError('');
    try {
      const res = await fetch(`/api/hub/requirements/${encodeURIComponent(id)}/checklist/${encodeURIComponent(itemId)}?${scope}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setActionError(data?.error || `hub_${res.status}`); return; }
      reload();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'checklist failed');
    } finally { setBusy(false); }
  }

  async function changeParticipants(next: Person[]) {
    await sendPatch({ participants: next });
  }

  function startChecklistEdit() {
    setChecklistDraft((req?.checklist || []).map(item => ({ id: item.id, text: item.text, done: item.done === true })));
    setNewItemText('');
    setChecklistError('');
    setEditingChecklist(true);
  }

  function addChecklistRow() {
    const next = addChecklistItem(checklistDraft, newItemText);
    if (!next) {
      setChecklistError(checklistDraft.length >= CHECKLIST_MAX_ITEMS ? `检查项最多 ${CHECKLIST_MAX_ITEMS} 个` : '检查项不能为空，且不超过 500 字');
      return;
    }
    setChecklistDraft(next);
    setNewItemText('');
    setChecklistError('');
  }

  async function saveChecklist() {
    const invalid = validateChecklist(checklistDraft);
    if (invalid) { setChecklistError(invalid); return; }
    if (await sendPatch({ checklist: checklistPayload(checklistDraft) })) setEditingChecklist(false);
  }

  async function saveDescription() {
    setEditError('');
    if (descriptionDraft.length > 20_000) { setEditError('描述不能超过 20000 个字符'); return; }
    if (await sendPatch({ description: descriptionDraft })) setEditingDescription(false);
  }

  function parseTags(draft: string): string[] | null {
    const tags = [...new Set(draft.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 10) { setEditError('最多 10 个标签'); return null; }
    if (tags.some(tag => tag.length > 20)) { setEditError('单个标签不能超过 20 个字符'); return null; }
    return tags;
  }

  async function saveTags() {
    setEditError('');
    const tags = parseTags(tagsDraft);
    if (!tags) return;
    if (await sendPatch({ tags })) setEditingTags(false);
  }

  async function submitComment() {
    if (!id || busy || !comment.trim()) return;
    setBusy(true); setActionError('');
    try {
      const res = await fetch(`/api/hub/requirements/${encodeURIComponent(id)}/comments?${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: comment.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setActionError(data?.error || `hub_${res.status}`); return; }
      setComment('');
      reload();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'comment failed');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const [detailRes, eventsRes] = await Promise.all([
          fetch(`/api/hub/requirements/${encodeURIComponent(id)}?${scope}`, { cache: 'no-store' }),
          fetch(`/api/hub/requirements/events?requirement_id=${encodeURIComponent(id)}&limit=100&${scope}`, { cache: 'no-store' }),
        ]);
        if (detailRes.status === 401) { if (alive) { setNeedsLogin(true); } return; }
        const detail = await detailRes.json();
        if (!detailRes.ok || !detail.ok) { if (alive) setError(detail?.error || `hub_${detailRes.status}`); return; }
        const eventsJson = eventsRes.ok ? await eventsRes.json() : { events: [] };
        if (!alive) return;
        setReq(detail.requirement as Requirement);
        setEvents((eventsJson.events || []) as EventRow[]);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, scope, reloadKey]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/hub/requirements?${scope}&parent_id=${encodeURIComponent(id)}&view=summary&limit=100`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || data.ok === false) {
          setChildRows([]);
          setChildError(data?.message || data?.error || `hub_${res.status}`);
          return;
        }
        setChildError('');
        setChildRows((data.requirements || []) as Array<{ id: string; seq: number; name: string; column: string; priority: string }>);
      } catch {
        if (alive) { setChildRows([]); setChildError('子需求读取失败，请重试'); }
      }
    })();
    return () => { alive = false; };
  }, [id, scope, reloadKey]);

  // 上级链（最多 3 层）：只用已有详情接口逐级读，成环/失败就停，绝不假装有上级。
  useEffect(() => {
    const parentId = (req as { parent_id?: string | null } | null)?.parent_id;
    if (!parentId) { setAncestors([]); return; }
    let alive = true;
    (async () => {
      const chain: Array<{ id: string; seq: number; name: string }> = [];
      const seen = new Set<string>([id || '']);
      let cursor: string | null = parentId;
      for (let depth = 0; depth < 3 && cursor && !seen.has(cursor); depth++) {
        seen.add(cursor);
        try {
          const res = await fetch(`/api/hub/requirements/${encodeURIComponent(cursor)}?${scope}`, { cache: 'no-store' });
          if (!res.ok) break;
          const data = await res.json();
          if (!data?.ok || !data.requirement) break;
          const row = data.requirement as { id: string; seq: number; name: string; parent_id?: string | null };
          chain.push({ id: row.id, seq: row.seq, name: row.name });
          cursor = row.parent_id ?? null;
        } catch {
          break;
        }
      }
      if (alive) setAncestors(chain);
    })();
    return () => { alive = false; };
  }, [id, scope, reloadKey, req]);

  async function searchParents() {
    const q = parentQuery.trim();
    if (!q) { setParentError('先输入关键词再搜索'); return; }
    setParentBusy(true);
    setParentError('');
    try {
      const res = await fetch(`/api/hub/requirements?${scope}&q=${encodeURIComponent(q)}&view=summary&limit=20`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setParentError(data?.message || data?.error || `hub_${res.status}`); return; }
      // 自己不能当自己的上级：其余交给 Hub 的层级/成环校验。
      setParentResults(((data.requirements || []) as Array<{ id: string; seq: number; name: string; column: string; priority: string }>)
        .filter(row => row.id !== id));
    } catch {
      setParentError('搜索失败，请重试');
    } finally {
      setParentBusy(false);
    }
  }

  async function moveUnder(parentId: string | null) {
    if (parentBusy) return;
    setParentBusy(true);
    setParentError('');
    try {
      if (await sendPatch({ parent_id: parentId })) {
        setParentPickerOpen(false);
        setParentResults([]);
        setParentQuery('');
        reload();
      }
    } finally {
      setParentBusy(false);
    }
  }

  async function createChild() {
    if (!id || childBusy) return;
    const name = childDraft.trim();
    if (!name) { setChildError('子需求需要一个标题'); return; }
    setChildBusy(true);
    setChildError('');
    try {
      const res = await fetch(`/api/hub/requirements?${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, priority: childPriority, parent_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setChildError(data?.message || data?.error || `hub_${res.status}`);
        return;
      }
      setChildDraft('');
      reload();
    } catch {
      setChildError('网络异常，子需求未创建');
    } finally {
      setChildBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6 text-gray-500">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--bg-elevated)]" />
          <div className="h-40 animate-pulse rounded bg-[var(--bg-secondary)]" />
        </div>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6">
        <div className="mx-auto max-w-4xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          会话已过期，<Link href="/login" className="underline">重新登录</Link>。
        </div>
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error ? `读取失败：${error}` : '这条需求不存在或不可见。'}
          </div>
          <Link href="/requirements" className="text-sm text-blue-400 hover:underline">← 返回需求列表</Link>
        </div>
      </div>
    );
  }

  const checklist = req.checklist || [];
  const personValue = (person?: Person | null) => (person ? `${person.kind}:${person.id}` : '');
  const optionLabel = (value: string) => personChoices?.find(choice => choice.value === value)?.label ?? value;
  const ownerValue = personValue(req.owner);
  const agentValue = personValue(req.agent_owner);
  const directoryReady = personChoices !== null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-gray-200">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <Link href="/requirements" className="text-xs text-gray-500 hover:text-gray-300">← 需求列表</Link>
        </div>

        <header className="mb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span className="tabular-nums">#{req.seq}</span>
            <span className={`rounded border px-1.5 py-0.5 ${COLUMN_CHIP[req.column] || COLUMN_CHIP.abandoned}`}>{req.column}</span>
            <span title={priorityTitle(req.priority)}>{priorityLabel(req.priority)}</span>
            {req.due && <span>due {String(req.due).slice(0, 10)}</span>}
            {(req.tags || []).map(name => (
              <TagChip key={name} name={name} color={tagColor(tagCatalog, name)} className="text-gray-400" />
            ))}
          </div>
          {ancestors.length > 0 && (
            <p className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500" data-testid="requirement-ancestors">
              上级：
              {ancestors.slice().reverse().map(ancestor => (
                <Link key={ancestor.id} href={`/requirements/${ancestor.id}`} className="underline hover:text-gray-300">
                  #{ancestor.seq} {ancestor.name}
                </Link>
              ))}
            </p>
          )}
          <h1 className="text-lg font-semibold text-white">{req.name}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-gray-500">
            <span>负责人 {req.owner ? optionLabel(ownerValue) : '—'}</span>
            <span>负责 Agent {req.agent_owner ? optionLabel(agentValue) : '—'}</span>
            {req.children && req.children.total > 0 && <span>子卡 {req.children.done}/{req.children.total}</span>}
            {req.external_url && (
              <a href={req.external_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                {req.external_ref || 'external'}
              </a>
            )}
          </div>
        </header>

        {/* #1634 — write surface. Hub keeps the rules (owner must be human,
            node tokens may not delete); this bar only sends whitelisted fields. */}
        <section className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-600">Status</span>
          {COLUMN_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              disabled={busy || req.column === opt.key}
              onClick={() => sendPatch({ column: opt.key })}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
                req.column === opt.key
                  ? (COLUMN_CHIP[opt.key] || COLUMN_CHIP.abandoned)
                  : 'border-transparent text-gray-500 hover:bg-[var(--bg-elevated)] hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-600">
            Priority
            <select
              value={req.priority}
              disabled={busy}
              onChange={e => sendPatch({ priority: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs normal-case text-gray-200"
            >
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{priorityLabel(p)} · {p}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-600">
            Due
            <input
              type="date"
              value={req.due ? String(req.due).slice(0, 10) : ''}
              disabled={busy}
              onChange={e => sendPatch({ due: e.target.value })}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs normal-case text-gray-200"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-600">
            负责人
            <select
              aria-label="负责人（人）"
              value={ownerValue}
              disabled={busy || !directoryReady}
              title={peopleError || (directoryReady ? '只列人；同名以 ID 区分' : '正在读取人员目录…')}
              onChange={e => {
                const value = e.target.value;
                if (value && !value.startsWith('user:')) return;
                sendPatch({ owner: value ? { kind: 'user', id: value.slice('user:'.length) } : null });
              }}
              className="max-w-[12rem] rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs normal-case text-gray-200 disabled:opacity-60"
            >
              <option value="">未分配</option>
              {personChoices?.filter(choice => choice.kind === 'user').map(choice => (
                <option key={choice.value} value={choice.value} title={choice.label}>{choice.label}</option>
              ))}
              {ownerValue && !personChoices?.some(choice => choice.value === ownerValue) && (
                <option value={ownerValue} disabled>{optionLabel(ownerValue)}（不可用）</option>
              )}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-600">
            负责 Agent
            <select
              aria-label="负责 Agent"
              value={agentValue}
              disabled={busy || !directoryReady}
              title={peopleError || (directoryReady ? '只列 Agent；同名以 ID 区分' : '正在读取人员目录…')}
              onChange={e => {
                const value = e.target.value;
                if (value && !value.startsWith('node:')) return;
                sendPatch({ agent_owner: value ? { kind: 'node', id: value.slice('node:'.length) } : null });
              }}
              className="max-w-[12rem] rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs normal-case text-gray-200 disabled:opacity-60"
            >
              <option value="">未分配</option>
              {personChoices?.filter(choice => choice.kind === 'node').map(choice => (
                <option key={choice.value} value={choice.value} title={choice.label}>{choice.label}</option>
              ))}
              {agentValue && !personChoices?.some(choice => choice.value === agentValue) && (
                <option value={agentValue} disabled>{optionLabel(agentValue)}（不可用）</option>
              )}
            </select>
          </label>
          {peopleError && (
            <span role="status" className="text-[11px] text-amber-300">
              {peopleError}
              <button type="button" onClick={() => setPeopleAttempt(n => n + 1)} className="ml-2 underline">重试人员目录</button>
            </span>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          {editingTags ? (
            <span className="flex items-center gap-1">
              <input
                aria-label="标签"
                value={tagsDraft}
                onChange={event => setTagsDraft(event.target.value)}
                placeholder="逗号分隔"
                className="w-44 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs text-gray-200"
              />
              <button type="button" data-testid="requirement-save-tags" disabled={busy} onClick={() => void saveTags()} className="rounded bg-[var(--hl)] px-2 py-0.5 text-[10px] text-[var(--bg)] disabled:opacity-60">保存</button>
              <button type="button" onClick={() => { setEditingTags(false); setEditError(''); }} className="text-[10px] text-gray-500 underline">取消</button>
              {editorTagSuggestions(tagCatalog, tagsDraft).length > 0 && (
                <span className="ml-1 flex flex-wrap items-center gap-1" data-testid="requirement-tag-suggestions">
                  {editorTagSuggestions(tagCatalog, tagsDraft).map(suggestion => (
                    <button
                      key={suggestion.name}
                      type="button"
                      onClick={() => setTagsDraft(prev => (prev.trim() ? `${prev.trim().replace(/[,，]$/, '')}, ${suggestion.name}` : suggestion.name))}
                      className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                      data-testid={`requirement-tag-suggestion-${suggestion.name}`}
                    >
                      {suggestion.color && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: suggestion.color }} />}
                      {suggestion.name}
                    </button>
                  ))}
                </span>
              )}
            </span>
          ) : (
            <button type="button" data-testid="requirement-edit-tags" onClick={() => { setTagsDraft((req.tags || []).join(', ')); setEditError(''); setEditingTags(true); }} className="text-[11px] text-gray-500 underline hover:text-gray-300">编辑标签</button>
          )}
          {editError && !editingDescription && <span role="alert" className="text-[11px] text-[var(--danger)]">{editError}</span>}
          {busy && <span className="text-[11px] text-gray-500">saving…</span>}
          {actionError && <span className="text-[11px] text-red-400">{actionError}</span>}
        </section>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">参与者 {req.participants && req.participants.length > 0 && <span className="ml-1 text-gray-600">{req.participants.length}</span>}</h2>
          <div className="flex flex-wrap items-center gap-2" data-testid="requirement-participants">
            {(req.participants || []).length === 0 ? (
              <p className="text-sm text-gray-600">暂无参与者</p>
            ) : (req.participants || []).map(person => {
              const value = `${person.kind}:${person.id}`;
              const known = personChoices?.some(choice => choice.value === value);
              const label = optionLabel(value);
              return (
                <span key={value} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs text-gray-200">
                  <span className="max-w-[12rem] truncate" title={`${person.kind} · ${person.id}`}>{label}{known ? '' : '（不可用）'}</span>
                  <button
                    type="button"
                    aria-label={`移除参与者 ${label}`}
                    disabled={busy}
                    onClick={() => void changeParticipants((req.participants || []).filter(item => !(item.kind === person.kind && item.id === person.id)))}
                    className="rounded px-1 text-[var(--fg-muted)] hover:text-[var(--danger)] disabled:opacity-50"
                  >✕</button>
                </span>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              添加参与者
              <select
                aria-label="添加参与者"
                value=""
                disabled={busy || personChoices === null}
                onChange={event => {
                  const person = personChoices?.find(choice => choice.value === event.target.value);
                  if (!person) return;
                  const ref = person.value.split(':');
                  void changeParticipants([...(req.participants || []), { kind: ref[0] as Person['kind'], id: ref.slice(1).join(':') }]);
                }}
                className="max-w-[14rem] rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs normal-case text-gray-200 disabled:opacity-60"
              >
                <option value="">选择人 / Agent</option>
                {(['user', 'node'] as const).map(kind => (
                  <optgroup key={kind} label={kind === 'user' ? '人' : 'Agent'}>
                    {personChoices?.filter(choice => choice.kind === kind && !(req.participants || []).some(item => item.kind === kind && item.id === choice.value.split(':').slice(1).join(':'))).map(choice => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {peopleError && <span role="status" className="text-[11px] text-[var(--warning)]">{peopleError}</span>}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs uppercase tracking-wide text-gray-500">Description</h2>
            {!editingDescription ? (
              <button type="button" data-testid="requirement-edit-description" onClick={() => { setDescriptionDraft(req.description || ''); setEditError(''); setEditingDescription(true); }} className="text-[11px] text-gray-400 underline hover:text-gray-200">编辑描述</button>
            ) : (
              <span className="flex items-center gap-2 text-[11px]">
                <button type="button" data-testid="requirement-save-description" disabled={busy} onClick={() => void saveDescription()} className="rounded bg-[var(--hl)] px-2 py-0.5 text-[var(--bg)] disabled:opacity-60">保存</button>
                <button type="button" onClick={() => { setEditingDescription(false); setEditError(''); }} className="text-gray-400 underline hover:text-gray-200">取消</button>
              </span>
            )}
          </div>
          {editingDescription ? (
            <div>
              <textarea
                aria-label="描述"
                value={descriptionDraft}
                onChange={event => setDescriptionDraft(event.target.value)}
                rows={8}
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 font-mono text-xs text-gray-200 focus:border-[var(--border-hover)] focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-[var(--fg-dim)]">{descriptionDraft.length}/20000 · 支持 Markdown</p>
              {editError && <p role="alert" className="mt-1 text-[11px] text-[var(--danger)]">{editError}</p>}
            </div>
          ) : req.description ? (
            <div className="prose prose-invert max-w-none prose-sm prose-pre:bg-[var(--bg)] prose-pre:border prose-pre:border-[var(--border)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{req.description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-gray-600">（没有描述）</p>
          )}
        </section>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
            Checklist {checklist.length > 0 && <span className="ml-1 text-gray-600">{checklist.filter(c => c.done).length}/{checklist.length}</span>}
            {!editingChecklist && (
              <button type="button" data-testid="requirement-edit-checklist" onClick={startChecklistEdit} className="ml-auto text-[11px] normal-case text-gray-500 underline hover:text-gray-300">编辑清单</button>
            )}
          </h2>
          {editingChecklist ? (
            <div>
              {checklistDraft.length === 0 ? (
                <p className="text-sm text-gray-600">（还没有检查项，先添加一条）</p>
              ) : (
                <ul className="space-y-1.5">
                  {checklistDraft.map((item, index) => (
                    <li key={item.id} className="flex items-center gap-2 text-sm" data-testid={`checklist-row-${index}`}>
                      <span className="min-w-0 flex-1 break-words text-gray-200">{item.text}</span>
                      <button type="button" aria-label={`上移 ${item.text}`} disabled={index === 0} onClick={() => setChecklistDraft(draft => [...moveChecklistItem(draft, index, index - 1)])} className="px-1 text-gray-500 disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`下移 ${item.text}`} disabled={index === checklistDraft.length - 1} onClick={() => setChecklistDraft(draft => [...moveChecklistItem(draft, index, index + 1)])} className="px-1 text-gray-500 disabled:opacity-30">↓</button>
                      <button type="button" aria-label={`删除 ${item.text}`} onClick={() => setChecklistDraft(draft => removeChecklistItem(draft, item.id))} className="px-1 text-[11px] text-[var(--danger)]">删除</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <input
                  aria-label="新检查项"
                  value={newItemText}
                  onChange={event => setNewItemText(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addChecklistRow(); } }}
                  placeholder="加一条检查项，回车添加"
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--fg)]"
                />
                <button type="button" data-testid="requirement-add-checklist" onClick={addChecklistRow} className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)]">添加</button>
              </div>
              {checklistError && <p role="alert" data-testid="checklist-error" className="mt-1 text-[11px] text-[var(--danger)]">{checklistError}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" data-testid="requirement-save-checklist" disabled={busy} onClick={() => void saveChecklist()} className="rounded bg-[var(--hl)] px-2 py-0.5 text-[10px] text-[var(--bg)] disabled:opacity-60">保存</button>
                <button type="button" onClick={() => { setEditingChecklist(false); setChecklistError(''); }} className="text-[10px] text-gray-500 underline">取消</button>
              </div>
            </div>
          ) : checklist.length === 0 ? (
            <p className="text-sm text-gray-600">（没有检查项）</p>
          ) : (
            <ul className="space-y-1.5">
              {checklist.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleItem(item.id, !item.done)}
                    className="flex items-start gap-2 text-left text-sm hover:opacity-80 disabled:opacity-60"
                  >
                    <span aria-hidden className={item.done ? 'text-emerald-400' : 'text-gray-600'}>{item.done ? '✓' : '○'}</span>
                    <span className={item.done ? 'text-gray-500 line-through' : 'text-gray-200'}>{item.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4" data-testid="requirement-children">
          <h2 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
            子需求{childRows.length > 0 && <span className="ml-1 text-gray-600">{childRows.length}</span>}
            <button
              type="button"
              data-testid="requirement-move-parent"
              onClick={() => { setParentPickerOpen(v => !v); setParentError(''); }}
              className="ml-auto text-[11px] normal-case text-gray-500 underline hover:text-gray-300"
            >
              改父级
            </button>
          </h2>
          {parentPickerOpen && (
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5" data-testid="requirement-parent-picker">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="搜索新上级"
                  value={parentQuery}
                  onChange={event => setParentQuery(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void searchParents(); } }}
                  placeholder="搜索新上级（标题）"
                  className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--fg)]"
                />
                <button type="button" onClick={() => void searchParents()} disabled={parentBusy} className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)] disabled:opacity-60">搜索</button>
                <button type="button" data-testid="requirement-move-root" onClick={() => void moveUnder(null)} disabled={parentBusy} className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)] disabled:opacity-60">升为顶级</button>
              </div>
              {parentError && <p role="alert" className="mt-1 text-[11px] text-[var(--danger)]">{parentError}</p>}
              {parentResults.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-auto rounded border border-[var(--border)]" data-testid="requirement-parent-results">
                  {parentResults.map(row => (
                    <li key={row.id}>
                      <button
                        type="button"
                        data-testid={`requirement-parent-option-${row.id}`}
                        onClick={() => void moveUnder(row.id)}
                        disabled={parentBusy}
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                      >
                        <span className="tabular-nums text-[10px] text-gray-500">#{row.seq}</span>
                        <span className="rounded bg-[var(--bg-elevated)] px-1 text-[10px]">{row.column}</span>
                        <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-gray-600">最多 5 层、不能成环（Hub 校验）；改父级不改卡片其它字段。</p>
            </div>
          )}
          {childError && <p role="alert" className="mb-2 text-[11px] text-[var(--danger)]">{childError}</p>}
          {childRows.length === 0 ? (
            <p className="text-sm text-gray-600">（还没有子需求）</p>
          ) : (
            <ul className="space-y-1.5">
              {childRows.map(row => (
                <li key={row.id}>
                  <Link href={`/requirements/${row.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm hover:bg-[var(--hover-tint)]">
                    <span className="tabular-nums text-[11px] text-gray-500">#{row.seq}</span>
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-gray-400">{row.column}</span>
                    <span className="text-[11px] text-gray-400" title={priorityTitle(row.priority)}>{priorityLabel(row.priority)}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-200">{row.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              aria-label="子需求标题"
              value={childDraft}
              onChange={event => setChildDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createChild(); } }}
              placeholder="子需求标题"
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--fg)]"
            />
            <select
              aria-label="子需求优先级"
              value={childPriority}
              onChange={event => setChildPriority(event.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-1 text-xs text-[var(--fg)]"
            >
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}
            </select>
            <button type="button" data-testid="requirement-create-child" disabled={childBusy} onClick={() => void createChild()} className="rounded bg-[var(--hl)] px-2 py-1 text-[11px] text-[var(--bg)] disabled:opacity-60">
              {childBusy ? '创建中…' : '新建子需求'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-600">同一网络、最多 5 层、不能成环（由 Hub 校验）。</p>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Activity</h2>
          {events.length === 0 ? (
            <EmptyState variant="generic" compact title="还没有动态" sub="状态变更和评论会出现在这里。" />
          ) : (
            <ul className="space-y-2">
              {events.map(ev => {
                const d = describeEvent(ev);
                return (
                  <li key={ev.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="text-gray-300">{personLabel(ev.actor)}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{d.label}</span>
                      {ev.at && <span>{String(ev.at).replace('T', ' ').slice(0, 16)}</span>}
                    </div>
                    {d.body && (d.label === 'comment'
                      ? <CommentMarkdown text={d.body} />
                      : <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-300">{d.body}</p>)}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="写一条进展或评论…（Ctrl/⌘+Enter 发送）"
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-blue-500/40 focus:outline-none"
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitComment(); }}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !comment.trim()}
                onClick={submitComment}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300 disabled:opacity-50"
              >
                Add comment
              </button>
              {actionError && <span className="text-[11px] text-red-400">{actionError}</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function RequirementDetailPage() {
  const { networkId, ready } = useNetworkId();
  if (!ready) return <div role="status" className="min-h-screen bg-[var(--bg)] p-6 text-sm text-gray-500">正在确认当前网络…</div>;
  if (!networkId) return (
    <div className="min-h-screen bg-[var(--bg)] p-6">
      <div className="mx-auto max-w-4xl"><NetworkRequiredNotice /></div>
    </div>
  );
  // A network switch must not leave another network's description or timeline
  // on screen: remount resets every piece of local state.
  return <RequirementDetailContent key={networkId} networkId={networkId} />;
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { TAG_COLORS, MAX_MERGE_SOURCES, tagOpMessage, validateTagOp, type TagOp } from '../lib/tag-ops';
import { orderedTags, type TagCatalog } from '../lib/tag-catalog';

type Action =
  | { kind: 'rename'; tag: string }
  | { kind: 'merge'; tag: string }
  | { kind: 'delete'; tag: string }
  | { kind: 'color'; tag: string };

/**
 * Manage tags for the whole network — APP parity for `tags/ops`.
 *
 * The Hub decides who may do this and owns every rule; this dialog only asks
 * for the operation, shows the Hub's answer, and then refreshes the catalogue
 * and the list. Destructive ops ask for a second click, and nothing is
 * optimistically applied to cards.
 */
export function TagManager({ catalog, networkId, onClose, onApplied }: {
  catalog: TagCatalog;
  networkId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState('');
  const [mergeSources, setMergeSources] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const tags = useMemo(() => orderedTags(catalog), [catalog]);
  const needle = query.trim().toLowerCase();
  const visible = needle ? tags.filter(tag => tag.name.toLowerCase().includes(needle)) : tags;

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (action) { setAction(null); setError(''); }
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [action, onClose]);

  const openAction = (next: Action) => {
    setAction(next);
    setConfirming(false);
    setError('');
    setNotice('');
    setDraft(next.kind === 'rename' ? next.tag : next.kind === 'merge' ? next.tag : '');
    setMergeSources(next.kind === 'merge' ? [next.tag] : []);
  };

  const run = async (op: TagOp) => {
    const invalid = validateTagOp(op);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/hub/requirements/tags/ops?network_id=${encodeURIComponent(networkId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setError(tagOpMessage(res.status, data.error)); return; }
      const affected = op.op === 'color' ? null : typeof data.affected === 'number' ? data.affected : null;
      setNotice(`${opLabel(op)}完成${affected === null ? '' : `，影响 ${affected} 张卡`}。`);
      setAction(null);
      setConfirming(false);
      onApplied();
    } catch {
      setError('网络异常，标签未修改，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!action) return;
    if (action.kind === 'rename') { void run({ op: 'rename', from: action.tag, to: draft }); return; }
    if (action.kind === 'merge') { void run({ op: 'merge', from: mergeSources, to: draft }); return; }
    if (action.kind === 'delete') {
      if (!confirming) { setConfirming(true); return; }
      void run({ op: 'delete', tag: action.tag });
      return;
    }
    void run({ op: 'color', tag: action.tag, color: draft || null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" data-testid="tag-manager-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-manager-title"
        data-testid="tag-manager"
        className="mt-6 w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="tag-manager-title" className="text-sm font-semibold text-[var(--fg)]">管理标签</h2>
            <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">改名、合并、删除只改整个网络里的卡片；颜色只改显示。用量含已归档。</p>
          </div>
          <button type="button" aria-label="关闭管理标签" onClick={onClose} className="rounded px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)]">✕</button>
        </div>

        <div className="px-4 py-3">
          <label className="block">
            <span className="sr-only">搜索标签</span>
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`搜索 ${tags.length} 个标签`}
              aria-label="搜索标签"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--fg)] placeholder-[var(--fg-dim)] focus:border-[var(--border-hover)] focus:outline-none"
            />
          </label>

          {notice && <p role="status" data-testid="tag-manager-notice" className="mt-2 text-[11px] text-[var(--success)]">{notice}</p>}
          {error && <p role="alert" data-testid="tag-manager-error" className="mt-2 text-[11px] text-[var(--danger)]">{error}</p>}

          {action && (
            <form
              className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
              data-testid="tag-manager-form"
              onSubmit={event => { event.preventDefault(); submit(); }}
            >
              <p className="text-xs text-[var(--fg)]">
                {action.kind === 'rename' && <>把「{action.tag}」改名为</>}
                {action.kind === 'merge' && <>合并到「{draft || '…'}」的来源</>}
                {action.kind === 'delete' && <>删除标签「{action.tag}」——卡片保留，只是去掉这个标签。</>}
                {action.kind === 'color' && <>给「{action.tag}」选颜色</>}
              </p>

              {action.kind === 'color' ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {TAG_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`颜色 ${color}`}
                      data-testid={`tag-colour-${color}`}
                      onClick={() => setDraft(color)}
                      className={`h-6 w-6 rounded-full border-2 ${draft === color ? 'border-[var(--fg)]' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <button type="button" onClick={() => setDraft('')} className="ml-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)]">清除颜色</button>
                </div>
              ) : (
                <input
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  aria-label={action.kind === 'merge' ? '合并目标标签' : '标签名'}
                  placeholder={action.kind === 'merge' ? '目标标签名' : '新标签名'}
                  className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--fg)]"
                />
              )}

              {action.kind === 'merge' && (
                <ul className="mt-2 max-h-32 overflow-auto rounded border border-[var(--border)]" data-testid="tag-merge-sources">
                  {tags.slice(0, MAX_MERGE_SOURCES).map(tag => (
                    <li key={tag.name}>
                      <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] text-[var(--fg-muted)]">
                        <input
                          type="checkbox"
                          checked={mergeSources.includes(tag.name)}
                          onChange={() => setMergeSources(prev => prev.includes(tag.name) ? prev.filter(name => name !== tag.name) : [...prev, tag.name])}
                          aria-label={`合并来源 ${tag.name}`}
                        />
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color || 'transparent', boxShadow: tag.color ? 'none' : 'inset 0 0 0 1px var(--border)' }} />
                        {tag.name}
                        <span className="tabular-nums text-[10px] text-[var(--fg-dim)]">{tag.count}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="tag-manager-submit"
                  className={`rounded px-3 py-1.5 text-xs text-[var(--bg)] disabled:opacity-60 ${confirming ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]'}`}
                >
                  {busy ? '处理中…' : confirming ? '确认删除' : action.kind === 'delete' ? '删除' : '保存'}
                </button>
                <button type="button" onClick={() => { setAction(null); setConfirming(false); setError(''); }} className="text-[11px] text-[var(--fg-muted)] underline">取消</button>
                {confirming && <span className="text-[11px] text-[var(--danger)]">再点一次确认，影响整个网络。</span>}
              </div>
            </form>
          )}

          <ul className="mt-3 max-h-[46vh] divide-y divide-[var(--border)] overflow-auto rounded-lg border border-[var(--border)]" data-testid="tag-manager-list">
            {visible.map(tag => (
              <li key={tag.name} className="flex items-center gap-2 px-2.5 py-1.5" data-testid={`tag-row-${tag.name}`}>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color || 'transparent', boxShadow: tag.color ? 'none' : 'inset 0 0 0 1px var(--border)' }} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]">{tag.name}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-[var(--fg-dim)]">{tag.count}</span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`改名 ${tag.name}`} onClick={() => openAction({ kind: 'rename', tag: tag.name })} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)]">改名</button>
                  <button type="button" aria-label={`合并 ${tag.name}`} onClick={() => openAction({ kind: 'merge', tag: tag.name })} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)]">合并</button>
                  <button type="button" aria-label={`颜色 ${tag.name}`} onClick={() => openAction({ kind: 'color', tag: tag.name })} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)]">颜色</button>
                  <button type="button" aria-label={`删除 ${tag.name}`} onClick={() => openAction({ kind: 'delete', tag: tag.name })} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--danger)] hover:bg-[var(--hover-tint)]">删除</button>
                </span>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-4 text-center text-[11px] text-[var(--fg-muted)]">没有匹配的标签</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function opLabel(op: TagOp): string {
  if (op.op === 'rename') return '改名';
  if (op.op === 'merge') return '合并';
  if (op.op === 'delete') return '删除';
  return '配色';
}

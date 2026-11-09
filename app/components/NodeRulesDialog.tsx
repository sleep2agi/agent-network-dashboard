'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './types';
import { t } from '../lib/ui-lang';

/**
 * 节点「规则文件」只读面板（AGENTS.md / CLAUDE.md）。
 *
 * 数据链路（与 APP 一致，见 agent-network-app/src/node-rules.ts）：
 *   1. POST /api/nodes/tool { tool: read_node_rules_file, args: { node_id | alias } }
 *      → { request_id }
 *   2. 轮询 get_rules_file_result { request_id } 直到 status=done/error。
 *      Hub 把结果只交给发起请求的登录一次，读完即删，所以每轮都要重新发起。
 *
 * 三条状态都要可读：加载中 / 失败（含 Hub 不支持）/ 有内容。
 * 文件名由**节点自己**决定（claude 系 CLAUDE.md，其余 AGENTS.md），这里只展示不猜测。
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; fileName: string | null; content: string; exists: boolean };

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 10;

export function NodeRulesDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { node_id: nodeId, alias } = session;
  const [copied, setCopied] = useState(false);
  // 写入（.438）：编辑草稿、确认覆盖、保存中/保存结果。写入前必须显式确认——
  // 规则文件是节点真在用的资产，一次误覆盖会直接影响该节点的行为。
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const cancelled = useRef(false);

  const call = useCallback(async (tool: string, args: Record<string, unknown>) => {
    const res = await fetch('/api/nodes/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as { ok: boolean; payload?: Record<string, unknown>; error?: string; kind?: string };
    } catch {
      return { ok: false, error: `响应无法解析（HTTP ${res.status}）` };
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 能力不足时什么都不做：界面在渲染期直接显示原因（effect 内同步 setState 会触发级联渲染）。
    if (session.rules_file_capable === false) return () => { cancelled.current = true; };
    // 每次打开/重读都重新构造：node_id 优先，没有就按 alias（与 APP 的取值顺序一致）
    const target: Record<string, string> = nodeId ? { node_id: nodeId } : { alias };

    const run = async () => {
      setPhase({ kind: 'loading' });
      const started = await call('read_node_rules_file', target);
      if (cancelled.current) return;
      if (!started.ok) {
        setPhase({ kind: 'error', message: started.kind === 'unsupported' ? t('当前 Hub 还不支持读取规则文件，请先升级 Hub', 'This Hub does not support rules files yet') : (started.error ?? t('读取失败', 'Failed')) });
        return;
      }
      const requestId = String((started.payload as { request_id?: string } | undefined)?.request_id ?? '');
      if (!requestId) {
        setPhase({ kind: 'error', message: t('Hub 没有返回请求号', 'Hub returned no request id') });
        return;
      }

      let tries = 0;
      const poll = async () => {
        tries += 1;
        const r = await call('get_rules_file_result', { request_id: requestId });
        if (cancelled.current) return;
        if (!r.ok) {
          setPhase({ kind: 'error', message: r.error ?? t('读取失败', 'Failed') });
          return;
        }
        const p = (r.payload ?? {}) as { status?: string; file_name?: string | null; content?: string; exists?: boolean; error?: string | null };
        if (p.status === 'done') {
          setPhase({
            kind: 'done',
            fileName: p.file_name ?? null,
            content: typeof p.content === 'string' ? p.content : '',
            exists: p.exists !== false,
          });
          return;
        }
        if (p.status === 'error') {
          setPhase({ kind: 'error', message: p.error ?? t('节点返回错误', 'Node returned an error') });
          return;
        }
        if (tries >= POLL_MAX) {
          setPhase({ kind: 'error', message: t('等待超时：节点可能未响应（或未上报规则文件能力）', 'Timed out: the node did not answer') });
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      };
      timer = setTimeout(poll, 300);
    };

    void run();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt, call, nodeId, alias, session.rules_file_capable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 通用门铃：发起 → 轮询结果。读写共用（写入也需要同样的 request_id 流程）。 */
  const ring = useCallback(async (tool: string, args: Record<string, unknown>) => {
    const started = await call(tool, args);
    if (!started.ok) return { ok: false as const, message: started.error ?? t('请求失败', 'Request failed') };
    const requestId = String((started.payload as { request_id?: string } | undefined)?.request_id ?? '');
    if (!requestId) return { ok: false as const, message: t('Hub 没有返回请求号', 'No request id') };
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise((r) => setTimeout(r, i === 0 ? 300 : POLL_INTERVAL_MS));
      if (cancelled.current) return { ok: false as const, message: t('已取消', 'Cancelled') };
      const r = await call('get_rules_file_result', { request_id: requestId });
      if (!r.ok) return { ok: false as const, message: r.error ?? t('读取失败', 'Failed') };
      const pl = (r.payload ?? {}) as { status?: string; content?: string; error?: string | null };
      if (pl.status === 'done') return { ok: true as const, content: typeof pl.content === 'string' ? pl.content : '' };
      if (pl.status === 'error') return { ok: false as const, message: pl.error ?? t('节点返回错误', 'Node error') };
    }
    return { ok: false as const, message: t('等待超时：节点可能未响应', 'Timed out waiting for the node') };
  }, [call]);

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    setSaveError(null);
    const args: Record<string, string> = { ...(nodeId ? { node_id: nodeId } : { alias }), content: draft };
    const r = await ring('write_node_rules_file', args);
    setSaving(false);
    if (!r.ok) { setSaveError(r.message); return; }
    setSavedAt(Date.now());
    setEditing(false);
    // 写完后重新读一遍，确认落盘内容就是刚才写的（不信「接口说成功」）
    setAttempt((n) => n + 1);
  };

  const copy = async () => {
    if (phase.kind !== 'done') return;
    try {
      await navigator.clipboard.writeText(phase.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默，不弹错误 */ }
  };

  const notCapable = session.rules_file_capable === false;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--scrim)] p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t('节点规则文件', 'Node rules file')}
      data-testid="node-rules-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--col-line-strong)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] text-[var(--fg)]">
              {t('规则文件', 'Rules file')}
              <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{session.alias}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]" data-testid="node-rules-file-name">
              {phase.kind === 'done' ? (phase.fileName ?? t('（节点未返回文件名）', '(no file name)')) : '—'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              data-testid="node-rules-retry"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
            >
              {t('重新读取', 'Reload')}
            </button>
            {phase.kind === 'done' && !editing && (
              <button
                type="button"
                onClick={() => { setDraft(phase.content); setEditing(true); setSavedAt(null); }}
                data-testid="node-rules-edit"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
              >
                {t('编辑', 'Edit')}
              </button>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={saving}
                data-testid="node-rules-save"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-sunken)] disabled:opacity-40"
              >
                {saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}
              </button>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => { setEditing(false); setSavedAt(null); }}
                disabled={saving}
                data-testid="node-rules-edit-cancel"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)] disabled:opacity-40"
              >
                {t('取消编辑', 'Cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={copy}
              disabled={phase.kind !== 'done'}
              data-testid="node-rules-copy"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)] disabled:opacity-40"
            >
              {copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="node-rules-close"
              aria-label={t('关闭', 'Close')}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {notCapable && (
            <div className="py-6 text-center text-[12px] text-[var(--danger)]" data-testid="node-rules-error">
              {t('该节点未上报「规则文件」能力', 'This node does not report rules-file support')}
            </div>
          )}
          {!notCapable && phase.kind === 'loading' && (
            <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-rules-loading">
              {t('正在向节点读取…', 'Reading from node…')}
            </div>
          )}
          {!notCapable && phase.kind === 'error' && (
            <div className="py-6 text-center text-[12px] text-[var(--danger)]" data-testid="node-rules-error">{phase.message}</div>
          )}
          {!notCapable && phase.kind === 'done' && (!phase.exists
            ? <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-rules-empty">{t('该节点没有规则文件', 'This node has no rules file')}</div>
            : (
              editing
                ? <textarea
                    data-testid="node-rules-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    className="h-[50vh] w-full resize-none rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-sunken)] p-2 font-mono text-[11px] leading-5 text-[var(--fg)] outline-none"
                  />
                : <pre
                    data-testid="node-rules-content"
                    className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--fg)]"
                  >{phase.content}</pre>
            ))}
        </div>
        {(saveError || savedAt) && (
          <div className="border-t border-[var(--col-line-strong)] px-3 py-1.5 text-[11px]"
            data-testid={saveError ? 'node-rules-save-error' : 'node-rules-saved'}>
            {saveError
              ? <span className="text-[var(--danger)]">{t('保存失败：', 'Save failed: ')}{saveError}</span>
              : <span className="text-[var(--success)]">{t('已写入，并已重新读取确认', 'Saved and re-read to confirm')}</span>}
          </div>
        )}
        {confirming && (
          <div className="border-t border-[var(--col-line-strong)] bg-[var(--bg-sunken)] px-3 py-2" data-testid="node-rules-confirm-bar">
            <div className="text-[11px] text-[var(--warning)]">
              {t('将覆盖该节点上的规则文件，节点会立即使用新内容。确定写入？', 'This overwrites the node rules file and takes effect immediately. Continue?')}
            </div>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => void save()} data-testid="node-rules-confirm"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--bg-elevated)]">
                {t('确定写入', 'Overwrite')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} data-testid="node-rules-confirm-cancel"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)]">
                {t('取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

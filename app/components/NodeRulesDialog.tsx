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
              <pre
                data-testid="node-rules-content"
                className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--fg)]"
              >{phase.content}</pre>
            ))}
        </div>
      </div>
    </div>
  );
}

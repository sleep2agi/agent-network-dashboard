'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './types';
import { t } from '../lib/ui-lang';

/**
 * 节点「密钥名称」只读面板（.452）—— RFC-028 scoped secrets，**只列 key 名**。
 *
 * 合同（Hub 侧源码确认）：
 *   POST /api/nodes/:id/secrets?network_id=… {action:"list"} → {ok, request_id, status, expires_at}
 *   GET  /api/nodes/:id/secrets/:request_id                 → snapshot { revision, keys:[{key,source}] }
 *   节点侧 project() 对 list **只返回 keys，不返回 values**；请求 120s 过期
 *   凭据：用户令牌 + 节点主人 / 网络 owner·admin
 *
 * 安全纪律：
 *   · 前端只请求 action:"list"（代理层也拒绝其它 action）
 *   · 界面永不渲染值；明写「值不可读」
 *   · 错误三态：无权限 / 节点不可达 / Hub 报错
 */
type KeyEntry = { key: string; source?: string };
type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; keys: KeyEntry[]; revision?: number };

const POLL_MS = 1500;
const POLL_MAX = 20;

function classifyError(msg: string): 'forbidden' | 'unreachable' | 'hub' {
  if (/权限|permission|forbidden|\b403\b|owner|管理员|refused/i.test(msg)) return 'forbidden';
  if (/超时|timed ?out|未响应|unreachable|离线|offline|expired|过期/i.test(msg)) return 'unreachable';
  return 'hub';
}

export function NodeSecretsDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { node_id: nodeId, alias } = session;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    const ref = nodeId || alias;
    const post = await fetch(`/api/hub/nodes/${encodeURIComponent(ref)}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    });
    const pj = (await post.json().catch(() => ({}))) as { ok?: boolean; request_id?: string; message?: string; error?: string };
    if (!post.ok || pj.ok === false || !pj.request_id) {
      return { ok: false as const, message: pj.message || pj.error || `HTTP ${post.status}` };
    }
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled.current) return { ok: false as const, message: t('已取消', 'Cancelled') };
      const g = await fetch(`/api/hub/nodes/${encodeURIComponent(ref)}/secrets/${encodeURIComponent(pj.request_id)}`);
      const gj = (await g.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string; keys?: KeyEntry[]; revision?: number };
      if (!g.ok || gj.ok === false) return { ok: false as const, message: gj.error || `HTTP ${g.status}` };
      if (gj.status === 'done') return { ok: true as const, keys: gj.keys ?? [], revision: gj.revision };
      if (gj.status === 'failed' || gj.error) return { ok: false as const, message: gj.error || t('节点返回失败', 'Node reported failure') };
    }
    return { ok: false as const, message: t('等待超时：节点未在 30 秒内返回（密钥请求 120 秒后过期）', 'Timed out: the node did not answer within 30s') };
  }, [nodeId, alias]);

  useEffect(() => {
    cancelled.current = false;
    if (session.node_secrets_capable === false) return () => { cancelled.current = true; };
    // setState 全部在异步函数体内完成（不在 effect 的同步段、也不在 .then 回调里）
    const load = async () => {
      const r = await run();
      if (cancelled.current) return;
      if (r.ok) setPhase({ kind: 'done', keys: r.keys, revision: r.revision });
      else setPhase({ kind: 'error', message: r.message });
    };
    void load();
    return () => { cancelled.current = true; };
  }, [attempt, run, session.node_secrets_capable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notCapable = session.node_secrets_capable === false;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--scrim)] p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t('节点密钥名称', 'Node secret names')}
      data-testid="node-secrets-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-[40vh] max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] shadow-xl" /* exception: 与运行日志/项目文件夹同高 */>
        <div className="flex items-center justify-between gap-2 border-b border-[var(--col-line-strong)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] text-[var(--fg)]">
              {t('密钥名称', 'Secret names')}
              <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{session.alias}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]" data-testid="node-secrets-subtitle">
              {phase.kind === 'done'
                ? t(`共 ${phase.keys.length} 个${typeof phase.revision === 'number' ? ` · revision ${phase.revision}` : ''}`, `${phase.keys.length} key(s)`)
                : '—'}
              <span className="ml-2">{t('（仅名称，值不可读）', '(names only — values are not readable)')}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              data-testid="node-secrets-retry"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-sunken)]"
            >{t('重新读取', 'Reload')}</button>
            <button
              type="button"
              onClick={onClose}
              data-testid="node-secrets-close"
              aria-label={t('关闭', 'Close')}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)]"
            >✕</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
          {notCapable && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-secrets-not-capable">
              {t('该节点未上报「密钥」能力（节点版本较旧，升级后可用）', 'This node does not report secrets support (older node build)')}
            </div>
          )}
          {!notCapable && phase.kind === 'loading' && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-secrets-loading">
              {t('正在向节点请求密钥名称…（节点需在线）', 'Requesting secret names from the node…')}
            </div>
          )}
          {!notCapable && phase.kind === 'error' && (() => {
            const k = classifyError(phase.message);
            const body = k === 'forbidden'
              ? { title: t('无权限查看该节点密钥名称', "Not allowed to view this node's secret names"), hint: t('需要节点主人或网络管理员', 'Node owner or network admin required'), testid: 'node-secrets-forbidden' }
              : k === 'unreachable'
                ? { title: t('节点未响应（可能离线）', 'Node did not respond'), hint: t('稍后重试；持续离线请检查节点进程', 'Retry later; check the node process'), testid: 'node-secrets-unreachable' }
                : { title: t('Hub 返回错误', 'Hub returned an error'), hint: t('稍后再试；持续失败请反馈', 'Retry later'), testid: 'node-secrets-hub-error' };
            return (
              <div className="py-6 text-center" data-testid={body.testid}>
                <div className="text-[var(--danger)]">{body.title}</div>
                <div className="mt-1 text-[11px] text-[var(--fg-muted)]">{phase.message}</div>
                <div className="mt-1 text-[11px] text-[var(--fg-dim)]">{body.hint}</div>
              </div>
            );
          })()}
          {!notCapable && phase.kind === 'done' && phase.keys.length === 0 && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-secrets-empty">
              {t('该节点没有配置密钥', 'This node has no secrets configured')}
            </div>
          )}
          {!notCapable && phase.kind === 'done' && phase.keys.length > 0 && (
            <ul data-testid="node-secrets-list" className="divide-y divide-[var(--col-hairline)]">
              {phase.keys.map((k) => (
                <li key={k.key} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="truncate font-mono text-[12px] text-[var(--fg)]">{k.key}</span>
                  <span className="shrink-0 text-[11px] text-[var(--fg-dim)]">{k.source ?? 'node'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--col-line-strong)] px-3 py-1.5 text-[11px] text-[var(--fg-dim)]" data-testid="node-secrets-note">
          {t('只读：只返回名称，Hub 不返回密钥值；写入请走节点自己的 CLI', 'Read-only: only names are returned; values are never sent to the browser')}
        </div>
      </div>
    </div>
  );
}

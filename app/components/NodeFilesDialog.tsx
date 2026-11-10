'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './types';
import { t } from '../lib/ui-lang';

/**
 * 节点「项目文件夹」只读浏览器（.450）—— list_node_files / read_node_file。
 *
 * 合同（Hub 侧既有能力）：
 *   list_node_files { node_id|alias, path? }  → { path, entries:[{name,type,size?,mtime?,hidden_reason?,no_descend?}], truncated, total }
 *   read_node_file  { node_id|alias, path }   → { path, name, kind, size?, mtime?, content?, hidden_reason? }
 *   相对路径；绝对路径与 `..` 被拒；>256KiB 或二进制只给 size；疑似密钥只给文件名
 *   凭据：user logins only（与运行日志同一套：节点主人 / 网络 owner·admin）
 *
 * 设计纪律（与日志面板一致）：
 *   · 两态空：空目录 vs 无匹配（本面板没有 grep，只需空目录）
 *   · 不能预览时说明原因（二进制/超大/疑似密钥），不假装能看
 *   · 错误三态：无权限 / 节点不可达 / Hub 报错
 *   · 配色只用 token；控件 h-[var(--control-h)]；只读 ⇒ 不出现保存类按钮
 */
type Entry = { name: string; type?: string; size?: number; mtime?: number; hidden_reason?: string; no_descend?: boolean };
type ListPayload = { path?: string; entries?: Entry[]; truncated?: boolean; total?: number };
type FilePayload = { path?: string; name?: string; kind?: string; size?: number; mtime?: number; content?: string; hidden_reason?: string };

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 10;
const PATH_MAX = 1024;

/** 相对路径守卫：只允许相对、不含 ..、长度受限（服务端还会再判一次）。 */
function safePath(p: string): string {
  const s = p.trim();
  if (!s) return '';
  if (s.length > PATH_MAX) return '';
  if (s.startsWith('/') || s.includes('..')) return '';
  return s.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function classifyError(msg: string): 'forbidden' | 'unreachable' | 'hub' {
  if (/权限|permission|forbidden|\b403\b|owner|管理员|refused|user login|登录|cannot/i.test(msg)) return 'forbidden';
  if (/超时|timed ?out|未响应|unreachable|离线|offline/i.test(msg)) return 'unreachable';
  return 'hub';
}

function fmtSize(n?: number): string {
  if (!Number.isFinite(n ?? NaN)) return '';
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

type ListPhase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'done'; payload: ListPayload };
type FilePhase = { kind: 'idle' } | { kind: 'loading'; path: string } | { kind: 'error'; message: string; path: string } | { kind: 'done'; payload: FilePayload };

export function NodeFilesDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { node_id: nodeId, alias } = session;
  const [dir, setDir] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListPhase>({ kind: 'loading' });
  const [file, setFile] = useState<FilePhase>({ kind: 'idle' });
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

  /** 门铃：发起 → 轮询（读写工具共用同一套 request_id 流程）。 */
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
      const p = (r.payload ?? {}) as { status?: string; content?: string; error?: string | null };
      if (p.status === 'done') return { ok: true as const, content: typeof p.content === 'string' ? p.content : '' };
      if (p.status === 'error') return { ok: false as const, message: p.error ?? t('节点返回错误', 'Node error') };
    }
    return { ok: false as const, message: t('等待超时：节点可能未响应', 'Timed out waiting for the node') };
  }, [call]);

  useEffect(() => {
    cancelled.current = false;
    if (session.files_capable === false) return () => { cancelled.current = true; };
    const target: Record<string, unknown> = nodeId ? { node_id: nodeId } : { alias };
    const run = async () => {
      setList({ kind: 'loading' });
      setFile({ kind: 'idle' });
      const r = await ring('list_node_files', { ...target, path: safePath(dir) });
      if (cancelled.current) return;
      if (!r.ok) { setList({ kind: 'error', message: r.message }); return; }
      let parsed: ListPayload = {};
      try { parsed = JSON.parse(r.content) as ListPayload; } catch { parsed = {}; }
      setList({ kind: 'done', payload: parsed });
    };
    void run();
    return () => { cancelled.current = true; };
  }, [attempt, dir, nodeId, alias, session.files_capable, ring]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (file.kind !== 'idle') { setFile({ kind: 'idle' }); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file.kind, onClose]);

  const openFile = async (path: string) => {
    setFile({ kind: 'loading', path });
    const target: Record<string, unknown> = nodeId ? { node_id: nodeId } : { alias };
    const r = await ring('read_node_file', { ...target, path: safePath(path) });
    if (cancelled.current) return;
    if (!r.ok) { setFile({ kind: 'error', message: r.message, path }); return; }
    let parsed: FilePayload = {};
    try { parsed = JSON.parse(r.content) as FilePayload; } catch { parsed = {}; }
    setFile({ kind: 'done', payload: parsed });
  };

  const notCapable = session.files_capable === false;
  const segments = dir ? dir.split('/') : [];

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--scrim)] p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t('节点项目文件夹', 'Node workdir')}
      data-testid="node-files-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-[40vh] max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] shadow-xl" /* exception: 与运行日志面板同高，避免两个面板跳变 */>
        <div className="flex items-center justify-between gap-2 border-b border-[var(--col-line-strong)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] text-[var(--fg)]">
              {t('项目文件夹', 'Workdir')}
              <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{session.alias}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--fg-dim)]" data-testid="node-files-path">
              <button type="button" onClick={() => setDir('')} className="hover:text-[var(--fg-muted)]">/</button>
              {segments.map((seg, i) => (
                <span key={`${seg}-${i}`} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDir(segments.slice(0, i + 1).join('/'))}
                    className="hover:text-[var(--fg-muted)]"
                  >{seg}</button>
                  {i < segments.length - 1 && <span>/</span>}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {file.kind !== 'idle' && (
              <button
                type="button"
                onClick={() => setFile({ kind: 'idle' })}
                data-testid="node-file-back"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
              >{t('返回列表', 'Back')}</button>
            )}
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              data-testid="node-files-retry"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-sunken)]"
            >{t('重新读取', 'Reload')}</button>
            <button
              type="button"
              onClick={onClose}
              data-testid="node-files-close"
              aria-label={t('关闭', 'Close')}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)]"
            >✕</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
          {notCapable && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-files-not-capable">
              {t('该节点未上报「文件」能力（节点版本较旧，升级后可用）', 'This node does not report file support (older node build)')}
            </div>
          )}

          {!notCapable && file.kind === 'idle' && list.kind === 'loading' && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-files-loading">{t('正在读取目录…', 'Reading directory…')}</div>
          )}
          {!notCapable && file.kind === 'idle' && list.kind === 'error' && (() => {
            const k = classifyError(list.message);
            const body = k === 'forbidden'
              ? { title: t('无权限读取该节点文件', 'Not allowed to read this node'), hint: t('需要节点主人或网络管理员', 'Node owner or network admin required'), testid: 'node-files-forbidden' }
              : k === 'unreachable'
                ? { title: t('节点未响应（可能离线）', 'Node did not respond'), hint: t('稍后重试；持续离线请检查节点进程', 'Retry later; check the node process'), testid: 'node-files-unreachable' }
                : { title: t('Hub 返回错误', 'Hub returned an error'), hint: t('稍后再试；持续失败请反馈', 'Retry later'), testid: 'node-files-hub-error' };
            return (
              <div className="py-6 text-center" data-testid={body.testid}>
                <div className="text-[var(--danger)]">{body.title}</div>
                <div className="mt-1 text-[11px] text-[var(--fg-muted)]">{list.message}</div>
                <div className="mt-1 text-[11px] text-[var(--fg-dim)]">{body.hint}</div>
              </div>
            );
          })()}
          {!notCapable && file.kind === 'idle' && list.kind === 'done' && (list.payload.entries ?? []).length === 0 && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-files-empty">{t('该目录为空', 'This directory is empty')}</div>
          )}
          {!notCapable && file.kind === 'idle' && list.kind === 'done' && (list.payload.entries ?? []).length > 0 && (
            <>
              {list.payload.truncated && (
                <div className="mb-1 rounded-lg bg-[var(--bg-sunken)] px-2 py-1 text-[11px] text-[var(--warning)]" data-testid="node-files-truncated">
                  {t(`条目过多，仅显示前 ${(list.payload.entries ?? []).length} / ${list.payload.total ?? '?'} 项`, 'Too many entries — showing the first N')}
                </div>
              )}
              <ul data-testid="node-files-list" className="divide-y divide-[var(--col-hairline)]">
                {(list.payload.entries ?? []).map((e) => {
                  const isDir = e.type === 'dir';
                  const path = joinPath(dir, e.name);
                  return (
                    <li key={e.name}>
                      <button
                        type="button"
                        data-testid={isDir ? 'node-files-dir' : 'node-files-file'}
                        data-name={e.name}
                        disabled={isDir && e.no_descend}
                        onClick={() => { if (isDir) { if (!e.no_descend) setDir(path); } else void openFile(path); }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-sunken)] disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate text-[var(--fg)]">
                          {isDir ? '📁 ' : '📄 '}{e.name}
                          {e.hidden_reason && <span className="ml-1 text-[11px] text-[var(--fg-dim)]">（{e.hidden_reason}）</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--fg-dim)]">{isDir ? '' : fmtSize(e.size)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {!notCapable && file.kind === 'loading' && (
            <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-file-loading">{t('正在读取文件…', 'Reading file…')}</div>
          )}
          {!notCapable && file.kind === 'error' && (() => {
            const k = classifyError(file.message);
            const testid = k === 'forbidden' ? 'node-file-forbidden' : k === 'unreachable' ? 'node-file-unreachable' : 'node-file-hub-error';
            return (
              <div className="py-6 text-center" data-testid={testid}>
                <div className="text-[var(--danger)]">{file.message}</div>
              </div>
            );
          })()}
          {!notCapable && file.kind === 'done' && (() => {
            const p = file.payload;
            const noPreview = p.content === undefined;
            return (
              <div data-testid="node-file-view">
                <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--fg-dim)]">
                  <span className="truncate">{p.path ?? ''}</span>
                  <span>{fmtSize(p.size)}</span>
                </div>
                {noPreview ? (
                  <div className="py-6 text-center text-[var(--fg-muted)]" data-testid="node-file-no-preview">
                    {p.hidden_reason
                      ? t(`无法预览：${p.hidden_reason}（只读、不下载）`, `No preview: ${p.hidden_reason}`)
                      : t('该文件无法预览（二进制或超过 256KiB）', 'Not previewable (binary or larger than 256KiB)')}
                  </div>
                ) : (
                  <pre data-testid="node-file-content" className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.45] text-[var(--fg)]">{p.content}</pre>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

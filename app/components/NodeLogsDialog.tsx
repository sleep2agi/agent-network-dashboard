'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from './types';
import { t } from '../lib/ui-lang';

/**
 * 节点「运行日志」面板（.448）—— 走 Hub MCP 的 tail_node_logs。
 *
 * 合同（Hub 侧 node-logs-transport.test.ts 实测）：
 *   tail_node_logs { node_id|alias, lines?, level?, grep?, since_ts? }
 *     → request_id（op = logs_tail）
 *   get_rules_file_result { request_id }
 *     → payload.content 是 **JSON 字符串**：{ files, lines:[{ts,level,text,key}], truncated, matched, now_ts }
 *   凭据：**用户令牌（会话 V3 token），不是节点令牌**。
 *         Hub 侧只放行「节点主人 / 网络 owner·admin」；普通成员/旁观者/别的网络的用户
 *         在生成任何一行之前就会被拒。代理（/api/nodes/tool）用 hubFetch 转发会话令牌，
 *         因此不存在「任何成员都能读别人节点日志」的洞。
 *         面板可见性 = logs_capable（节点能力） × Hub 授权（权限），
 *         与 can_edit_permission 不同源：能看日志 ≠ 能改权限。
 *   读一次即焚：第二次读返回 content_purged ⇒ 面板只保留首次结果，重新读取必须重新发起
 *
 * 设计约束（评审给定，改前先读）：
 *   1. truncated 必须显示成一句话——「日志少」与「日志被截断」必须可区分
 *   2. 空态分两种：无日志 vs grep 无匹配（后者要带上 pattern）
 *   3. 级别配色只用 token（--danger / --warning / --fg-muted），不许 text-red-*
 *   4. 只有「贴底」才自动跟随；往上滚就停，并给「回到底部（N 条新）」
 *   5. 高度稳定（min-h 40vh），字号只用 11/12，行高 leading-[1.45]
 *   6. since_ts 显示成「最近 N 分钟」，并附 now_ts（观测时间），不硬编码窗口
 */
type LogLine = { ts?: number; level?: string; text?: string; key?: string };
type LogPayload = {
  files?: string[];
  lines?: LogLine[];
  truncated?: boolean;
  matched?: number;
  now_ts?: number;
};

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 10;
const LINE_LIMIT = 2000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; payload: LogPayload };

/** 把「红色一行字」拆成三态：无权限 / 节点不可达 / Hub 报错。 */
function classifyError(msg: string): 'forbidden' | 'unreachable' | 'hub' {
  if (/权限|permission|forbidden|\b403\b|owner|管理员|refused|user login|登录|cannot/i.test(msg)) return 'forbidden';
  if (/超时|timed ?out|未响应|unreachable|离线|offline/i.test(msg)) return 'unreachable';
  return 'hub';
}

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-[var(--danger)]',
  warn: 'text-[var(--warning)]',
  info: 'text-[var(--fg-muted)]',
  debug: 'text-[var(--fg-muted)] opacity-70',
};

export function NodeLogsDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { node_id: nodeId, alias } = session;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [grep, setGrep] = useState('');
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [lines, setLines] = useState(500);
  const [sinceMinutes, setSinceMinutes] = useState<number | ''>('');
  const [follow, setFollow] = useState(true);
  const cancelled = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  useEffect(() => { followRef.current = follow; }, [follow]);
  // 「已看到的最末行数」。用 state（不是 ref）：渲染期要拿它算差值，
  // 读 ref 会被 react-hooks/refs 拦；只在事件/异步回调里更新（不在 effect 体内同步 setState）。
  const [seenLen, setSeenLen] = useState(0);

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
    // 能力不足：渲染期直接给原因（effect 里同步 setState 会触发级联渲染）
    if (session.logs_capable === false) return () => { cancelled.current = true; };

    const target: Record<string, unknown> = nodeId ? { node_id: nodeId } : { alias };
    // 入参白名单：这里只放 Hub 允许的五个键，别的什么都不发
    const args: Record<string, unknown> = {
      ...target,
      lines: Math.max(1, Math.min(LINE_LIMIT, Number.isFinite(lines) ? lines : 500)),
    };
    if (level !== 'all') args.level = level;
    if (grep.trim()) args.grep = grep.trim().slice(0, 200);
    // 窗口长度现取，不硬编码：用户选的分钟数 × 60000，从「此刻」倒推
    if (sinceMinutes !== '' && Number.isFinite(Number(sinceMinutes))) {
      args.since_ts = Math.max(0, Date.now() - Number(sinceMinutes) * 60_000);
    }

    const run = async () => {
      setPhase({ kind: 'loading' });
      setSeenLen(0);
      const started = await call('tail_node_logs', args);
      if (cancelled.current) return;
      if (!started.ok) {
        setPhase({
          kind: 'error',
          message: started.kind === 'unsupported'
            ? t('当前 Hub 还不支持读取运行日志，请先升级 Hub', 'This Hub does not support run logs yet')
            : (started.error ?? t('读取失败', 'Failed')),
        });
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
        const p = (r.payload ?? {}) as { status?: string; content?: string; error?: string | null };
        if (p.status === 'error') {
          setPhase({ kind: 'error', message: p.error ?? t('节点返回错误', 'Node returned an error') });
          return;
        }
        if (p.status === 'done') {
          // content 是 JSON 字符串（与技能列表同一套「JSON-in-JSON」约定）
          let parsed: LogPayload = {};
          if (typeof p.content === 'string') {
            try { parsed = JSON.parse(p.content) as LogPayload; } catch { parsed = {}; }
          }
          setPhase({ kind: 'done', payload: parsed });
          // 跟随态下把「已看到」推到最新（异步回调里，不是 effect 体内的同步 setState）
          if (followRef.current) setSeenLen((parsed.lines ?? []).length);
          return;
        }
        if (tries >= POLL_MAX) {
          setPhase({ kind: 'error', message: t('等待超时：节点可能未响应', 'Timed out waiting for the node') });
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
  }, [attempt, call, nodeId, alias, session.logs_capable, grep, level, lines, sinceMinutes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 贴底才跟随：新结果到达时，只有 follow=true 才滚到底；否则累计「N 条新」
  const rows = phase.kind === 'done' ? (phase.payload.lines ?? []) : [];
  // 非跟随态下「有多少行是用户没看过的」——渲染期派生，不用 state
  const pendingRows = follow ? 0 : Math.max(0, rows.length - seenLen);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (follow) el.scrollTop = el.scrollHeight;
  }, [rows.length, follow]);

  const nowTs = phase.kind === 'done' ? phase.payload.now_ts : undefined;
  const windowLabel = useMemo(() => {
    if (sinceMinutes === '') return t('全部（按行数上限）', 'All (capped by line limit)');
    return t(`最近 ${sinceMinutes} 分钟`, `last ${sinceMinutes} min`);
  }, [sinceMinutes]);

  const notCapable = session.logs_capable === false;
  const truncated = phase.kind === 'done' && phase.payload.truncated === true;
  const matched = phase.kind === 'done' ? Number(phase.payload.matched ?? rows.length) : 0;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--scrim)] p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t('节点运行日志', 'Node run log')}
      data-testid="node-logs-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-[40vh] max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--col-line-strong)] px-3 py-2">
          <div className="min-w-0">
            {/* 标题档 14px：全仓 5 处标题同一档（非特例）。若将来抽 --fs-title，这里一起换。 */}
            <div className="truncate text-[14px] text-[var(--fg)]">
              {t('运行日志', 'Run log')}
              <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{session.alias}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]" data-testid="node-logs-subtitle">
              {windowLabel}
              {nowTs ? ` · ${t('观测于', 'observed')} ${new Date(nowTs).toLocaleTimeString()}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              value={grep}
              onChange={(e) => setGrep(e.target.value)}
              placeholder={t('过滤关键字', 'grep')}
              data-testid="node-logs-grep"
              className="h-[var(--control-h)] w-32 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 leading-none text-[11px] text-[var(--fg)]"
            />
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as 'all' | 'info' | 'warn' | 'error')}
              data-testid="node-logs-level"
              className="h-[var(--control-h)] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1 leading-none text-[11px] text-[var(--fg)]"
            >
              <option value="all">{t('全部级别', 'all levels')}</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              data-testid="node-logs-retry"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-sunken)]"
            >
              {t('重新读取', 'Reload')}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="node-logs-close"
              aria-label={t('关闭', 'Close')}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)]"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 截断提示：必须在界面上可见，「少」与「被截断」不能混为一谈 */}
        {truncated && (
          <div
            className="border-b border-[var(--col-line-strong)] bg-[var(--bg-sunken)] px-3 py-1 text-[11px] text-[var(--warning)]"
            data-testid="node-logs-truncated"
          >
            {t(`仅显示最后 ${lines} 行，已截断（匹配 ${matched} 行）`, `Showing the last ${lines} lines (truncated, ${matched} matched)`)}
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={() => {
              const el = scrollRef.current;
              if (!el) return;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              if (atBottom && !follow) { setFollow(true); setSeenLen(rows.length); }
              if (!atBottom && follow) setFollow(false);
            }}
            data-testid="node-logs-scroll"
            className="h-full overflow-auto px-3 py-2 font-mono text-[11px] leading-[1.45]"
          >
            {notCapable && (
              <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-logs-not-capable">
                {t('该节点未上报「运行日志」能力（节点版本较旧，升级后可用）',
                   'This node does not report run-log support (older node build; available after upgrade)')}
              </div>
            )}
            {!notCapable && phase.kind === 'loading' && (
              <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-logs-loading">
                {t('正在向节点读取日志…', 'Reading logs from node…')}
              </div>
            )}
            {!notCapable && phase.kind === 'error' && (() => {
              // 三态：无权限（找管理员）/ 节点不可达（重试或查进程）/ Hub 报错（稍后再试）
              // 三者都只表现为「红色一行字」时，用户无法判断该找谁——所以这里分开。
              const k = classifyError(phase.message);
              const body = k === 'forbidden'
                ? { title: t('无权限读取该节点日志', 'Not allowed to read this node\'s log'),
                    hint: t('需要节点主人或网络管理员；请联系节点主人 / 管理员授权', 'Node owner or network admin required — ask them to grant access'),
                    testid: 'node-logs-forbidden' }
                : k === 'unreachable'
                  ? { title: t('节点未响应（可能离线）', 'Node did not respond (may be offline)'),
                      hint: t('稍后重试；若持续离线，请检查该节点进程是否在运行', 'Retry later; if it stays offline, check that node process is running'),
                      testid: 'node-logs-unreachable' }
                  : { title: t('Hub 返回错误', 'Hub returned an error'),
                      hint: t('稍后再试；持续失败请把这条错误连同时间反馈给我', 'Retry later; if it persists, report this error with the time'),
                      testid: 'node-logs-hub-error' };
              return (
                <div className="py-6 text-center text-[12px]" data-testid={body.testid}>
                  <div className="text-[var(--danger)]">{body.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--fg-muted)]">{phase.message}</div>
                  <div className="mt-1 text-[11px] text-[var(--fg-dim)]">{body.hint}</div>
                </div>
              );
            })()}
            {!notCapable && phase.kind === 'done' && rows.length === 0 && (
              <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-logs-empty">
                {grep.trim()
                  ? t(`无匹配：${grep.trim()}`, `No match for "${grep.trim()}"`)
                  : t('该节点暂无日志', 'This node has no logs')}
              </div>
            )}
            {!notCapable && phase.kind === 'done' && rows.length > 0 && (
              <ol data-testid="node-logs-lines">
                {rows.map((ln, i) => (
                  <li key={ln.key ?? `${i}`} className="whitespace-pre-wrap break-words">
                    <span className={(LEVEL_CLASS[String(ln.level ?? 'info')] ?? 'text-[var(--fg-muted)]')}>
                      {ln.text ?? ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {!follow && pendingRows > 0 && (
            <button
              type="button"
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
                setFollow(true);
                setSeenLen(rows.length);
              }}
              data-testid="node-logs-jump"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--accent)] shadow"
            >
              {t(`回到底部（${pendingRows} 条新）`, `Jump to latest (${pendingRows} new)`)}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--col-line-strong)] px-3 py-1.5 text-[11px] text-[var(--fg-dim)]">
          <span data-testid="node-logs-matched">
            {phase.kind === 'done'
              ? t(`${rows.length} / ${matched} 行`, `${rows.length} / ${matched} lines`)
              : '—'}
          </span>
          <span className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              {t('行数', 'lines')}
              <select
                value={lines}
                onChange={(e) => setLines(Number(e.target.value))}
                data-testid="node-logs-limit"
                className="h-[var(--control-h)] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1 leading-none text-[11px] text-[var(--fg)]"
              >
                {[200, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              {t('窗口', 'window')}
              <select
                value={String(sinceMinutes)}
                onChange={(e) => setSinceMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                data-testid="node-logs-window"
                className="h-[var(--control-h)] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1 leading-none text-[11px] text-[var(--fg)]"
              >
                <option value="">{t('全部', 'all')}</option>
                {[5, 15, 60, 360].map((n) => <option key={n} value={n}>{t(`${n} 分钟`, `${n} min`)}</option>)}
              </select>
            </label>
          </span>
        </div>
      </div>
    </div>
  );
}

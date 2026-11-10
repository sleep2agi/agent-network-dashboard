'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './types';
import { t } from '../lib/ui-lang';

/**
 * 节点「技能」只读面板。
 *
 * 契约（2026-11-10 线上实测，与 APP 同一套门铃）：
 *   list_node_skills { node_id }            → request_id (op=skills_list)
 *   get_rules_file_result { request_id }    → payload.content 是 **JSON 字符串**：
 *                                             {"skills":[{name,scope,path_rel,description,origin}]}
 *   read_node_skill { node_id, name }       → request_id (op=skill_read)
 *   get_rules_file_result { request_id }    → payload.content = SKILL.md 正文
 *
 * 注意两处只有真调一次才知道的细节：结果套在 content 字符串里；读单个技能参数名是 `name`。
 */
type Skill = { name: string; scope?: string; path_rel?: string; description?: string; origin?: string };

type ListPhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; skills: Skill[] };

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 10;

export function NodeSkillsDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [phase, setPhase] = useState<ListPhase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<{ skill: Skill; content: string | null; error?: string } | null>(null);
  const cancelled = useRef(false);
  // 复制反馈（.443）：技能名 / SKILL.md 全文各一个复制入口，点完 1.5s 内显示「已复制」。
  // 不提供「在 SkillHub 打开」：node 技能只有 name/scope/path_rel，没有 skill_id，
  // 拼 /skillhub?skill_id= 会是假链接（SkillHub 页按 skill_id 定位）。
  const [copied, setCopied] = useState<'name' | 'content' | null>(null);
  const { node_id: nodeId, alias } = session;

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

  /** 发起门铃并轮询取回 payload（规则文件与技能共用同一套结果接口）。 */
  const ring = useCallback(async (tool: string, args: Record<string, unknown>) => {
    const started = await call(tool, args);
    if (!started.ok) return { ok: false as const, message: started.error ?? t('请求失败', 'Request failed'), unsupported: started.kind === 'unsupported' };
    const requestId = String((started.payload as { request_id?: string } | undefined)?.request_id ?? '');
    if (!requestId) return { ok: false as const, message: t('Hub 没有返回请求号', 'No request id') };
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise(r => setTimeout(r, i === 0 ? 300 : POLL_INTERVAL_MS));
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
    if (session.skills_capable === false) return () => { cancelled.current = true; };
    (async () => {
      setPhase({ kind: 'loading' });
      const args: Record<string, string> = nodeId ? { node_id: nodeId } : { alias };
      const r = await ring('list_node_skills', args);
      if (cancelled.current) return;
      if (!r.ok) { setPhase({ kind: 'error', message: r.message }); return; }
      let parsed: { skills?: Skill[] } | null = null;
      try { parsed = JSON.parse(r.content) as { skills?: Skill[] }; } catch { parsed = null; }
      if (!parsed || !Array.isArray(parsed.skills)) {
        setPhase({ kind: 'error', message: t('技能列表格式无法解析', 'Unrecognised skills payload') });
        return;
      }
      setPhase({ kind: 'done', skills: parsed.skills });
    })();
    return () => { cancelled.current = true; };
  }, [attempt, nodeId, alias, ring, session.skills_capable]);

  const openSkill = async (skill: Skill) => {
    setOpen({ skill, content: null });
    const args: Record<string, string> = nodeId ? { node_id: nodeId, name: skill.name } : { alias, name: skill.name };
    const r = await ring('read_node_skill', args);
    if (!r.ok) { setOpen({ skill, content: null, error: r.message }); return; }
    // 实测：read_node_skill 的 content 也是一个 JSON 对象（含 name/scope/path_rel/content 等），
    // 直接展示会把 JSON 当正文给用户看 —— 先尝试取出内层 content，取不到再原样展示。
    let body = r.content;
    try {
      const parsed = JSON.parse(r.content) as { content?: unknown; body?: unknown };
      const inner = typeof parsed.content === 'string' ? parsed.content : (typeof parsed.body === 'string' ? parsed.body : null);
      if (inner) body = inner;
    } catch { /* 不是 JSON：本来就是正文 */ }
    setOpen({ skill, content: body });
  };

  const copyText = async (kind: 'name' | 'content', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* 剪贴板不可用时静默，不弹错误（与规则面板一致） */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (open) setOpen(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const notCapable = session.skills_capable === false;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--scrim)] p-3"
      role="dialog"
      aria-modal="true"
      aria-label={t('节点技能', 'Node skills')}
      data-testid="node-skills-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[var(--col-line-strong)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--col-line-strong)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] text-[var(--fg)]">
              {open ? t('技能内容', 'Skill') : t('技能', 'Skills')}
              <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{session.alias}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]" data-testid="node-skills-subtitle">
              {open ? open.skill.name : (phase.kind === 'done' ? t(`${phase.skills.length} 个技能`, `${phase.skills.length} skills`) : '—')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {open && (
              <button
                type="button"
                onClick={() => setOpen(null)}
                data-testid="node-skills-back"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
              >
                {t('返回列表', 'Back')}
              </button>
            )}
            {open && (
              <button
                type="button"
                onClick={() => void copyText('name', open.skill.name)}
                data-testid="node-skill-copy-name"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
              >
                {copied === 'name' ? t('已复制', 'Copied') : t('复制名字', 'Copy name')}
              </button>
            )}
            {open && open.content !== null && (
              <button
                type="button"
                onClick={() => void copyText('content', open.content ?? '')}
                data-testid="node-skill-copy-content"
                className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
              >
                {copied === 'content' ? t('已复制', 'Copied') : t('复制全文', 'Copy full')}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setOpen(null); setAttempt(n => n + 1); }}
              data-testid="node-skills-retry"
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--bg-sunken)]"
            >
              {t('重新读取', 'Reload')}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="node-skills-close"
              aria-label={t('关闭', 'Close')}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {notCapable && (
            <div className="py-6 text-center text-[12px] text-[var(--danger)]" data-testid="node-skills-error">
              {t('该节点未上报「技能」能力', 'This node does not report skills support')}
            </div>
          )}
          {!notCapable && phase.kind === 'loading' && (
            <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-skills-loading">
              {t('正在向节点读取技能列表…', 'Reading skills from node…')}
            </div>
          )}
          {!notCapable && phase.kind === 'error' && (
            <div className="py-6 text-center text-[12px] text-[var(--danger)]" data-testid="node-skills-error">{phase.message}</div>
          )}
          {!notCapable && phase.kind === 'done' && phase.skills.length === 0 && (
            <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-skills-empty">
              {t('该节点没有技能', 'This node has no skills')}
            </div>
          )}
          {!notCapable && phase.kind === 'done' && phase.skills.length > 0 && !open && (
            <ul className="flex flex-col" data-testid="node-skills-list">
              {phase.skills.map(s => (
                <li key={s.name} className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => void openSkill(s)}
                    data-testid="node-skills-item"
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-sunken)]"
                  >
                    <div className="truncate text-[12px] text-[var(--fg)]">{s.name}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]">
                      {[s.origin, s.scope].filter(Boolean).join(' · ')}
                    </div>
                    {s.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--fg-muted)]">{s.description}</div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyText('name', s.name)}
                    data-testid="node-skills-copy-name"
                    aria-label={t(`复制技能名 ${s.name}`, `Copy skill name ${s.name}`)}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--bg-sunken)] hover:text-[var(--fg-muted)]"
                  >
                    {copied === 'name' ? t('已复制', 'Copied') : t('复制', 'Copy')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && (
            open.error
              ? <div className="py-6 text-center text-[12px] text-[var(--danger)]" data-testid="node-skill-error">{open.error}</div>
              : open.content === null
                ? <div className="py-6 text-center text-[12px] text-[var(--fg-muted)]" data-testid="node-skill-loading">{t('正在读取…', 'Loading…')}</div>
                : <pre data-testid="node-skill-content" className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--fg)]">{open.content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

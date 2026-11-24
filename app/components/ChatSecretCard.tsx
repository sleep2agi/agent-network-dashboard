'use client';

// admin 2026-11-24 —— 聊天里的「密钥」卡（网页版）。AI 调 Hub 的 request_secret 后，
// 回复任务行带 meta_json.reply_secret_request，这张卡代替那条兜底文字出现在回复气泡里。
// 保存 = list 拿 revision → put（都走 /api/hub/nodes/:ref/secrets 代理并轮询回执）→ 成功后父级
// 以用户身份发一句「已在卡片里保存 X」（只含名字），AI 收到才继续。值只在输入框和 put 请求体里。
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/ui-lang';
import { secretSaveErrorText, secretSavedMessage, type ChatSecretRequest } from '../lib/chat-secret-request';

const POLL_MS = 1000;
const POLL_MAX = 30;

type Outcome = { ok: true; revision?: number } | { ok: false; kind: string };

async function secretsCall(ref: string, body: Record<string, unknown>, live: { current: boolean }): Promise<Outcome> {
  const post = await fetch(`/api/hub/nodes/${encodeURIComponent(ref)}/secrets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => null);
  if (!post) return { ok: false, kind: 'unconfirmed' };
  const pj = (await post.json().catch(() => ({}))) as { ok?: boolean; request_id?: string; error?: string };
  if (!post.ok || pj.ok === false || !pj.request_id) {
    const e = pj.error || '';
    return { ok: false, kind: e === 'secret_admin_required' || post.status === 403 ? 'forbidden'
      : e === 'node_secrets_upgrade_required' ? 'unsupported' : e === 'invalid_secret_input' ? 'invalid' : 'unconfirmed' };
  }
  for (let i = 0; i < POLL_MAX; i += 1) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!live.current) return { ok: false, kind: 'cancelled' };
    const g = await fetch(`/api/hub/nodes/${encodeURIComponent(ref)}/secrets/${encodeURIComponent(pj.request_id)}`).catch(() => null);
    if (!g) continue;
    const gj = (await g.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string; revision?: number };
    if (gj.status === 'done') return { ok: true, revision: gj.revision };
    if (!g.ok || gj.ok === false || gj.status === 'failed') return { ok: false, kind: 'unconfirmed' };
  }
  return { ok: false, kind: 'unconfirmed' };
}

export default function ChatSecretCard({ request, alreadySaved, onSaved }: {
  request: ChatSecretRequest;
  alreadySaved: boolean;
  onSaved: (message: string) => void;
}) {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>(alreadySaved ? 'saved' : 'idle');
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (alreadySaved) setPhase('saved'); }, [alreadySaved]);
  const title = request.label || request.key;

  const save = async () => {
    if (phase === 'saving' || phase === 'saved' || !value.trim()) return;
    setPhase('saving'); setError('');
    const listed = await secretsCall(request.nodeId, { action: 'list' }, live);
    if (!live.current) return;
    if (!listed.ok || typeof listed.revision !== 'number') { setPhase('error'); setError(secretSaveErrorText(listed.ok ? 'unconfirmed' : listed.kind)); return; }
    const put = await secretsCall(request.nodeId, { action: 'put', key: request.key, value, revision: listed.revision }, live);
    if (!live.current) return;
    if (!put.ok) { setPhase('error'); setError(secretSaveErrorText(put.kind)); return; }
    setValue('');
    setPhase('saved');
    onSaved(secretSavedMessage(request));
  };

  return (
    <div data-testid={`chat-secret-${request.key}`} className="flex max-w-md flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold text-[var(--fg)]">{title}</span>
        <span className="text-[11px] text-[var(--fg-dim)]">{request.key}</span>
      </div>
      {phase === 'saved' ? (
        <div data-testid={`chat-secret-${request.key}-saved`} className="text-[12px] text-[var(--success)]">
          {t(`${request.key} 已保存。`, `${request.key} saved.`)}
        </div>
      ) : (
        <>
          <div className="text-[12px] text-[var(--fg-muted)]">
            {request.hint || t('内容不会出现在聊天里，AI 也看不到。', 'It never appears in the chat, and the AI cannot see it.')}
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input
              data-testid={`chat-secret-${request.key}-input`}
              type={shown ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={phase === 'saving'}
              autoComplete="off"
              spellCheck={false}
              placeholder={t(`粘贴 ${request.key}`, `Paste ${request.key}`)}
              aria-label={title}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[14px] text-[var(--fg)] placeholder-[var(--fg-dim)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button type="button" data-testid={`chat-secret-${request.key}-reveal`} onClick={() => setShown((s) => !s)}
              aria-label={shown ? t('隐藏', 'Hide') : t('显示', 'Show')}
              className="shrink-0 rounded px-1 text-[var(--fg-dim)] hover:text-[var(--fg)]">
              {shown ? '🙈' : '👁'}
            </button>
            <button type="submit" data-testid={`chat-secret-${request.key}-submit`} disabled={phase === 'saving' || !value.trim()}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
              {phase === 'saving' ? t('保存中…', 'Saving…') : t('保存', 'Save')}
            </button>
          </form>
          <div className="text-[11px] text-[var(--fg-dim)]">
            {t(`安全保存，AI 看不到内容；这个 AI 下次启动后可用（环境变量 ${request.key}）。`,
              `Stored securely; the AI never sees it. Available as env var ${request.key} after this AI restarts.`)}
          </div>
          {phase === 'error' && error ? <div data-testid={`chat-secret-${request.key}-error`} className="text-[12px] text-[var(--danger,#ef4444)]">{error}</div> : null}
        </>
      )}
    </div>
  );
}

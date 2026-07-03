'use client';

import { useEffect, useState } from 'react';

/**
 * Create/edit a model provider (RFC-028 P1). Single-step modal mirroring the
 * CreateNodeWizard shell (escape-to-close, SVG ✕, cyan primary). The API key
 * field is WRITE-ONLY: on edit of a provider that already has a key it shows a
 * "•••• configured" placeholder and an empty value means "keep existing key";
 * the stored value is never fetched or displayed.
 */

export interface ProviderDraft {
  provider_id?: string;
  name: string;
  type: string;
  base_url: string;
  models: string[];
  enabled: boolean;
  hasKey?: boolean;
}

// Backend (#308) currently supports only the `anthropic` vendor — which means
// any Anthropic-COMPATIBLE endpoint (Claude api.anthropic.com, DeepSeek
// api.deepseek.com/anthropic, MiniMax api.minimax.chat/anthropic, …) via a
// custom base_url, not just Anthropic the company. Native OpenAI/Grok vendors
// aren't wired yet → shown disabled so users can't pick an erroring option.
const TYPES: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'anthropic', label: 'Anthropic 兼容端点（Claude / DeepSeek / MiniMax 等）' },
  { id: 'openai-compatible', label: 'OpenAI-compatible（native，即将支持）', disabled: true },
  { id: 'grok', label: 'Grok（native，即将支持）', disabled: true },
];

type Phase = 'form' | 'saving' | 'done' | 'unconfirmed' | 'error';

const inputCls =
  'w-full rounded-md border border-[#26262b] bg-[#0e0e10] px-3 py-2 text-sm text-gray-200 focus:border-cyan-600 focus:outline-none';

export function ProviderFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ProviderDraft | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const editing = !!initial?.provider_id;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? TYPES[0].id);
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '');
  const [modelsText, setModelsText] = useState((initial?.models ?? []).join(', '));
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [phase, setPhase] = useState<Phase>('form');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'saving') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const nameValid = name.trim().length > 0;
  const urlValid = baseUrl.trim().length > 0;
  // Secret-first (RFC-028): a provider can't be created without a vault key,
  // so the API key is required on CREATE. On edit the key + vendor are
  // immutable (update_provider patches name/base_url/models only).
  const keyValid = editing || apiKey.trim().length > 0;
  const canSave = nameValid && urlValid && keyValid && phase !== 'saving';

  async function handleSave() {
    setPhase('saving'); setMsg('');
    const models = modelsText.split(',').map(m => m.trim()).filter(Boolean);
    const payload = {
      ...(initial?.provider_id ? { provider_id: initial.provider_id } : {}),
      name: name.trim(), type, base_url: baseUrl.trim(), models, enabled,
      ...(apiKey ? { apiKey } : {}),
    };
    try {
      const r = await fetch('/api/anet/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.ok) {
        setPhase('done'); onSaved?.();
        // close shortly after success so the list refresh is visible
        setTimeout(onClose, 350);
      } else if (data?.unconfirmed) {
        setPhase('unconfirmed');
        setMsg(`后端 RFC-028 未就绪：${data?.error || '不可用'}（hub 需 #308 + 升级）`);
      } else {
        setPhase('error');
        setMsg(data?.error ? `保存失败：${data.error}` : '保存失败');
      }
    } catch (e) {
      setPhase('error');
      setMsg(`保存失败：${e instanceof Error ? e.message : '网络错误'}`);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={() => phase !== 'saving' && onClose()} aria-hidden />
      <div
        role="dialog"
        aria-label={editing ? '编辑供应商' : '新增供应商'}
        className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#26262b] bg-[#161618] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#26262b] px-4 py-3">
          <div className="text-sm font-semibold text-white">{editing ? '编辑供应商' : '新增供应商'}</div>
          <button onClick={onClose} aria-label="关闭" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-white/5 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {phase === 'unconfirmed' || phase === 'error' ? (
            <div className={`rounded-md border px-3 py-2 text-xs ${phase === 'unconfirmed' ? 'border-amber-500/30 bg-amber-500/5 text-amber-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
              {msg}
            </div>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">名称 <span className="text-red-400/70">*</span></span>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="例如 DeepSeek" className={inputCls} />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">类型{editing ? '（不可修改）' : ''}</span>
            <select value={type} onChange={e => setType(e.target.value)} disabled={editing} className={`${inputCls} ${editing ? 'opacity-60 cursor-not-allowed' : ''}`}>
              {TYPES.map(t => <option key={t.id} value={t.id} disabled={t.disabled}>{t.label}</option>)}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Base URL <span className="text-red-400/70">*</span></span>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com" className={inputCls} />
            {!editing && <span className="text-[11px] text-gray-600">Anthropic 兼容端点：Claude <span className="font-mono">api.anthropic.com</span> · DeepSeek <span className="font-mono">api.deepseek.com/anthropic</span> · MiniMax <span className="font-mono">api.minimax.chat/anthropic</span>。</span>}
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">模型（逗号分隔）</span>
            <input value={modelsText} onChange={e => setModelsText(e.target.value)} placeholder="claude-sonnet-4-6, deepseek-chat" className={inputCls} />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">API Key {editing ? <span className="text-gray-600">（不可在此修改）</span> : <span className="text-red-400/70">*</span>}</span>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={editing ? '•••• configured（密钥库已存）' : 'sk-…'}
              className={`${inputCls} ${editing ? 'opacity-60 cursor-not-allowed' : ''}`}
              autoComplete="off"
              disabled={editing}
            />
            <span className="text-[11px] text-gray-600">{editing ? '密钥不可在此改；如需轮换 key 走单独的密钥库流程。' : '写入即存入密钥库，UI 不回显 key 值。'}</span>
          </label>

          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-cyan-500" />
            <span className="text-xs text-gray-300">启用</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#26262b] px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">取消</button>
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${canSave ? 'bg-cyan-600 text-white hover:bg-cyan-500' : 'bg-[#1c1c1f] text-gray-600 cursor-not-allowed'}`}
          >
            {phase === 'saving' ? '保存中…' : phase === 'done' ? '✓ 已保存' : editing ? '保存' : '新增'}
          </button>
        </div>
      </div>
    </>
  );
}

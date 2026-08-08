'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNetworkId } from '../lib/network-context';

type Skill = {
  skill_id: string; slug: string; name: string; description: string; version: string;
  status: 'pending' | 'published' | 'rejected'; source_type: 'node' | 'user';
  source_alias?: string; updated_at: string; review_note?: string; content?: string;
};

const EMPTY = { slug: '', name: '', description: '', version: '1.0.0', content: '# Skill\n\nDescribe when and how an agent should use this skill.\n' };

export default function SkillHubPage() {
  const { networkId } = useNetworkId();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [reviewer, setReviewer] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Skill | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    const qs = new URLSearchParams({ review: '1' });
    if (networkId) qs.set('network_id', networkId);
    if (query.trim()) qs.set('q', query.trim());
    try {
      const res = await fetch(`/api/anet/skills?${qs}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.unconfirmed ? '当前 Hub 尚未升级 SkillHub 后端' : (data.error || '加载失败'));
      setSkills(Array.isArray(data.skills) ? data.skills : []);
      setReviewer(!!data.reviewer);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [networkId, query]);

  useEffect(() => { const id = setTimeout(refresh, 180); return () => clearTimeout(id); }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const res = await fetch('/api/anet/skills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, ...(networkId ? { network_id: networkId } : {}) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '上传失败');
      setShowUpload(false); setDraft(EMPTY); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function review(skillId: string, decision: 'published' | 'rejected') {
    const res = await fetch('/api/anet/skills', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: skillId, decision, ...(networkId ? { network_id: networkId } : {}) }),
    });
    const data = await res.json();
    if (!data.ok) setError(data.error || '审核失败'); else refresh();
  }

  async function openSkill(skill: Skill) {
    const qs = new URLSearchParams({ skill_id: skill.skill_id });
    if (networkId) qs.set('network_id', networkId);
    const res = await fetch(`/api/anet/skills?${qs}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) setError(data.error || '读取失败'); else setSelected(data.skill);
  }

  return (
    <div className="min-h-screen bg-[#0b0b0d] p-4 text-gray-100 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white lg:ml-0 ml-10">SkillHub</h1>
          <p className="mt-1 text-sm text-gray-500">节点沉淀可复用能力，审核后供整个网络使用。</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="ml-auto rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium hover:bg-cyan-500">上传 Skill</button>
      </div>

      <div className="mb-4 max-w-3xl">
        <input aria-label="搜索 Skills" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称、slug 或说明…" className="w-full rounded-lg border border-[#2a2a2f] bg-[#151518] px-3 py-2 text-sm outline-none focus:border-cyan-500/50" />
      </div>
      {error && <div className="mb-4 max-w-3xl rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      <div className="grid max-w-5xl gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? [1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-[#17171a]" />) : skills.map(skill => (
          <article key={skill.skill_id} className="flex min-h-40 flex-col rounded-xl border border-[#26262b] bg-[#151518] p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-white">{skill.name}</h2><code className="text-xs text-cyan-400">{skill.slug}@{skill.version}</code></div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${skill.status === 'published' ? 'bg-emerald-500/10 text-emerald-300' : skill.status === 'pending' ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300'}`}>{skill.status}</span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm text-gray-400">{skill.description || '暂无说明'}</p>
            <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-gray-600">
              <span>{skill.source_type === 'node' ? '节点' : '用户'} · {skill.source_alias || 'unknown'}</span>
              <button onClick={() => openSkill(skill)} className="ml-auto rounded border border-[#303037] px-2 py-1 text-gray-300">查看</button>
              {reviewer && skill.status === 'pending' && <span className="flex gap-1"><button onClick={() => review(skill.skill_id, 'rejected')} className="rounded border border-red-500/25 px-2 py-1 text-red-300">拒绝</button><button onClick={() => review(skill.skill_id, 'published')} className="rounded border border-emerald-500/25 px-2 py-1 text-emerald-300">发布</button></span>}
            </div>
          </article>
        ))}
        {!loading && skills.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-[#303037] p-10 text-center text-sm text-gray-500">还没有 Skill。让节点总结经验，或上传第一份 SKILL.md。</div>}
      </div>

      {showUpload && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) setShowUpload(false); }}>
        <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#303037] bg-[#151518] p-5 sm:rounded-2xl">
          <div className="mb-4 flex items-center"><h2 className="text-lg font-semibold">上传 Skill</h2><button type="button" onClick={() => setShowUpload(false)} className="ml-auto text-gray-500">✕</button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-400">名称<input required value={draft.name} onChange={e => setDraft({...draft, name:e.target.value})} className="mt-1 w-full rounded border border-[#303037] bg-[#0e0e10] p-2 text-sm" /></label>
            <label className="text-xs text-gray-400">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={e => setDraft({...draft, slug:e.target.value})} className="mt-1 w-full rounded border border-[#303037] bg-[#0e0e10] p-2 font-mono text-sm" /></label>
            <label className="text-xs text-gray-400 sm:col-span-2">说明<input value={draft.description} onChange={e => setDraft({...draft, description:e.target.value})} className="mt-1 w-full rounded border border-[#303037] bg-[#0e0e10] p-2 text-sm" /></label>
            <label className="text-xs text-gray-400">版本<input required value={draft.version} onChange={e => setDraft({...draft, version:e.target.value})} className="mt-1 w-full rounded border border-[#303037] bg-[#0e0e10] p-2 font-mono text-sm" /></label>
            <label className="text-xs text-gray-400 sm:col-span-2">SKILL.md<textarea required rows={12} value={draft.content} onChange={e => setDraft({...draft, content:e.target.value})} className="mt-1 w-full rounded border border-[#303037] bg-[#0e0e10] p-3 font-mono text-xs" /></label>
          </div>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setShowUpload(false)} className="rounded border border-[#303037] px-3 py-2 text-sm">取消</button><button disabled={saving} className="rounded bg-cyan-600 px-3 py-2 text-sm font-medium disabled:opacity-50">{saving ? '上传中…' : '提交审核'}</button></div>
        </form>
      </div>}
      {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
        <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-[#303037] bg-[#151518] p-5 sm:rounded-2xl">
          <div className="flex items-start gap-3"><div><h2 className="text-lg font-semibold">{selected.name}</h2><code className="text-xs text-cyan-400">{selected.slug}@{selected.version}</code></div><button onClick={() => setSelected(null)} className="ml-auto text-gray-500">✕</button></div>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl border border-[#28282d] bg-[#0c0c0e] p-4 text-xs leading-6 text-gray-300">{selected.content}</pre>
        </section>
      </div>}
    </div>
  );
}

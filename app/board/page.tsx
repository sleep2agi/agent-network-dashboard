'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkId } from '../lib/network-context';
import { PendingNotice } from '../components/PendingNotice';

type Card = {
  id?: string;
  seq?: number | null;
  name?: string;
  column?: string;
  priority?: string;
};

const COLUMNS = [
  { id: 'pool', label: '需求池' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '完成' },
  { id: 'abandoned', label: '废弃' },
] as const;

export default function BoardPage() {
  const { networkId } = useNetworkId();
  const router = useRouter();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState('');
  const [aware, setAware] = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);

  useEffect(() => {
    let alive = true;
    const qs = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
    fetch(`/api/hub/requirements${qs}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/login');
          return null;
        }
        return r.json();
      })
      .then((body) => {
        if (!alive || !body) return;
        if (!body.ok) {
          setError(body.error || '读取任务看板失败');
          setCards([]);
          return;
        }
        const caps = Array.isArray(body.capabilities) ? body.capabilities : [];
        setAware(caps.includes('column_abandoned'));
        setError('');
        setCards(Array.isArray(body.requirements) ? body.requirements : []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '读取任务看板失败');
        setCards([]);
      });
    return () => { alive = false; };
  }, [networkId, router]);

  const abandonedCount = useMemo(
    () => (cards || []).filter((card) => card.column === 'abandoned').length,
    [cards],
  );
  const visible = (cards || []).filter((card) => showAbandoned || card.column !== 'abandoned');

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-5 text-[var(--fg)] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">任务看板</h1>
          <p className="text-xs text-[var(--fg-muted)]">
            只读，对齐 Hub 的需求列。声明了 abandoned 之后，废弃不再被投影成完成。
            {aware ? ' 当前 Hub 认这一列。' : ' 当前响应没有 column_abandoned，废弃列不会出现。'}
          </p>
        </header>
        <PendingNotice>
          新建、拖列、改负责人、评论都还没接到。下面的卡片是 Hub 返回的，不是演示行。
        </PendingNotice>
        {cards === null ? <p className="text-xs text-[var(--fg-dim)]">正在读取…</p> : null}
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
        {abandonedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAbandoned((v) => !v)}
            className="text-xs text-[var(--fg-muted)] underline"
          >
            {showAbandoned ? '收起已废弃' : `显示已废弃（${abandonedCount}）`}
          </button>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.filter((col) => col.id !== 'abandoned' || showAbandoned).map((col) => {
            const rows = visible.filter((card) => card.column === col.id);
            return (
              <section key={col.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                <h2 className={`text-xs font-medium ${col.id === 'abandoned' ? 'text-[var(--fg-dim)] line-through' : 'text-[var(--fg)]'}`}>
                  {col.label} · {rows.length}
                </h2>
                <ul className="mt-2 space-y-2">
                  {rows.map((card) => (
                    <li key={card.id || card.name} className="rounded-md border border-[var(--border)] px-2 py-1.5 text-xs">
                      <div className={col.id === 'abandoned' ? 'text-[var(--fg-dim)] line-through' : col.id === 'done' ? 'text-green-300' : 'text-[var(--fg)]'}>
                        {card.seq != null ? `#${card.seq} ` : ''}{card.name || card.id}
                      </div>
                      {card.priority ? <div className="text-[10px] text-[var(--fg-dim)]">{card.priority}</div> : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

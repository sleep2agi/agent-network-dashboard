'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RequirementRef } from './RequirementRef';
import { useNetworkId } from '../lib/network-context';

type Card = { id: string; seq?: number | null; name?: string; column?: string };

/** Overview strip of the latest Hub requirements, each title and #id linked. */
export function RequirementPulse() {
  const { networkId } = useNetworkId();
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ limit: '6' });
    if (networkId) params.set('network_id', networkId);
    fetch(`/api/hub/requirements?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) return null;
        if (!res.ok) return null;
        return res.json();
      })
      .then((body) => {
        if (!alive || !body || !Array.isArray(body.requirements)) return;
        setCards(body.requirements.filter((row: Card) => row && row.id).slice(0, 6));
      })
      .catch(() => {
        if (alive) setCards(null);
      });
    return () => { alive = false; };
  }, [networkId]);

  if (!cards || cards.length === 0) return null;

  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 sm:mb-6">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-[var(--fg-muted)]">Requirements</span>
        <Link href="/board" prefetch={false} className="text-cyan-400 hover:text-cyan-300">Board →</Link>
      </div>
      <ul className="space-y-1.5">
        {cards.map((card) => (
          <li key={card.id}>
            <RequirementRef id={card.id} seq={card.seq} name={card.name} done={card.column === 'done'} />
          </li>
        ))}
      </ul>
    </section>
  );
}

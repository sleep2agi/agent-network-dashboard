'use client';

import { Suspense } from 'react';
import { BoardWorkspace } from './BoardWorkspace';

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="anet-page min-h-screen bg-[var(--bg)] text-xs text-[var(--fg-dim)]">Loading tasks…</div>}>
      <BoardWorkspace />
    </Suspense>
  );
}

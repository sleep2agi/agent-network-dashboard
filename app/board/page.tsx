'use client';

import { Suspense } from 'react';
import { BoardWorkspace } from './BoardWorkspace';

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)] px-4 py-5 text-xs text-[var(--fg-dim)]">Loading tasks…</div>}>
      <BoardWorkspace />
    </Suspense>
  );
}

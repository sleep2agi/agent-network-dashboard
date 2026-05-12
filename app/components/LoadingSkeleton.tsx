'use client';

export function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-6 font-mono animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-7 w-48 bg-gray-800 rounded mb-2" />
          <div className="h-4 w-64 bg-gray-800/60 rounded" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-[72px] h-[60px] bg-gray-800/40 rounded-lg border border-gray-800" />
          ))}
        </div>
      </div>

      {/* Broadcast bar skeleton */}
      <div className="mb-6 flex gap-2">
        <div className="flex-1 h-10 bg-gray-800/40 rounded-lg" />
        <div className="w-28 h-10 bg-gray-800/40 rounded-lg" />
      </div>

      {/* Topology skeleton */}
      <div className="w-full max-w-4xl mx-auto mb-8 h-64 bg-gray-800/20 rounded-xl" />

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-xl border border-gray-800/40 p-4 bg-gray-800/20">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-700" />
              <div className="h-4 w-24 bg-gray-700 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-800/60 rounded" />
              <div className="h-3 w-3/4 bg-gray-800/60 rounded" />
              <div className="h-3 w-1/2 bg-gray-800/60 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// EmptyState export removed in 0.4.5 — replaced by EmptyState.tsx with
// per-variant glyphs and a NodesEmptyState wrapper for the Overview
// hint-aware behavior. See app/components/EmptyState.tsx.

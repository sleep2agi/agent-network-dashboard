'use client';

import Link from 'next/link';

interface StatsBarProps {
  online: number;
  working: number;
  total: number;
  runningTasks?: number;
  failedTasks?: number;
  showTaskSummary?: boolean;
  // #53: when true, presence.sseSessions is missing but the hub reports
  // live SSE connections — we're seeing an anonymized/wrong-scope view
  // of /health. `online` is unknowable; render it as '?' with a neutral
  // dot so the card doesn't confidently show 0 while HealthBanner is
  // already surfacing the alert with the CTA.
  presenceUnknown?: boolean;
}

export function StatsBar({
  online,
  working,
  total,
  presenceUnknown = false,
  runningTasks = 0,
  failedTasks = 0,
  showTaskSummary = false,
}: StatsBarProps) {
  const onlinePercent = !presenceUnknown && total > 0 ? Math.round((online / total) * 100) : 0;
  // #53: don't render the "fleet is empty" quickstart strip when we
  // literally can't see presence — that state's "0 registered" copy is
  // wrong twice over (registered is per hub, not per SSE, but users
  // read the strip together). fleetEmpty only applies when total is
  // truly 0 in this scope; when total is 0 AND presence unknown, we
  // still emit the strip but leave the online cell as '?' so the copy
  // stops asserting "you have nothing".
  const fleetEmpty = total === 0;
  const onlineDisplay: number | string = presenceUnknown ? '?' : online;
  const offlineDisplay: number | string = presenceUnknown ? '?' : (total - online);

  // #209 R29 (mobile vertical rhythm — goal "大幅提升移动端体验"):
  // populated branch previously left mb-8 (32 px) below the 4-card grid,
  // the single biggest gap on the Overview page. Drop to mb-4 (16 px)
  // on phones, restore mb-8 from sm: up. Pairs with R28's section-gap
  // tighten — together they reclaim ~48 px of pure scroll waste before
  // the agent grid. The empty-fleet branch already used mb-4 since R72,
  // so this only touches the populated case.
  return (
    <div className={fleetEmpty ? 'mb-4' : 'mb-4 sm:mb-8'}>
      {/* Title row. #217 S3 dropped the version/uptime subtitle (lives in
          Settings → CommHub Connection). S9 (Vincent tg 613 "没居中"):
          WeChat-style centered title on phones — centering also clears
          the fixed hamburger symmetrically, replacing the old ml-10
          indent that read as misalignment. Left-aligned from lg: up. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-[var(--fg)]">Agent Network</h1>
        {showTaskSummary && (
          <Link
            href="/tasks"
            prefetch={false}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[var(--bg-secondary)] px-3 text-[13px] tabular-nums text-[var(--fg-muted)] shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[var(--bg-elevated)]"
          >
            <span className={runningTasks ? 'font-medium text-[var(--success)]' : ''}>{runningTasks} running</span>
            <span className="text-[var(--fg-dim)]" aria-hidden>·</span>
            <span className={failedTasks ? 'font-medium text-[var(--error)]' : ''}>{failedTasks} failed</span>
            <span className="text-[var(--fg)]">View all →</span>
          </Link>
        )}
      </div>

      {fleetEmpty ? (
        /* Round 72: thin status strip replaces the 4-card grid when fleet
           is empty. Saves ~280px on mobile (CTA y=650 → ~370) and keeps
           the same data visible in a single inline row. #53: when
           presence is unknown, the "0 online" copy would be a false
           assertion — swap to '?' so the row reads honestly and pairs
           with the HealthBanner alert above. */
        <div className="anet-stat-strip flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[10px] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--fg-dim)]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--offline)]" />
            <span className="tabular-nums text-[var(--fg)]">{onlineDisplay}</span> online
          </span>
          <span className="text-[var(--fg-dim)]">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--offline)]" />
            <span className="tabular-nums text-[var(--fg)]">0</span> working
          </span>
          <span className="text-[var(--fg-dim)]">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--offline)]" />
            <span className="tabular-nums text-[var(--fg)]">0</span> registered
          </span>
        </div>
      ) : (
        <>
        {/* #217 M1 (Vincent: "再简洁点你自己理解一下"): on phones the
            populated state reuses the round-72 thin strip instead of
            the card grid — one quiet line of numbers, ~70px reclaimed.
            Cards return from sm: up where they have room to breathe. */}
        <div className="anet-stat-strip flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[10px] bg-[var(--bg-secondary)] px-4 py-2 text-xs text-[var(--fg-dim)] sm:hidden">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${presenceUnknown ? 'bg-[var(--offline)]' : 'bg-[var(--success)]'}`} />
            <span className="tabular-nums text-[var(--fg)]">{onlineDisplay}</span> online
          </span>
          {working > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="anet-brand-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                <span className="tabular-nums text-[var(--fg)]">{working}</span> working
              </span>
            </>
          )}
          <span>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--offline)]" />
            <span className="tabular-nums text-[var(--fg)]">{offlineDisplay}</span> offline
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular-nums text-[var(--fg)]">{total}</span> total
          </span>
        </div>
        {/* Populated state, sm: up. #217 S2 (less is more): the Working
           card only earns its grid cell when something is actually
           working. */}
        <div className={`hidden sm:grid gap-3 ${working > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <StatCard
            value={onlineDisplay}
            label="Online"
            sub={presenceUnknown ? 'presence unavailable' : `${onlinePercent}% of fleet`}
            color={presenceUnknown ? 'text-[var(--fg-muted)]' : 'text-[var(--success)]'}
          />
          {working > 0 && (
            <StatCard
              value={working}
              label="Working"
              sub={!presenceUnknown && online > 0 ? `${Math.round((working / online) * 100)}% utilization` : '--'}
              color="text-[var(--accent)]"
            />
          )}
          <StatCard
            value={offlineDisplay}
            label="Offline"
            sub={presenceUnknown ? 'presence unavailable' : (total - online === 0 ? 'All systems go' : `${total - online} disconnected`)}
            color="text-[var(--fg-muted)]"
          />
          <StatCard
            value={total}
            label="Total"
            sub="Registered nodes"
            color="text-[var(--fg)]"
          />
        </div>
        </>
      )}
    </div>
  );
}

function StatCard({ value, label, sub, color }: {
  value: number | string; label: string; sub: string; color: string;
}) {
  // #217 D2 (OpenWebUI-style color restraint): the per-color gradient
  // wash + tinted borders made the KPI row read as four neon billboards.
  // Surfaces are now neutral (shared border + bg); color survives only
  // on the number itself. Mobile density values are #209 R39.
  return (
    <div className="anet-stat-card rounded-[10px] bg-[var(--bg-secondary)] px-4 py-3.5 shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[var(--bg-elevated)] sm:px-5 sm:py-4">
      <div className={`text-2xl font-semibold tabular-nums leading-tight sm:text-[28px] ${color}`}>{value}</div>
      <div className="mt-0.5 text-[13px] font-medium text-[var(--fg)]">{label}</div>
      <div className="mt-1 text-[11px] text-[var(--fg-dim)] sm:text-xs">{sub}</div>
    </div>
  );
}

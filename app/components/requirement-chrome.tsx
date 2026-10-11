import type { ReactNode } from 'react';

/** Shared task-surface chrome so board, list, activity, and the leaderboard match. */

export function columnDot(column?: string): string {
  if (column === 'doing') return 'var(--info)';
  if (column === 'done') return 'var(--success)';
  if (column === 'abandoned') return 'var(--warning)';
  return 'var(--fg-dim)';
}

export function columnLabel(column?: string): string {
  if (column === 'doing') return 'In progress';
  if (column === 'done') return 'Done';
  if (column === 'abandoned') return 'Abandoned';
  if (column === 'pool') return 'Pool';
  return column || '—';
}

export function TaskPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 ${className}`}>
      {children}
    </section>
  );
}

export function TaskCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3 transition-colors hover:border-[var(--border-hover)] ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1.5 pb-2">
      <h2 className="text-sm font-medium tracking-tight text-[var(--fg)]">{title}</h2>
      {hint ? <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">{hint}</span> : null}
    </div>
  );
}

export function MetaChip({ children, soft = false }: { children: ReactNode; soft?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-medium text-[var(--fg-muted)] ${
        soft ? 'text-xs tracking-normal' : 'text-[10px] uppercase tracking-wide'
      }`}
    >
      {children}
    </span>
  );
}

export function TagList({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="max-w-[10rem] truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
          {tag}
        </span>
      ))}
    </span>
  );
}

export function PriorityChip({ priority }: { priority?: string }) {
  if (!priority) return null;
  const hot = priority === 'high';
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        hot
          ? 'border-[var(--danger)]/35 bg-[var(--bg)] text-[var(--danger)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-dim)]'
      }`}
    >
      {priority}
    </span>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-1">
      {options.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]'
                : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

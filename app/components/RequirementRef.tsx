import Link from 'next/link';
import { requirementDetailPath, shortIdLabel } from '../lib/requirement-links.mjs';

/** Title and short id, each a real link to the requirement detail route. */
export function RequirementRef({
  id,
  seq,
  name,
  struck = false,
  done = false,
  lines = 1,
}: {
  id: string;
  seq?: number | null;
  name?: string;
  struck?: boolean;
  done?: boolean;
  lines?: 1 | 2;
}) {
  const href = requirementDetailPath(id);
  const seqText = shortIdLabel(seq);
  const title = name?.trim() || id;
  const titleClass = struck
    ? 'text-[var(--fg-dim)] line-through'
    : done
      ? 'text-[var(--fg-muted)]'
      : 'text-[var(--fg)]';
  if (!href) {
    return (
      <span className={`inline-flex min-w-0 items-baseline gap-2 text-sm leading-[22px] ${titleClass}`}>
        {done ? <span aria-hidden style={{ color: 'var(--success)' }}>✓</span> : null}
        {seqText ? `${seqText} ` : ''}{title}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {done ? <span aria-hidden className="shrink-0 text-sm" style={{ color: 'var(--success)' }}>✓</span> : null}
      {seqText ? (
        <Link
          href={href}
          prefetch={false}
          data-testid="requirement-seq"
          aria-label={`Open task ${seqText}`}
          className="shrink-0 font-mono text-xs tabular-nums text-[var(--fg-dim)] hover:text-[var(--accent)] hover:underline"
        >
          {seqText}
        </Link>
      ) : null}
      <Link
        href={href}
        prefetch={false}
        data-testid="requirement-title"
        title={title}
        className={`min-w-0 text-sm font-medium leading-[22px] hover:text-[var(--accent)] hover:underline ${lines === 2 ? 'line-clamp-2 whitespace-normal' : 'truncate'} ${titleClass}`}
      >
        {title}
      </Link>
    </div>
  );
}

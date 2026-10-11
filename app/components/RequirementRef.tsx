import Link from 'next/link';
import { requirementDetailPath, shortIdLabel } from '../lib/requirement-links.mjs';

/** Title and short id, each a real link to the requirement detail route. */
export function RequirementRef({
  id,
  seq,
  name,
  struck = false,
  done = false,
}: {
  id: string;
  seq?: number | null;
  name?: string;
  struck?: boolean;
  done?: boolean;
}) {
  const href = requirementDetailPath(id);
  const seqText = shortIdLabel(seq);
  const title = name?.trim() || id;
  const titleClass = struck
    ? 'text-[var(--fg-dim)] line-through'
    : done
      ? 'text-[var(--success)]'
      : 'text-[var(--fg)]';
  if (!href) {
    return <span className={`truncate text-[13px] font-medium leading-5 ${titleClass}`}>{seqText ? `${seqText} ` : ''}{title}</span>;
  }
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {seqText ? (
        <Link
          href={href}
          prefetch={false}
          data-testid="requirement-seq"
          aria-label={`Open task ${seqText}`}
          className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--info)] hover:underline"
        >
          {seqText}
        </Link>
      ) : null}
      <Link
        href={href}
        prefetch={false}
        data-testid="requirement-title"
        title={title}
        className={`min-w-0 truncate text-[13px] font-medium leading-5 hover:underline ${titleClass}`}
      >
        {title}
      </Link>
    </div>
  );
}

'use client';

import {
  FEATURES,
  LEVEL_STYLE,
  MATRIX_SOURCE,
  RUNTIMES,
  cellOf,
  type SupportLevel,
} from '../lib/runtime-support-matrix';

/**
 * Runtime 支持矩阵（只读静态表）。
 *
 * 为什么做成「URL 开关」而不是直接进导航：
 * 数据是静态抄录（客户端 runtime-support.ts），还没有 Hub 实时接口；
 * 在得到「可以在 Dashboard 露出」的决定前，先用 `?matrix=1` 预览，
 * 不改变任何默认界面。这一点写在页脚与注释里，避免被当成实时能力。
 */
export function RuntimeSupportMatrix() {
  return (
    <section
      data-testid="runtime-support-matrix"
      className="rounded-2xl bg-[var(--bg-secondary)] p-4"
      aria-label="Runtime 支持矩阵（静态表）"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--fg)]">Runtime 支持速查</h2>
        <span className="text-[11px] text-[var(--fg-dim)]">
          {MATRIX_SOURCE.label} · 来源 <a className="underline" href={MATRIX_SOURCE.href} target="_blank" rel="noreferrer">支持矩阵</a>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
        静态表，可能滞后于实际能力；未验证一律显示为「?」，不把未知当支持。
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-max text-left text-[11px]">
          <thead>
            <tr className="text-[var(--fg-dim)]">
              <th className="sticky left-0 bg-[var(--bg-secondary)] py-1 pr-3 font-normal">Runtime</th>
              {FEATURES.map((f) => (
                <th key={f.id} className="py-1 pr-3 font-normal whitespace-nowrap">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RUNTIMES.map((r) => (
              <tr key={r.id} className="border-t border-[var(--col-hairline)]">
                <th scope="row" className="sticky left-0 bg-[var(--bg-secondary)] py-1.5 pr-3 text-left font-mono text-[var(--fg)] whitespace-nowrap">
                  {r.label}
                  <span className="ml-1.5 text-[var(--fg-dim)] font-sans">{r.maturity}</span>
                </th>
                {FEATURES.map((f) => {
                  const level: SupportLevel = cellOf(r.id, f.id);
                  const style = LEVEL_STYLE[level];
                  return (
                    <td key={f.id} className="py-1.5 pr-3">
                      <span
                        title={`${r.label} · ${f.label}：${style.label}`}
                        data-level={level}
                        className={
                          level === 'supported' ? 'text-[var(--success)]'
                            : level === 'unsupported' ? 'text-[var(--danger)]'
                              : level === 'partial' ? 'text-[var(--warning)]'
                                : 'text-[var(--fg-dim)]'
                        }
                      >
                        {style.text}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-[var(--fg-dim)]">
        ✓ 已验证支持 · ◐ 部分支持 · ✕ 已验证不可用 · ? 未验证 · — 不适用
      </p>
    </section>
  );
}

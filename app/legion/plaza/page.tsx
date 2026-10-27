'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { legionFetcher, deptFetcher, type PeopleResponse, type DepartmentsResponse } from '../../lib/legion-data';
import { buildLegionLayout } from '../../lib/legion-layout';
import { getAvatarUrl, useAvatarsVersion } from '../../lib/avatars';

/**
 * 军团 · 平台视角（/legion/plaza）
 *
 * 按 admin 2026-10-27 给的参考图做的「分层展台」视图：每个部门是一块带厚度的
 * 3D 台面，成员头像排在台面上，部门名挂在台面前沿；远处一排更小、更靠上，
 * 形成透视层次。
 *
 * 为什么用 SVG 而不是 canvas：台面 + 头像 + 文字都是静态布局（没有逐帧动画），
 * SVG 用 <image> 直接吃头像、文字清晰、可被读屏索引，代码量也小得多。
 * 大量节点（>1200 个元素）才会考虑换 canvas —— 当前规模（≤300）没问题。
 */

const COLS = 6;
const PLATFORM_W = 340;
const PLATFORM_D = 150;
const SKEW = 54;
const THICK = 16;
const GAP_X = 22;
const ROW_H = 280;
const VIEW_W = 1560;
const PAD_X = 40;

const HUES = [206, 268, 330, 152, 20, 190, 300, 120, 240, 350, 45, 170];

interface Bubble { key: string; alias: string; label: string; kind: 'person' | 'agent' }

interface Platform {
  id: string;
  name: string;
  hue: number;
  people: { id: string; name: string; username: string; agents: number }[];
  bubbles: Bubble[];
}

export default function LegionPlazaPage() {
  const { data: peopleData, error: peopleError, isLoading } = useSWR<PeopleResponse>(
    '/api/hub/people?limit=200&offset=0', legionFetcher, { refreshInterval: 30000, shouldRetryOnError: false },
  );
  const { data: hierarchy } = useSWR<DepartmentsResponse | null>('/api/hub/departments', deptFetcher, {
    refreshInterval: 60000, shouldRetryOnError: false,
  });
  // manifest 拉完会派发事件；订阅后头像才会从首字母换成图片。
  useAvatarsVersion();

  const layout = useMemo(() => buildLegionLayout({
    people: peopleData?.people ?? [],
    orphans: peopleData?.agents_without_owner,
    departments: hierarchy?.departments,
    members: hierarchy?.members,
  }), [peopleData, hierarchy]);

  const platforms = useMemo<Platform[]>(() => {
    // 部门归属以 Hub 的部门树为准（members 映射），person.department 只是兜底：
    // 生产上 13 个部门、8 个人，只看 person.department 会只剩 2 块展台。
    const depts = hierarchy?.departments ?? [];
    const deptById = new Map(depts.map(d => [d.id, d]));
    const memberDept = new Map((hierarchy?.members ?? []).map(m => [m.user_id, m.department_id]));

    const byDept = new Map<string, Platform>();
    const ensure = (id: string, name: string) => {
      if (!byDept.has(id)) {
        byDept.set(id, { id, name, hue: HUES[byDept.size % HUES.length], people: [], bubbles: [] });
      }
      return byDept.get(id)!;
    };

    for (const p of peopleData?.people ?? []) {
      const deptId = memberDept.get(p.user_id) || p.department?.id || 'ungrouped';
      const deptName = deptById.get(deptId)?.name || p.department?.name || '未分组';
      const plat = ensure(deptId, deptName);
      plat.people.push({
        id: p.user_id, name: p.display_name || p.username, username: p.username, agents: p.agents.length,
      });
      // 先本人，再名下 Agent：台面上才有「一层层的人」。
      plat.bubbles.push({ key: `p:${p.user_id}`, alias: p.username, label: p.display_name || p.username, kind: 'person' });
      for (const a of p.agents) plat.bubbles.push({ key: `a:${a.node_id}`, alias: a.alias, label: a.alias, kind: 'agent' });
    }

    // 没有成员的部门也上台：这是「组织架构图」，空部门同样属于编制
    // （只是台面空着、标注 0 人），否则 13 个部门只看到 2 块展台。
    for (const d of depts) {
      if (!byDept.has(d.id)) {
        byDept.set(d.id, { id: d.id, name: d.name, hue: HUES[byDept.size % HUES.length], people: [], bubbles: [] });
      }
    }

    return [...byDept.values()].sort((a, b) => b.people.length - a.people.length);
  }, [peopleData, hierarchy]);

  const emptyDeptCount = platforms.filter(p => p.people.length === 0).length;

  const [hoverDept, setHoverDept] = useState<string | null>(null);

  // 每行放 4 块；越靠后的行整体缩小并上移，形成纵深。
  const perRow = 4;
  const rows = Math.ceil(platforms.length / perRow) || 1;
  const viewH = 150 + rows * ROW_H;

  const slots = platforms.map((p, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const scale = 1 - row * 0.1;
    const rowCount = Math.min(perRow, platforms.length - row * perRow);
    const rowW = rowCount * (PLATFORM_W + GAP_X) - GAP_X;
    const x = PAD_X + (VIEW_W - PAD_X * 2 - rowW) / 2 + col * (PLATFORM_W + GAP_X);
    const y = 150 + row * ROW_H * scale;
    return { platform: p, x, y, scale };
  });

  const fatal = (peopleError as { status?: number } | undefined)?.status === 401 ? 'login' : peopleError ? 'error' : null;
  const isEmpty = !isLoading && !fatal && peopleData != null && platforms.length === 0;

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 text-[var(--fg)] sm:p-6">
      <div className="mx-auto max-w-[1720px]">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold text-[var(--fg)]">军团 · 平台视角</h1>
              <span className="hidden text-[11px] text-[var(--fg-dim)] sm:inline">Legion Plaza</span>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {isLoading
                ? '正在读取编制…'
                : `${platforms.length} 个部门 · ${layout.stats.people} 名成员 · ${layout.stats.agents} 个 Agent`
                  + (emptyDeptCount > 0 ? ` · 另有 ${emptyDeptCount} 个部门暂无成员` : '')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href="/legion/3d" className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">
              3D 拓扑
            </Link>
            <Link href="/legion" className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">
              2D 同心环
            </Link>
            <Link href="/org" className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">
              列表视图
            </Link>
          </div>
        </div>

        {fatal === 'login' && (
          <p className="rounded-lg bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--warning)]">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看军团。
          </p>
        )}
        {fatal === 'error' && (
          <p className="rounded-lg bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--danger)]">
            读取军团编制失败：{String((peopleError as Error)?.message ?? '未知错误')}
          </p>
        )}
        {isEmpty && (
          <p className="rounded-lg bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--fg-muted)]">
            军团还没有成员 —— 成员加入网络并绑定 Agent 后，这里会出现部门展台。
          </p>
        )}

        {!fatal && !isEmpty && (
          <div className="overflow-x-auto rounded-xl bg-[var(--bg-secondary)]">
            <svg
              viewBox={`0 0 ${VIEW_W} ${viewH}`}
              className="block h-auto w-full"
              role="img"
              aria-label="军团平台视角：每个部门一块展台，成员头像排在台面上"
              data-testid="legion-plaza-svg"
            >
              <defs>
                <radialGradient id="plaza-shadow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#000" stopOpacity="0" />
                </radialGradient>
                {platforms.map(p => (
                  <g key={`g-${p.id}`}>
                    <linearGradient id={`plate-${p.id}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={`hsl(${p.hue} 62% 46%)`} stopOpacity="0.95" />
                      <stop offset="100%" stopColor={`hsl(${p.hue} 62% 34%)`} stopOpacity="0.95" />
                    </linearGradient>
                    <linearGradient id={`edge-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`hsl(${p.hue} 58% 30%)`} />
                      <stop offset="100%" stopColor={`hsl(${p.hue} 58% 20%)`} />
                    </linearGradient>
                  </g>
                ))}
              </defs>

              {/* 连线：从顶部核心到每个部门台面，示意「同一个网络下的编制」 */}
              <g stroke="var(--border-hover)" strokeWidth="1" fill="none" opacity="0.55">
                {slots.map(({ platform, x, y, scale }) => (
                  <path
                    key={`link-${platform.id}`}
                    d={`M ${VIEW_W / 2} 40 Q ${(VIEW_W / 2 + x + PLATFORM_W / 2) / 2} ${y * 0.4 + 40} ${x + PLATFORM_W / 2 - SKEW / 2} ${y + 12 * scale}`}
                  />
                ))}
              </g>

              {slots.map(({ platform, x, y, scale }) => {
                // 台面显示上限：一块台面最多 48 个头像，多出来的用「+N」标注。
                const CAP = 72;
                const shown = platform.bubbles.slice(0, CAP);
                const rest = platform.bubbles.length - shown.length;
                const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(shown.length * 1.5))));
                const rowsN = Math.ceil(shown.length / cols);
                const cellW = (PLATFORM_W - 60) / cols;
                const cellH = Math.min(46, (PLATFORM_D - 34) / Math.max(1, rowsN));
                const rAvatar = Math.max(9, Math.min(13, cellH * 0.42));
                const active = hoverDept === platform.id;

                return (
                  <g
                    key={platform.id}
                    transform={`translate(${x} ${y}) scale(${scale})`}
                    opacity={platform.people.length === 0 ? 0.55 : 1}
                    onMouseEnter={() => setHoverDept(platform.id)}
                    onMouseLeave={() => setHoverDept(h => (h === platform.id ? null : h))}
                  >
                    {/* 台面底部柔光：没有阴影时台面像贴纸，浮不起来 */}
                    <ellipse
                      cx={PLATFORM_W / 2 - SKEW / 2}
                      cy={PLATFORM_D + THICK + 26}
                      rx={PLATFORM_W * 0.55}
                      ry={26}
                      fill="url(#plaza-shadow)"
                    />
                    {/* 台面厚度（前立面） */}
                    <path
                      d={`M ${SKEW} ${PLATFORM_D} L ${PLATFORM_W} ${PLATFORM_D} L ${PLATFORM_W} ${PLATFORM_D + THICK} L ${SKEW} ${PLATFORM_D + THICK} Z`}
                      fill={`url(#edge-${platform.id})`}
                    />
                    {/* 台面 */}
                    <path
                      d={`M 0 0 L ${PLATFORM_W} 0 L ${PLATFORM_W - SKEW} ${PLATFORM_D} L ${-SKEW} ${PLATFORM_D} Z`}
                      fill={`url(#plate-${platform.id})`}
                      opacity={active ? 1 : 0.92}
                      stroke={active ? 'var(--fg)' : 'transparent'}
                      strokeWidth={1.5}
                    />

                    {/* 成员头像：按网格排布，位置做双线性插值贴到台面上 */}
                    {shown.map((m, idx) => {
                      const col = idx % cols;
                      const row = Math.floor(idx / cols);
                      // 双线性插值：台面是平行四边形 A(0,0) B(W,0) D(-SKEW,D)，
                      // 点 = A + u·(B-A) + v·(D-A)。之前只在左边排了一列，
                      // 就是因为漏了 -SKEW·v 这一项。
                      const u = 0.08 + ((col + 0.5) / cols) * 0.84;
                      const v = 0.12 + ((row + 0.5) / Math.max(1, rowsN)) * 0.62;
                      const px = u * PLATFORM_W - v * SKEW;
                      const py = v * PLATFORM_D;
                      const url = getAvatarUrl(m.alias);
                      return (
                        <a key={m.key} href={`/org?focus=${encodeURIComponent(platform.name)}`} aria-label={`${m.label}（${platform.name}）`}>
                          <g transform={`translate(${px} ${py})`}>
                            <circle r={rAvatar + 1.5} fill="var(--bg)" opacity="0.85" />
                            {url ? (
                              <image
                                href={url}
                                x={-rAvatar}
                                y={-rAvatar}
                                width={rAvatar * 2}
                                height={rAvatar * 2}
                                preserveAspectRatio="xMidYMid slice"
                                style={{ clipPath: 'circle(50%)' }}
                              />
                            ) : (
                              <text textAnchor="middle" y={3} fill="var(--fg)" style={{ fontSize: rAvatar }}>
                                {(m.label || '?').slice(0, 1)}
                              </text>
                            )}
                          </g>
                        </a>
                      );
                    })}

                    {/* 部门名牌 */}
                    <g transform={`translate(${PLATFORM_W / 2 - SKEW} ${PLATFORM_D + THICK + 6})`}>
                      <rect x={-Math.max(46, platform.name.length * 12)} y={-2} width={Math.max(92, platform.name.length * 24)} height={24} rx={6} fill={`hsl(${platform.hue} 58% 26%)`} />
                      <text textAnchor="middle" y={15} fill="#fff" style={{ fontSize: 13, fontWeight: 600 }}>
                        {platform.name}
                      </text>
                      <text textAnchor="middle" y={40} fill="var(--fg-muted)" style={{ fontSize: 11 }}>
                        {platform.people.length} 人 · {platform.bubbles.length - platform.people.length} Agent
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

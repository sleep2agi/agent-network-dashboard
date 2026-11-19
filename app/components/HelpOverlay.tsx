'use client';

import { useEffect, useState, useRef } from 'react';
import { useFocusTrap, focusablesIn } from '../lib/focus-trap';
import { useRouter } from 'next/navigation';

/** Help overlay — press `?` to see keyboard shortcuts.
 *  Restrained: no animation noise, single column, all global keys in one
 *  place. Closes on Esc or `?` again or click-outside.
 */

interface Shortcut {
  keys: string[];
  label: string;
}

// vim 风格 `g` + 单键的跳转表。帮助面板的「Navigate」分组直接由这张表生成，
// 免得再加页面时只改一处、另一处忘掉（军团/需求就是这样漏掉的）。
// 大小写有意义：`g l` 去军团（常用），`g L`（Shift+L）才是审计日志。
const GO_TARGETS: Record<string, { href: string; label: string }> = {
  o: { href: '/', label: '概览' },
  t: { href: '/tasks', label: '任务' },
  n: { href: '/nodes', label: '节点' },
  r: { href: '/requirements', label: '需求' },
  l: { href: '/legion', label: '军团' },
  m: { href: '/messages', label: '消息' },
  w: { href: '/settings/networks', label: '网络' },
  a: { href: '/admin', label: '管理台' },
  s: { href: '/settings', label: '设置' },
  L: { href: '/logs', label: '审计日志' },
};

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: '全局',
    items: [
      { keys: ['⌘', 'K'], label: '打开命令面板（也支持 Ctrl+K）' },
      { keys: ['/'], label: '打开命令面板' },
      { keys: ['?'], label: '显示 / 收起这个帮助浮层' },
      { keys: ['Esc'], label: '关闭任何已打开的弹窗' },
    ],
  },
  {
    group: '跳转（vim 风格：先按 g 再按字母）',
    items: Object.entries(GO_TARGETS).map(([key, target]) => ({ keys: ['g', key], label: `前往${target.label}` })),
  },
  {
    group: '需求列表',
    items: [
      { keys: ['/'], label: '聚焦搜索框' },
      { keys: ['j', 'k'], label: '在行之间移动（也支持 ↑/↓）' },
      { keys: ['w'], label: '切换「本周到期」筛选（仅统计已加载行）' },
    ],
  },
  {
    group: '命令面板',
    items: [
      { keys: ['↑', '↓'], label: '移动选中项' },
      { keys: ['↵'], label: '执行选中命令' },
      { keys: ['type'], label: '输入即过滤 —— 同时搜索命令、Agent 与任务' },
    ],
  },
  // Round 25 / Loop: TopoGraph keys + mouse gestures from rounds 21-23
  // were only surfaced in button titles. Consolidating here gives the
  // Help overlay (the canonical discovery surface) a single place to
  // learn the canvas controls.
  {
    group: '军团（2D / 3D）',
    items: [
      { keys: ['↑', '↓', '←', '→'], label: '2D：在节点间移动 · 3D：环绕相机' },
      { keys: ['+', '−'], label: '3D：放大 / 缩小' },
      { keys: ['R'], label: '3D：重置相机' },
      { keys: ['↵'], label: '打开选中的节点（Agent 页 / 部门）' },
      { keys: ['Space'], label: '收起或展开选中的部门' },
      { keys: ['/'], label: '在本页搜索节点' },
      { keys: ['Esc'], label: '清空节点筛选' },
      { keys: ['list'], label: '画布只有一个 Tab 停靠点；其余节点请用节点列表访问' },
    ],
  },
  {
    group: '拓扑画布',
    items: [
      { keys: ['+'], label: '放大（也支持 =）' },
      { keys: ['−'], label: '缩小' },
      { keys: ['0'], label: '重置缩放与平移' },
      { keys: ['f'], label: '缩放至适应画布' },
      { keys: ['l'], label: '切换布局（环形 ↔ 网格）' },
      { keys: ['⌘', 'wheel'], label: '以光标为中心缩放（Windows / Linux 用 Ctrl）' },
      { keys: ['drag'], label: '拖动平移画布（光标变为抓手）' },
      { keys: ['dbl-click'], label: '重置缩放与平移（仅空白画布处）' },
      { keys: ['click'], label: '在节点上打开聊天浮窗（Esc 关闭）' },
      // Round 59 / Loop: discoverability for the interactions added in
      // R52 (hub click), R55 (legend status hover), R56 (recent-signal
      // row hover). All three live inside the topology canvas, so this
      // is the right group for the new entries.
      { keys: ['click hub'], label: '缩放至适应画布' },
      { keys: ['hover legend'], label: '高亮某一状态的节点' },
      { keys: ['hover signal'], label: '高亮一条流量边' },
      // Round 62 / Loop: R60 + R61 added click-to-pin on the pressure
      // chip and legend rows; R62 added Esc to release the pin. Pin
      // gives users a sticky filter (vs R55 transient hover).
      { keys: ['click chip'], label: '锁定状态筛选' },
      { keys: ['Esc'], label: '清除锁定筛选 —— 或关闭聊天' },
      // Round 65 / Loop: R63 added group-pin via group label click; R64
      // added active-filter pills in the chip row with per-pill ×
      // clear. Both compose with the R62 Esc keystroke (single press
      // clears everything pinned).
      { keys: ['click group'], label: '锁定团队聚焦' },
      { keys: ['click ×'], label: '清除单个筛选 —— Esc 清除全部' },
      // Round 70 / Loop: R69 added 4 Cmd+K palette actions that pin/
      // clear topology filters from anywhere. Surface them so keyboard
      // power users find the shortcut without spelunking the palette.
      { keys: ['⌘', 'K'], label: '用命令面板锁定 / 清除筛选 →「锁定拓扑筛选…」' },
      // Round 74 / Loop: palette also exposes layout + view actions —
      // a search-friendly alternative to the `l` (R32) and `f` (R29)
      // keyboard shortcuts for users who can't remember them.
      { keys: ['⌘', 'K'], label: '用命令面板切换布局 / 适应画布' },
      // Round 78 / Loop: surface R73 (whole pill body is a click target)
      // and R77 (active-links chip hover → boost all flow edges) —
      // both are real user gestures that weren't in the help overlay.
      { keys: ['click pill'], label: '清除筛选 —— 点胶囊任意位置' },
      { keys: ['hover chip'], label: '点亮全部活跃流 —— 悬停「N 条活跃连接」' },
      // Round 81 / Loop: catch up on the two newest chip-row affordances
      // — R79 working/online chips and R80 vendor-letter chips. All
      // four chip hovers feed the same dim mechanic the R55 legend
      // rows use.
      { keys: ['hover N working'], label: '高亮工作中的节点 —— 与图例同源的胶囊行' },
      { keys: ['hover vendor'], label: '高亮单一厂商 —— 悬停胶囊行的 A/O/书/?' },
      // Round 87 / Loop: catch up on the two newest hover-preview
      // gestures that close click-only gaps from earlier rounds.
      // R83 added preview-before-pin on the pressure-bar segments;
      // R86 did the same for group labels. Both compose with their
      // existing click-pin (R60 / R63) — hover transient, click
      // sticky, Esc clears (R62).
      { keys: ['hover seg'], label: '预览状态筛选 —— 悬停压力条分段' },
      { keys: ['hover group'], label: '预览团队聚焦 —— 悬停部门标签' },
      // Round 91 / Loop: catch up on vendor pin (R88) and granular
      // Cmd+K vendor-clear (R90). Vendor was the last filter
      // dimension without a sticky pin; the click-to-pin gesture
      // and palette clear command both deserve discovery entries.
      // R89's third "filter:" pill is already covered by the
      // generic "click pill" (R73) and "click ×" (R64) entries.
      { keys: ['click vendor'], label: '锁定厂商筛选 —— 点胶囊行的 A/O/书/?' },
      { keys: ['⌘', 'K'], label: '仅清除厂商锁定请用命令面板 →「清除拓扑厂商筛选」' },
      // Round 109 / Loop: catch up on R108 — palette gained
      // pin-vendor commands for the three major vendors. Mirror of
      // R69's pin-status entry; closes the symmetric gap so the
      // palette can both pin AND clear every filter dimension.
      { keys: ['⌘', 'K'], label: '用命令面板锁定厂商 Anthropic / OpenAI / 书生 →「锁定拓扑筛选…」' },
      // Round 118 / Loop: catch up on R116 (recent-signal row click
      // pins the edge — the 4th pin dim, completing the hover→pin
      // sweep) and R117 (granular Cmd+K clear-edge command).
      { keys: ['click row'], label: '锁定流量筛选 —— 点最近信号行锁定该边' },
      { keys: ['⌘', 'K'], label: '仅清除流量锁定请用命令面板 →「清除拓扑边锁定」' },
      // Round 123 / Loop: catch up on R121 — the edge midpoint count
      // badge (R100) became a click-to-pin affordance, giving the
      // canvas side a peer to R116's row-pin. R122 made hovering the
      // badge mirror line hover; doesn't need its own entry — it's
      // the natural hover partner of this click gesture.
      { keys: ['click badge'], label: '在画布上锁定流量 —— 点边中点计数徽标' },
      // Round 134 / Loop: catch up on R133 — the recent-signal panel's
      // "+ N more flows" truncation footer (R128) became a clickable
      // nav to /messages. First TopoGraph affordance that reaches OUT
      // of the canvas; every prior gesture composes back into local
      // state. Help overlay should surface the cross-page jump so
      // operators know the path exists. R124-R132 were all passive
      // visuals / motion / readouts with no new gestures, so this is
      // the only new entry since R123.
      { keys: ['click footer'], label: '查看全部流量 —— 点最近信号面板的「+ N 条更多」' },
      // Round 137 / Loop: catch up on R136 — the "N active links"
      // chip in the chip row gained a real onClick → /messages
      // navigation (it already had cursor:pointer since R77 but the
      // handler was missing, the cursor was lying). Pairs with R133
      // footer-nav at a different surface: R133 lives on the canvas-
      // side panel and only shows when flowLinks > 3; R136 lives at
      // the chip row and triggers whenever flowLinks > 0 — a broader
      // entry point for the same "show me the full list" jump.
      { keys: ['click chip'], label: '查看全部流量 —— 点胶囊行的「N 条活跃连接」' },
      // Round 141 / Loop: catch up on R139 + R140 — the chip-row
      // "N working" and "N online" chips finally honour the cursor:
      // pointer they've carried since R79. Working pins
      // pinnedStatus='working' (composes with R60 pressure-bar + R61
      // legend rows — three surfaces, one pin); online navigates to
      // /nodes (pinning 'idle' would misrepresent the chip, which
      // semantically means working+idle). Two entries this round
      // because two new gestures landed since R137's catch-up.
      { keys: ['click chip'], label: '锁定「工作中」状态 —— 点胶囊行的「N 工作中」' },
      { keys: ['click chip'], label: '打开 Agent 列表 —— 点胶囊行的「N 在线」' },
      // Round 153 / Loop: catch up on R151 — node <g> gained role=button
      // + tabIndex=0 + aria-pressed + onKeyDown so keyboard-only users
      // can Tab to a node and press Enter / Space to open the chat
      // popover (same path as mouse click). Was the FIRST true keyboard
      // gesture added since R141 (R142-R150 were visual / motion / hover
      // refinements; R151 + R152 added/closed keyboard handlers — R152
      // wired Enter on the group label which is just the keyboard parallel
      // of the existing R63 click-group entry, so it doesn't earn a new
      // line). The chat-open path didn't exist as a keyboard gesture
      // before R151, so this is the discoverability entry for it.
      { keys: ['Tab', 'Enter'], label: '在聚焦节点上打开聊天（也支持空格）—— 与点击聊天等价' },
    ],
  },
];


export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  // `.633`：全站帮助浮层声明了 `aria-modal="true"`，但没有焦点容纳 ——
  // Tab 会跑到遮罩背后的页面元素上（与 `.628`/`.629` 修的四处同一问题）。
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef);
  // `.633`：实测打开瞬间焦点仍留在背后的 textarea（hook 的同步 focus 被后续事件覆盖）。
  // 补一次延迟聚焦：与 CommandPalette 的 50ms 做法一致，确保"打开即入内"。
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = dialogRef.current;
      (focusablesIn(el)[0] ?? el)?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open]);
  const router = useRouter();
  /** Timestamp when `g` was last pressed. The next single letter within
   *  1500ms is interpreted as the target page. vim-style `g o`, `g t`, etc. */
  const gAtRef = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement | null)?.isContentEditable;
      // `?` toggles — Shift+/ on US layout. Only when no input is focused.
      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
      // Vim-style `g + letter` route shortcuts (round 35). Skip when modifier
      // keys are held (g is a perfectly fine letter when ⌘ is involved) and
      // when typing into a field.
      if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') {
        gAtRef.current = Date.now();
        return;
      }
      if (Date.now() - gAtRef.current < 1500) {
        const target = GO_TARGETS[e.key];
        if (target) {
          e.preventDefault();
          gAtRef.current = 0;
          router.push(target.href);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, router]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label="键盘快捷键"
      className="anet-help fixed inset-0 z-[101] flex items-center justify-center px-4"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        className="relative w-full max-w-md rounded-xl border border-[#26262b] bg-[#111113] shadow-2xl shadow-black/40 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#26262b] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            键盘快捷键
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="关闭帮助"
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map(g => (
            <div key={g.group} className="mb-3 last:mb-0">
              <div className="text-[11px] uppercase tracking-[0.12em] text-gray-600 mb-1.5">{g.group}</div>
              <ul className="space-y-1.5">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <kbd key={ki} className="text-[11px] font-mono border border-[#26262b] rounded px-1.5 py-0.5 text-gray-400 bg-[#1c1c1f]/40">
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-gray-400 flex-1">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-[#26262b] px-4 py-1.5 text-[11px] text-gray-600 flex items-center justify-between">
          <span>按 <kbd className="font-mono">?</kbd> 显示 / 收起</span>
          <span>或按 <kbd className="font-mono">esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
}

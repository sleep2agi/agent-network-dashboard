// #1545 dashboard 侧 —— 同一个缺陷的第三个入口。
//
// hub 发了、CLI 念了、桌面端在 agent-network-app#224 接上了,而 dashboard 的
// 「选服务器」里,一台「在线但建不了节点」的 daemon 和一台好的长得一模一样,
// 只有点了创建才会失败。
//
// 好消息:数据其实**已经到浏览器了** —— app/api/anet/host-supervisors/route.ts:156
// 是把 hub 的 daemons[] **整体透传**,不是逐字段 map。缺的只是类型和渲染。
//
// 🔴 本模块只做渲染,不重算判据。判据由拥有解析器的那个包(agent-node)算出、
//    经 hub 原样带过来。主仓 #1545 定的规矩是「判据只有一份,永远由拥有它的
//    那个包计算」;而那边的历史统计是自造判据四次、四次都比真判据更松 ——
//    一个更松的判据会显示「可用」然后照样失败,比现在的沉默更糟。
//
// 🔴 也不复制 CLI 的 FIX_BY_REASON 修法表(agent-network/src/
//    daemon-capability-display.ts)。那张表会随 agent-node 版本长出新的 reason
//    code,复制过来就是一份会静默漂掉的同义副本,而漂掉那一刻用户拿到的是
//    一条错误的修复命令。这里只原样显示 reason code,并指向那台机器上的
//    `anet doctor`。这条在本模块的测试里做成了会红的断言,不是一句注释。
//
// 🔴 已知的重复:agent-network-app 的 src/daemon-capability.ts 是同语义的第二份。
//    两个仓之间没有共享包,发一个新 npm 包只为三个字段不划算;取而代之的是
//    **两边各有一套压住同样语义的测试**,任何一边漂了都会红,而不是安静地分岔。

export type DaemonCapabilityKind = 'ready' | 'blocked' | 'unknown';

export interface DaemonCapabilityInput {
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  create_capability_observed_ms_ago?: number;
  last_seen_at?: string | null;
}

export interface DaemonCapabilityView {
  kind: DaemonCapabilityKind;
  label: string;
  detail?: string;
  ageMs?: number;
}

/** 毫秒 → 人读的相对时间。**不四舍五入到「刚刚」** ——
 *  这一格存在的意义就是分辨新鲜和陈旧,含糊化等于把它的功能删掉。 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms 前`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  return `${Math.floor(h / 24)}d 前`;
}

function parseLastSeen(v: string | null | undefined): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function describeDaemonCapability(
  d: DaemonCapabilityInput,
  nowMs: number,
): DaemonCapabilityView {
  // ① 从来没报过 ⇒ unknown。**不是 false。**
  //    把没升级的 daemon 渲染成「不能建」,会让人去修一台其实好好的机器;
  //    渲染成「能建」,又是朝「没问题」方向说谎。它必须是第三种话。
  if (typeof d.can_create_nodes !== 'boolean') {
    return {
      kind: 'unknown',
      label: '创建能力未知',
      detail:
        '这台 daemon 没报过这一格(agent-node 早于 2.5.0-preview.55)。' +
        '升级那台机器的 agent-node 并重启 daemon 后才会有。',
    };
  }

  // ② 绝对年龄 = (now - last_seen_at) + create_capability_observed_ms_ago。
  //    daemon 只提供一个**时长**,绝对时间全部由 hub/浏览器的钟出,
  //    它自己的钟偏移污染不到这个数。
  const lastSeen = parseLastSeen(d.last_seen_at);
  const observed = d.create_capability_observed_ms_ago;
  const ageKnown =
    lastSeen !== undefined && typeof observed === 'number' && Number.isFinite(observed);
  const ageMs = ageKnown ? Math.max(0, nowMs - lastSeen!) + observed! : undefined;

  if (d.can_create_nodes) {
    return ageMs === undefined
      ? {
          kind: 'ready',
          label: '可建节点',
          detail: '不知道是什么时候测的 —— 那台 daemon 的版本开机只算一次。重启它,或升级。',
        }
      : { kind: 'ready', label: `可建节点(${formatAge(ageMs)}测)`, ageMs };
  }

  // ③ blocked —— 原样带出 reason code,不猜修法。
  const reason = d.create_nodes_blocked_reason || 'anet_bin_unknown';
  const when = ageMs === undefined ? '(不知道是什么时候测的)' : `(${formatAge(ageMs)}测)`;
  return {
    kind: 'blocked',
    label: `建不了节点 ${when}`,
    detail:
      `原因代码:${reason}。完整原文和可粘贴的修法只在那台机器上 —— ` +
      '在它上面运行 `anet doctor` 或 `anet daemon list` 会打印出来' +
      '(带真实机器路径,按设计不上报)。',
    ageMs,
  };
}

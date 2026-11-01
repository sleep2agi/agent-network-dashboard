/**
 * 需求列表的「计划健康度」：把 start / due 变成一句能扫的短标签。
 *
 * 为什么需要：列表只有「已逾期」这一个二元筛选——「还有 2 天到期」和「还有 30 天」
 * 长得一样，而排期恰恰需要这个区别。数据（start / due）本来就在行里，不发新请求。
 *
 * 日期一律按「日历日」比较（YYYY-MM-DD 片段），不掺时分秒与时区偏移：
 * 用 Date.UTC 拼装，两侧相减再取整，避免本地时区把边界日算成前一天。
 */

export type PlanHealthKind = 'overdue' | 'dueToday' | 'dueSoon' | 'daysLeft' | 'inProgress';

export interface PlanHealth {
  kind: PlanHealthKind;
  days: number;
  label: string;
}

function dayNumber(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
}

/**
 * @param today 只用于测试注入；默认取当前日历日
 * @param done 已结束的列（完成/放弃）不再提示排期
 */
export function planHealth(
  start: string | null | undefined,
  due: string | null | undefined,
  today: Date = new Date(),
  done = false,
): PlanHealth | null {
  if (done) return null;
  const todayDay = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);
  const dueDay = dayNumber(due);
  if (dueDay !== null) {
    const left = dueDay - todayDay;
    if (left < 0) return { kind: 'overdue', days: -left, label: `已超期 ${-left} 天` };
    if (left === 0) return { kind: 'dueToday', days: 0, label: '今天到期' };
    if (left <= 3) return { kind: 'dueSoon', days: left, label: `剩余 ${left} 天` };
    return { kind: 'daysLeft', days: left, label: `剩余 ${left} 天` };
  }
  const startDay = dayNumber(start);
  if (startDay !== null) {
    const elapsed = todayDay - startDay;
    if (elapsed >= 1) return { kind: 'inProgress', days: elapsed, label: `已进行 ${elapsed} 天` };
  }
  return null;
}

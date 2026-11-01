import { describe, expect, test } from 'bun:test';
import { planHealth } from './requirement-plan-health.ts';

const TODAY = new Date(2026, 10, 1); // 2026-11-01

describe('计划健康度', () => {
  test('没有 start / due → 不显示', () => {
    expect(planHealth(null, null, TODAY)).toBe(null);
    expect(planHealth(undefined, '', TODAY)).toBe(null);
  });

  test('超期按天数算，且不出现负数剩余', () => {
    const h = planHealth(null, '2026-10-28', TODAY);
    expect(h?.kind).toBe('overdue');
    expect(h?.label).toBe('已超期 4 天');
  });

  test('今天到期单独一档', () => {
    expect(planHealth(null, '2026-11-01', TODAY)?.label).toBe('今天到期');
  });

  test('3 天内提醒，4 天及以上只报剩余', () => {
    expect(planHealth(null, '2026-11-03', TODAY)?.kind).toBe('dueSoon');
    expect(planHealth(null, '2026-11-06', TODAY)?.kind).toBe('daysLeft');
    expect(planHealth(null, '2026-11-06', TODAY)?.label).toBe('剩余 5 天');
  });

  test('没有 due 但有 start → 报已进行天数', () => {
    expect(planHealth('2026-10-25', null, TODAY)?.label).toBe('已进行 7 天');
    expect(planHealth('2026-11-01', null, TODAY)).toBe(null);
  });

  test('已完成的列不提示排期', () => {
    expect(planHealth(null, '2026-10-28', TODAY, true)).toBe(null);
  });

  test('日期带时间戳也按日历日算（不吃时区偏移）', () => {
    expect(planHealth(null, '2026-11-03T23:59:59Z', TODAY)?.label).toBe('剩余 2 天');
  });
});

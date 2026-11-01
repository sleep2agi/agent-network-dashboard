import { describe, expect, test } from 'bun:test';
import { TOUR_STEP_MAX_MS, TOUR_STEP_MIN_MS, tourStepMs } from './legion-tour.ts';

describe('巡礼步长', () => {
  test('空部门取最小值，不会一闪而过', () => {
    expect(tourStepMs(0, 0)).toBe(TOUR_STEP_MIN_MS);
  });

  test('人越多停越久', () => {
    const small = tourStepMs(4, 1);
    const medium = tourStepMs(12, 2);
    expect(medium).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(TOUR_STEP_MIN_MS);
  });

  test('大部门封顶，不会永远停在一步', () => {
    expect(tourStepMs(80, 40)).toBe(TOUR_STEP_MAX_MS);
    expect(tourStepMs(1000, 1000)).toBe(TOUR_STEP_MAX_MS);
  });

  test('脏数据不产生 NaN / 负步长', () => {
    expect(tourStepMs(Number.NaN, 0)).toBe(TOUR_STEP_MIN_MS);
    expect(tourStepMs(-5, -5)).toBe(TOUR_STEP_MIN_MS);
  });

  test('Agent 只算半个权重（环上更容易扫完）', () => {
    expect(tourStepMs(0, 8)).toBeLessThan(tourStepMs(8, 0));
  });
});

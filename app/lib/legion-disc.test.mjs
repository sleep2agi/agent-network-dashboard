import { describe, expect, test } from 'bun:test';
import { groupDiscRadii, hitTest } from './legion-3d';

const node = (kind, scale = 1, depth = 1) => ({
  item: { kind }, point: { x: 0, y: 0, z: 0 },
  projected: { x: 100, y: 100, scale, depth },
});
const discShape = n => n.item.kind === 'group' ? groupDiscRadii(20 * n.projected.scale) : undefined;

describe('部门盘的命中区域与视觉尺寸一致', () => {
  test('盘面水平边缘可点击，椭圆外的上下空白不会误选', () => {
    const disc = node('group');
    expect(hitTest([disc], 135, 100, 16, discShape)).toBe(disc);
    expect(hitTest([disc], 100, 125, 16, discShape)).toBeNull();
    expect(hitTest([disc], 140, 115, 16, discShape)).toBeNull();
  });

  test('缩放后的盘面边缘可点击，缩小时保留最小命中区域', () => {
    const zoomed = node('group', 2);
    expect(hitTest([zoomed], 170, 100, 16, discShape)).toBe(zoomed);
    const small = node('group', 0.1);
    expect(hitTest([small], 100, 114, 16, discShape)).toBe(small);
    expect(hitTest([small], 120, 100, 16, discShape)).toBeNull();
  });

  test('盘面和成员重叠时仍优先选前面的节点', () => {
    const disc = node('group', 1, 2);
    const person = node('person', 1, 1);
    expect(hitTest([disc, person], 105, 100, 16, discShape)).toBe(person);
    expect(hitTest([disc, person], 135, 100, 16, discShape)).toBe(disc);
  });

  test('未提供椭圆的节点沿用圆形命中，旧调用兼容', () => {
    const person = node('person');
    expect(hitTest([person], 115, 100, 16, discShape)).toBe(person);
    expect(hitTest([person], 135, 100, 16, discShape)).toBeNull();
    expect(hitTest([person], 100, 100, 0)).toBe(person);
  });
});

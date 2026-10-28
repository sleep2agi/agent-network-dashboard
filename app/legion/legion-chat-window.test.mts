import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_COLLAPSED_HEIGHT, fitChatWindow, initialChatWindow } from './legion-chat-window.ts';

test('floating chat fits desktop, phone, and reduced visible viewport without covering the whole host', () => {
  for (const bounds of [{ x: 12, y: 12, width: 1640, height: 800 }, { x: 12, y: 12, width: 296, height: 544 }, { x: 12, y: 100, width: 340, height: 260 }]) {
    const r = initialChatWindow(bounds);
    assert(r.x >= bounds.x && r.y >= bounds.y);
    assert(r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height);
    if (bounds.height > 320) assert(r.height < bounds.height);
  }
});

test('dragging and growing past edges retain access to the whole window', () => {
  const bounds = { x: 200, y: 30, width: 900, height: 700 };
  for (const x of [-2000, 5000]) for (const y of [-1000, 5000]) {
    const r = fitChatWindow({ x, y, width: 2000, height: 3000 }, bounds);
    assert.deepEqual(r, { ...bounds });
  }
});

test('minimized movement retains expanded dimensions, restoring clamps it back inside', () => {
  const bounds = { x: 12, y: 12, width: 900, height: 700 };
  const r = fitChatWindow({ x: 1000, y: 1000, width: 480, height: 600 }, bounds, true);
  assert.equal(r.width, 480); assert.equal(r.height, 600);
  assert.equal(r.y + CHAT_COLLAPSED_HEIGHT, bounds.y + bounds.height);
  const restored = fitChatWindow(r, bounds);
  assert.equal(restored.height, 600);
  assert(restored.x + restored.width <= 912 && restored.y + restored.height <= 712);
});

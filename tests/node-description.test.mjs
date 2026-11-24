import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptionSummary } from '../app/lib/node-description.ts';

test('descriptionSummary handles empty and untouched template', () => {
  assert.equal(descriptionSummary(null), '');
  assert.equal(descriptionSummary('   \n  '), '');
  assert.equal(descriptionSummary('负责：\n能干什么：\n什么事找我：\n不做：'), '');
});

test('descriptionSummary strips template prefix and truncates cleanly', () => {
  assert.equal(descriptionSummary('负责：ANet 全端发版与排错\n能干什么：修 bug'), 'ANet 全端发版与排错');
  assert.equal(descriptionSummary('负责：\n能干什么：  写代码   与 巡检\n不做：'), '写代码 与 巡检');
  assert.equal(descriptionSummary('😀'.repeat(12), 10), '😀'.repeat(9) + '…');
});

test('Dashboard wires description into lite nodes API, NodeList, and ChatPane', () => {
  const route = readFileSync(new URL('../app/api/hub/nodes/route.ts', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../app/components/NodeList.tsx', import.meta.url), 'utf8');
  const pane = readFileSync(new URL('../app/components/ChatPane.tsx', import.meta.url), 'utf8');
  assert.ok(route.includes("'description'"));
  assert.ok(list.includes('node-list-desc'));
  assert.ok(pane.includes('chat-pane-desc'));
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../app/components/TaskChatPanel.tsx', import.meta.url),
  'utf8',
);

test('the rendered panel alias is the synchronous default send target', () => {
  assert.doesNotMatch(source, /useState\(alias\)/);
  assert.doesNotMatch(source, /setTargetAlias/);
  assert.match(source, /let sendTo = alias;/);
  assert.match(source, /body:\s*JSON\.stringify\(\{[\s\S]*?alias:\s*sendTo,/);
});

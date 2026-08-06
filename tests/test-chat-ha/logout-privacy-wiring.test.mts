import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('every explicit sign-out surface clears private chat recovery data', () => {
  for (const file of [
    'app/components/Sidebar.tsx',
    'app/components/CommandPalette.tsx',
    'app/components/UserBar.tsx',
    'app/settings/page.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /clearPrivateChatStorage\(\)/, `${file} must clear outbox and drafts`);
  }
});

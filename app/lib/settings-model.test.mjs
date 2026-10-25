import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SECTIONS, SETTINGS_LINKS, SETTINGS_GROUP_ORDER } from './settings-model';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

describe('settings information architecture', () => {
  test('group order follows the desktop client model', () => {
    expect(SETTINGS_SECTIONS.map(s => s.id)).toEqual(SETTINGS_GROUP_ORDER);
  });

  test('every section has a unique id and a label', () => {
    const ids = SETTINGS_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS_SECTIONS) expect(s.label.length).toBeGreaterThan(0);
  });

  test('every link points at a route that exists on disk', () => {
    for (const l of SETTINGS_LINKS) {
      const target = join(APP, l.href.replace(/^\//, ''));
      expect({ href: l.href, exists: existsSync(target) }).toEqual({ href: l.href, exists: true });
    }
  });

  test('team and resource groups are both represented', () => {
    expect(SETTINGS_LINKS.filter(l => l.group === 'team').length).toBeGreaterThan(0);
    expect(SETTINGS_LINKS.filter(l => l.group === 'resource').length).toBeGreaterThan(0);
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isOwnSender, senderLabelFor } from './chat-sender.ts';

// #35：hub 发来的消息被标成「You」。
//
// tasks.from_name 的默认值就是 `hub`，Hub 的广播与系统通知走这条路径。
// 把它们算成「我说的话」，在多节点协作里会让操作者误以为是自己发的。
// 这里同时钉住判定表本身，和「面板只能走这张表」——防止有人再在组件里
// 内联一份 from_name 名单。

const root = join(import.meta.dir, '..', '..');
const panel = readFileSync(join(root, 'app/components/TaskChatPanel.tsx'), 'utf8');

describe('会话发送者归属', () => {
  test('本客户端的两个身份标签算「我」', () => {
    expect(isOwnSender(undefined)).toBe(true);
    expect(isOwnSender(null)).toBe(true);
    expect(isOwnSender('')).toBe(true);
    expect(isOwnSender('Dashboard')).toBe(true);
    expect(isOwnSender('api')).toBe(true);
    expect(isOwnSender(' dashboard ')).toBe(true);
    expect(isOwnSender('API')).toBe(true);
  });

  test('hub 不算「我」，显示为 Hub（#35）', () => {
    expect(isOwnSender('hub')).toBe(false);
    expect(senderLabelFor('hub')).toBe('Hub');
    expect(senderLabelFor('Hub')).toBe('Hub');
  });

  test('其它发送者原样显示，不被人为改名', () => {
    expect(isOwnSender('通信欧')).toBe(false);
    expect(senderLabelFor('通信欧')).toBe('通信欧');
    expect(senderLabelFor('tm-agent-1')).toBe('tm-agent-1');
  });

  test('You 只在真的算「我」时出现', () => {
    expect(senderLabelFor('api')).toBe('You');
    expect(senderLabelFor('')).toBe('You');
    expect(senderLabelFor('hub')).not.toBe('You');
  });

  test('面板走 helper，不再内联 from_name 名单', () => {
    expect(panel).toContain('isOwnSender(m.from_name)');
    expect(panel).toContain('senderLabelFor(m.from_name)');
    expect(panel).not.toContain("m.from_name === 'hub'");
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CREATE_FIELDS } from '../api/hub/requirements/route';
import { WRITABLE } from '../api/hub/requirements/[id]/route';

/**
 * 为什么钉这两张表：2026-10-31 新建需求加截止日期时，表单把 `due` 放进了请求体，
 * 而 POST 代理的白名单没有它 —— 字段在浏览器和 Hub 之间被**静默丢弃**，界面不报错、
 * 数据也没保存，只有在验收里断言「真的到了 Hub」才发现。
 *
 * 这个文件的作用不是证明它们现在是对的，而是让下一次「加字段忘了透传」变成一次
 * 红色的单测，而不是一个用户几周后才发现的空字段。
 */

const README = readFileSync(new URL('./proxy-allowlists.test.mjs', import.meta.url), 'utf8');

describe('需求写入代理的字段白名单', () => {
  test('创建：日期字段与页面实际发送的字段都在名单里', () => {
    // 页面（app/requirements/CreateRequirement.tsx）发送的字段
    const sentByDialog = ['name', 'priority', 'column', 'project_id', 'tags', 'description', 'due'];
    for (const field of sentByDialog) expect([...CREATE_FIELDS]).toContain(field);
    // 详情页的「新建子需求」还会带 parent_id
    expect([...CREATE_FIELDS]).toContain('parent_id');
  });

  test('创建：不会悄悄放行 Hub 不认识的字段', () => {
    // 新增字段必须同时改这里和 CHANGELOG —— 逼一次有意识的决定。
    expect([...CREATE_FIELDS].sort()).toEqual(
      ['column', 'description', 'due', 'name', 'parent_id', 'priority', 'project_id', 'start', 'tags'].sort(),
    );
  });

  test('修改：详情页每个 writePath 都落在白名单内', () => {
    // 详情页（app/requirements/[id]/page.tsx）实际会发出去的字段
    const sentByDetail = ['column', 'priority', 'due', 'start', 'tags', 'description', 'owner', 'agent_owner',
      'participants', 'checklist', 'parent_id', 'issues', 'archived'];
    for (const field of sentByDetail) expect([...WRITABLE]).toContain(field);
  });

  test('修改：白名单与页面字段严格相等（多了就是没人发的死字段）', () => {
    const expected = ['column', 'priority', 'due', 'start', 'tags', 'name', 'description', 'owner', 'agent_owner',
      'participants', 'checklist', 'parent_id', 'issues', 'archived'];
    expect([...WRITABLE].sort()).toEqual(expected.sort());
  });

  test('两张表都禁止出现 network_id / 身份类字段', () => {
    // network_id 走 query，身份走已登录会话；放进 body 会绕过代理的边界。
    for (const banned of ['network_id', 'user_id', 'token', 'Authorization']) {
      expect([...CREATE_FIELDS]).not.toContain(banned);
      expect([...WRITABLE]).not.toContain(banned);
    }
  });

  test('测试自述里写清由来，避免被当成多余的断言', () => {
    expect(README).toContain('静默丢弃');
  });
});

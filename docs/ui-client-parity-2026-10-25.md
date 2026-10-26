# Dashboard ↔ 客户端 功能对齐清单（2026-10-25）

Owner 指令：Dashboard 的**审美与功能**都要向客户端对齐，另外单独支持军团组织架构图。

这份清单只写**已核过源码**的结论，每条带证据路径。没核过的不写「大概一致」——
上一轮就是因为凭印象判断「客户端没有组织图」，差点漏掉 `OrgChart.tsx`（657 行，
真正的部门树）。

对照基准：`/home/vansin/agent-network-app`（客户端，只读）。

---

## 一、结论摘要

| 方向 | 结论 |
|---|---|
| 视觉 | 客户端有 `docs/design/minimal-2026-09.md` 作为唯一准绳；Dashboard 已按它收了 `/requirements`、`/org` 两页，其余页面仍是旧密度（143 处 `gray-600/700`、31 处 700+ 字重、14 处描边）。 |
| 组织架构 | **最大的一处不对齐**：客户端有真实部门树（父子、负责人、部门群），Dashboard 只有扁平的「人 → 一个部门名」。 |
| 聊天 | 客户端三栏 + 私信 + 语音输入；Dashboard 有 `/nodes` 三栏与 `/messages`，语音未见实现。 |
| 任务 | 客户端可按部门取任务（`department_id`）；Dashboard 全仓没有 `department_id`。 |
| 军团图 | Dashboard 独有（客户端无对应视觉），「部门树 → 人 → Agent」三层同心环；v4 起支持**部门折叠/展开**（折叠把角度让给同级、角标显示藏了多少人）与**导出 PNG**（内联计算样式，深色底 2x 光栅化）。 |

---

## 二、组织架构（优先级最高）

### 客户端有、Dashboard 没有

| 能力 | 客户端证据 | Dashboard 现状 |
|---|---|---|
| 部门树（`parent_id`） | `src/org-model.ts` `childrenOf` / `pathTo` / `subtreeIds` / `totalMembers` | `app/org/page.tsx` 只把 `person.department.name` 去重，**没有层级** |
| 部门负责人 | `Department.leader_user_id` + `LeaderBadge`（`src/OrgChart.tsx`） | 无 |
| 部门群（RFC-042） | `src/DeptGroupPanel.tsx`、`useGroupSupport`、`canManageDeptGroup` | 全仓搜 `部门群` / `dept-group` 无命中 |
| 成员调部门 | `setMemberDepartment` → `PUT /api/networks/{id}/members/{uid}/department` | 无 |
| 按部门的任务 | `fetchDepartmentRequirements` → `/api/requirements?department_id=` | 全仓无 `department_id` |
| 列的增删改 | `createDepartment` / `updateDepartment` / `deleteDepartment` + `viewer_can` 权限位 | 页面明写「只读，不提供编辑」 |

### 数据源差异（这是根因）

- 客户端：`GET /api/networks/{networkId}/departments`
  → `{ departments: [{ id, name, parent_id, leader_user_id, sort, member_count, viewer_can? }], members: [{ user_id, department_id }] }`
  （`src/org-api.ts:63`，老 Hub 404 时整块不出现，回退行为必须保留）
- Dashboard：`GET /api/requirements/people/directory`（`app/api/hub/people/route.ts`）
  → 只有 `department: { id, name } | null`，**拿不到 parent_id、负责人、成员表**。

**所以「军团图」原先画的是扁平部门，不是军团真实编制。**

→ 2026-10-25 晚已修：新增 `/api/hub/departments` 代理（状态码原样透传，404 表示
「这版 Hub 没有这条路由」），`legion-layout` 改为按树递归，半径随深度从 0.30 递增到
0.50；没接口时仍合成一层扁平部门，几何与旧版一致，页面顶部明写原因，不用“空”掩盖。
`/org` 列表页已同步（2026-10-25 深夜）：按树缩进 + 负责人徽章 + 含下级的合计，
与军团图共用 `buildOrgGroups`（`app/lib/org-tree.ts`，6 条单测）；老 Hub 仍是扁平回退。

---

## 三、聊天

| 能力 | 客户端 | Dashboard |
|---|---|---|
| 会话三栏（列表 / 会话 / 详情） | `ChatScreen.tsx` | `app/nodes/NodesView.tsx` + `ChatPane` |
| 私信（DM） | `DmChatScreen.tsx` | `app/messages/page.tsx`（存在，未逐项比对） |
| 草稿 / 置顶 / 免打扰 | `chat-drafts` `chat-pin` `chat-mute` | 同名 lib 在 `app/lib/`，已接线（`NodeList` 引用） |
| 语音输入 | `DesktopVoiceBar.tsx`、`useVoiceInput` | 全仓仅在 `TopoGraph.tsx` 命中字符串，**未见实现** |
| 部门群 | `DeptGroupPanel.tsx` | 无 |

---

## 四、任务 / 定时 / 技能 / 服务器

| 页面 | 客户端 | Dashboard | 差异 |
|---|---|---|---|
| 任务 | `TasksScreen.tsx`（项目分组、筛选、看板） | `app/tasks`、`app/requirements` | Dashboard 已有两个入口；缺部门维度筛选（见二） |
| 定时 | `ScheduledTasksScreen.tsx` + `ScheduleEditor` + 时钟选择器 | `app/scheduled-tasks` | 未逐项比对，编辑器能力待核 |
| 技能 | SkillHub（客户端有 skill 浏览/安装） | `app/skillhub` | 未逐项比对 |
| 服务器 / Provider | `ServersDrawer`、Provider 表单 | `app/servers`、`app/providers` | 未逐项比对 |
| 设置 | `SettingsScreen` + `SettingsEditPages` + `SettingsPhonePages` | `app/settings` | ✅ 已按客户端 `settings-model.ts` 重排六组（账号→连接→成员与组织→外观→资源→关于，2026-10-25 `26b65a2`）。仍缺客户端独有的**通知 / 语音输入 / 快捷键**三组；Dashboard 无对应能力，不画假开关 |
| 版本 | — | `app/versions` | Dashboard 独有 |

---

## 五、军团的定位（与客户端的关系）

客户端 `OrgChart.tsx` 是**管理页**：部门树导航 + 详情 + 编辑弹层，手机是一层一页。
它不是可视化图，也没有「Agent 编制」这一层。

所以 `/legion` 不是客户端的替代品，补的是客户端缺的那块：**一张能看出编制比例、
人机归属、在线状态的组织图**。它必须建立在**真实的部门树**上才有意义——
这也是下一轮的第一件事。

---

## 六、下一步（按依赖排序）

1. `/api/hub/departments` 代理（404 透传，不改状态码语义），Dashboard 侧统一
   `OrgSnapshot = { departments, members, people }`。
2. `legion-layout` 支持任意深度：部门节点带 `depth`，半径按深度插值（根 = 圆心，
   叶子部门 = 0.5 环），人数仍按子树加权；扁平数据走现有 path，等价于 depth=1。
3. `/org` 列表按树缩进，负责人徽章、成员数用 `totalMembers` 语义（含下级）。
4. 部门群 / 按部门任务 / 语音输入单独立卡，等 Hub 接口确认后再接。

---

## 七、三态普查（2026-10-26，`28f54c5`）

写报告前先查了「读失败时页面说什么」。结论不是「某些页面缺 loading」，
而是**一个共享 SWR key 的吞错污染了全站**：

`/api/hub/status` 同时被 `useSessions()`（页面）和 `Sidebar` 注册。
Sidebar 的 `statusFetcher` 在非 2xx 时返回 `{ sessions: [] }`；SWR 按 key
去重，Sidebar 先解析出的「空」写进全局缓存，于是所有页面拿到的都是**空数组
而不是 error**，空态文案就把「Hub 读不到」说成「本来就没有」：

| 页面 | 读失败时的旧文案 | 实际含义 |
| --- | --- | --- |
| `/nodes` | 「Run this in a fresh terminal to register an agent…」 | 不是新装，是没读到 |
| `/versions` | 「在线 0 / 落后 0」（且画成统计卡） | 不是全对齐，是没读到 |
| `/tasks` | 「Tasks will appear here when agents send them」 | 不是没任务，是没读到 |
| `/messages` | 空态（`useMessages` 连 error 都没解构） | 不是没消息，是没读到 |

修法分三层（都在同一个提交里）：

1. **吞错源头**：`Sidebar.statusFetcher` 非 2xx 抛错（401 仍跳登录）；
   `useSessions` 的共享 `fetcher` 对 `!res.ok` 抛错。
2. **代理层状态码**：`/api/hub/status`、`/api/hub/messages` 上游非 2xx 不再
   包成 200；`/api/hub/tasks` 的 `/api/completions` 回退也失败时返回 502，
   而不是 `{ ok: true, tasks: [] }`。
3. **页面三态互斥**：四页只在「真·空且没报错」时渲染空态；读失败给错误卡 +
   重试；已有陈旧数据时给一条「下面是上一次读到的」。`/versions` 读失败时
   不画 0/0 统计。

验收用 stub Hub 独立制造 500：四页均出现错误卡、无空态引导；切回 200 后四页
正常且无错误文案。契约写在 `app/lib/hub-error-propagation.test.mjs`（4 条），
因为这类问题发生在 SWR 缓存去重之前，e2e 很难稳定复现。

**第二轮收口（2026-10-26，`ec6e9c8`）**：把「页面当权威数据用」的代理逐条修了。

| 代理 | 旧行为 | 现在 |
| --- | --- | --- |
| `/api/hub/tokens` | 失败 → 200 `{tokens: []}` | 非 2xx 透传（404→502）；设置页命中已有的错误卡 |
| `/api/hub/networks` | 失败 → 200 `{networks: []}` | 404 标 `unavailable`，其余透传；Sidebar `networkFetcher` 不再吞错（同一个 SWR key 污染模式） |
| `/api/hub/task-events` | 失败 → 200 `{events: []}` | 404 标 `unavailable`（老 Hub 无端点），其余透传 |
| `/api/hub/nodes` | 失败 → 200 `{nodes: []}` | 先走 `/api/status` 兜底（老 Hub 无 `/api/nodes` 是设计好的降级），两个上游都挂才 502；兜底映射合并成 `nodesFromSessions()` |

设置页 `/settings/networks` 补了 error / unavailable / loading 三态互斥——
它的注释早就写着「空列表和读失败无法区分」，但代码里没解构 `error`。

**仍未覆盖**：`/api/hub/audit-log` 等少数路由仍有 graceful fallback，其页面
不把结果当权威数据（只做附加信息展示），暂不动。

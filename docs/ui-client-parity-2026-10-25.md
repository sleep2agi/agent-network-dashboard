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

---

## 八、节点列表审美（2026-10-26，`f912ebd`）

前几轮把 SkillHub / Servers / Providers / Tasks 的卡片描边收完了，这轮补 `/nodes`：

| 元素 | 改法 | 依据 |
| --- | --- | --- |
| 网格卡片 / 列表行 | 去掉 `border`，hover 由「描边变青」改为「底色变亮」 | minimal-2026-09：分层靠底色，不靠描边 |
| 卡内 Current task 面板 | 去同色描边，改用更深一档的 `--bg` | 同上 |
| 节点状态 | 3 处彩色胶囊 → 圆点 + 文字（`<StatusLabel>`） | 胶囊越少越好；颜色仍走 `status.ts` 单一事实源 |

顺带修了个可访问性问题：状态文字 idle/offline 原来用 gray-400/500，在
`--bg-secondary`(#161618) 上只有 **3.74:1**，低于小字 4.5:1。改成 gray-300/400 后
分别为 **12.26:1 / 7.12:1**（绿 10.37:1、琥珀 11.80:1、红 6.53:1）。圆点保持原暗度，
所以「强状态更亮、弱状态更暗」的层次没有被拉平。

验证：1280 的 list/grid 与 375 的 list 三档，卡片 `border-width` 实测 `0px`、底色
`rgb(22,22,24)`，两个节点分别渲染 idle / working 圆点+文字，横向溢出 0px。

## 九、节点详情与聊天面板（2026-10-26，`e4c265a`）

| 位置 | 改法 | 说明 |
| --- | --- | --- |
| `/node` 六个卡片壳 | 硬编码 `#161618` + `#26262b` 描边 → `bg-[var(--bg-secondary)]` 无描边 | 顺带把 `--code-bg` / `--col-line` / `--col-inset` 等 token 接上 |
| Terminal `<pre>`、外部计划行、时间线圆点环 | 同上，去同色描边 | 行内保留更浅一档底色做分层 |
| 聊天气泡（收/发） | 去掉 `border-*` 与 `shadow-sm` | 只留 8% 色调底 + `rounded-bl/br-md` 非对称圆角区分方向 |
| 「正在输入」提示 | 去描边 | 与气泡同一语言 |

`tab` 栏的 `border-b`、输入框描边、告警条保留 —— 这些是结构分隔与输入可辨性，
不属于「装饰性描边」。

`color-ratchet` 基线同步从 **376 收紧到 354**（本轮 hex→token 净减少 22 处）。
不收紧的话，以后新增 22 处硬编码颜色也拦不住。

验证：1280/375 聊天页气泡 `border-width=0px`、`box-shadow=none`、圆角
`16px 16px 6px`；`/node` 的 Node Info / Send Task 卡片 `border=0px`、
底色 `rgb(22,22,24)`；两宽度横向溢出均 0px。

## 十、首页 KPI 与定时任务（2026-10-26，`deefe2c`）

| 位置 | 改法 | 备注 |
| --- | --- | --- |
| 首页 KPI 卡（`.anet-stat-card`） | `border-[#26262b]` → `border-transparent`，底色 `--bg-secondary` | 保留 1px solid，否则浅色/薄荷主题的 2px 顶部色条规则会失效 |
| 首页状态条 | 去硬编码描边，底色 token 化 | |
| 首页 Agent 过滤 chips | 描边胶囊 → 选中淡青底 / 未选悬停底色 | |
| `/scheduled-tasks` 表单卡与计划卡 | 去描边，改用 `--bg-secondary` 分层 | 空态从虚线框改实底块 |
| 计划操作按钮（编辑/暂停/立即执行/记录/取消） | 五条描边 → 文字按钮 + 悬停底色 | 危险/主操作仍靠颜色区分 |

表单输入框与告警条保留描边 —— 输入可辨性与错误语义需要边界。

`color-ratchet` 继续收紧：354 → **349**。
验证：1280/375 下 KPI 卡 `border-top-color = rgba(0,0,0,0)`、`border-width 1px`、
底色 `rgb(22,22,24)`；`/scheduled-tasks` 仅剩告警条一处描边；
首页 / 定时任务 / 版本三页横向溢出 0px，无 pageerror。

## 十一、军团 3D 网络拓扑（2026-10-26，`0b58b5e`）

owner 要求「3D 版本网络拓扑，给看到军团的人大大的震撼」。与神明分工：她定
视觉参数、我实现渲染与门禁。

### 为什么不引 three.js
一个页面不值得把 WebGL 运行时塞进离线部署包（包体、CSP、e2e 截图都会受牵连）。
3D 的部分其实是**投影数学**，用 Canvas 2D + 透视除法就够：节点数量在几十个
量级，性能不是瓶颈，控制力反而更强（每个像素都能按 token 上色）。

### 结构与约束

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 数学 | `app/lib/legion-3d.ts` | 极坐标→3D、旋转、投影、深度排序、命中、雾化、轨道采样（10 条单测） |
| 取数 | `app/lib/legion-data.ts` | 2D/3D 共用：404=能力缺失、其余非 2xx 抛、401 交登录 |
| 渲染 | `app/legion/3d/page.tsx` | Canvas 绘制、交互、详情卡、导出、三态 |

三条和 2D 页一致的硬约束：
1. 坐标只来自纯函数，组件里不许出现画节点的 `Math.sin/cos`（有源码契约测试）；
2. 颜色只读 token，JSX 里不出现 `#rrggbb`；
3. 空 / 加载 / 401 / 500 各有独立状态，空态只在数据到位且确实只有圆心时出现。

### 视觉元素
星野 + 径向辉光、部门扇区弧带（一眼看出「这块是哪个部门」）、地面网格
（给纵深参照）、核心呼吸（6% 幅度）、连线流动光点、每层环上两颗卫星、
深度雾化与径向标签（避免正下方标签糊成一团）。

### 交互与出口
拖动环绕、滚轮/双指缩放、点节点看详情（含部门路径与 Agent 深链）、
方向键旋转 / `R` 重置 / `Esc` 取消选中、自转在 2.6s 无操作后恢复；
导出当前视角 PNG；与 `/legion` 双向互达。

### 验收
1280/375 均 200、无 pageerror；canvas 有实际像素（亮样本 2126 / 624）；
拖动 / 滚轮 / 方向键都改变画面；点不同色块分别命中圆心与三个部门节点；
导出 PNG 成功；375 下窗口高度贴合（812=812）、无横向溢出。
`npm test` 22/22（新增 5 条页面契约 + 10 条投影单测）。

### 后续两笔（同日）

- `9655e57` 按神明给 PPT 首页 3D 图的参数收敛：俯仰 0.52rad、透视与缩放
  拆成两个变量（dist 固定 6.0，滚轮改 zoom）、自转 0.027 rad/s 且 3s 后恢复、
  连线三层（光晕/实线/流光）、环上彗星、离线改降透明度不换灰。
- `7477726` 浅底主题分支：深底靠 `shadowBlur` 发光，浅底改「半透明实心 +
  同色描边」，否则节点周围是一圈脏灰。主题切换每 30 帧重读 token。
- `af0124b` 交互补齐：悬停描边与强制标签（只改 ref，不逐帧重渲染）、
  双击直达（Agent→节点详情 / 成员部门→/org）、部门聚焦（详情卡开关 +
  顶部胶囊，非子树节点淡到 0.22）。

### 神明两段脚本的吸收（`2925491`）

神明把她 PPT 的 cover14（深色）/ phalanx18（浅色）脚本发了过来。能搬的
「材质」全部搬到 Canvas 2D：

| 她的做法 | 我们的落地 |
| --- | --- |
| 连线 = 二次曲线，控制点法向偏移 18% | 控制点法向偏移 16%、双向交替，避免所有线朝同一边鼓 |
| 三层：宽光晕 + 实线 + 白色 dash 2/22 | 宽光晕 9px@.34（blur 3）→ 实线 2px@.85 → dash 2/22 + lineDashOffset 动画 |
| 双向彗星：亮头（白芯+彩描边）+ 6 段尾巴 | 每条边两个数据包，沿二次贝塞尔求值跑 |
| 节点：白芯 + 团队色描边 + 外晕 | 深底 = 外晕 → 白芯 → 彩描边；浅底 = 7px .18 外圈 + 白芯 + 3.5px 描边 |
| 团队内弧：细彩线 + 白色短划 1.5/11 | 部门内相邻成员之间同款细弧，比部门间连线细一档 |
| 投影 P() = 1/(1+Z·0.11) | 固定 dist=6（≈1/6 柔化），缩放与透视拆开 |

没搬的：`roundPath()` 圆角平台是 2.5D 方阵列队，我们的 3D 轨道投影里没有
平台这个对应物，硬搬会多出一层没有语义的装饰。

### 3D 性能与导出（`19043fb`）

**压测**：造了 BIG 数据集（8 部门 / 60 人 / 90 Agent = 158 节点）跑帧间隔。
初版中位 33.3ms（30fps）、p95 50ms。逐段计时后发现 JS 只占 ~1.8ms ——
瓶颈在光栅化：逐节点 `shadowBlur` + 逐边模糊在软件光栅（headless / 无 GPU
的窄带云主机）下极贵。

**两处结构性改法**：
| 改法 | 收益 |
| --- | --- |
| 节点光晕 → 预渲染 128×128 径向渐变精灵（按色缓存，`drawImage` 缩放） | 去掉逐帧 `shadowBlur` |
| 背景（底色 + 染色渐变 + 星野）→ 离屏 canvas，每帧只 `drawImage` | 少两次全画布渐变填充 |
| 连线光晕 → 两遍加宽描边（10px@.07 + 5px@.10） | 去掉整层模糊 |

叠加规模降级（>80 节点：连线光晕仅高亮边、数据包每 6 条边、白色短划每 3 条边、
小节点不画外晕、标签只留核心/部门/高亮）：**33.3ms → 16.7ms（60fps）**，
p95 50 → 33.4ms，视觉元素一个没少；小网络视觉不变。

**导出**补齐：此前只导裸画布，现在带标题「军团 · 3D 网络拓扑」、部门/成员/
Agent 计数、导出时间、底部状态图例、`ANet · Legion 3D` 水印（1072×959）。

### 柔化（`d170858`）

admin 反馈「亮线刺眼」后，神明把 PPT 的辉光宽度减半、不透明度降到 ~.3、中段
亮青换成更柔的蓝。3D 页同步收一档：连线光晕 10px@.07 → 6px@.04、实线
2px@.85 → 1.6px@.62、白色短划 alpha .75 → .48、数据包尾巴 .42 → .30、
环上彗星 .62 → .45。

深底亮样本 2127 → 1903（变暗符合预期），浅底不变。要点：柔化只动「装饰层」，
节点白芯 + 彩色描边的对比度保持原样 —— 亮线可以淡，节点不能糊。

### 标签避让与搜索（`2b2e2ba`、`d099542`）

- **标签避让**：158 节点时部门名会在核心附近互相压住。改为统一收集后按
  「核心 > 悬停/选中 > 部门 > 成员」占位，每个标签沿径向外试 12/24/38px
  三档，仍冲突就跳过（宁可少一个名字，不要两行字叠着）。只有 >80 节点才
  给文字垫半透明底衬。
- **搜索**：与 2D 页同口径 —— 命中按名称/子标题匹配，命中节点的子孙一起
  点亮；高亮优先级「搜索 > 选中血脉 > 部门聚焦」；无匹配时明确提示。
- **手机顶部**：加搜索框后，原来绝对定位在 `top-16` 的按钮组正好压住输入框。
  改成 flex 容器，手机竖排「标题 → 搜索 → 按钮」，桌面标题左/按钮右。

## 十二、按部门筛任务（2026-10-26，`153e685`）

客户端能「点部门看这个部门的任务」，Hub 的任务接口只有 `status` /
`from_name` / `to_name` —— 没有 `department_id`。这轮先做不依赖新合同的投影版：

| 层 | 实现 |
| --- | --- |
| 纯函数 `app/lib/dept-task-filter.ts` | alias→人→部门反查、部门子树展开、任务过滤、下拉选项 |
| `/tasks` 过滤行 | 新增「Dept」下拉（缩进表示层级）；状态计数/分布条/列表都基于筛选后的集合 |
| 口径说明 | 「命中数为当前这 N 条任务里的投影结果，不是部门全量」 |
| 空态 | 筛不到时写「这个部门在当前这批任务里没有记录」，不写「该部门没有任务」 |

诚实边界（都写进单测）：
- `members` 落位表是权威，`null` 表示「明确未分配」，**不回退**到
  `person.department` 的旧值；
- 不认识的 alias（离职 / 不在通讯录）一律不算任何部门，宁可显示未归属；
- 筛父部门要带上子部门；
- 兼容路径只给 `from_alias`/`to_alias` 时也能筛出来；
- 通讯录/部门树读不到 → 只是没有下拉框，任务列表照常。

等通信欧确认 Hub 的真实合同（`department_id` 服务端过滤或部门群接口）后，
再把投影换成服务端口径。

### 未归属分组与大网络提示（`7951bfd`、`06d1b6f`）

- **未归属**：部门筛选上线后暴露一个洞 —— 参与者不在通讯录（外部 Agent、
  离职的人）或没分配部门时，这些任务在任何部门筛选下都不出现。现在 Dept
  下拉多一项「未归属（N）」；判定规则是**所有**参与者都落不到部门才算，
  只要有一个能落到部门就不算；字段全空时不算未归属（没信息 ≠ 未分配）。
- **3D 规模提示**：节点 >120 时在底部给一条可关掉的提示（带真实节点数），
  关闭后写 `sessionStorage`，本次会话不再弹。

### 部门任务深链与 3D 聚焦朝向（`faec29e`）

- `/org` 每个部门行加「N 条任务 →」徽标，点进去是 `/tasks?department=<id>`，
  落地即按该部门筛选。计数复用 `dept-task-filter` 的投影口径，只取一页
  任务，所以数字是「当前这批任务里的命中数」—— 写在 title 里，不冒充全量。
  老 Hub 没有部门树时 group id 是合成的，按部门名再兜一层。
- 3D 部门聚焦时镜头转到该扇区：yaw 目标取节点 angle、最短路径缓动，
  用户拖动/按键立即放弃自动对准，取消聚焦也清目标。聚焦不再只是淡化别人。

### 部门筛选可分享 + 3D 聚焦更彻底（`61dd482`、`4bfa508`）

- `/tasks` 的部门筛选写回 URL（`replaceState`，保留其它参数）：刷新不丢、
  可把「某部门的这批任务」直接发给同事；history 被禁用时只是不写 URL。
- 3D 部门聚焦（无选中/搜索时）：命中扇区填充 .22→.26、描边 .5→.55，
  其余扇区 .04→.015 / .08→.03 —— 之前只淡节点，别人的部门扇区还亮着，
  「只留这一个部门」的感觉不彻底。


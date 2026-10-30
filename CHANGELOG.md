# Changelog

All user-facing changes to `@sleep2agi/agent-network-dashboard`.

Format: chronological release notes; each entry lists what *changed for a user* between one release and the next, not per-commit history. Preview versions (`X.Y.Z-preview.N`) are dev-channel iterations and are collapsed under the stable release they feed into.

---

## 0.6.3-preview.122 — 2026-10-30

### Edit participants from the requirement detail

- The detail page lists participants as chips and lets you add people or Agents
  from the same visible directory, remove one, or clear them. The PATCH proxy
  validates and forwards the full `participants` list with the selected network.
- Already-added identities are hidden from the add picker; an unknown
  participant keeps its exact ID and is marked unavailable instead of
  disappearing. Directory failures disable adding only; denied writes keep the
  previous list and show Hub’s reason.

## 0.6.3-preview.121 — 2026-10-30

### Refuse a project catalogue from another network

- Hub preview.215+ echoes the network it actually read. If that echo differs
  from the selected network, the project picker no longer renders the foreign
  catalogue: it is disabled and says which network Hub returned, with retry.
- A missing echo is an older Hub and stays a silent success, so existing
  deployments keep working unchanged.

## 0.6.3-preview.120 — 2026-10-30

### Create requirements from the dashboard

- “新建需求” on `/requirements` opens a dialog for name, priority, status,
  project, tags and description. Hub still owns validation; the dialog only
  shapes the request and names the selected network.
- A successful create closes the dialog, shows the new sequence and refreshes
  the current list/board in place. Server validation, denied writes and network
  errors keep the draft visible with the reason.
- The project catalogue is optional: if it cannot be read, only that field is
  disabled and the requirement can still be created without a project.

## 0.6.3-preview.119 — 2026-10-30

### Move requirement cards between board columns

- Drag a card to another status column to change its column, or use the
  per-card “移动到状态” select (keyboard/touch). Both send only the new column
  with the current `network_id`.
- The card moves immediately; a successful write refreshes silently without a
  skeleton, and a denied or failed write puts the card back in its original
  column with Hub’s reason shown.
- Dropping a card in its current column sends nothing.

## 0.6.3-preview.118 — 2026-10-30

### Requirement board view

- Switch `/requirements` between the list and a status board (需求池 / 进行中 /
  完成 / 已放弃). The choice lives in the URL as `view=board`, survives reload
  and deep links, and does not disturb the existing filters.
- Cards show sequence, priority, due date, tags, archived state, both owners and
  checklist/child counts; clicking a card opens the detail page.
- The board follows the same status, project, tag, text, owner and archive
  filters; selecting a status tab narrows it to that column instead of showing a
  silently unfiltered board.
- Narrow screens scroll the board horizontally without widening the page. Empty
  columns stay visible with an explicit placeholder.

## 0.6.3-preview.117 — 2026-10-30

### Edit owners from the requirement detail

- The detail page can now change the human owner and the responsible Agent
  directly, using the same visible people directory and role semantics as the
  list filter: owner options are people, Agent options are Agents.
- Duplicate names stay distinguishable by ID, and an owner who is no longer in
  the visible directory keeps their exact ID instead of silently becoming
  “unassigned”.
- The write proxy accepts only `owner` (a person or null) and `agent_owner` (an
  Agent or null); wrong roles are rejected before Hub. Directory failures,
  expiries and denied writes disable the controls or show Hub’s error instead of
  pretending the change succeeded.

## 0.6.3-preview.116 — 2026-10-30

### Keep requirement detail in the selected network

- Opening a requirement, its activity timeline, checklist toggles, comments and
  inline edits now name the selected network. A user token that belongs to
  several networks no longer gets `network_id_required` on the detail page.
- Switching networks remounts the detail view, so another network's description
  or timeline cannot stay on screen; a foreign requirement shows Hub's denial.
- Without a resolved network the page shows the standard network notice and
  sends no detail read.

## 0.6.3-preview.115 — 2026-10-30

### Present and record the legion

- “演示模式” hides the interface, cursor and hover tooltips and orbits the 3D legion at a constant speed; Esc or the exit chip restores the page.
- “导出循环” records exactly one 16-second revolution and downloads a 1280×720 seamless loop (mp4 when the browser can encode it, webm otherwise). The camera angle is a pure function of elapsed time, so frame drops cannot drift the loop seam; ornaments freeze during capture so the last frame matches the first.
- Recording progress, cancellation and encoder failures are visible instead of failing silently.

### Find requirements by responsibility

- Filter requirements by a human owner, a responsible Agent or no assignment. “未分配” means both roles are empty; individual empty-role and combined URL conditions remain explicit.
- Search the visible people directory without changing requirement results. Duplicate names retain distinct identities, full labels remain in title attributes, and result rows show human and Agent names separately.
- Responsibility filters combine with project, status, tag and archived searches. Catalog failures, unknown identities and unsupported Hubs have explicit feedback; retries, clearing, history and late-response isolation preserve the selected conditions.

## 0.6.3-preview.113 — 2026-10-28

### Filter requirements by project

- Choose all projects, a specific project or “无项目” in the requirements view. Visible parent paths distinguish projects; selecting a parent matches its own requirements, not its descendants.
- Project selection stays in the URL and combines with status, tags and archived searches. Switching projects starts a new page and ignores late responses from the previous filter.
- Project loading, empty catalogs, permissions and older Hubs have explicit feedback and retry controls. Unknown or archived URL selections retain their exact ID instead of silently switching to all projects.

## 0.6.3-preview.112 — 2026-10-28

### Find archived requirements

- Requirement searches include archived items by default when the Hub advertises archive search. Turn “包含已归档” off to search active items only; the preference is kept in the URL and applies only when a search term is present.
- Archived results have an explicit label. Search status reports the number of loaded rows, and existing status/tag filters and load-more pagination work with the archive option.
- Older Hubs show an explicit availability message. Capability negotiation and delayed pages use the current search generation so stale responses cannot replace a newer filter selection.

## 0.6.3-preview.111 — 2026-10-28

### Node detail shortcuts

- Copy a node's exact alias beside its title, with keyboard access and visible success or clipboard-failure feedback.
- Long node names keep their full alias in a tooltip. The header now uses the shared theme colors and title weight.
- Opening node details no longer lets a delayed chat-input focus interrupt a header action.

## 0.6.3-preview.110 — 2026-10-28

### Clearer platform hierarchy

- Neutral namecard guide lines are distinct from the animated organization connections. The selected department retains its accent-colored guide.
- Node status and the full-roster shortcut use 11px text with bounded line heights, improving desktop readability while preserving compact card layout.

## 0.6.3-preview.109 — 2026-10-28

### Floating Legion conversations

- Conversations in the 3D topology and platform views open in a rounded floating window. Drag the title bar to move it or the lower corner to resize it while keeping the scene usable.
- Collapse a conversation to its title bar and restore it with the current draft and messages intact. The window stays inside the visible area when the viewport or fullscreen state changes.
- Move and resize with arrow keys, return the window to its starting position with Home, and close with Escape. Keyboard focus can return to the scene without closing the conversation.

## 0.6.3-preview.108 — 2026-10-28

### Readable dense platform views

- Platform namecards avoid one another and leave the ANet mark visible. The selected department's card stays readable above platform geometry, including after rotation or panning.
- Dense organizations use compact department cards with a node-name, status and model/runtime preview. Select a department to expand up to six nodes and access the complete roster; tight viewports retain a readable selected summary.
- When the viewport cannot hold every namecard, the view explains how many are not expanded. All department platforms and selector entries remain available, including empty and nested departments.

## 0.6.3-preview.107 — 2026-10-28

### Perspective platforms and node information

- The platform view now opens in perspective 3D. Rotate departments by dragging or using arrow keys, zoom, Shift-drag to pan, locate the selected department and reset with the button or R. The 2D platform remains available from the view switcher.
- Read node names, reported session status, model and runtime directly on each platform. Select a department for its complete searchable roster, exact-node attributes and in-page chat.
- Platforms retain empty and nested departments, connect them with directional light trails and show the official ANet logo in both themes. Light flow can be paused and respects reduced-motion preferences.
- Node-data loading and failures are explicit; a retained snapshot is not presented as live status. Light flow illustrates organization relationships, not task activity.

## 0.6.3-preview.106 — 2026-10-28

### Legion light flow and ANet branding

- Department connections now have luminous channels and continuous directional light trails. Large networks limit decorative effects while keeping department paths prominent.
- Pause light flow independently of camera rotation. Paused lights stay at the same position along a connection when the camera turns or zooms; system reduced-motion preferences are applied live.
- The topology center uses the client's current one-stroke ANet logo, with original dark, light and small-size artwork. Its proportions remain stable as the scene rotates.

## 0.6.3-preview.105 — 2026-10-28

### Scheduled execution history

- Switching schedules or networks, or closing and reopening execution history, keeps late responses from replacing the currently selected records.
- Execution history now shows loading and retryable failures explicitly. Only a successful, validated empty response displays “暂无执行记录”; expired login, permission errors, interrupted connections and invalid responses remain visible as errors.
- Retry and refresh keep keyboard focus on the same control, with a 44px minimum target for history controls.

## 0.6.3-preview.104 — 2026-10-28

### Desktop Legion integration

- The desktop release now integrates the validated Legion 2D, 3D and platform views into main. Platform rosters read every directory page, use independent Agent departments when supported, include unowned Agents and show exact-node attributes.
- Open an Agent conversation inside the 3D or platform scene. History, live events and sending remain bound to the selected network; closing chat keeps the scene's camera and selection.
- Platform parent-child connections, searchable paginated rosters and native fullscreen are available. Long model names keep their status labels visible, and fullscreen controls avoid the server drawer.
- Organization task badges follow the selected network, stale people responses cannot replace the current list, and both task-list clear actions remove all four filters from the URL.
- Main's login-expiry handling is retained, including the legacy nodes-to-status fallback. Empty scoped task/message results stay scoped instead of silently showing another network's data.
- Late task-list responses cannot replace a newly selected network or cleared filter. Task permission denials retain HTTP 403 and show an explicit permission message in the list and inline conversation history.
- Slow task reads are shared by same-scope polls, so a five-second refresh cannot leave the list loading forever. Network switching clears scoped list/projection data while preserving the current filters and navigation state.
- A delayed task retry completion cannot start a refresh for a network or filter that is no longer selected.

### Design-language alignment

- The 3D renderer uses the client's dark surfaces and blue accent alongside its ANet core and label clearance. Accent text and solid-fill foregrounds migrate as a pair, including Provider save and admin task-button hover states.

### Legion 3D framing

- Small networks now fit their nodes and full orbits between the toolbar and legend, including after resizing or restoring controls from clean view.
- Manual rotation keeps its camera position, and mobile members retain their portraits at automatic-fit scales. The scene remains visible when controls leave no room for automatic framing.

### Legion 3D department discs

- Departments use translucent elliptical discs with readable short names. Picking, hover/selection outlines, label clearance and automatic framing follow both axes, including the minimum screen size at distant zoom levels.
- Search clearing, node-list types, the large-member-list hint and copy-link controls use an 11px minimum size.

## 0.6.3-preview.101 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角

- 头像变成「黑长条」：每行头像的背景圆把上一行盖住了（行距小于圆径）。去掉有头像时的
  背景圆、台面加深（150→190）、单台上限 72→48，头像不再互相压。

## 0.6.3-preview.100 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角

- 画布加左右留白（VIEW_W 1470 → 1560，PAD_X 40）：最右一列不再被卡片边缘切掉。

## 0.6.3-preview.99 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角：空部门也上台

- 没有成员的部门以 55% 透明度的空展台呈现（标注 0 人），页头不再写「另有 N 个部门
  暂无成员」——这是组织架构图，空编制也要看得见。

## 0.6.3-preview.98 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角：按部门树分组

- 之前按 `person.department.name` 分组，生产上 13 个部门只剩 2 块展台。现在以 Hub
  部门树 + `members` 映射为准（`person.department` 仅兜底），并在页头标注
  「另有 N 个部门暂无成员」。

## 0.6.3-preview.97 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：深层部门默认淡出

- 生产 13 个部门里二级部门默认只留 12% 透明度，放大到 1.8× 或聚焦/选中时才实心：
  内圈不再叠成一团。

## 0.6.3-preview.96 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团：三层环整体外移

- 部门环 0.56–0.74（原 0.34–0.54）、成员环 0.84（原 0.76）：生产 13 个部门原来全挤在
  顶部一小圈，圆心文字互相压；现在三层在画面上是三个明显的环。

## 0.6.3-preview.95 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：部门多时双层错开

- 生产有 13 个部门，全挤在内层环（0.34）上会互相压、圆心文字叠在一起。
  同层按奇偶交替 +0.11 半径，形成两条细环。

## 0.6.3-preview.94 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：缩放范围放宽

- `MIN_ZOOM/MAX_ZOOM` 0.62–2.4 → **0.25–8**（自动取景在 1.5× 左右时，之前往外只剩 1.6×
  可用，admin 反馈「滚轮能滚动的幅度太少」）。
- 每格滚轮 8% → 12%，滚起来更快；缩放锚点仍是鼠标位置。

## 0.6.3-preview.93 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团：Agent 环均匀铺满整圈

- 之前 Agent 的角度跟各自成员绑定，一个部门占 9/16 人时，它的几百个 Agent 会全挤在
  同一侧（admin 截图里的「半边糊、半边空」）。现在按成员方位排序后**均分整圈**：
  同一成员的 Agent 仍连续，外层三档半径交错。
- 契约测试同步改写：同一 owner 连续 + 相邻间隔 ≈ 2π/n + 半径交错。
- 2D 部门节点描边加深（--border-hover），深色主题下不再像黑块。

## 0.6.3-preview.92 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角

- 台面下加柔光阴影，展台不再像贴纸浮在背景上。

## 0.6.3-preview.91 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：修「缩成一坨」

admin 截图：127 节点却只占中间一小团、抬头显示 240%。根因是取景在数据到位前算过一次
（span≈0 → 被夹到 MAX_ZOOM），入场动画又把「用户已缩放」标记留下，之后再也不重算。

- 入场动画结束后解除保护标记，允许后续重新取景。
- 新增自愈：用户没手动缩放过时，每 ~1 秒检查内容包围盒，占画面不到 35% 就重新取景。

## 0.6.3-preview.90 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 · 平台视角（`/legion/plaza`）

- 新增「展台」视图：每个部门一块带厚度的 3D 台面，成员与名下 Agent 的头像按网格
  排在台面上，部门名挂在台面前沿；越靠后的行整体缩小，形成纵深。
- 台面显示上限 72 个头像（超出不画，避免单块台面糊成一片）。
- 入口：`/legion` 与 `/legion/3d` 头部「平台视角」；`smoke:routes` 已纳入该路由。

## 0.6.3-preview.89 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：不再有大片空白圆

- 部门圆心写短名（半径 ≥11px 写 2 字，≥20px 写 3 字）：之前部门是纯白圆，
  远看一排「白饼」。
- 没有头像的成员画首字母兜底；成员头像阈值 7px → 5.5px、Agent 5px → 4.5px，
  减少「本该有头像却是白的」。

## 0.6.3-preview.88 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D：悬停与命中修复

- **悬停从来没生效过**：`onPointerMove` 一上来要求「指针已在按下登记表里」，导致光标不变、
  悬停高亮不亮、提示框不出。改为只区分按下/未按下。
- **大节点点不中**：命中半径固定在 16–18px，核心/部门直径 40–60px，属于「看得见、点不着」。
  `hitTest()` 新增可选 `radiusOf`，页面按 `世界半径 × 透视缩放 + 6` 判定。
- 新增悬停提示：鼠标停留显示「名字 · 状态」，不点也能认人。

## 0.6.3-preview.87 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团：成员/Agent 显示头像

- 3D 与 2D 的成员节点改为头像（同一套解析链：Hub avatar_url → localStorage
  → `public/avatars/manifest.json` 池 → 首字母兜底）；Agent 节点在半径 ≥5px 时也换头像。
- 修 `getAvatarUrl()`：非 hook 调用（canvas 渲染循环）之前不会触发 manifest 拉取，
  所以军团图永远拿不到默认头像池；现在它会自己触发一次。
- 2D 订阅 `useAvatarsVersion()`，manifest 到位后重渲染 SVG（否则图里没有 `<image>`）。

## 0.6.3-preview.86 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团：默认视图去掉标签堆叠

- 部门名默认只画**扇区最宽的那一个**（生产里是 TMWork）；其余部门名在悬停、选中、
  放大到 1.25× 以上，或点图例聚焦时出现。12 个部门的名字同时画，必然糊成一团。
- 内层部门环外移（0.26 → 0.34），深一层部门节点缩小（0.05 → 0.036 世界半径）：
  6 个一级部门不再互相叠住。

## 0.6.3-preview.85 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团：修「简直不能看」（生产形状下节点挤成一坨、部门名叠在中心）

- Agent 扇形上限 0.2 → **0.42 弧度**，并改**三圈半径交错**（1 / 0.9 / 0.82）：
  生产里一个人名下 20–40 个 Agent，原参数会挤成一个球。
- 部门扇区下限 0.22 → **0.45 弧度**：内层环半径只有 0.26，6 个一级部门原来会互相叠住。
- 3D 部门标签只在**扇区够宽（≥0.28 rad）**或悬停/选中/放大时出现；
  窄扇区的小部门不再把名字压到邻居身上。

## 0.6.3-preview.84 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D

- 两层部门树时，二级组的名字默认不画（放大到约 1.3×、选中或悬停才出）：生产形状是
  4 个一级 + 8 个二级，所有名字都画会挤成一团；一级部门始终保留。
- 标签避让优先级按部门层级：一级（2）> 二级（2.5）> 成员/Agent（3）。

## 0.6.3-preview.83 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 2D

- 人多的网络（>60 人）把成员点收小到 0.72：100 个 16px 圆挤在同一圈会连成一条白带，
  收小之后能看出「一个个的人」，和 3D 的 crowd 缩放同一套思路。

## 0.6.3-preview.82 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 运维

- 新增 `GET /api/health`（免登录）：返回 `{ ok, version, commit, uptimeSec }`。
  发布后不用再从 `/login` 的 HTML 里 grep 版本；监控/脚本可直接读 JSON。
- `verify-prod` 增加健康检查项（版本 + 构建提交），现有 8 项。

## 0.6.3-preview.81 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 可访问性

- 3D 图例（状态筛选）在 DOM 里提前到节点列表之前：从「跳到主内容」出发，**11 次 Tab**
  就能摸到并回车切换（之前 32 次）。视觉位置不变（绝对定位）。
- 冒烟新增「键盘可从主内容摸到状态筛选」，当前 32/32。

## 0.6.3-preview.80 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 测试

- 新增 `scripts/bench-legion.mjs`（`npm run bench:legion`）：408 节点下测静止 / 拖动 /
  缩放三段的 fps 与 p50/p95 帧间隔，作为渲染路径改动的相对回归基线。
  headless 软件光栅环境实测 **30–39fps（p95 33–50ms）**；真实 GPU 浏览器更高，
  这组数字只用于同机对比，不对外宣称 60fps。
- 支持 `STORAGE_STATE` 复用已登录 cookie，避免登录限流（10 次/15 分钟）打断批量体检。

## 0.6.3-preview.79 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团

- 状态筛选写进页头与导出图：抬头显示「仅显示 运行中」，导出 PNG 的副标题同样带上，
  截图/分享出去不用再靠人记忆当时筛了什么。
- 冒烟里「2D 列表回车打开」加了重试：SWR 每 30s 刷新会重建列表并丢焦点，偶发不过。

## 0.6.3-preview.78 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 修复

- **`/settings` 在浅色主题下 hydration 不匹配**：主题选择器在首帧直接读
  `localStorage`（服务端渲染 cyber、客户端首帧 light），React 判定不一致并整棵树重渲染。
  改为首帧固定 cyber，挂载后再同步真实选择。

### 测试

- 新增 `scripts/smoke-routes.mjs`（`npm run smoke:routes`）：18 条路由 × 2 套主题，
  断言 200/307、无 pageerror、无异常子资源、无 error boundary；带 stub 已知端点豁免。
  首次运行就抓到上面的 hydration 问题。

## 0.6.3-preview.77 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团

- 图例带数量：运行中 / 空闲 / 阻塞 / 错误 / 未上报，一眼知道「现在几个在跑」。
- 3D 新增「未上报」档（无 session 的 Agent 不再被算成空闲）：与 2D 的口径一致，
  合计等于 Agent 总数（冒烟断言守住）。

## 0.6.3-preview.76 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 2D

- 图例同样可点筛选（运行中 / 空闲 / 离线 · 未上报），未命中的 Agent 压到 0.18；
  与 3D 同口径，`Esc` 清除。2D 的 Esc 单独挂了监听（主键盘处理器与全站 Esc 抢事件，
  实测收不到）。

## 0.6.3-preview.75 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D

- **图例即筛选**：点「运行中 / 空闲 / 阻塞 / 错误」只看该状态的 Agent，其余压暗
  （部门与成员保持可见作为背景），再点取消，`Esc` 也能清。用于回答「现在谁在跑」。

## 0.6.3-preview.74 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 主题

- 首帧脚本补齐 Slack 皮肤：`slack` 在 hydration 前就设好 `data-theme=light` +
  `data-skin=slack`，不再先闪一下普通浅色。
- `<html>` 加 `suppressHydrationWarning`：pre-paint 脚本会改 `data-theme`，
  React 之前会报 hydration 不匹配（浅色/Slack 用户每个页面一条）。
- 冒烟新增「主题在 hydration 前生效且无 hydration 警告」，当前 28/28。

## 0.6.3-preview.73 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 聊天面板 / 令牌 / 用户资料

- `TaskChatPanel`、`ProviderFormModal`、`UserBar`、`/settings/tokens` 的写死颜色 → token。
  聊天面板原先用 cyan 作强调色，现与全站同一套 `--accent`（深色主题紫、浅色主题青）。
- 实心 accent 按钮统一 `--accent-fg`，hover 用透明度（原来 hover 写成同一个 accent，等于没有反馈）。
- 硬编码颜色类 **170 → 137**（累计 349 → 137，−61%）。

## 0.6.3-preview.72 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D

- **入场镜头**：第一次打开 `/legion/3d` 时，拓扑从 62% 缓动推近到取景比例（约 0.9 秒），
  再进入自转。尊重 `prefers-reduced-motion`，同一会话只播一次；任何拖动/滚轮会立刻接管。
- 取景修两处「先跳错再跳回」：画布尺寸没量到之前不取景（曾算出 240% 再跳回 151%）；
  只有 core 时（成员/Agent 都是 0）不取景，等数据到位再算。

## 0.6.3-preview.71 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 构建

- **字体改为自托管**：`Geist` / `Geist Mono` 的 latin 子集（可变字重 100–900）放进
  `app/fonts/`，用 `next/font/local` 加载。之前走 `next/font/google`，构建必须访问
  `fonts.googleapis.com` + `fonts.gstatic.com`；本机 DNS 把 gstatic 指到不可达 IP 时
  `next build` 直接失败（今天为了构建绕了两次本地代理）。现在 `npm run build`
  不依赖外网，离线也能出包，产物与线上用同一份字体文件。

## 0.6.3-preview.70 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 修复

- **`/settings/networks` 整页崩溃**：`AliasAvatar` 的 `aliasAvatarColors()` 直接读
  `alias.length`，遇到缺 `name` 的网络条目就抛错，整页只剩 “This page couldn't load”。
  现在缺名字只画占位，不再打崩整页。
- `NodeAttrsEditor` 的正则里是字面控制字符（文件被 git 当 binary），改成
  `\u0000-\u001f\u007f` 转义。

### 主题一致性

- `TaskChatPanel`、`/settings/networks`、`LoadingSkeleton`、`NodeAttrsEditor` 的写死颜色
  → 主题 token；硬编码颜色类 **207 → 170**（累计 349 → 170，−51%）。

## 0.6.3-preview.69 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 任务 / 消息 / 建节点向导

- `TaskDetail`、`TaskDrawer`、`/messages`、`CreateNodeWizard` 的写死颜色换主题 token。
- 顺手修主按钮文字色：实心 accent/success 底上用 `--accent-fg`（原来在浅色主题下是
  深色字压深色底）；建节点向导的「下一步 / 创建节点 / 返回修改」一并统一。
- 硬编码颜色类 **262 → 207**（累计 349 → 207，−41%）。

## 0.6.3-preview.68 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### Admin / 侧栏

- `/admin` 与 `Sidebar` 的写死颜色换成主题 token（`--bg*`、`--border`、`--fg*`、
  `--accent*`、语义色）；浅色主题下侧栏与页头不再残留深色块。
- 硬编码颜色类 **311 → 262**（两轮共 349 → 262，降 25%），基线同步收紧。

## 0.6.3-preview.67 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 节点设置抽屉

- 颜色全部改走主题 token（`--bg/--bg-secondary/--bg-elevated/--border/--fg/--fg-muted/--fg-dim`
  与 `--accent/--accent-fg/--success/--warning/--danger`）：之前写死 `#161618`/`#26262b`/
  `gray-500..600`，浅色主题下抽屉仍是深色块，与页面割裂。
- 硬编码颜色类 **349 → 311**（color-ratchet 基线同步收紧，只降不升）。

## 0.6.3-preview.66 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 2D

- 图例改中文（运行中 / 空闲 / 离线 · 未上报）：之前页面上是 working/idle/offline，
  导出图却是中文，同一张图两套说法。
- 详情卡「复制」→「复制链接」：和 3D 一致，复制的是 `…/legion?node=<名字>`。

## 0.6.3-preview.65 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 2D

- 新增**净屏**：隐藏头部与右侧面板，只留环图，`Esc` 恢复（与 3D 同口径）。
- 人环描边改用 `--fg`：与 3D 的「人环亮、Agent 环淡」一致；之前用 `--border-hover`，
  100 人时内圈是一圈黑点，看不出「人」这一层。

### 门禁

- 新增 `check-no-build-artifacts`：被 git 跟踪的路径里不允许出现 `.next*` /
  `node_modules` 等构建产物（2026-10-27 那次「`.next.prev-*` 进仓库导致构建失败」的防回归）。

## 0.6.3-preview.64 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 2D

- 新增全屏：把整页（含头部按钮）铺满视口，2D 环图跟着放大，会议室投屏用；再点退出。
- 坑：全屏只包住画布时，头部按钮不在全屏元素里 → 进去就出不来；改成全屏页面根。

## 0.6.3-preview.63 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D

- 新增**净屏**：一键隐藏标题、按钮、图例、提示与详情卡，只留拓扑 —— 截屏与做 PPT 用；
  `Esc` 或再点一次恢复（净屏期间按钮不可见，所以退出键挂在 window 上，不依赖焦点）。
- 速查表补 `F`（全屏）与「净屏」两行，键盘用户不用猜。

## 0.6.3-preview.62 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**）。

### 军团 3D

- 新增全屏演示：按钮或 `F` 键把拓扑铺满整个屏幕（只剩画布、标题、图例），
  适合会议室投屏与 PPT 取材；再点一次或 `Esc` 退出。全屏时画布随视口重新取景。

## 0.6.3-preview.61 — 2026-10-27

从 `fix/1636-requirements-load-more` 分支构建（**未合并进 main**，本条目在合并后应折叠进下一个稳定版）。

### 军团（Legion）

- 新增 `/legion`（2D 同心环）与 `/legion/3d`（Canvas 3D 网络拓扑）：部门树任意层级、折叠/展开、血脉高亮、部门聚焦、缩放平移、导出 PNG（标题/图例/时间）。
- 3D：星野/部门扇区/地面网格/核心呼吸/双向数据包/环上彗星/深度雾化；拖动、滚轮、双指、键盘、双击、`/` 搜索、`R` 重置；>80 / >250 节点两档降级，408 节点交互仍 60fps。
- 自动取景：首屏/重置/结构变化时按投影包围盒取景 82%（手机 82%），408 节点不再被裁掉。
- 深链：`?focus=<部门名>`、`?node=<名字>` 两页同口径，聚焦/选中写回地址；详情卡「复制链接」复制可直接发给别人的地址。
- 明度分层：人环 `--fg`、Agent 环 `--fg-muted`，不新增颜色。

### 可访问性与一致性

- 全站 skip link「跳到主内容」；`:focus-visible` 可见焦点；键盘可达军团两页（8 次 Tab + 4 次按键到部门详情）。
- 对比度：`--fg-dim` 深/浅、浅色语义色全部提到 AA；四道纯 Node 门禁（color-ratchet / avatars / token-contrast / accent-text-ratchet）。
- 主题化：Tasks / SkillHub / Servers / Providers / 设置 / 节点列表与详情 / 聊天面板 / 首页 KPI / 定时任务去装饰描边，颜色只走 token。

### 任务与组织

- `/tasks` 按部门筛选（通讯录投影，UI 标注「当前这批任务里的命中数」）；`/org` 真实部门树缩进、`?focus=` 深链、默认折叠与搜索全量过滤。

## 0.6.3 — 2026-07-31

**156 commits across 51 previews (0.6.3-preview.0 … 0.6.3-preview.52), plus 2 skipped preview minors (0.6.1, 0.6.2 — never had a stable release, all their preview.N was folded into 0.6.3).**

If you install from `latest` on npm, this is the first stable version after 0.6.0 (2026-06-04). Everything below arrived in that window.

### Layout — dashboard is now a three-pane app

- **Persistent node list rail on `/nodes`** — the left column stays put as you switch between agents; no more full page redraw when you click a node.
- **Persistent chat pane** — the middle/right column keeps the conversation open across nav, `/nodes/[alias]` deep links you straight into that agent's chat.
- **Selected node = list + chat, the wide table yields** — when you pick an agent, the table view collapses to leave room for the conversation.
- **Third sidebar mode: 56px icon rail (Feishu-style)** — new default. Was previously "expanded" or "hidden"; the icon rail keeps navigation reachable without eating horizontal space. `Sidebar` remembers your last choice.
- **Per-column scrolling** — each of the three columns scrolls independently; no more the whole page moving when you scroll one list.
- **Layered background colors across the three columns** — SPEC §2 palette, easier to tell columns apart at a glance.
- **`/nodes` opens straight into a conversation** — the first available agent's chat is pre-selected, so a fresh visit is one click closer to sending a message.

### Search — pinyin everywhere

- **Top-of-rail search on `/nodes`** — filter the node list as you type.
- **Pinyin match on Chinese names** — typing `zhangsan` finds `张三`; the same matcher powers `/nodes` search, `/messages` search, and chat `@` mentions (one shared implementation, so behavior is identical across surfaces).
- **`Cmd/Ctrl+F` inside an open chat** opens a search box that scrolls to the matching bubble.
- **Filter `/nodes` by team + tag** (AND semantics) with distinct empty states so "no matches" and "no data yet" look different.

### Chat — the conversation surface is much closer to WeChat/Feishu

- **Right-click menu on a conversation** (pin, mute, mark read, quick actions).
- **Keyboard navigation** — up/down arrows walk the conversation list.
- **Settings drawer** reachable directly from the chat header.
- **Send feedback loop**: in-flight spinner while a message is going out, click-to-resend on failure (tap-to-resend on touch), red banner with human-readable failure reason.
- **Send failures translate hub status codes into human labels** — you see "对方节点离线，稍后重试" instead of `sse_delivery_failed`.
- **Live incoming messages while a chat panel is idle** — no need to refocus to receive.
- **WeChat-style time grouping** — separators between bubble clusters instead of a stamp under every bubble; one shared time formatter across chat + `/messages` dividers.
- **Chat images**: click to open lightbox, multi-image navigation (arrows), loading + error states.
- **Videos and images inline** — server-side attachments render in-place instead of showing as "file" links; layout picks inline vs attachment card by mime, never accidentally inlines something dangerous.
- **Attachment upload**: progress indicator (`上传图片 k/n…`), Bearer-safe download proxy, error copy no longer prefixed with `network error:`. Failed uploads can be retried and will re-upload the images (a resend-loss bug fixed).
- **Per-conversation drafts persist** — `[草稿]` marker on the conversation in the list; typing continues where you left off.
- **New-message pill** floats above the composer when messages arrive while you're scrolled up.
- **In-conversation search** (`Cmd/Ctrl+F`, see above) — scrolls the matching bubble into view.
- **Long messages collapse** into a "show more" preview so the pane doesn't get eaten by a wall of text.
- **`@` mentions**: pinyin typeahead + keyboard navigation to pick a target.
- **Copy button** on each message bubble.
- **Composer refocuses** when you return to the tab.

### Conversation list (nudged toward WeChat semantics)

- **Pinned conversations** (`micro-⌘⇧P` or right-click) sort to the top and stay there.
- **Per-conversation mute** with a bell-slash indicator in the chat header + CommandCenter tab; muted conversations don't emit unread badges.
- **Unread count badges** on each conversation with a `(N)` mirror in the browser tab title.
- **Favicon red-dot** while unreads exist — visible even when the tab isn't focused.
- **Presence in chat header + CommandCenter tab dot** — see at a glance whether the agent you're talking to is online.
- **Opened-conversation sort by recency**, WeChat-style — the one you just messaged rises to the top; unopened order stays alphabetical.
- **Working-state demoted to a badge** in a "quiet grid" view (unchanged from busy view — this is the compact card mode).

### `/tasks` and `/messages`

- **`/tasks` is now a two-column list + detail layout** (Feishu-style). Deep links preserve which task is open.
- **`/messages` visual alignment with the chat pane** — matches SPEC §2/§5/§6 so it feels like the same app, not a different tool.

### Mobile

- **Two-level navigation for phone form** — list page ⇄ chat page, like Feishu's phone client. No more trying to fit three columns onto a 375px screen.
- **Chat manners**: Enter inserts newline on touch (not send — send is via the button), 44px minimum tap targets.

### Node management

- **`/nodes` node-attrs editor** — set/edit `display_name`, `team`, `tags` on a node from a modal.
- **Symmetric pin-attachment display** — pinned attachment renders consistently across chat vs. detail views.
- **Node lifecycle UI**: stop / delete / restart from the node card, with optimistic-then-ack transitions and a toast when the ack lands.
- **Rename entry** with lifecycle capability gating (won't offer the option if the node isn't in a renamable state).
- **Node settings panel** with a `⋮` menu, model + flags wired to the real form, "apply" triggers the actual lifecycle path (not just a UI toggle).
- **Removed dead UI**: the old "重命名 / 停止 / 删除" tiles that never worked.

### Model providers (RFC-028)

- **Providers CRUD in a dedicated left-nav entry** — create/edit/delete providers with the RFC-028 reachability matrix visible.
- **Preset catalog**: DeepSeek / MiniMax / GLM / Claude presets with key-only create (paste your key, the rest is filled).
- **Node-create wizard filters runtimes** by what the target host's daemon actually supports (`daemon.runtimes_supported`) — no more picking `codex-sdk` on a host that can't run it.
- **Wizard picks a sensible default model** so hitting Enter without picking one doesn't 400 at the hub.

### Topology view

- **20px node illustrations** on the topology graph.
- **Hover-detail card** now un-gated; hover any node to see who/what it is.
- **Illustrated avatars on the graph** when a node's rendered diameter ≥ 48px (design-owned pool of 20 WebP images at 256px, stable hash assignment).

### Custom avatars

- Design-owned illustration pool of 20 avatars; `_pool` manifest with stable hash-based assignment (same alias always gets the same face). Zero-friction handoff — the design team drops WebPs and the checker script verifies them.

### Reliability & performance

- **Build-on-deploy guard**: the container refuses to serve a stale `.next` build; catches the load-timeout that "chunk 500s" symptom pointed at.
- **Chat history retry ladder + graceful degrade** on slow transport — the panel gives up cleanly instead of hanging a spinner forever.
- **Shared SSE channel** — one `EventSource` per URL app-wide (was one per component using it).
- **Content-visibility on the agent grid** — 192-card grid uses native lazy render.
- **Memoized AgentCard** — re-render storm on the grid dropped from ~1920 to ~28 per 30s (−98.5%).
- **Only the visible chat tab polls** — background tabs sit quiet (16 → 4 fetches/min at 4 tabs open).
- **60s presence hysteresis** — an agent doesn't flap between "online" and "offline" from one missed heartbeat.
- **P0 fix**: dashboard was dropping `network_id` on send paths — messages didn't reach the intended agent. Every send path now threads `network_id`.
- **P0 fix**: `/health` and `/api/*` proxies pass through `?network_id=` and `&skip_stats=1` where the hub requires them (previously stripped, made SSE proxy silently useless under utok_ auth).
- **P0 fix**: default theme back to `classic dark` after a preview that shipped Slack Light broke muscle memory. The Slack Light skin stays available in Settings.

### Deprecated / removed

- **DispatchPanel** (183 LOC) — dead component removed as part of the #217 simplification sweep.
- **Old node-settings UI tiles** (see "Node management" above) that were never wired.

---

## 🔴 Upgrade notes (0.6.0 → 0.6.3)

**Session cookies are compatible.** The dashboard session cookie format (`v3:<token>`, where `<token>` starts with `atok_` / `utok_` / `ntok_`) is unchanged between 0.6.0 and 0.6.3 — the read logic on both versions is byte-identical when you diff them. **Users logged in on 0.6.0 stay logged in after upgrading.**

If, after upgrading, opening the dashboard behaves oddly (redirect loop, half-loaded pages, `/login` when you shouldn't be there):

> **Clear your dashboard cookies and log in again.** That is the only known recovery path, and it always works. No data loss — your account, network memberships, node history, and message history live server-side.

*Scope of this claim*: verified by static comparison of the two versions' auth code (byte-identical `v3:` prefix + `atok_/utok_/ntok_` shape checks + length gate) and by curl probes against 0.6.3 with several malformed cookie shapes — all landed at `/login` cleanly, no half-authenticated state observed. **Not verified with a live browser session** — multi-hop redirects, CSRF token refresh, and SSE reconnect carrying old cookies are outside what curl covers. Report anything that doesn't match the above and we'll dig in.

### New runtime dependency

`pinyin-pro ^3.28.1` was added (powers the pinyin matcher used across search + `@` mentions). Adds roughly 316–564 KB to the shipped bundle (minified, before gzip); mostly affects first-page-load size, not subsequent navigation.

### No breaking changes to configuration

- **No new required environment variables.**
- **No config-file schema changes.**
- **No database or cache migration** — the dashboard is stateless; state lives at the hub.
- **CLI entry point unchanged** (`agent-network-dashboard`, from `apps/desktop/electron/main.cjs`).

---

## 0.6.0 — 2026-06-04

Formal release after 27 rounds of the #217 simplification sweep. See git history for the full delta from 0.5.x.

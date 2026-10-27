# Changelog

All user-facing changes to `@sleep2agi/agent-network-dashboard`.

Format: chronological release notes; each entry lists what *changed for a user* between one release and the next, not per-commit history. Preview versions (`X.Y.Z-preview.N`) are dev-channel iterations and are collapsed under the stable release they feed into.

---

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

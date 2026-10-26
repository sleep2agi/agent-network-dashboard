# 写死的「文字色」清单（2026-10-27）

## 为什么有这份清单

主题化之后，文字色应该走 `--fg` / `--fg-muted` / `--fg-dim` / `--accent-text`
这些 token。但组件里仍有一批写死的 Tailwind 文字色（`text-cyan-300` 之类）：

- 深色主题下它们看着没问题；
- 浅色主题下，其中一部分在浅底上对比度不够（`a11y:contrast` 只扫了 12 个
  页面，任务详情、弹层、图例这些不在清单里的位置还没覆盖到）。

一次性全改风险大（`TopoGraph` / `Sidebar` / `TaskChatPanel` 都不在本节点
独占的文件里），所以先上**棘轮**：`scripts/check-accent-text-ratchet.mjs`
记录每个文件的当前数量做基线，**新增就红**，改少提示收紧。

```bash
npm run gates                                  # 含 accent-text-ratchet
node scripts/check-accent-text-ratchet.mjs --update   # 改少了以后收紧基线
```

## 当前基线（126 处 / 27 个文件，2026-10-27 第一批迁移后）

| 文件 | 数量 |
| --- | --- |
| `app/components/TaskChatPanel.tsx` | 17 |
| `app/components/TopoGraph.tsx` | 14 |
| `app/components/Sidebar.tsx` | 8 |
| `app/login/page.tsx` | 7 |
| `app/components/HostSupervisorPicker.tsx` | 7 |
| `app/components/AttachmentBlock.tsx` | 6 |
| `app/components/EmptyState.tsx` | 6 |
| `app/nodes/NodesView.tsx` | 5 |
| `app/admin/page.tsx` | 4 |
| `app/components/AgentCard.tsx` | 3 |
| `app/components/CreateNodeWizard.tsx` | 3 |
| 其余 13 个文件 | 各 1–2 |

已迁移完：`/messages`、`/node`、`/`（12 处），基线从 138 → 126。

## 迁移指引

1. **当强调色/链接**：`text-cyan-300` / `text-cyan-400` → `text-[var(--accent-text)]`。
2. **当状态色**：用语义 token —— `--success` / `--warning` / `--danger` / `--info`
   （它们已经按主题调过对比度，见 `check-token-contrast.mjs`）。
3. **确实只在深色固定面板里出现**（例如永远深底的聊天气泡内部）：可以保留，
   但要在代码注释里写清「这里永远是深底」，否则下一个人会当 bug 修。
4. 迁移后跑 `node scripts/check-accent-text-ratchet.mjs --update` 收紧基线，
   免得以后又涨回去。

## 建议顺序

优先覆盖「会被 a11y:contrast 扫到的页面」：`/messages`、`/node`、`/`；
其次 `/login`（未登录用户的第一屏）；`TaskChatPanel` / `TopoGraph` 属于
共享组件，等各自 owner 排期一起做，不在本节点单方面改。

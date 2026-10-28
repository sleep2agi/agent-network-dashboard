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

## 当前基线（119 处 / 26 个文件，2026-10-27）

| 文件 | 数量 |
| --- | --- |
| `app/components/TaskChatPanel.tsx` | 17 |
| `app/components/TopoGraph.tsx` | 14 |
| `app/components/Sidebar.tsx` | 8 |
| `app/components/HostSupervisorPicker.tsx` | 7 |
| `app/components/AttachmentBlock.tsx` | 6 |
| `app/components/EmptyState.tsx` | 6 |
| `app/nodes/NodesView.tsx` | 5 |
| `app/admin/page.tsx` | 4 |
| `app/components/AgentCard.tsx` | 3 |
| `app/components/CreateNodeWizard.tsx` | 3 |
| 其余 13 个文件 | 各 1–2 |

已迁移完：`/messages`、`/node`、`/`（12 处）；`app/login/page.tsx` 已从扫描中
豁免（固定深色品牌屏，颜色写死是有意的），基线从 138 → 126 → 119。

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

## 固定深色屏白名单

`check-accent-text-ratchet.mjs` 里有一个 `EXEMPT` 集合，目前只有 `app/login/page.tsx`。
加白名单不是「懒得改」，必须同时满足三条：

1. 这个屏**不跟随主题**（背景、卡片、文字全写死，切到浅色主题也不会变）；
2. 写死色是**品牌标记/装饰**（SVG 图标、logo），不是需要阅读的正文；
3. 在文件里写明「为什么这里写死是有意的」，防止下一个人当 bug 修。

反例（不要豁免）：`/messages` 里的类型徽章、`/node` 的 tab 选中态 —— 它们
跟随主题，浅色下必须换色，这种就该迁移成 token。

新增白名单时同时更新本清单，并在 PR 描述里写一句「为什么它不跟随主题」。


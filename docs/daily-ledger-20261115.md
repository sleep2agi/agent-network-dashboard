# Dashboard 台账 · 2026-11-15

本文件记录 `.563` 发布与当日两条**判据级教训**。数字全部来自实际运行输出，未估算。

---

## 1. 发布：`0.6.4-preview.563`

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.563` |
| commit | `cd813d89d739231782d37752cfa653d398a06579` |
| buildId | `b1gdZ41FrqS-7hoebDwL5` |
| 内容 | i18n 第 1 批：`/node` 11 处 + `/nodes` 9 处文案中文化（逻辑零改动） |
| 回退锚点 | `preview.562-d9617ad`（`d9617ad` / `KMN3cdgAFRMO78qMIVkzD`） |
| pm2 状态 | `restart_time 0` · `unstable_restarts 0` · `neighborsExcluded: commhub-hub` |

### 证据链（全部实际运行）
```
① 干净 worktree 构建 + 20 套件     PASS 20/20
   legion 272 · pageSmoke 47 · nodesKbd 14 · detail 115 · board 171 · responsibility 88
   project 82 · archive 70 · network 54 · planHealth 44 · contrast 31 · tagOps 26
   chat 24 · recording 23 · mine 23 · tags 22 · timeline 21 · summary 19 · create 13 · hydration 7
② CI                               4/4 success（同 SHA）
③ 发布后自检                       4/4 PASS（版本/commit/cwd/evidence 路径与线上一致）
④ health-all                       14/14 PASS
⑤ legion-verify-all                6/6 PASS
   drift-clip · label-drop · pitch-param · visual-spotcheck · projector · site-scroll
⑥ 线上文案探针                     I18N-NODE: PASS（外壳 0 残留）
```

---

## 2. 判据教训 A：本地 dev 渲染不能作为"文案是否改成功"的依据

**发生**：改完 `/node`、`/nodes` 20 处文案后，本地 dev 页面仍显示英文原串。
连续两次误判为"改动没生效"。

**排查**：
```
源码全仓 grep（排除 node_modules / .next）  0 命中
重启 dev（3106 → 3108）                     仍显示英文
清 .next/cache 后仍未复测即转入生产路径
生产构建产物 .next 里该串只 5 处，全部在 changelog 产物（.563 发版说明的对照表）
```

**结论**：Turbopack 开发态缓存会给出陈旧渲染；跨重启仍可能复用缓存。

**判据（已落地）**：
1. 文案类改动的本地证据 = **源码 grep（0 命中）**，不是页面渲染。
2. 需要页面证据时，用**生产构建**（`releases/preview.*` 或线上），不用 dev。
3. dev 页面上的异常现象，在源码 grep 与生产产物都反驳时，**先判定为环境问题**，不做代码改动。

---

## 3. 判据教训 B：含对话内容的页面不能做"全文英文扫描"

**发生**：线上探针在 `/node?alias=通信Dash欧` 报 16 处英文残留，`/nodes` 报 0。

**定位**（TreeWalker 找文本节点 + 打印祖先链）：
```
td.px-2.py-1.border ← tr ← tbody ← table.w-full ← div.my-2.overflow-x-auto
  ← div.break-words.leading-relaxed      （markdown 消息正文）
文本值："Tap to chat / Current task / Status"
```

**结论**：命中的是**我自己在汇报里写的对照表**，被 markdown 渲染在对话气泡内。
`innerText` 里英文与中文以 Tab 分隔成对出现，正是表格单元格的分隔符——这个特征本身就是"表格内容"的指纹。

**判据（已落地到 `evidence/probes/i18n-node-nodes.mjs`）**：
1. 探针必须先输出**实际 URL**，证明量的是目标页（此前曾把 `/login` 当目标页量）。
2. 扫描前剔除 `.leading-relaxed` / `.prose` / `pre` / `code` / `blockquote` 这些 markdown 渲染区。
3. 只对"页面外壳与控件"计数；对话正文、发版说明属于用户/agent 内容，不是 UI 文案。
4. 出现"英文与中文成对相邻"时，先怀疑是表格/对照表内容，再怀疑产品残留。

---

## 4. 当前线上基线

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.563` / `cd813d89` |
| 健康门 | 14/14 |
| 军团探针 | 6/6 |
| 套件 | 20/20 |
| 中文覆盖 | `/nodes` 外壳 1889 字、`/node` 外壳 1296 字，英文残留 0 |

---

## 5. 待决（需要用户一句话）

| 决策 | 建议默认 | 不定则 |
|---|---|---|
| 技术名词白名单（API / Provider / Model / Hub / Session / Token / Node / Agent 是否保留英文） | 保留英文，其余中文化 | 剩余 78 条 i18n 只能逐批请示 |
| 3D 俯角 pitch | 49°（现状） | 无法定型，只能保留现状 |
| 核心展示风格 | 混合（现状） | `ticks` 会丢核心数字，不宜为默认 |
| 操作提示条 | 常显（现状） | 无法定型 |
| 2D 入口 | 现入口（现状） | 不做画布重写 |
| 残留 #12（1280/1366 头部 115px vs 1920 99px） | 继续用 DOM 枚举法定位 | 约 32px 差异，零溢出、无功能影响 |

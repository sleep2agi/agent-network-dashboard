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

---

## 6. 发布：`0.6.4-preview.564`（界面语言统一，72 处）

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.564` |
| commit | `4f39767a7baaa22102eaa16e33ad2085d4d1edd5` |
| buildId | `9Q2Ysasn49mmopQOFpIf1` |
| 内容 | i18n 第 2–4 批：侧栏 12 · 设置页 16 · 管理台 8 · 任务/需求主标题 2 · 概览统计与过滤 11 · 退出登录 4 处 |
| 回退锚点 | `preview.563-cd813d8`（`cd813d8` / `b1gdZ41FrqS-7hoebDwL5`） |
| 术语白名单 | Hub / Token / Session / SSE / URL / API / Provider / Model / Node / Agent / Cookie 保留英文 |

### 证据链
```
① 干净 worktree 构建 + 20 套件   PASS 20/20（legion 272 · pageSmoke 47 · nodesKbd 14 · network 54）
② CI                            3 success + 1 合规 skipped:paths-filter（docs-only 提交未触发 gates）
③ 发布后自检                    4/4 PASS（版本/commit/cwd/evidence 路径与线上一致）
④ health-all                    14/14 PASS（随后扩为 15 门）
⑤ legion-verify-all             6/6 PASS
⑥ 线上文案门（新）              I18N-UI PASS — 7 页 × 49 词，0 残留
   /  /nodes  /tasks  /requirements  /settings  /admin  /legion/3d
```

### 关键改动位置（易漏点）
- 设置页文案**不在** `app/settings/page.tsx`，而在 `app/lib/settings-model.ts`（分组标签、8 张资源卡、主题名）。
- 侧栏导航文案在 `app/components/Sidebar.tsx` 的 `NAV_ITEMS` 数组。
- 「退出登录」一个概念在 **4 处**各写一遍：侧栏底部、设置页账号组、顶部 `UserBar`、命令面板。

---

## 7. 判据教训 C：界面文案门必须只扫「控件与标题」

三代口径对比（同一份代码，三种结论）：
```
v1 全文 innerText 匹配        → /node 报 16 处残留，实为 agent 对话里的表格内容
v2 剔除 markdown 渲染区       → 仍报 14 处，实为任务标题 / 需求正文 / JSON 片段
v3 只扫 nav/aside/header/button/h1-h4/th/label/legend/role=tab
                             → 7 页 0 残留，与人工观察一致
```
**结论**：UI 文案 = 控件与标题里的文字；任务标题、需求正文、Agent 名属于数据，不应翻译。
**已落地**：`evidence/probes/i18n-ui-sweep.mjs` 为 v3 实现，并接入 `deploy/health-all.sh` 第 15 门。

---

## 8. 判据教训 D：测试选择器不能与界面文案耦合

`.564` 验收第一次红在 `network` 套件：
```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('link', { name: 'Requirements', exact: true })
Error: element(s) not found
```
根因：套件按**可见文案**定位导航链接，而导航已中文化为「需求」。

**结论**：这是断言与文案耦合（brittle selector），不是界面回归。
**修法**：导航链接本来就带稳定钩子 `data-nav-href={item.href}`，套件改用它。
已改 `verify-network.mjs`（1 处）与 `verify-project-cancel.mjs`（2 处），重跑后 network 54/54。

---

## 9. 流程教训 E：发布提交之后再补文档，会让「产物 SHA」与「CI SHA」错位

```
现象：publish-564.py 断言 AssertionError
原因：生成器因「工作树不干净」拒绝执行（未提交的台账），我随后补了一个 docs 提交
      → main 尖端变成 4f39767a
      → 验收脚本按 main 尖端检出并构建，BUILD_COMMIT = 4f39767a
      → 而我采集 CI 用的仍是上一个 SHA a04ab6bc
      → 断言 all(r['headSha'] == sha) 失败
修法：按产物真实 SHA（4f39767a）重新采集 CI，让「产物 = 验收 = CI」三者同 SHA
```
**规矩**：文档先提交，代码其次，release bump 最后；发版前先 `git status` 清干净。
发布链里那道断言的价值，就是拒绝拿"两张不同 SHA 的证据"去发版。

---

## 10. 已知未覆盖（下一批）

| 项 | 状态 |
|---|---|
| 命令面板（⌘K）条目 `Go to X`、组名 `Navigate` / `Actions` | 仍是英文；面板默认隐藏，v3 门扫不到，需"打开面板后扫描" |
| 军团 3D 四项视觉定型（pitch / 核心 / 提示条 / 2D 入口） | 等用户拍板；现状 49° · 混合 · 常显 · 现入口 |
| 残留 #12（头部 16.5px） | 已定案为非缺陷（图例文本换行），若要省需缩短图例 |


---

## 11. 发布：`0.6.4-preview.565` + 界面文案彻底收口计划

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.565` |
| commit | `02a6b660f932b3d0f8f9f97f73968fb077d5e9a3` |
| buildId | `GgUWohDshmi4oHhRSQHC4` |
| 内容 | 命令面板 41 条中文化 + 分组取值 38 处 + 面板行 `data-command-id` |
| 回退锚点 | `preview.564-4f39767`（`4f39767` / `9Q2Ysasn49mmopQOFpIf1`） |

证据链：
```
① 20 套件   PASS 20/20（legion 272 · board 171 · pageSmoke 47）
② CI        3 success + 1 skipped:paths-filter（原因：该提交改动不在 gates 的 paths 内）
③ 自检      4/4 PASS
④ 健康门    15/15 PASS —— 第 15 门 i18n-ui-sweep 首次全绿：
            7 页全部「残留=0 面板=0」
```

### 教训 F：同一句文案可能同时存在于多个组件
```
现象：把 'Go to X' 当成命令面板独有文案去改，结果 board 套件 168/171 红。
反证：同一批里 help:listsLegionGroup 断言仍在查 /Legion (2D / 3D)/i 且通过
      ⇒ 快捷键帮助浮层（HelpOverlay，305 行）有自己的文案表
规矩：改文案前先按「这个字符串属于哪个组件」逐一定权，
      不能看到一处 grep 命中就认为找到了唯一来源。
```

### 教训 G：带管道的测试命令不能用 && 串后续步骤
```
错误写法：npm test | tail -2 && git commit ...
后果：退出码是 tail 的 0，测试 57/58 也会继续提交
正确写法：npm test > log 2>&1; code=$?; [ "$code" -eq 0 ] || exit 1
```

### 教训 H：验收拒绝「陈旧套件产物」
```
现象：stale suite output: evidence/.../responsibility-565/result.json
原因：565 上一轮尝试留下的 result.json 属于另一个 SHA/buildId
规矩：重出产物时先清掉同名 label 的历史目录，护栏不会替你判断"这是哪次的"
```

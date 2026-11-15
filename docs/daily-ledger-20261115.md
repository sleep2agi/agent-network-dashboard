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


---

## 12. 3D 首屏耗时归因（`.567` 后实测，结论：前端没有便宜可捡）

### 阶段表（`evidence/probes/legion-phase-timing.mjs`，线上 `preview.567`）
| 阶段 | 时刻 | 增量 |
|---|---|---|
| 第一批 Hub 请求（6 个并行） | 954ms 起 | 各 1.58–1.80s |
| 布局数据（overview/people/departments/session-status/task-stats） | 2606–2656ms 起 | 各 0.18–0.26s |
| messages | 3905ms 起 | 915ms |
| 入场结束（introState=done） | ~3971ms | — |
| 取景收束（镜头稳定） | 6753ms | **+2782ms** |

### 冷/暖对照（同 context 连跑，判据 `canvas.dataset.introState === 'done'`）
```
首次访问（无 anet_network_id cookie）：中位数 2311ms  样本 [2190, 2311, 2857]
再次访问（已有 cookie）            ：中位数 3403ms  样本 [1776, 3403, 3476]
```
**判读**：方差远大于两路径的差异（1.78–3.48s），说明"网络发现"不是主导项；
主导项是 Hub 侧每次调用 1.6s 的延迟与 three 初始化，两者都不在前端可优化范围内。

### 结论（明确不做无据优化）
- 不在"压首屏"上继续投入：可动的部分（串行依赖）测下来不是瓶颈；
- 若将来要真的更快，只有两条路：① Hub 侧把 `/api/hub/networks` 等调用降到百毫秒级；
  ② 减少首帧前必须等待的 Hub 调用数量（需要与 Hub 侧确认哪些可延后）。
- 取景收束 2782ms 属于"画面已可见后的镜头稳定"，不影响第一眼，改动需负责人确认观感取舍。



---

## 13. 发布：`0.6.4-preview.568`（白名单门驱动的最后一轮中文化）

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.568` |
| commit | `9919e8bf557c4892fbaaa222f5e66e0a93362941` |
| buildId | `ytDHr4xSMBy3nQlI5uyoV` |
| 内容 | 17 文件：移动底栏 6 项 · 概览拓扑控件 · 任务状态体系（芯片 + 行内）· 失败横幅 · 快速搜索 · 加载更早消息 |
| 回退锚点 | `preview.567-d537571`（`d537571` / `Wj60pk2v6IKFbDdKqpt18`） |

### 为什么这一版才真正收口
```
前五版靠"人工词表 + 逐页翻检"，连续漏掉四类区域：
  ① 移动端底部导航（6 项，整块英文）
  ② 概览页拓扑控件（Show/Hide Topology、Ring/Grid/Tree、N working）
  ③ 任务状态芯片与行内状态（created/delivered/acked… 、HIGH）
  ④ 失败横幅句子（"104 tasks failed in the last 24h"）与附件卡片

`.568` 把门改成白名单制：控件/标题里任何 ≥2 字母的拉丁词都报，只放行技术白名单
与九类明确的数据/内容形态。它一次就把上面四类全揪出来。
```

### 门的九条跳过规则（每条对应一类明确的数据形态）
```
① <option> 与含 <select> 容器（目录）
② [data-node-alias] 与页内别名文本（Agent 名）
③ [data-node-list-rail]（节点列表栏）
④ [data-task-id]/[data-requirement-id]/[data-msg-id]/article（正文）
⑤ 含中文的 h1–h4（内容标题）
⑥ .leading-relaxed/.prose/[data-markdown]（聊天 markdown 表格）
⑦ 含 <img> 的按钮（附件预览）
⑧ 含文件扩展名的文本（附件卡片）
⑨ 白名单：技术词 + 产品名 Agent Network + default/P0–P3 + Slack
```

### 教训 I：改一个可见标签，要扫三种引用形态
```
`.568` 验收红了 4 次，全部同源：套件按可见文案定位。三种形态都要处理：
  ① { name: 'X', exact: true }
  ② /^X\s*\d+$/                 ← 「All 200」芯片
  ③ 三元/条件表达式里的 'X'        ← 如 code === '401' ? 'Refresh' : '重试'
做法：改完标签后全仓 grep 该标签的所有形态，确认残留 0 再跑验收。
      本次 Refresh 22 处 + All 4 处，均为中英双兼容正则。
```

### 教训 J：门与"看图"是两条互补的证据
```
门覆盖结构控件（nav/button/h1-h4/th/label + 面板 + 浮层）；
看图覆盖密排内容区（任务行内状态、附件卡片）—— 这些 <span> 不在门的 selector 里。
`.568` 的行内状态 running/acked/replied 与 HIGH 就是靠看移动端截图发现的。
```


---

## 14. 发布：`0.6.4-preview.569` —— 界面中文化正式结案（18 页口径）

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.569` |
| commit | `7fe70f284f90ff97421db814dbe11ace53475c60` |
| buildId | `Wv32vobrxwgeZB1VRrTgh` |
| 内容 | `/messages`（导出 MD/时间线/分组/调试）· `/logs`（5 动作芯片+行内）· `/servers`（N 个 Agent）· 空态 7 条 |
| 门 | 7 → 18 页，4 条数据跳过规则，白名单补 `MD` |
| 回退锚点 | `preview.568-9919e8b`（`9919e8b` / `ytDHr4xSMBy3nQlI5uyoV`） |

### 结案证据
```
20 套件 20/20（legion 272 · pageSmoke 47 · board 171 · detail 115）
CI 4/4 · 发布后自检 4/4 · 健康门 15/15
线上文案门：I18N-UI PASS，18 条入口每一行都是「残留=0 面板=0 浮层=0」
复跑命令：node evidence/probes/i18n-ui-sweep.mjs https://dm.vansin.top
```

### 教训 K：空态文案是"有数据就永远扫不到"的盲区
```
`/tasks`、`/messages` 的空态在真实数据下永不渲染，白名单门扫不到；
它是被 pageSmoke 的断言（查 'No tasks yet' / 'No messages'）反向暴露的。
处置：① 补中文化 ② 把断言期望文本改成中文 —— 等于给这类文案留了一道岗。
规矩：新增空态文案时，必须同时更新"查空态"的断言，否则它永远不被验证。
```

### 教训 L：同一产物两次结果不一致 → 先判抖动，再判回归
```
legion 首次 269/272（viewMemory:changedZoom / viewMemory:resetForgets /
present:deepLinkFillsHeight），单套件重跑 272/272，全量重跑 272/272。
判定：时序抖动（视角记忆依赖 localStorage 写入与深链取景时序）。
规矩：① 同产物重跑通过 = 抖动（记录不修）
      ② 重跑仍失败 = 回归（排查/回退）
      ③ 手工回归用 <suite>-<ver>-manual 标签，不占用发布标签名
```


---

## 15. 发布：`0.6.4-preview.571` —— 界面文案线封版（21 目标）

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.571` |
| commit | `38e0c0c055c11a9c904bf3e06c60652ed3d7dd32` |
| buildId | `k-dQ5-sAnRFsY0dgNk8rK` |
| 内容 | 需求页 `Clear filters`→清除筛选 · 组织页 `Clear`→清除 · 节点页 tab：对话/事件/信息 |
| 门 | **21 目标**：18 条静态入口 + `/requirements/<id>` + `/nodes/<alias>` + `/node?alias=` |
| 回退锚点 | `preview.570-e7ce5be`（`e7ce5be` / `V7RG3nvgG9htsXb7JJYuu`） |

### 结案证据
```
20 套件 20/20（legion 272 · board 171 · detail 115 · pageSmoke 47）
CI 4/4 · 发布后自检 4/4 · 健康门 15/15
线上文案门：I18N-UI PASS，21 个目标全部「残留=0 面板=0 浮层=0」
  动态路由纳入：/requirements/req_…  /nodes/TM中转运维2号  /node?alias=TM中转运维2号
```

### 教训 M：清点必须一次扫全三种写法
```
`Clear filters` 红过一次（16 处），我按 getByRole 的 name 字面量做了全仓清点；
但 `Events` 仍红了——因为它写在 hasText / getByText 两种写法里。
规矩：改可见文案前，清点必须同时扫 name: / hasText: / getByText( 三种写法。
本次扫完后的结论：20 个验收套件里，"只认英文文案"的选择器已清零。
  已修：Refresh 22 · Clear filters 16 · All N 4 · Events/Chat/Info 2
  无需改：'Clear' 仅存在于归档历史探针（不在 20 套件内）
  有意保留：verify-header 的 'Alias copied'（刻意验证英文分支）
```

### 封版口径（写入 CHANGELOG，同时作为下次的边界）
```
覆盖：18 条入口 + 需求详情 + 节点详情（两条路由）+ 命令面板 + 帮助浮层
      = 21 目标 × 3 类界面
判据：白名单制（非白名单拉丁词即报）+ 9 条数据/内容跳过规则 + 取不到样本必须显式报告
不覆盖：抽屉类（文件/日志/技能/密钥）、/tasks/<id> 等其它动态详情
复跑：node evidence/probes/i18n-ui-sweep.mjs <base>
```


---

## 16. 环境清理与一条新发现：孤儿进程指向已删除的 release

### 清理结果
```
evidence/   8.1G → 6.6G（删除 1250 个版本 < 566 的验收腔本，保留 566–571）
releases/   4.0G → 2.0G（删除 preview.567 / preview.569，保留 570 回退锚点 + 571 当前）
磁盘可用    73G → 77G（85% → 84%）
```

### 教训 N：发布后可能残留"指向已删除目录"的旧进程
```
巡检发现：pid 178965 的 cwd = releases/preview.458-5b3c3c5 (deleted)，仍监听 127.0.0.1:38477。
它不影响页面正确性，但长期占用端口与内存，且没有任何报错提示。

判定方法（比 pm2 更可靠）：
  ss -ltnp              → 端口与 pid
  readlink /proc/<pid>/cwd → 这个进程实际在跑哪份产物
判定规则：
  cwd 指向当前 release        → 生产，保留
  cwd 指向"已删除目录"或开发目录 → 残留，清理

本次清理：1 个孤儿（.458）+ 3 个我的测试残留（:3109 / :3300）+ 其父进程
清理后复核：127.0.0.1:3001 与 https://dm.vansin.top 均返回 307（未登录跳转，正常）
```

### 规矩（追加到 kickoff）
```
每次发布后顺手查一次：
  ss -ltnp | grep next-server  → 是否有多个 next-server
  readlink /proc/<pid>/cwd     → 是否有人还跑着旧/已删目录
只杀 cwd 指向非当前 release 的进程。
```

---

## 17. 发布：`0.6.4-preview.572` —— 今天唯一一版「为观感而改」

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.572` |
| commit | `c366e5ae097d5ce40799f1574c94e00f79ab0261` |
| 内容 | 军团 3D：`<1440` 折叠次要工具到「更多操作」· 图例缩短 |
| 回退锚点 | `preview.571-38e0c0c`（`38e0c0c` / `k-dQ5-sAnRFsY0dgNk8rK`） |

### 起因：门全绿，但笔记本尺寸下不好看
```
前九版（.563–.571）都在改"界面语言"，15 道门、21 目标文案门全绿。
但在 1366×768 / 1280×720 上截图后看到两处观感问题：
  ① 工具条换行 → 第二行只剩一个孤立的「平台视角」胶囊
  ② 图例折行 → 最后一行只剩「Agent。」三个字
⇒ 结构正确 ≠ 看起来体面。截图检查是门替代不了的。
```

### 算术（同一份数据量的三档，写清楚才有最小改法）
```
控件自然宽合计 866 + 13×4 间隙 = 需求 918px
可用宽：1920 → 918（正好放下）  1366 → 868.3  1280 → 801.5
缺口：1366 缺 49.7px · 1280 缺 116.5px
收紧内边距/间隙最多省 ~82px → 够 1366，不够 1280
⇒ 选结构性最小改：<1440 把演示/导出类 5 个控件收进已有的「更多操作」抽屉
```

### 改动（5 处，全在 `app/legion/3d/page.tsx`）
```
1) 「更多操作」开关：sm:hidden → min-[1440px]:hidden
2) 次要工具组：sm:contents → min-[1440px]:contents（≥1440 仍平铺）
3) 折叠态下 1080p 标签、净屏提示改为同样可见（信息不丢）
4) 图例：圆心是网络，外三环依次是部门、成员与名下 Agent。
        → 圆心是网络；外三环：部门 / 成员 / Agent。
```

### 双档判据（关键：改动必须"一边变好、一边不变"）
```
toolbar 高：1920 = 28 · 1366 = 30 · 1280 = 30（此前 1366/1280 为 60）
header  高：1920 = 98.5 · 1366 = 98.5 · 1280 = 98.5（此前 1366/1280 为 115）
1366 截图：顶部单行、无孤立胶囊、图例一行
1920 截图：与 .571 完全一致（零影响）
```

### 验收
```
20 套件 20/20（legion 272/272 —— 预判的"折叠导致演示/导出判据失效"没有发生）
CI 4/4 · 发布后自检 4/4 · 健康门 15/15 · 军团探针 6/6
```

### 教训 O：截图要在真实笔记本视口看一眼
```
门能证明结构没坏、文案没漏，但证明不了"在 1366 上是否体面"。
今天这条缺陷（孤立胶囊 + 孤字行）在 1920 下完全看不见，只有笔记本视口暴露。
规矩：每次动头部/工具栏/图例这类布局，必须截 1366 与 1920 两档，双档判据写进 CHANGELOG。
```

---

## 18. 发布：`0.6.4-preview.573` —— 圆心断词，以及"预算该按字数还是按像素"

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.573` |
| 内容 | 军团部门圆心短名：中英交界断开 · 西文整词 · 预算由像素宽度派生 |
| 回退锚点 | `preview.572-c366e5a` |

### 三个"门全绿也发现不了"的缺陷（今天连续抓到）
```
① 孤立胶囊：1366 下工具条换行，第二行只剩「平台视角」      → .572 修（折叠进更多操作）
② 孤字行：图例折行后最后一行只剩「Agent。」                → .572 修（文案缩短）
③ 圆心断词：ANet→ANe、TMAI→TMA、无主 Agent→无主A、未分组→未分 → .573 修
共同点：结构、文案、对比度门全绿；只有按真实视口截图、逐字看画面才暴露。
```

### 教训 P：修根因要看"预算的单位"，不是调那个数字
```
第一版修法：把"3 个字"改成"按中英分段取整段" → 1920 好了，1366 的「未分组」仍是「未分」。
原因：预算单位是"字数"，而圆的容量单位是"像素"。
第二版：budget = clamp((2*rx - 6) / fontSize, 1, 4)，中文 1.0 / 西文 0.6 计入。
结果：同一份代码在 1366（rx≈25, fs≈11.5）与 1920（rx≈28, fs≈13）都放得下。
⇒ 凡是"看起来放不下"的问题，先问"我的预算按什么单位算"。
```

### 教训 Q：单测要钉住"接线"，不只是钉住"函数"
```
legionCircleName 写得再对，只要 page.tsx 又写回 slice(0, 3)，用户看到的就是错的。
因此测试里加了两条反向断言：
  · page.tsx 必须 legionCircleName(node.label, legionCircleBudget(...))
  · page.tsx 不许出现 `rx >= 28 ? 3 : 2`
函数正确 + 接线正确，才算修好。
```

---

## 19. `.573` 健康门红 1 项：文案门把「网络名」当文案报了

### 现象
```
HEALTH-ALL: FAIL (1 项红) - i18n-ui-sweep
/legion/plaza 残留 2 条：
  · net        ← <button> 👤 net_399bdf86f528 424 ▼
  · bdf86f528  ← 同一个按钮
```

### 判定：门的边界缺口，不是产品回归
```
该按钮是侧边栏「网络切换器」，显示的是 Hub 返回的**网络名**。
这个网络未命名，Hub 直接返回它的 id（net_399bdf86f528），于是被当成拉丁词报出。
`.572` 之前没红，是因为当时该路径采样到的网络名是 default —— 数据变了才暴露。
⇒ 20 套件、CI、自检、军团 6 探针全绿，仅这一条门规则没覆盖"网络名是数据"。
```

### 修法：把数据划出去，而不是往词表塞 net_
```
evidence/probes/i18n-ui-sweep.mjs 增加：
  if (el.closest('[data-testid="network-switcher"]')) continue;
为什么不用"词表里加 net_ 前缀"：
  白名单门的意义是「非白名单拉丁词即报」。往词表里加 net_ 会让真的英文界面文案
  （例如某天有人写出一个 <span>net</span>）被放过 —— 门就从"报警器"退化成"消音器"。
正确做法：用 data 属性把数据区标出来（与 .571 的抽屉泄露修复同一原则）。
```

### 教训 R：门红了先分「产品回归 / 门边界缺口 / 数据变化」三类
```
① 产品回归      → 改代码
② 门边界缺口    → 改门（用 data 属性划出数据区，别动词表）
③ 纯数据变化    → 改探针取样口径（例如动态路由换了一条记录）
今天这条是 ②，且成因是 ③ 触发。三类混着改，就会把真回归一起掩盖掉。
```

---

## 20. 发布：`0.6.4-preview.574` —— 首轮双档体检抓到的两类真缺陷

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.574` |
| 内容 | 需求状态芯片中文化 · start/due 中文化 · 中文 404 · 门规则 3 处 · 双档体检脚本 |
| 回退锚点 | `preview.573-8315fcc` |

### 缺陷一：同一屏里两种语言
```
/requirements 每行芯片：done / doing / pool
同页筛选器：需求池 / 进行中 / 完成 / 已放弃
详情页：start 2026-11-16 / due 2026-11-18
根因：列值直接渲染 {row.column} / {req.column}；界面文案没有单一来源。
```

### 缺陷二：全站 404 是英文
```
访问不存在的路由 → Next.js 默认页 "This page could not be found."
404 从来不在文案门的 21 个目标里，所以永远不会被发现。
修法：app/not-found.tsx（中文 + 三个出口）。
```

### 教训 S：门的"跳过规则"就是覆盖率的真实边界
```
`.573` 的 PASS (21/21 页 0 残留) 是**假的**：
  门的跳过规则 if (el.closest('[data-requirement-id], article')) continue;
  把需求行整行排除了 —— 行内芯片的英文从没被扫过。
修法不是"把词表调小"，而是给界面芯片一个可寻址的挂钩（data-status-chip），
让门在"内容行内部"也能精确取到界面文案。同类做法见 .571 抽屉（data-servers-drawer）。

结论口径也跟着改：结论行必须带分母（21/21），覆盖不全给 DEGRADED（退出码 3）。
```

### 教训 T：中文"能否一行放下"要按字数预算，别交给自动断行
```
同一段 404 说明文案的三次实验：
  35 字 + max-w-sm        → 末行只剩「误。」（孤字行）
  35 字 + text-balance    → 「已过期」被切成「已过 / 期」（更差）
  21 字 + max-w-md，不用 balance → 一行显示
⇒ 中文窄容器里，balance 只能让两行等长，不懂词边界；压到一行才稳。
   已在代码注释里写明"21 字上限"，让下一个改文案的人先看到约束。
```

### 体检脚本自己的清单也要体检
```
deploy/laptop-pass.mjs 初版默认清单里写了 /overview 与 /board —— 两页实际不存在。
脚本自己先撞 404，才暴露了"全站英文 404"。现已改为 12 条真实路由。
```

---

## 21. `.574` 未发版：一道 ratchet 门拦住了它（流程有效的一次实证）

### 发生了什么
```
`.574`：20 套件 20/20 · detail 115/115 · CI 里 scrub-guard / unit tests / OSS readiness 全绿
但 gates 这一条 workflow 失败 → publish-574.py 断言「4 条 workflow 必须同 SHA success」→ 拒绝发布
线上仍是 .573（pid cwd = releases/preview.573-8315fcc），没有被坏版本覆盖
```

### 原因
```
color-ratchet：app/not-found.tsx: 0 → 1 (+1) off-whitelist arbitrary size
新写的 404 页用了 min-h-[70vh]；白名单只允许 85vh / 50vh 这类既定值。
⇒ 门的设计意图是「不许随手发明任意尺寸」，它这次正好拦住了一个新文件。
修法：min-h-[70vh] → min-h-[50vh] + py-20；四项 ratchet 回到基线。
```

### 教训 U：发布链的"断言在 publish 里、发现却在 CI 里"，这次配合是对的
```
publish 不做"跳过失败重试"，也不看 CI 之外的绿灯；
它只认「同一 SHA、四条 workflow 全 success」。
⇒ 结果是：坏版本 0 影响，代价是一个 label 作废（574 保留为失败证据，改发 575）。
⇒ 反面做法是"手动 patch 掉失败那条"，今天没有这么做。
```

### 教训 V：门的扫描集合等于覆盖率的真实上限（第五次同类）
```
文案门只扫 nav/aside/header/button/h1-h4/th/label/legend/summary/role=tab|button。
据此漏掉了：需求行状态芯片（.574 修）· 输入区提示语（.575 修）。
现在的做法：不再扩词表，而是给界面文案加"可寻址钩子"
  data-status-chip（行内芯片）· data-composer-hint（输入区提示）
门按钩子取样，新区域只要挂钩子即可被覆盖。
```

---

## 22. 发布：`0.6.4-preview.576` —— 门"红得精确"的第一次完整体验

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.576` |
| 内容 | 服务器页头部中文化 · 输入提示改「回车发送」 |
| 回退锚点 | `preview.575-28bbdc5` |

### 三件事被同一轮体检同时验证
```
`.575` 体检：HEALTH-ALL FAIL (1 项红) — i18n-ui-sweep
  I18N-UI: FAIL (4 处残留，覆盖 21/21 页)
  404 检查 status=404 · 中文标题=有 · 英文默认页=无      ← 新增断言转绿
  /servers 残留=1 ← "and"（and agent rollups from CommHub telemetry）
  /nodes 三条 ← "Enter"（Enter 发送 · 可直接粘贴图片）
⇒ ① 404 修复被门锁住 ② 长文本规则抓得到真英文献 ③ 覆盖分母是诚实的 21/21
```

### 教训 W：把"红"当成交付物的一部分
```
以前我会把体检红项当"还没做完"，倾向于先修再跑；
这次特意在线上跑了一次"已知会红"的体检，好处是：
  · 证明门不是摆设（它抓到了我肉眼发现的那句英文）
  · 证明新断言有效（404 由红转绿）
  · 证明覆盖口径没退（分母 21/21，不是 19）
一个只会绿的检查，无法自证有效性；一条红得具体、可解释的红，才是资产。
```

### 教训 X：能用中文就不用英文，白名单不是垃圾桶
```
输入提示原为「Enter 发送」。有两种修法：
  A) 把 Enter 加进白名单（快速消红）
  B) 改成「回车发送」（界面真的中文化）
选 B。白名单只应包含确实无法翻译的专有词（Hub / Token / API / CLI）。
否则白名单会逐版变长，最终把所有英文都"批准"掉，门就等于没有。
```

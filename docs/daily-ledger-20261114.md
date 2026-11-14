# 2026-11-14 工程台账（军团 3D / Dashboard）

> 一天内 4 次发布、4 个缺陷修复、7 个想法被否。每条都指向可复跑的读数，便于复核与追责。

## 一、发布记录

| 版本 | commit | 主要内容 | 判据 |
|---|---|---|---|
| `0.6.4-preview.557` | `e3067f3b` | 取景层高单一来源（绘制 ×`LOOK_TIER`，取景用原值） | 20 套件 · 272/272 · CI 4/4 · 自检 4/4 · 健康 12/12 |
| `0.6.4-preview.558` | `b14754f3`…（见状态板） | 边界纪元（边界变化必被消费）+ 回退分支层高同源 | 同上 |
| `0.6.4-preview.559` | `4ea91221` | `?pitch=` 桌面失效修复（三处收口） | 同上 |
| `0.6.4-preview.560` | `b14754f3` | 军团 3D 未读角标让路（`useLegionGate`） | 同上 + 13/13 门 |
| `0.6.4-preview.561` | `303e5d6b` | `/tasks` 短内容多滚 31px（同类第 8 处） | 20 套件 · 272/272 · CI 4/4 · 自检 4/4 · **14/14 门** |

回退锚点：`preview.560-b14754f`（在磁盘上可直接回退）。

## 二、修复的四个缺陷（都有前后数字）

| # | 缺陷 | 修前 → 修后 | 判定依据 |
|---|---|---|---|
| 1 | 取景用层高与绘制不是同一来源（差 30%） | 桌面越界 Agent 实体 **19 → 0**；最大越出 35.1 → 12.5px | `drift-clip` |
| 2 | "边界缩小"的取景请求被入场窗口吞掉 + 回退分支漏乘 1.3 | 同配方 zoom **1.240 → 1.192**；越界 10 个/18.2px → 1 个/≤12.8px | `late-data-fit` ×3 |
| 3 | `?pitch=` 在桌面完全不生效 | Agent 环高宽比跨度 **0.002 → 0.278**，与 `?view` 通道一致（0.714 vs 0.711） | `pitch-param` |
| 4 | `useLegionGate` 同步 setState 触发 lint 错（CI 红） | lint **1 error → 0** | `npm run lint` |

## 三、性能：一个改动部分达标

| 指标 | `.559` | `.560` | 门槛 | 判定 |
|---|---|---|---|---|
| `/api/hub/people` 中位 | 1404ms | **1020ms（-27%）** | ≥30% | **未达标**（如实记录） |
| 编制就绪中位 | 4296ms | **3882ms（-10.4%）** | — | 改善成立 |

## 四、被测并否决的想法（7 条，避免后人重走）

| 想法 | 结果 |
|---|---|
| 入场结束后补一次取景（`.558` 候选） | 方差消失但包围盒 104%（更差） |
| 取景"双稳态"结论 | 探针固定 sleep 读到过渡值 → 撤回 |
| "数据晚到不是原因"结论 | 样本是空场景（0 节点）→ 撤回 |
| 方差 0.4% | 样本不足，修正为 ≤1.7% |
| `?deferChrome=1` 能给 people 让路 | 实测首屏从 4.4s 变 8.0s（更差） |
| "启动空档 0.9s" 需拆包优化 | 服务端 curl 仅 60ms，是无头环境放大 → 前提撤回 |
| 就绪后再加 800ms 缓冲 | 就绪 +320ms（更慢） |
| 投屏页头换行（4 次改法） | 均未达 1 行，全部回退（残余 12） |

## 五、新增的判据资产

```
探针 17 支：drift-clip · fit-timeline · late-data-fit · pitch-param · pitch-4up
            hint-overlap · phase-timing · startup-gap · visual-spotcheck · projector
            + 既有 7 支（label-drop / cold-start / export / canvas-text / core-variants / plaza-smoke / geom）
健康门 12 → 13（新增 legion-visual 目视抽检：三页 × 两视口 16 条结构判据）
记分卡：docs/legion-wow-metrics.md（6 指标 + 相位表 + 量法告警 + 改动收益清单）
基线：docs/legion-baseline-560.md（结构/性能/俯角/中心区/门禁/残余 + 一键复跑）
```

## 六、量法纪律（今天新增 4 条）

1. 分母用页面自己的安全区 `[data-safe-bounds]`，不用画布（320 按画布算 28%、按安全区算 94%）
2. 越界判据是"越出 ≤16px"（= 页头前最小间隙），不是"必须为 0"
3. 取景/动画类指标必须等**收束**（连续 2s 不变 + 知道 writer），固定 sleep 会读到过渡值
4. **绝对值会随时间漂移**（同一版本两小时内 people 1020ms → 537ms）⇒ 任何"变快/变慢"必须同段 A/B

## 七、残余（5 条，全部带数字）

| # | 现象 | 数字 | 状态 |
|---|---|---|---|
| 7 | `/legion/plaza` 移动端多滚 | 390：140px | 待外部（卡片渐进加载方差大） |
| 9 | 部门盘描边擦安全区 | 1440 12.5px / 390 3.0px | 已知取舍（在 16px 间隙内） |
| 10 | 取景 zoom 残余方差 | 1.187–1.21（≤1.7%） | 主要已修 |
| 11 | 底部提示条压最外层环 | 覆盖 9 个 Agent（2.5%），可关闭 | 已知取舍 |
| 12 | 投屏 1280/1366 页头高 60px（1920 为 28px） | 差 32px | 已知取舍（无头读数自相矛盾，需 DevTools 专修） |

## 八、环境维护

```
磁盘 88% → 83%（清理 36 个已合并旧 worktree + 1 个旧 release，释放约 22GB）
crontab 14 条完好（并响应通信飞书欧的"测试会清空 crontab"通报，留了一份 600 权限快照）
文档口径清理：版本号一律指向 docs/dashboard-status.md；门数统一为 13；不手抄 SHA
```

## 九、两道新门的首战（`.560`→`.561`）

```
第 13 门 legion-visual（三页 × 两视口目视抽检）
  · 首轮稳定通过；守的是"探针全绿但页面空白"这一类

第 14 门 site-scroll（20 条真实路由滚动普查）
  · 第一次运行就抓到真缺陷：/tasks overflowY=31（与健康横幅等高）—— 同类第 8 处
  · 该缺陷只在"内容较短"时暴露（内容长时 265px 把它盖住），历次抽查都漏掉
  · 修法：TasksView 5 处 min-h-screen → calc(100dvh - var(--health-banner-h))
  · 线上验证（.561）：/tasks?q=… 短内容 31 → 0；长内容 265 属正常

门自己也曾抖（已修）：
  · 固定 2.5s 采样会捕到"横幅刚插入/高度自适应"的过渡态，两次跑结论相反（一次红 /legion/3d、一次红 /tasks）
  · 改为「文档高度 + 横幅高度连续 1.2s 不变」才取样（最多 8s，不稳定记 unstable-height 判红）
  · 修后连跑两次均 PASS(20/20)
```

**教训**：会误报的门比没有门更糟（会让人习惯性忽略红灯）；新门上线前必须先自证稳定性。

## 十、门的稳定性第二次验证（`.561`，同日 23:05）

```
与首次通过相隔约 3 小时（且期间数据已变化：部门 14→15、Agent 347/353 并存），
再次全量跑 14 门：HEALTH-ALL: PASS (14/14)
⇒ 说明这两道新门（legion-visual / site-scroll）以及原有 12 门，
   不是"发布当时那一刻恰好全绿"，而是跨时段、跨数据状态都稳定
```

同日另有两处"判据随数据变化"的历史（都已在文档留档）：
- `/tasks` 的 31px 只在内容短时暴露（内容长时 265px 会盖住）
- `site-scroll` 门自身曾因固定 2.5s 采样捕到过渡态而两次结论相反，已改为"高度连续 1.2s 不变"

## 十一、2026-11-15（次日）跨夜复核：一次假红与它的修法

```
00:02 跑 ./deploy/legion-verify-all.sh → drift-clip FAIL
  报告里 1440 视口只有 1 个节点（仅核心）、zoom 1.12、包围盒占安全区 9%×14%
  390 / 320 均正常（378 节点）

判定：这不是缺陷，是"编制还没到"的采样被当成真实读数，
      再被"三视口节点总数一致"的判据逮到 → 假红。

探针修法（产品零改动）：
  · 等编制就绪（节点 >100，最多 25s）；失败则重载页面再等一次
  · 仍不就绪 ⇒ 该视口标 invalid：不参与任何判据，报告写"编制未就绪（样本无效）"，
    退出码 2（INVALID）而不是 1（FAIL）
  · "三视口节点总数一致"只在三档全部有效时才判

修复后复跑：
  drift-clip 19/19 PASS（三档均 378 节点、越界 0）
  ./deploy/legion-verify-all.sh → LEGION-VERIFY: PASS (6/6)
```

**教训（量法纪律第 7 条）**：任何"等数据就绪"的等待都不能 `.catch(() => {})` 静默吞掉——
超时必须变成"样本无效"这个显式状态，否则就是把"没读到"当成"没有"。

## 十二、2026-11-15 当日基线（跨夜后首次全量）

```
线上        0.6.4-preview.561 / 303e5d6b（uptime 约 4.6h，发布后未重启）
军团探针    LEGION-VERIFY: PASS (6/6)
            drift-clip 19/19（三档均 378 节点、越界 0）
            projector 68/68（四形态 × 5 档）
健康门      HEALTH-ALL: PASS (14/14)
底座        磁盘 76G 可用 · crontab 14 条 · git worktree 12 个
需求池      未认领且与本仓库相关的任务 0 条
代码整洁    军团相关文件无 TODO/FIXME 残留
```

同日另有两件小事（都已入档）：

1. `drift-clip` 在 00:02 报过一次假红（1440 只读到 1 个节点），根因是"编制未就绪"被当成真实读数；
   已改为「等就绪 → 失败重载一次 → 仍失败记 INVALID(2)，不参与判据」，并写成量法纪律第 7 条。
2. 需求池核查确认：模型切换（6 张）与节点向导/fork 节点均由客户端节点负责，
   本仓库对齐这两项的前提仍是"先有 Hub 契约"。

## 十三、2026-11-15 新发现：`/providers` 页面中英混排（未修，待一句确认）

顺查"providers 返回空列表"时发现：页面空态本身是**齐备的**（`EmptyState variant=generic`），
但整套文案是英文，而同一个页面里又有中文按钮，形成中英混排：

| 位置 | 现文案 |
|---|---|
| 页面标题 | `Model Providers` |
| 空态标题 / 副文案 | `No model providers` / `Add a provider to register its models and test per-server reachability.` |
| 状态词 | `key set` / `no key` |
| 行内动作 | `Test` / `Edit` |
| 预览标记 | `preview fixture` |
| 同页中文（对照） | `新增供应商` · `连通性测试` · `停用（软删，可重新启用）` |

建议改法（保持与全局中文一致，约 8 条文案）：

```
Model Providers        → 模型供应商
No model providers     → 还没有配置模型供应商
Add a provider to …    → 添加供应商后可登记其模型，并按服务器测试连通性。
key set / no key       → 已配置密钥 / 未配置密钥
Test / Edit            → 测试 / 编辑
preview fixture        → 预览数据
```

未直接改的原因：这是**用户可见文案**，属产品口吻范畴；改一次要发一版（约 40 分钟）。
给一句“改”即可执行；给“保持”我就把它记为已知风格差异，不再重复报告。

## 十四、`.562` 上线：`/providers` 文案中文化（今日唯一"用户直接看得到"的修复）

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.562` / `d9617add` |
| 改动 | 10 处英文文案 → 中文（标题 / 空态 / 状态词 / 行内动作 / 说明段 / 预览标记），逻辑与交互零改动 |
| 验收 | 20/20 套件 · legion 272/272 · pageSmoke 47/47 |
| CI | 4/4（gates / scrub-guard / unit tests / OSS） |
| 自检 | 4/4 PASS |
| 健康门 | **14/14 PASS**（含 a11y 与 site-scroll——文案类改动最该看的两门） |
| 线上判定 | 截图 + 文本：空态「还没有配置模型供应商」出现 ✔、页面英文残留 0 ✔ |
| 回退锚点 | `preview.561-303e5d6` |

量法提醒（今日新增）：截图必须等数据落位——6s 时只捕到加载骨架（三条灰条），
会误判成"页面空白"；延长到 12s 才看到真实的空态文案。

## 十五、2026-11-15 系统性问题发现：界面文案整体中英混排（不止 `/providers`）

`.562` 把 `/providers` 改中文后，顺手扫了全仓界面串：

```
粗算英文界面文案：98 条，分布在 33 个 .tsx（不含测试）
最集中的几页：
  app/settings/page.tsx        13  （Settings / Change password / Sign out / CommHub connection / Hub URL / Config source）
  app/node/page.tsx            10  （Click Capture to view terminal output / External schedules / No alias specified / Back to dashboard / Node Info）
  app/admin/page.tsx            8  （Server Overview / Offline / Total Tasks / No online sessions / Actions / Broadcast）
  app/nodes/NodesView.tsx       7
  app/settings/networks/page.tsx 5
  app/components/TaskDetail.tsx 4 · TaskDrawer 3 · skillhub 2 · settings/tokens 2 · server-logs 2
```

现状判断（不是缺陷，是产品口吻问题）：

- 已中文化的页面：消息、需求、军团、任务列表、变更日志、概览等
- 仍大量英文的页面：设置、节点详情、管理台、技能库、Tokens、服务端日志
- 另有一类**技术名词**（API / Provider / Model / Hub URL / Session / Token）本就适合保留英文

因此不能"一键全翻译"：需要先定两件事——
1. **面向谁**：设置/管理台是否只给管理员用（若只给运维，英文可接受）
2. **保留白名单**：哪些术语保留英文（API、Provider、Model、Hub、Session、Token、RFC 编号等）

建议的落地顺序（每次 40 分钟含发布，可分批）：

```
第 1 批（用户最常见）：/node 详情页 10 条 + /nodes 列表 7 条
第 2 批（用户会进）：/settings 13 条 + /settings/networks 5 条 + /settings/tokens 2 条
第 3 批（管理员）：/admin 8 条 + /skillhub 2 条 + /server-logs 2 条
第 4 批（组件内文案）：TaskDetail 4 · TaskDrawer 3
```

未直接开工的原因：这是**跨全站的文案口径变更**（98 条、33 个文件），必须先定"面向谁 + 保留白名单"，
否则会把技术名词也翻成中文，反而降低可读性。给一句口径即可按批次推进。

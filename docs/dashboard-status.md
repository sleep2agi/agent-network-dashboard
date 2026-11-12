# Dashboard 状态板（随版本更新）

> 用途：一眼看清「线上是什么、什么还没发、什么在等谁」。
> 每个结论都绑定版本号；过期即改，不引用旧结论。

## 线上

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.511` |
| commit | `e29d8de23252b8e8b5cd09fa0073e68b55d5a597` |
| 公网 | https://dm.vansin.top |
| 进程 | pm2 `anet-dashboard` · cwd `releases/preview.511-e29d8de` |
| 回滚锚点 | `preview.510-7762b06`（切 cwd + `pm2 restart anet-dashboard`） |

## 今日已上线（各自只做一件事、各自可独立回滚）

| 版本 | 内容 | 现场证据 |
|---|---|---|
| `.484` | 军团 3D：>250 节点拖动时画面放大/裁切修复；新增 `?perf=1` 读数 | 拖动中背板 2464→1478（ratio 0.600），松手 restored=true |
| `.485` | 定时任务页权限降级；节点页相对时间 hydration 修复 | 403 五条断言全过；`/nodes` pageErrors `[]`（原 React #418） |
| `.486` | 三处重复流量：`/versions`·`/admin` 切 lite、`/versions` 轮询 30s、聊天面板 SWR 去重 | `/nodes` status 3→2 次（775→517 KB）；`/versions` 35s 7→2 次（8606→891 KB/分） |
| `.487` | 命令面板两处取数带网络作用域 | Ctrl+K 期间 unscoped 2→0，面板仍可开 |
| `.488` | 服务器页每台机器可展开看节点清单（只读） | 3→3 条、90→40+余数行、1→1 条 |
| `.489` | 圆角 R1 批次（153×6→8px，7 处保留）+ 门禁口径 + 运行时矩阵预览 | 2D 几何 0 差异（同时刻、同节点集）；hydration 19/19 |
| `.490` | R1 越界修复（`.489` 遗留） | 16px 控件不再被 8px 强制 |
| `.492` | 小控件圆角改「上限 + 判据」：h≥24→8 · 18≤h<24→6 · h<18→4；CSS 默认取 4px | 生产实测 16→4 · 20→6 · 28→8 · 32→8；HTML 陈旧值 0；首帧≠稳态 0 条 |
## 圆角现场口径（`.492` 实测，可复现）

```
探针：evidence/radius-492-20261111/{probe-item-radius,probe-exact-height,probe-stale-var,stale-by-tag}
三条路由 /legion · /nodes · /board，共 415 个 [data-radius-tier="item"]

结论一：三档全部正确（16→4 · 20→6 · 28→8 · 32→8），HTML 控件陈旧值 = 0（500ms/2s/5s 三时刻）
结论二：349 个 `<g role="button">`（3D 军团节点组）被误当控件打标，345 个变量与高度不符
        —— 不是分档错，是**对象选错**：border-radius 对 SVG `<g>` 无视觉效果，其"高度"是坐标缩放产物
        `.493` 起打标只作用于 HTMLElement
结论三：`.492` 的"首帧会先按 8px 渲染"前提**被实测推翻**
        打标与写变量在同一语句序列、CSS 规则依赖该属性选择器 ⇒ 不存在"有 tier 没有变量"的窗口
        默认 4px 保留，但定位改为防御（防 SSR 打标 / 防将来拆开这两步）
```

## 门禁（今天新增，均可独立运行）

| 工具 | 判据 |
|---|---|
| `deploy/next-release.py` | 允许集 = { live, target }，由线上 health 派生；`--from` 不符即在生成任何文件前拒绝 |
| `deploy/assert-docs-ahead.py` | `产物SHA..main` 的差异必须全部匹配 `docs/` 或 `*.md`，否则退出 1 |
| `deploy/publish-NNN.py` | 同上判据内联在发布脚本里（docs-ahead 是断言，不是声明） |
| `deploy/diff-guard.py` | 视图差异分类：结构/文本/类名/数据必须 0 差异；chunk 引用/buildId/哈希允许并记录 |
| `evidence/probes/geom-compare.mjs` | 几何对照先锁节点集，集合不同 ⇒ INVALID，不得输出位移数字 |

## 军团 3D 现场口径（`.498`，可复现）

```
探针：evidence/legion-3d-fit-495/  ·  evidence/legion-3d-pitch-497/  ·  evidence/legion-3d-497-live/
读数：?perf=1 的 HUD 显示 fps · p50 · 背板 · dpr · scale · **边距 Npx** · run/f/size

结论一（已修）：取景此前有两条"静默放弃/推断触发"路径
  · 目标比例放不下 ⇒ return null ⇒ 退回默认 zoom（边距 133px）
  · 只靠"尺寸漂移"推断该不该取景 ⇒ 数据晚到后不再触发
结论二（已修）：取景曾与三类时变量纠缠 —— 标签矩形（反馈环）、自转 yaw、呼吸/dolly
  现按 8 个 yaw 取并集 + 规范相机 + 挂载 1.5s 收束取景
结论三（已知项，未修）：首屏 zoom 仍在 113–121 摆动（约 ±7%）
  已排除 8 个候选（数据/安全区/投影复用/yaw/周期自愈/呼吸+dolly/事件时刻/标签）
  彻底消除需改为**解析式取景**（由环半径与层高直接算），单独立项
```

## 被否掉的方案（保留证据，避免重复提案）

| 提案 | 结论 | 证据 |
|---|---|---|
| 圆心加规模文字（`349 Agent` / `14 部门 · 9 成员`） | **否**：与「军团」标签、部门盘叠压，观感更差 | `evidence/legion-3d-499-core/desktop.png` |
| 部门标签矩形并入取景包围盒 | **否**：标签位置依赖 zoom ⇒ 反馈环 ⇒ 三个不动点 | 4 次加载 zoom 122/116/126 |


## 取景抖动 ±7%：6 个假设全部被证伪（停止追查）

```
现象：同一份编制数据连续加载，桌面 zoom 得到 113 / 115 / 121 / 121 等不同值（边距 72–122px）
影响：画面偶尔多留 5% 白边；不影响可用性、不裁切、不遮挡

被证伪的假设（每条都有 4 次对照数据）：
  1 编制/状态数据在变         → agents=351 / offline=220 恒定
  2 安全区测量不稳            → safeBounds 恒为 24,135,1208,864
  3 标签矩形并入取景（反馈环） → 撤销后仍抖动
  4 取景复用"当前帧投影"      → 改固定参考焦距后仍抖动
  5 自转 yaw（相对采样）      → 8-yaw 并集后仍抖动
  6 固定绝对 yaw 采样         → 实测 121/115/121/113，仍抖动
  另：删除每 60 帧自愈取景、去呼吸/dolly（规范相机）、1.5s 收束取景 均无效

结论：这不是参数问题，是**取景架构**问题。
根治方案：解析式取景（由环半径、层高、俯角直接算，不依赖投影采样），预计 2–3 h，需单独排期。
现状：作为已知项接受；凡涉及"改前/改后"的视觉对照，必须同一次加载内对比或用与取景无关的代理量。
```


## 军团 3D 五个读数（`.504` 起，均可复读）

| 读数 | 取值 | 判据 | 读法 |
|---|---|---|---|
| `data-zoom` | **123**（稳定态 6/6） | 稳定后必须一致；引导期读到的 112/126 属采样过早 | 页面根节点 `data-zoom` |
| 环边距 | 桌面 **81px** · 窄屏 **35px** | 不为 0、也不回到 133 / 41 | `?perf=1` HUD「边距 Npx」 |
| `labelMargin` | **131–134** | **≥ `LABEL_PAD`(12)**，低于即判"绕过 clamp" | `?debug=1` |
| `groupPointDelta` | **0.000** | **< 0.5px**（盘中心 vs 盘底光斑） | `?debug=1` |
| `edgeEnergy` | **7.7** | 相对基线 11.3 应显著更低 | `?perf=1` |

### 已知残余（`.504` 后仍存在）

```
1) zoom 偶发 126（约 1/9）：其余 8 次为 123，且 safeBounds / 画布 / 编制指纹三次复核完全相同
   现状：记录发生率，不继续追（前 7 个假设已证伪，第 8 个是解析式取景，已把主因消掉）
2) 短页面 +20px 竖向滚动：无单一责任人（已排除舞台/横幅/页面 min-height），需专门布局梳理
3) 层距 1.6 的圆心压痕 15.4px（外推 2% 后 12.7px）：默认保持 1.3，`?tier=1.6` 为变体
```


## 发布流程（每一步都有门禁，缺一步就不算发完）

```
1  生成：deploy/next-release.py --from <live> --to <target> --sha <main-sha>
   · 允许集与基准由 live（线上 health）派生；--from 不等于 live 时**在生成任何文件前**拒绝
   · 拒绝覆盖已存在的 run/publish 脚本（防旧脚本发新产物）
2  验收：deploy/run-NNN-final-acceptance.py
   · 20 套；拒绝复用陈旧 evidence（防旧结果冒充新结果）
3  发布：deploy/publish-NNN.py --source releases/preview.NNN-xxxxxxx
4  发布后：deploy/post-release-check.sh <产物SHA>
   · ① docs-ahead：产物 SHA..main 的差异必须全是文档
   · ② docs-consistency：状态板的 版本/commit/cwd/证据路径 必须与线上一致
   ⇒ 全部 PASS 才算发完；任一 FAIL 都要先修再收工
```


## 未发布的版本（记录，避免以后误以为漏发）

| 版本 | 状态 | 原因 |
|---|---|---|
| `.499` | 构建过、未发布 | 性能断言挂了一条（`perf:denseMedianFrame`），内容并入 `.500` |
| `.502` | 构建过两次、未发布 | CHANGELOG 出现两段互相矛盾的说明；内容并入 `.503` |
| `.508`（旧 SHA `db15a5ce`） | 验收通过但**未发布** | 该 SHA 的四条 CI run 卡在 `queued` 不推进；改用空提交 `9f6ca900`（代码树相同）重建并发布 |

`.508` 的内容：任务页 `From`/`To` 输入框补 `aria-label`（可访问名称 2 → 0）。
一旦 CI 放行：`collect-508-main-ci.py` → `publish-508.py` → `post-release-check.sh`。


## 可访问名称基线（`.510` 起，16 个页面）

```
判据：可交互元素（button/a/input/select/textarea/[role=button]）中，
      「无 aria-label / title / 文本 / alt 图、且未被 <label> 包裹」的数量
当前：16 页全部 0
口径与误报规则（必须带上，否则会误判）：
  · <label>文字<input/></label> 属隐式关联 ⇒ 算有名称
  · skip link（1×1，聚焦展开）不算违规
  · ::before 扩展过命中区的控件（健康横幅 CTA/关闭）不算"过小"
```


## 两条原理（今日沉淀，来自实际返工）

```
一、「手段窄」是代码属性，「影响窄」是几何属性，两者不自动相等
   · A 案只改一行（部门环外推 2%），却把 1.3 层距下的叠压对数从 6 推到 18
   · ⇒ 窄改也必须全量复测，不能因为"只动一处"就跳过判据

二、「重复的记录」比「缺失的记录」更糟
   · 缺一句是"不知道"，两段互相矛盾是"知道两个且无法判断哪个是真的"
   · `.502` 因此不发布：代码通过 20 套验收，但 CHANGELOG 出现两段 .502 说明
   · ⇒ 版本号冲突时，宁可重做一版把记录合并，也不带着矛盾上线
```

## 操作教训（可避免的时间损失）

```
· 不要用 `pgrep -f <模式>` 判断"某任务是否结束"：模式会匹配到执行这条命令的 shell 自身
  （今天因此让 .503 验收空转 6 分钟）⇒ 用 `wait <pid>` 或按端口/pid 精确检查
· 发布链的两道门禁今天各拦了一次：拒绝覆盖旧脚本（防旧脚本发新产物）、
  拒绝复用陈旧证据（防旧结果冒充新结果）
```


## 基线（绑定 `.487`/`.488`）

| 指标 | 值 |
|---|---|
| 桌面 18 页 | 15 页零报错 + 3 页已知权限 403（均正确降级） |
| 窄屏 390 / 320 | 横向溢出 0/18 |
| hydration 19 路由 | 0 报错 |
| 代理层只读 API 21 条 | 21/21 正常（3 个 admin 专属 403 除外） |
| 命令面板 | 打开期间无作用域请求 = 0 |

## 在等什么（材料均已备好）

| 待决 | 等谁 | 我这边的就绪度 | 落地预计 |
|---|---|---|---|
| A/B 两案是否设默认（`?weights` / `?intro2`） | admin | 默认开补丁 + `?weights=0/?intro2=0` 回退 + 8 张 `.485` 对照图 + 运行时钩子核对 | 50–60 分钟（含一次发布） |
| 圆角 6→8px 迁移 | 设计师 | R1 补丁 28 行（带回退）+ 163 条行号清单 + 三档截图流程 | 40–60 分钟（R1 批次） |
| 需求页搜索语义（`?q=` 命中面宽） | 通信欧 | 接口级数字：军团/Dashboard/TMWork → 200 条；zzz → 0 条 | 收到即 15–40 分钟 |
| 真机 GPU 帧率 | 有屏幕的人 | `https://dm.vansin.top/legion/3d?perf=1` 左上角一行读数 | 收到即 15 分钟 |
| #3191 真实账号回验 | 账号提供方 | Runbook：12 项只读 + 10 项写入 | 1–2 h |

## 池中待排期

| 卡 | 内容 | 估算 |
|---|---|---|
| #4583 | 服务器页第二步：创建/启停/重启/克隆（写操作，需权限合同） | 2–3 h |
| #4561 | 功能 × runtime 支持矩阵（数据来源需与 Hub 确认） | 2–3 h |

## 工程门禁（CI 四条 + 本地三条）

```
CI：gates（含字号/颜色两条审美棘轮）· unit tests · scrub-guard · OSS readiness
本地常用：tsc --noEmit · npm test（58/58）· scripts/check-scale-ratchet.mjs · scripts/check-color-ratchet.mjs
发布链：生成器（版本已涨自检）→ 同 SHA 构建（BUILD_COMMIT 断言）→ 20 套验收 →
        collect-*-main-ci.py（四条 headSha 必须等于本版）→ publish（缺 --source 会拒绝执行）
```

## 口径说明（对外提问的答案，避免重复猜测）

### `/servers` 匿名返回 200：公开外壳 + 认证数据

```
无登录态：/servers 200（外壳 37328 B）· /legion 200（38877 B）· /changelog 200 · /nodes 307（SSR 需 cookie）
匿名 HTML：主机名命中 0 · 节点别名命中 0
数据接口：未登录一律 401（/api/hub/servers、/api/hub/nodes …）
⇒ 与 /legion、/changelog 同型；非 .488 引入（本版未改鉴权）
⇒ 若要求"外壳也需登录"，属一批页面的统一口径变更，需 admin 定
```

### 2D 页字节变化（`.488`：39,016 → 39,785，+769）

```
几何对照（.487 vs .488，同一探针 evidence/probes/geom2d.mjs）：
  80 节点 · 共同 id 80 · 坐标不同 0 · 两侧独有 id 0
⇒ 几何：2D 视图节点位置未变（80 节点 · 坐标 0 差异）
⇒ 归一化 HTML diff（去掉 chunk 名 / 内联脚本 / 长 ID / 时间戳后）：
   class 集合一致（195）· 可见文本一致（343 字符）· data-* 一致
   标签只多 1 个 <script>（.488 多引一个 chunk）· src/href 7 处不同且全部是 chunk 名
⇒ 结构 / 文本 / class / data 均未变，差异只在产物层（chunk 引用）
证据：evidence/legion-2d-488/{geom-487.json, geom-488.json, html-diff.txt, diff-legion-html.py}
```

### 历史版本对照跑法（跨轮次进程需脱离会话）

```
setsid nohup env PORT=3301 npx next start -p 3301 > log 2>&1 < /dev/null &
export PLAYWRIGHT_BROWSERS_PATH=<workdir>   # 独立调用探针时必须带上
```

## 提交粒度的两条已知瑕疵（如实记录，不改历史）

```
① R1 提交（3f429be9，message 为「R1 圆角迁移」）里同时带上了 Runtime 支持速查的三份文件
   （app/lib/runtime-support-matrix.ts · app/components/RuntimeSupportMatrix.tsx · app/providers/page.tsx）
   原因：提交时用了 `git add -A app`，把同在工作区的改动一起带走
② 因此「矩阵预览」没有独立提交；功能已进 main，仅提交信息未单列
⇒ 规则改成：提交前先 `git status --porcelain` 看清单，再按清单逐项 add（不用 -A）
```

## 视觉门禁（2026-11-11 新增）

```
三件套（都可本地跑、都可复跑）：
1) r/h 比例规则：圆角/高度 ≤ 1/3；> 0.4 视为药丸。实测高度，不用 className 估算。
   · 153 处 6→8px；7 处保留 6px（5 个小 chip + HealthBanner 关闭按钮 + 1 注释）
2) 两条棘轮：scripts/check-scale-ratchet.mjs（rounded-md 7 / text-9,10 = 0）
             scripts/check-color-ratchet.mjs（131 / 1037 / 6 / 66，注释不计债、exception 仍生效）
   · 注意：一次回退要同时改两条基线（两处都数 rounded-md）
3) deploy/diff-guard.py：视图差异分类
   · 必须为 0：标签结构 / 可见文本 / class 集合 / data-*
   · 允许并记录：chunk 引用、buildId、URL 哈希
   · 声明式样式改动：--allow-class-change 'rounded-md,rounded-lg'（超出即 FAIL）
   · 相对时间归一化为 REL_AGO（时间流过 ≠ 视图变了，与 #418 同源）
   · 首跑 .488→.489：四路由 artifact-only，diff-guard: PASS
```

## 几何对照口径（2026-11-11 新增，工具：evidence/probes/geom-compare.mjs）

```
判决顺序：先锁集合，再比坐标
① 集合不同 ⇒ INVALID（exit 2），列出 only-A / only-B，**不输出位移数字**
② 集合同 ⇒ 位移 >0.5px 的节点数 + 最大位移（exit 0 = PASS）
③ --allow-subset --reason '…' ⇒ 用共同子集再算，结果标 SUBSET=true
```
```
实测（真实发生过的一次误读）：
A. geom-488 vs geom-489（跨时刻）：only-A 1 / only-B 1 ⇒ INVALID
B. same-488 vs same-489（同时刻同集合）：位移 0/80 · 最大 0px ⇒ PASS
C. A 两份 + --allow-subset：SUBSET=true · 共同 79 · 位移 60 · 最大 65.4px
⇒ 与设计师独立算出的 60 / 65.4 完全一致，说明"61/80 位移"确由 1 个 agent 换人引起
```

## 未决：两套圆角标准在 16–32px 区间冲突（2026-11-11）

```
· tier 规则（既有，与客户端对齐）：useRadiusTier.ts 给渲染高度 ≤32px 的控件打
  data-radius-tier="item"，globals.css 强制 border-radius: 8px !important
· r/h 规则（今日新立）：圆角/高度 ≤ 1/3；>0.4 视为药丸
⇒ 16px 按钮：tier 要 8px（0.5），r/h 要 6px（0.375）⇒ 直接冲突，且 class 改不动 !important

三条候选（已发设计师裁定）：
A. 保留 tier 8px，r/h 规则显式排除 ≤20px 控件（代价：只改规则与探针口径）
B. 保留 r/h，tier 分档 ≤20px→6px / 21–32→8px（代价：改 CSS+阈值，需重跑 7 页+20 套，1.5–2 h）
C. 去掉 tier 的 !important（代价：大量小控件回 6px，回归风险最高）

⇒ 未裁定前 R2–R6 圆角批次暂停，避免在冲突区间反复返工。
⇒ `.490` 的 CHANGELOG 写"失败横幅按钮已修"不准确：该按钮被 tier 覆盖，视觉未变，需更正。
```

## 发布基准只有一个来源：live（2026-11-11）

```
现象（跳号暴露）：next-release.py 已打印「live-basis 已校正为 .490」，但允许集仍按 --from 491 算
⇒ 基准与允许集是两处独立计算 ⇒ 必然可能不一致（与相机/tier/层高同族）

改造：允许集 = { live, target }，由线上 health 回读派生；--from 只作校验
  · 不等 ⇒ 生成任何文件之前就 SystemExit(2)，并打印正确值
  · 「跳号」与「同号重建」都自然成立，不需要人记住填什么
判据（已通过）：
  --from 491 --to 493 ⇒ REFUSE: 线上真实在跑的是 .490，请改用 --from 490
  --from 490 --to 493 ⇒ 越过守卫，继续到版本号检查
附带：陈旧发布标记自动清理并打印内容
```

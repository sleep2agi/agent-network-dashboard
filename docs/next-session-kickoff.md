# 下一次开工清单（军团 / Dashboard）· 2026-11-14 收尾

> 每个待办都附：① 需要谁给什么 ② 复制即用的命令 ③ 判据 ④ 预计耗时。
> 现状基线（2026-11-15 终态）：线上 `0.6.4-preview.568` / `9919e8bf`，
> 20 套件 20/20 · CI 4/4 · 自检 4/4 · 健康门 15/15（含白名单文案门 7 页 0 残留）· 军团探针 6/6，
> 回退锚点 `preview.567-d537571`。

## 〇、今天沉淀的 5 条硬规矩（下次开工先读）

```
1) 界面文案只属于显示层：测试/CSS/体检门一律用 data-* / testid 定位，禁止按可见文案或 aria-label 选择。
   已落地：data-nav-href（侧栏）· data-command-id（命令面板）· .anet-help（帮助浮层）
          data-servers-drawer（服务器抽屉）· data-node-alias / data-node-list-rail / data-task-id 等

2) 改一个可见标签，必须扫三种引用形态并确认残留 0：
   ① { name: 'X', exact: true }   ② /^X\s*\d+$/   ③ 三元表达式里的 'X'
   （.568 的 Refresh 22 处 + All 4 处都是这么清掉的）

3) 改过 verify-*.mjs 必须先删对应 *-<label> 腔本再跑验收，否则会复用旧探针的数字
   （legion 曾因此显示 268/272 —— 少 4 项仍"全绿"）

4) 时序类门（冷启动）必须在干净负载下测：并行构建/探针会把 2.6s 抬到 7.2s

5) 门与看图是两条互补证据：门查结构控件，看图查密排内容区
   （.568 任务行内 running/acked/HIGH 就是靠看截图发现的）
```
>
> 已完成（本日）：界面文案中文化全部收口 —— 首屏 7 页、侧栏 16 项、设置、管理台、
> 任务、需求、概览、命令面板（⌘K）、快捷键帮助浮层（`?`）；文案门（第 15 门）同时扫
> 首屏 / 面板 / 浮层，输出「残留=0 面板=0 浮层=0」。

## A. 视觉取向（需要负责人一句话）

| 事项 | 选项 | 材料 | 改法与复验 | 需时 |
|---|---|---|---|---|
| 俯角 | 保持 49°（建议）/ 43° / 31° | `docs/legion-3d-pitch.md`（四档截图 + 占安全区/越界量） | 改 `DEFAULT_VIEW.pitch`（0.75 / 0.855 / 0.541）→ `./deploy/legion-verify-all.sh` → 20 套件 → 发布 | 2 h |
| 中心区 | 保持混合（建议）/ big / ticks | `docs/legion-3d-variants.md`（4 倍放大图） | 翻 `CORE_PARAM` 默认常量 → 同上 | 2 h |
| 提示条遮挡 | 保持（建议）/ 8 秒自动淡出 | 残余 11（覆盖 9 个 Agent = 2.5%，可关闭） | 加 `setTimeout` 淡出 → 同上 | 1 h |
| 2D 入口 | 保持（建议）/ 侧栏加 3D / 画布重写 | 现状单入口 | 视选择而定 | 0–3 h |

## B. 残余 #12 —— 已定案：非缺陷，无需修（2026-11-15）

```
四档实测（evidence/probes/header-height-owner.mjs）：
  1920×1080 / 1440×900  标题块 98.5  工具条 28  header 98.5  图例 1 行
  1366×768  / 1280×720  标题块 115   工具条 60  header 115   图例 2 行

结论：真实差异 16.5px 来自图例文字换行；工具条 60px < 标题块 115px，对头部高度贡献为 0。
过程：曾试"窄屏让工具条独占整行"，工具条确实回到 28px，但头部升到 134.5px —— 已回退。
若将来要省这 16.5px，正确做法是把图例文案缩到一行内，而不是调整工具条。
```

## C. 跨引擎（需要一条 sudo）

```bash
sudo apt-get install -y libgtk-3-0t64 libpangocairo-1.0-0 libcairo-gobject2 libgdk-pixbuf-2.0-0
# 之后：
PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH node evidence/probes/legion-visual-spotcheck.mjs https://dm.vansin.top firefox
```

## D. 真机性能读数（需要有人打开一次）

```
打开 https://dm.vansin.top/legion/3d?perf=1 ，把页面上的帧率/耗时读数发回。
用途：目前所有性能数字来自无头环境（下载完成时刻被放大约 10 倍），只有真机读数能校准指标 4。
```

## E. 客户端对齐（需要对方回复）

| 事项 | 现状 | 需要 |
|---|---|---|
| 客户端自身 chrome（导航/手势/返回键） | 未知 | 通信客户端欧回复 |
| 节点生命周期写操作 | 本仓库无后端合同 | Hub/客户端给权限模型（谁能对哪个节点做哪一步、被拒如何回传） |
| 会话 / 模型切换 | 本仓库无相关路由 | 同上 |

## F. 常规复验（任何时候都能跑）

```bash
./deploy/legion-verify-all.sh                 # 6 支探针 → LEGION-VERIFY: PASS (6/6)
./deploy/health-all.sh                        # 14 门 → HEALTH-ALL: PASS (14/14)
deploy/post-release-check.sh 303e5d6b         # 4 项自洽
```

发布流程（改动落地时）：

```bash
python3 deploy/next-release.py --from 561 --to 562 --sha <merge-sha>
python3 deploy/run-562-final-acceptance.py
python3 deploy/collect-562-main-ci.py <merge-sha>
python3 deploy/publish-562.py --source releases/preview.562-<short> --yes
deploy/post-release-check.sh <short> && deploy/health-all.sh
```

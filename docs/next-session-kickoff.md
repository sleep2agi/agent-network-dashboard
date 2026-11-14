# 下一次开工清单（军团 / Dashboard）· 2026-11-14 收尾

> 每个待办都附：① 需要谁给什么 ② 复制即用的命令 ③ 判据 ④ 预计耗时。
> 现状基线：线上 `0.6.4-preview.561` / `303e5d6b`，判据链全绿，回退锚点 `preview.560-b14754f`。

## A. 视觉取向（需要负责人一句话）

| 事项 | 选项 | 材料 | 改法与复验 | 需时 |
|---|---|---|---|---|
| 俯角 | 保持 49°（建议）/ 43° / 31° | `docs/legion-3d-pitch.md`（四档截图 + 占安全区/越界量） | 改 `DEFAULT_VIEW.pitch`（0.75 / 0.855 / 0.541）→ `./deploy/legion-verify-all.sh` → 20 套件 → 发布 | 2 h |
| 中心区 | 保持混合（建议）/ big / ticks | `docs/legion-3d-variants.md`（4 倍放大图） | 翻 `CORE_PARAM` 默认常量 → 同上 | 2 h |
| 提示条遮挡 | 保持（建议）/ 8 秒自动淡出 | 残余 11（覆盖 9 个 Agent = 2.5%，可关闭） | 加 `setTimeout` 淡出 → 同上 | 1 h |
| 2D 入口 | 保持（建议）/ 侧栏加 3D / 画布重写 | 现状单入口 | 视选择而定 | 0–3 h |

## B. 残余 #12（需要一次真实浏览器 DevTools 会话）

```
现象：1280/1366 下页头 115px（1920 为 99px），工具栏盒 60px vs 28px；
     但两档 computed style 完全一致、子项同行且合计仅 495px、子项高 28px。
已排除（13 次尝试）：内边距/gap/字号、隐藏 1080p/导出循环/导出 PNG/平台视角及组合、
                     换行断点改 2xl、min-w-0 flex-1。
下一步：DevTools → Elements 选中 [data-testid="legion-3d-toolbar"]，
       在 1280 与 1920 各看一次 Computed + Layout（重点：是否有伪元素撑高、父级是否有 min-height）。
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

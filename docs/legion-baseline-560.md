# 军团基线快照 · `0.6.4-preview.560` / `b14754f3`（2026-11-14）

> 用途：交接与回归。任何后续改动只要与这张表比，就能判断"变好还是变坏"。
> 所有数字都来自**今天实际跑过的探针/门**，没有外推值；每条都附出处，便于重跑核对。

## 结构判据

| 指标 | 值 | 出处 |
|---|---|---|
| 取景越界（1440 / 390 / 320） | 越出安全区最大 12.5 / 3.0 / 0 px（全部 ≤16px 间隙） | `drift-clip` · 判据 19/19 PASS |
| 内容占安全区 | 1440 53%×101% · 390 92%×97% · 320 55%×94% | 同上 |
| 取景收束一致性 | zoom 1.187–1.21（≤1.7%），无「1.240 必现」 | `drift-clip` × 多轮 + `late-data-fit` |
| 标签落地率 | 四变体 × 三视口全绿（基线 39/39） | 健康门 `legion-label-drop` |
| 画布文字对比度 | 深/浅两主题 16 组全绿（≥4.0） | 健康门 `legion-canvas-text` |
| 窄屏溢出 | 320/390 横向溢出 0 | 健康门 `narrow-overflow` + `visual-spotcheck` |
| 导出 PNG | 1232×1059 · ≈1.9MB · 2.5s 内为真实头像 | 健康门/`export-check` |
| 目视抽检 | 三页 × 两视口 6/6 通过（无 pageerror、正文非空） | `visual-spotcheck` |

## 性能

| 指标 | 值 | 出处 |
|---|---|---|
| `/api/hub/people` 中位数 | **1020ms**（`.559` 为 1404ms，-27%） | `phase-timing` × 5 |
| 编制就绪中位数 | **3882ms**（`.559` 为 4296ms，-10.4%） | `phase-timing` × 5 |
| 冷启动门 | 1440 2954ms（3 次中位数）· 390 2562ms | 健康门 `legion-cold-start` |
| 首帧 | 195ms（DOMContentLoaded 77–212ms） | `phase-timing` |
| 理论上界（不发 messages） | people 722ms / 就绪 3477ms | 掐断实验 × 5 |

> ⚠️ 量法告警：无头 + SwiftShader 会把"下载完成时刻"整体推后（浏览器记 1.1s，curl 实测 60ms）。
> **绝对值不可用于驱动重构决策**；相对比较（同环境前后）有效。真机读数需 `/legion/3d?perf=1`。

## 俯角与中心区（决策材料）

| 俯角 | 环占安全区 | 越出安全区 | `?pitch=` |
|---|---|---|---|
| 31° | 53%×99% | 0.7px | 0.541 |
| 43° | 53%×100% | 7.3px | 0.75 |
| **49°（当前）** | 54%×102% | 13.7px | 0.855 |
| 54° | 55%×103% | 17.5px（>16px 间隙） | 0.942 |

| 中心区变体 | coreRx | 刻度环 | 环内规模数字 |
|---|---|---|---|
| **默认（混合）** | 55.5 | 15 段 | 有 |
| `?core=big` | 55.5 | 无 | 有 |
| `?core=ticks` | 34.5 | 15 段 | **无**（CORE_BIG=false 时不绘制） |

## 门禁与发布链（本次发布实测）

```
验收 20/20 套件（legion 272/272、detail 115/115、board 171/171 …）
CI 4/4（gates / scrub-guard / unit tests / OSS readiness）
发布自检 4/4 · 健康门 12/12（发布后 + 清理后各一次）
回退锚点 preview.559-4ea9122 在磁盘上可回退
```

## 已知残余

| # | 现象 | 数字 | 状态 |
|---|---|---|---|
| 7 | `/legion/plaza` 移动端一屏多滚 | 390：140px（卡片渐进加载方差大） | 未修（无法用溢出证明） |
| 9 | 部门盘描边擦安全区 | 1440 12.5px / 390 3.0px | 在 16px 间隙内，记取舍 |
| 10 | 取景 zoom 残余方差 | 1.187–1.21（≤1.7%） | 主要已修（`.558`），残余记录 |
| 11 | 底部提示条压最外层环 | 覆盖 9 个 Agent（2.5%），可关闭 | 记取舍（可选 8s 淡出） |

## 一键复跑

```
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:?先指向本机 ms-playwright 目录}"
node evidence/probes/legion-drift-clip.mjs        https://dm.vansin.top
node evidence/probes/legion-label-drop.mjs        https://dm.vansin.top
node evidence/probes/legion-phase-timing.mjs      https://dm.vansin.top 1440
node evidence/probes/legion-pitch-param.mjs       https://dm.vansin.top
node evidence/probes/legion-visual-spotcheck.mjs  https://dm.vansin.top 560
./deploy/health-all.sh                            # 12 门
```

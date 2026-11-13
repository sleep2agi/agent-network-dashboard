# 军团 3D 现状一页纸（`.536` · 2026-11-13）

> 给"要不要改、改哪个"这个判断用的一页材料。所有数字都来自线上实测，命令可复跑。

## 一、线上

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.536` / `674a991a` |
| 页面 | https://dm.vansin.top/legion/3d （2D 页 `/legion` 页头有「3D 视图」入口） |
| 回退锚点 | `preview.535-d5bab7a` |
| 终检 | `./deploy/health-all.sh https://dm.vansin.top` → **PASS (11/11)** |

## 二、四种中心区（控制条「核心：…」点击循环，整页重载）

| 变体 | URL | 桌面 | 390 | 一句话 |
|---|---|---|---|---|
| **环（当前默认）** | 无参数 / `?core=ticks` | ticks 14 | ticks 6 | 部门刻度环，结构一眼可读 |
| 大 | `?core=big` | big 1 | big 1 | 核心放大 1.6×，`352 Agent / 14 部门 · 9 成员` 进核心 |
| 混合 | `?core=both` | ticks 14 + big 1 | ticks 6 + big 1 | 规模在核心、结构在外圈，两者同时可见 |
| 干净 | `?core=off` | 无刻度 | 无刻度 | 只剩标识，留白最多 |

对照材料（线上实拍 4 方案 × 2 视口）：`evidence/legion-center-compare-535/compare.html`

## 三、可读性 / 流畅度 / 等待感（都有数字）

| 维度 | 工具 | 线上读数 |
|---|---|---|
| DOM 文字对比度 | `deploy/contrast-check.mjs` | 20 路由 × 2 主题（40 页）**0 处** <4.5 |
| canvas 文字对比度 | `evidence/probes/legion-canvas-text-contrast.mjs` | 4 变体 × 2 视口：**5.95–8.75**（判据 ≥4.0） |
| 标签落地率 | `evidence/probes/legion-label-drop.mjs` | 1440 4/4 · 390 5/5 · 320 7/6（86%） |
| 冷启动就绪 | `evidence/probes/legion-cold-start.mjs` | 1440 **3.2s** · 390 **2.6–4.6s**（判据 ≤6s） |
| 帧率（软件渲染下限） | `?perf=1` | 1440 **24.5fps** / p50 33.4ms · 390 60fps |
| 帧时间归因 | `evidence/legion-fps-matrix-536/` | 光流/自转**非瓶颈**（全关仅 +9%）⇒ 不做"低配关特效" |
| 320 溢出 | `deploy/narrow-overflow.mjs` | 20 路由 × 320 **0 溢出** |
| 离线（Hub 不可达） | `deploy/offline-hint.mjs` | 4 路由全部给出提示（红幅「CommHub unreachable」+ 网络选择提示），非空白 |
| 长时运行（160s） | 手写采样（见 evidence/legion-soak-536） | JS 堆稳定 20.7MB · DOM 273 恒定 ⇒ 无泄漏信号 |

```
说明：仅 160 秒/单视口；会议室常开数小时未测（脚本把采样次数调到 60 即可，约 20 分钟）。
未带 ?debug=1 时 nodeCount 不导出、未带 ?perf=1 时 fps 不渲染，故这两项在本次采样里为空。
```

## 四、切中心区会不会影响别的东西

```
不会：四步切换探针 12/12（环→大→混合→无→环 × 2 视口），
      混合态必须 coreBig=1 且 coreTicks>0 同时成立；
      legion 272 项验收（含几何/坐标断言）在 .535 引入混合态后仍全过。
切换是整页导航，其它参数（focus / perf / 视角）原样保留。
```

## 五、待决策 / 待输入

| 项 | 需要什么 | 工时 |
|---|---|---|
| 中心区默认值 | 「留环 / 换大 / 换混合 / 换干净」 | 30 分钟改 + 1.5–2 h 发布 |
| 客户端对齐 2 项 | 客户端侧"有 / 没有 / 不同" | 1–3 h |
| WebKit/Safari | 允许 `sudo npx playwright install-deps webkit` | 25 分钟 |
| 真机 fps | 在有屏机器开 `/legion/3d?perf=1` 回读数 | 判断 + 调优 |

## 六、真机 fps 怎么用这组锚点

```
本机软件渲染（SwiftShader）1440 = 24.5fps，是"最差环境"的下限参考。
真机读到 ≥24.5 ⇒ 渲染不是瓶颈；< 24.5 ⇒ 需要看设备/降级（方向是减绘制量，不是砍特效）。
```

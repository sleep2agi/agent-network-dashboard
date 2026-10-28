# 浏览器侧检查脚本（2026-10-27）

这三条都是**手动跑**的（需要跑着的 app + Playwright 浏览器），不在 `npm run gates`
里 —— gates 的四道检查是纯 Node、秒级、CI 友好。分工如下。

## 1. `npm run a11y:contrast` — 全站文字对比度

```bash
BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx npm run a11y:contrast
```

- 扫 12 个页面 × 2 个主题（cyber / light）的**所有叶子文本**；
- 按 WCAG 阈值判定（大字 24px+ 或 18.66px+粗体 → 3:1，其余 4.5:1）；
- 背景取最近的、不透明度 >0.6 的祖先背景色；
- 跳过隐藏元素、`opacity<0.4`、半透明前景（装饰分隔符）；
- 有违规退出码 1。

覆盖不到：Canvas 画的文字（见第 2 条）、SVG 里 `fill=` 的文字
（`/legion` 的节点名走 DOM 扫描，能覆盖；`/legion/3d` 的画布不能）。

## 2. `npm run a11y:canvas` — 3D 画布

```bash
BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx npm run a11y:canvas
```

两段：

1. **画布烟雾断言**：新开页面后 `canvas.width > 300` 且亮像素 ≥50。
   防的是「初始化被 skip → 300×150 空白」（真发生过，HMR 后截图看不出来）。
2. **标签对比度探针**：用页面同一套 token + 11px 字号真的画一遍文字，
   按渲染后像素算对比度（alpha 下限 0.8，即远端标签最坏情况）。

## 3. `npm run smoke:legion` — 军团两页交互冒烟

```bash
BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx npm run smoke:legion
```

6 项断言，每一项都对应一个真实踩过的坑：

| 断言 | 防的是什么 |
| --- | --- |
| 3D 画布已渲染 | 初始化被 skip → 空白页 |
| 搜索命中 / 无结果 / 清空 | 无结果一片黑、无法恢复 |
| 部门聚焦（chip 出现） | 聚焦链路断掉 |
| 导出全分辨率（PNG 宽 ≥1000） | 交互期 0.6× 背板被导出 |
| 2D 列表选中 + 回车打开 | 键盘走不到 Agent |
| 无 pageerror | — |

## 与 gates 的关系

| 层级 | 内容 | 运行时机 |
| --- | --- | --- |
| `npm run gates` | color-ratchet、头像池、token 对比度、写死文字色棘轮 | 每次提交（纯 Node，秒级） |
| 上面三条浏览器检查 | DOM / Canvas / 交互 | 发版前、改军团或主题后 |

token 级对比度已经能在 gates 里拦住「选错颜色」；浏览器三条拦的是
「token 对了但用法错了」（淡出过度、画布没渲染、导出分辨率等）。

# Dashboard 状态板（随版本更新）

> 用途：一眼看清「线上是什么、什么还没发、什么在等谁」。
> 每个结论都绑定版本号；过期即改，不引用旧结论。

## 线上

| 项 | 值 |
|---|---|
| 版本 | `0.6.4-preview.488` |
| commit | `a16fb6908b8aaed3d120f739ca12231f6060104a` |
| 公网 | https://dm.vansin.top |
| 进程 | pm2 `anet-dashboard` · cwd `releases/preview.488-a16fb69` |
| 回滚锚点 | `preview.487-413614f`（切换目录 + `pm2 restart anet-dashboard`） |

## 今日已上线（各自只做一件事、各自可独立回滚）

| 版本 | 内容 | 现场证据 |
|---|---|---|
| `.484` | 军团 3D：>250 节点拖动时画面放大/裁切修复；新增 `?perf=1` 读数 | 拖动中背板 2464→1478（ratio 0.600），松手 restored=true |
| `.485` | 定时任务页权限降级；节点页相对时间 hydration 修复 | 403 五条断言全过；`/nodes` pageErrors `[]`（原 React #418） |
| `.486` | 三处重复流量：`/versions`·`/admin` 切 lite、`/versions` 轮询 30s、聊天面板 SWR 去重 | `/nodes` status 3→2 次（775→517 KB）；`/versions` 35s 7→2 次（8606→891 KB/分） |
| `.487` | 命令面板两处取数带网络作用域 | Ctrl+K 期间 unscoped 2→0，面板仍可开 |
| `.488` | 服务器页每台机器可展开看节点清单（只读） | 3→3 条、90→40+余数行、1→1 条 |

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
export PLAYWRIGHT_BROWSERS_PATH=/home/vansin/.cache/ms-playwright   # 独立调用探针时必须带上
```

## 提交粒度的两条已知瑕疵（如实记录，不改历史）

```
① R1 提交（3f429be9，message 为「R1 圆角迁移」）里同时带上了 Runtime 支持速查的三份文件
   （app/lib/runtime-support-matrix.ts · app/components/RuntimeSupportMatrix.tsx · app/providers/page.tsx）
   原因：提交时用了 `git add -A app`，把同在工作区的改动一起带走
② 因此「矩阵预览」没有独立提交；功能已进 main，仅提交信息未单列
⇒ 规则改成：提交前先 `git status --porcelain` 看清单，再按清单逐项 add（不用 -A）
```

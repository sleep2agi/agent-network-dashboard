# 文档索引

设计稿、可靠性记录与安全门说明。截图在 `images/`。

## 设计与界面

- [design-task-chat.md](design-task-chat.md) —— 任务聊天面板设计方案：在 Dashboard 上像聊天一样给 Agent 派活、看回复。
- [mobile-app.md](mobile-app.md) —— Web / 桌面 / 移动三个薄壳如何共用同一套 Dashboard UI。

## 可靠性与发布

- [chat-ha-preview.md](chat-ha-preview.md) —— 聊天预览改造：web、桌面与 CLI 内置 Dashboard 共用同一聊天面板与 `/api/hub/send` 路由，一处升级三端受益。

## 安全

- [oss-security-gates.md](oss-security-gates.md) —— 仓库的 OSS 安全门：凭据、不可移植路径、依赖、lint、生产构建与历史扫描各查什么。

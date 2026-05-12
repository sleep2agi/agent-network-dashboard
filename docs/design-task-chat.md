# Task Chat Panel — 设计方案

## 需求
在 Dashboard 上直接与 Agent Node 对话式交互，像聊天窗口一样发任务、看回复。

## 交互流程

```
用户点击 "Chat" 按钮（Node 卡片/Nodes 列表/NodeDetail）
    ↓
右侧滑出 Chat Panel（固定宽 400px，全高）
    ↓
加载该节点最近 20 条 task+reply 历史
    ↓
用户在底部 textarea 输入任务内容
    ↓
Cmd+Enter 或点 Send 发送
    ↓
消息出现在聊天区（右侧气泡，带 spinner）
    ↓
状态条实时更新：created → delivered → running → replied
    ↓
Node 回复显示为左侧气泡（markdown 渲染）
    ↓
可继续发送下一条（不关面板）
```

## 组件拆分

### 1. TaskChatPanel (新组件)
- 位置：右侧滑出面板（slide-over），固定定位
- Props: `alias: string, onClose: () => void`
- 内部状态：messages[], input, sending, taskStatus

### 2. ChatMessage (子组件)
- 类型：outgoing (用户发的 task) / incoming (node 的 reply)
- outgoing: 右对齐，蓝/cyan 色气泡
- incoming: 左对齐，绿色气泡，markdown 渲染
- 状态条：created → delivered → running → replied（带动画过渡）

### 3. ChatInput (子组件)
- Auto-resize textarea
- 优先级选择（small dropdown: normal/high/low）
- Cmd+Enter 发送
- 发送按钮带 loading 状态

## API

### POST /api/hub/send-task (新建)
```json
Request:  { alias, task, priority }
Response: { ok, task_id, message_id }
```
后端：hubFetch POST /api/task（已有）

### GET /api/hub/tasks?to_name=<alias>&limit=20
已有，获取历史任务

### GET /api/hub/tasks?task_id=<id>
已有，轮询单条任务状态

## 入口
1. Sidebar: 不加（太多了）
2. AgentCard: 加 chat 图标按钮
3. Nodes 列表: 每行已有 Send Task → 改成 Chat
4. NodeDetail: Send Task 区域改成 Chat Panel trigger
5. Overview Quick Actions: 不加

## 实时状态
发送后每 2s 轮询 GET /api/hub/tasks?task_id=xxx：
- status 变化时更新状态条动画
- status === 'replied' 时显示 result 内容
- 30s 无变化停止轮询

## UI 风格
- 面板背景：#0d0d1a（和 sidebar 一致）
- 气泡：参考 Messages 页样式
- Markdown：用 简单的 pre/code 高亮（不引入重依赖）
- 状态动画：CSS transition 颜色变化 + pulse

## 不做
- WebSocket 双工通信（用轮询，简单可靠）
- 多节点同时聊天（一次只开一个面板）
- 消息编辑/删除

# 单连接 IPC + 选择性转发 设计文档

**日期**: 2026-05-31
**状态**: 待评审
**参考**: [pi-feishu-cli-rebuild-design](./2026-05-30-pi-feishu-cli-rebuild-design.md)

---

## 1. 背景

当前实现有两个偏差：

1. **IPC 多连接**：IPCServer 支持多个 Extension 同时连接（`7788879`），与 spec 4.2 定义的 "Daemon 同时只服务 1 个 Extension 连接" 不一致
2. **TUI 无条件同步**：Pi TUI 的所有对话都自动转发到飞书（`before_agent_start` + `message_update` + `message_end`），产生噪音

本次修正：
- 变更 1：IPCServer 恢复单连接设计
- 变更 2：仅飞书触发的对话响应转发到飞书，TUI 对话不再同步

---

## 2. 变更 1：IPCServer 单连接

### 2.1 变更内容

将 IPCServer 回退到 commit `d24e26f` 的原始实现：

- `_activeSocket: net.Socket | null` 替换 `_sockets: Set<net.Socket>`
- `listen()` 中新增连接先检查 `_activeSocket`：已有连接则发 `bye` 后关闭新 socket，emit `reject`
- `sendToClient(msg)` 只发给 `activeSocket`，返回 `boolean`
- 移除 `socketCount` getter
- `close()` 清理单个 socket

### 2.2 Daemon 配合变更

- **恢复** `ipcServer.on("reject", ...)` 事件处理，记录拒绝日志
- **保留** `connectChannel()` 中的 `if (channel?.connected) await channel.disconnect()` — 防飞书重复连接
- **保留** `connect` 事件的 ready/needAuth 逻辑不变

### 2.3 Extension 不变

Extension 只通过 `IPCClient` 与 daemon 通信，IPCServer 内部改为单连接对 Extension 透明。`client.ts` 也不需改动。

---

## 3. 变更 2：选择性 Pi→飞书转发

### 3.1 策略

用 `Set<string>` 跟踪当前正在被飞书触发的 sessionFile，仅在飞书触发的 assistant 响应期间转发：

```
飞书消息 → add(sessionFile) → sendUserMessage → Agent处理
  ├─ message_update → has(sessionFile)? ✓ → 转发
  └─ message_end → has(sessionFile)? ✓ → 转发, delete(sessionFile)

// 之后 TUI 同 session 对话
TUI用户发消息 → Agent处理
  ├─ message_update → has(sessionFile)? ✗ → 不转发
  └─ message_end → has(sessionFile)? ✗ → 不转发
```

### 3.2 具体变更

1. **新增** `forwardingSessions = new Set<string>()`
2. **删除** `pendingInjects`、`injectSequence` 及相关 tag 前缀逻辑
3. **删除** `pi.on("before_agent_start", ...)` hook
4. **飞书消息注入点**：在 `message` handler 的三条注入路径中，均在 `sendUserMessage` 前调用 `forwardingSessions.add(sessionFile)`：
   - 有 session → `switchSession` + `withSession` + `newCtx.sendUserMessage()`
   - 无 session → `ctx.newSession` + `withSession` + `newCtx.sendUserMessage()`
   - 无 session + 无 withSession → `pi.sendUserMessage()`（注意：此路径可能无法获取 sessionFile，需自行提取）
5. **`message_update` hook**：增加 `forwardingSessions.has(sessionFile)` 前置判断
6. **`message_end` hook**：增加 `forwardingSessions.has(sessionFile)` 前置判断 + 转发后 `forwardingSessions.delete(sessionFile)`
7. **删除** `pi.on("session_shutdown", ...)`（仅清理 pendingInjects）

### 3.3 循环防止

当前设计中飞书消息注入使用 tag 前缀机制防止 `before_agent_start` 反向转发循环。删除 `before_agent_start` 后不再存在反向转发路径，tag 机制不再需要。

---

## 4. 受影响文件

| 文件 | 变更类型 |
|------|----------|
| `src/ipc/server.ts` | 回退到原始单连接实现 |
| `src/daemon/index.ts` | 恢复 `reject` 处理器 |
| `extensions/index.ts` | 删除 TUI 同步，新增转发 set |
| `tests/ipc/server.test.ts` | 修改多连接测试为单连接测试 |

---

## 5. 边界条件

- **Daemon 已有连接时新 Extension 尝试连接**：IPCServer 发 `bye` 拒绝，IPCClient 已处理 `bye` 消息（自动断连）。Extension 中 `/feishu-im start` 的 `getClient` 检测到 `bye` 会 disconnect，需通知用户
- **Extension 崩溃重连**：原连接断开后 `_activeSocket` 清空，新连接正常接受
- **sendUserMessage 抛异常**：`forwardingSessions` 中对应的 sessionFile 残留。需在异常路径中清理（`try/finally`）

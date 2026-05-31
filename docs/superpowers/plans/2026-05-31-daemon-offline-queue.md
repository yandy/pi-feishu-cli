# Daemon 离线消息队列实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 实现设计文档 3.1 中离线部分：Pi 退出时 Daemon 不退出；socket 断开后暂存飞书消息并自动回复"Pi 暂时离线"；Extension 重连后恢复转发。

**Architecture:** Daemon 维护 pendingMessages 内存队列。channel `message`/`cardAction` 回调先 `sendToClient()`，失败则入队。`connect` 事件 flush 队列。

**Tech Stack:** TypeScript, Node.js net, vitest (TDD)

---

### Task 1: 实现 pendingMessages 缓冲 + 自动回复 + flush

**要求:**
- 在 main() 的 streamMap 之后添加 `pendingMessages: DaemonMessage[]`
- 添加 `flushPending(socket: net.Socket)` 函数遍历队列写入 socket 并清空
- 重构 channel `message` 回调：
  - 先构建 DaemonMessage，调用 ipcServer.sendToClient()
  - 若返回 false → pendingMessages.push() + channel.send(chatId, { text: "Pi 暂时离线，请稍后再试。" }, { replyTo: msg.messageId })
  - channel?.connected 为 true 时才 auto-reply
- 重构 channel `cardAction` 回调：
  - 先 sendToClient()，失败则入队（不需 auto-reply）
- 在 connect 事件的每个 ready/needAuth 分支后调用 flushPending(socket)
- 注意：已有 `ipcServer.on("disconnect")` 仅做 log，保留不动

**文件:**
- Modify: `src/daemon/index.ts`

**Context:**
- 目前 daemon 的 message/cardAction 回调直接调用 sendToClient()，不做离线处理
- connect 事件只发 ready/needAuth，不 flush
- DaemonMessage 已定义在 src/ipc/protocol.ts 中
- IPCServer.sendToClient() 无客户端时返回 false

**TDD:** 先写测试再实现。测试验证：
1. `sendToClient()` returns false when no client
2. Pending messages are flushed to reconnecting client
3. Empty queue flush is a no-op

### Task 2: 编写集成测试 — 离线完整流程

**要求:**
- 测试：3 条消息离线到达 → 缓冲 → 客户端连接 → flush → 客户端收到 3 条
- 测试：cardAction 离线到达 → 缓冲 → flush
- 测试：无缓冲消息时 flush 不报错

**文件:**
- Create: `tests/daemon/offline-queue.test.ts`

**Context:**
- 使用 createIPCServer + net.createConnection 构建测试
- pendingMessages 是 daemon 内部数组，集成测试通过模拟 daemon 行为验证
- 测试不启动真实 daemon 进程，直接使用 IPCServer + 手动管理 pendingMessages 数组

**TDD:** 先写测试，确认测试正确验证行为，再确认实现满足测试。

### Task 3: 最终验证

- [ ] **运行全部测试**: `npm test` — all pass
- [ ] **TypeScript 检查**: `npm run check` — no errors
- [ ] **读最终代码**: 确认实现完整

# 差距修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 修复设计文档与代码实现之间的 8 个差距（fire: #1 reaction, #4 delete newSession, #8 模型路径; minor: #2 AUTH_FILE, #3/#5 handleModelAction, #6 README, #7 unlinkSync）

**Architecture:** 各个修复相互独立，可并行执行。

**Tech Stack:** TypeScript, Node.js, vitest (TDD)

---

### Task 1: reaction 事件管道 (#1)

**Files:**
- Modify: `src/daemon/index.ts`
- Modify: `extensions/index.ts`

**要求:**
- Daemon `connectChannel()`: 增加 `channel.on("reaction", ...)` 回调
  - 回调参数格式: `{ messageId, chatId, userId, emoji, added }`（由 Channel SDK 定义）
  - 构建 `DaemonMessage` 类型 `{ type: "reaction" } & ReactionPayload` 并通过 `sendToClient()` 转发
- Extension IPC message handler `switch(msg.type)`: 增加 `case "reaction"` 分支
  - 目前仅 `ctx.ui.notify()` 显示 reaction 通知（如 `"用户 ${msg.userId} ${msg.added ? '添加' : '移除'}了表情 ${msg.emoji}"`）
  - 飞书侧 reaction 已由 Channel SDK 自动处理，Pi 无需特殊响应

**TDD:** 
1. 检查 protocol.ts 中 ReactionPayload 格式确认消息形状
2. 在 daemon 中添加 reaction handler，在 extension 中添加 case
3. 运行全部测试确认无回归

**Context:**
- `ReactionPayload` 定义在 `src/ipc/protocol.ts`:
  ```typescript
  export interface ReactionPayload {
    messageId: string;
    chatId: string;
    userId: string;
    emoji: string;
    added: boolean;
  }
  ```
- Daemon `connectChannel()` 中现有 channel event handlers：lines 46-101
- Extension IPC message handler 现有 case: lines 143-327
- Channel SDK 的 reaction 事件: `channel.on("reaction", (event) => { ... })` — event 包含 `messageId`, `chatId`, `userId`, `emoji`, `added`

### Task 2: AUTH_FILE 常量 + unlinkSync 统一 (#2, #7)

**Files:**
- Modify: `src/auth/index.ts`
- Modify: `extensions/index.ts`

**要求:**
- `src/auth/index.ts`: 导入 `AUTH_FILE`，在 `loadAuth`/`saveAuth` 中用 `AUTH_FILE` 替换 `join(dir, "auth.json")`
  - 保持函数签名不变（仍接受 `dir` 参数），但内部路径使用 `AUTH_FILE`
- `extensions/index.ts` restart 子命令: `rmSync(SOCKET_PATH)` → `unlinkSync(SOCKET_PATH)`

**TDD:** 运行全部测试确认无回归

### Task 3: handleModelAction 重构 (#3, #5, #8)

**Files:**
- Modify: `extensions/bot-commands/model.ts`
- Modify: `extensions/index.ts`

**要求:**
- `handleModelAction` in `model.ts`:
  - `switchSession` 改用 `withSession` 模式，避免 stale context
  - 处理未绑定路径: 当 `registry[chatId]` 不存在时，先 `ctx.newSession()` 创建绑定
  - 函数签名改为支持 `newSession`: `ctx: { switchSession, newSession, getSessionFile, modelRegistry }`
- `extensions/index.ts` cardAction 处理:
  - 导入并使用 `handleModelAction` 替换内联的模型切换逻辑（lines 284-305）
  - 删除内联的 `pi.setModel` + `switchSession` + `buildModelCard` 代码，改为调用 `handleModelAction`

**TDD:** 运行全部测试确认无回归

### Task 4: delete 操作先 newSession (#4)

**Files:**
- Modify: `extensions/bot-commands/sessions.ts`

**要求:**
- `handleSessionsAction` 中 `case "delete"`:
  - 先调用 `ctx.newSession()` 创建新 session
  - 再删除旧 session 文件 `rmSync(action.sessionPath, { force: true })`
  - 最后从 registry 移除 `delete registry[chatId]`
  - 调用 `ctx.getSessionFile()` 获取新 session 路径并写入 registry

**TDD:** 运行全部测试确认无回归

**Context:** current `case "delete"`:
```typescript
case "delete":
  rmSync(action.sessionPath, { force: true });
  delete registry[chatId];
  break;
```

### Task 5: README 更新 (#6)

**Files:**
- Modify: `README.md`

**要求:**
- 第 44 行: "双向同步" → "飞书到 Pi 单向转发"
- 第 50 行: "飞书与 Pi 终端对话双向同步" → "Pi 的回复以流式形式返回飞书"
- 第 45 行: 更新描述反映 `forwardingSessions` 模式

**TDD:** 无需测试，纯文档更新

### Task 6: 最终验证

- [ ] **运行全部测试**: `npm test` — all pass
- [ ] **TypeScript 检查**: `npm run check` — no errors

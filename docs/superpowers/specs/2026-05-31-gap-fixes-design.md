# 差距修复设计文档

**日期**: 2026-05-31
**状态**: 待评审
**参考**: 
- [pi-feishu-cli-rebuild-design](./2026-05-30-pi-feishu-cli-rebuild-design.md)
- [feishu-bot-commands-design](./2026-05-31-feishu-bot-commands-design.md)
- [single-ipc-forwarding-design](./2026-05-31-single-ipc-forwarding-design.md)

---

## 1. 修复列表

| # | 差距 | 严重程度 | 涉及文件 |
|---|------|---------|---------|
| 1 | `reaction` 事件类型已定义但 Daemon/Extension 均未处理 | 严重 | `src/daemon/index.ts`, `extensions/index.ts` |
| 2 | `AUTH_FILE` 常量已定义但未使用 | 轻微 | `src/auth/index.ts` |
| 3 | `handleModelAction` 已导出但 Extension 未使用（内联逻辑代替） | 轻微 | `extensions/index.ts` |
| 4 | `delete` 操作未先 `ctx.newSession()` | 中等 | `extensions/bot-commands/sessions.ts` |
| 5 | `handleModelAction` 中 `switchSession` 未使用 `withSession` | 轻微 | `extensions/bot-commands/model.ts` |
| 6 | README 声称"双向同步"但 TUI→飞书转发已移除 | 轻微 | `README.md` |
| 7 | Extension `restart` 用 `rmSync` 清理 socket（与 Daemon 的 `unlinkSync` 不一致） | 轻微 | `extensions/index.ts` |
| 8 | Model cardAction 未绑定路径用 `pi.setModel` 直接修改当前 session | 中等 | `extensions/index.ts` |

## 2. 各修复详述

### 2.1 #1: reaction 事件管道

**问题**: `protocol.ts` 定义了 `ReactionPayload` 和 `"reaction"` 消息类型，但：
- Daemon 未注册 `channel.on("reaction", ...)`，飞书表情反应不会进入 IPC
- Extension 未处理 `case "reaction"`，即使收到也会被静默丢弃

**修复**:
- Daemon `connectChannel()`: 增加 `channel.on("reaction", ...)` 回调，构建 `ReactionPayload` 并通过 `sendToClient()` 转发
- Extension IPC message handler: 增加 `case "reaction"` 分支，目前仅 log（飞书侧 reaction 已由 Channel SDK 自动处理，Pi 无需特殊响应）

**消息格式**（已有）：
```typescript
{ type: "reaction"; messageId: string; chatId: string; userId: string; emoji: string; added: boolean }
```

### 2.2 #2: AUTH_FILE 常量

**问题**: `src/config.ts` 中 `export const AUTH_FILE = join(FEISHU_IM_DIR, "auth.json")` 未在任何地方使用。`src/auth/index.ts` 内部自己拼路径。

**修复**: `src/auth/index.ts` 导入并使用 `AUTH_FILE` 替换硬编码的 `join(dir, "auth.json")`。注意 `loadAuth`/`saveAuth` 仍接受 `dir` 参数保持接口不变，内部用 `AUTH_FILE` 计算路径。

### 2.3 #3 + #5 + #8: handleModelAction 重构

**#3 handleModelAction 未使用 + #5 withSession 缺失 + #8 未绑定路径问题**

这三个差距相关，一起修复：

**修复**:
1. `extensions/bot-commands/model.ts:handleModelAction`:
   - 修改 `switchSession` 调用为 `withSession` 模式（传递 `getSessionFile` 获取新 sessionFile）
   - 处理未绑定路径：当 `registry[chatId]` 不存在时，调用 `ctx.newSession()` 创建绑定
   
2. `extensions/index.ts`:
   - 导入 `handleModelAction` 替换内联模型 cardAction 逻辑
   - 删除内联的 `pi.setModel` + `switchSession` + `buildModelCard` 代码

### 2.4 #4: delete 操作先 newSession

**问题**: `handleSessionsAction` 在 `case "delete"` 直接删除 session 文件和解绑，未先创建新 session。若删除的是当前 session，Pi 可能处于无 session 状态。

**修复**: 在 `delete` case 中，先调用 `ctx.newSession()` 创建新 session，再删除旧 session 文件并解绑。

### 2.5 #6: README 更新

**问题**: README 第 44、50 行提到"双向同步"，但实际 TUI→飞书转发已被移除（`forwardingSessions` 模式）。

**修复**: 
- 第 44 行：`双向同步` → `飞书到 Pi 单向转发`
- 第 50 行：`飞书与 Pi 终端对话双向同步` → `Pi 的回复以流式形式返回飞书`
- 第 45 行：更新描述以匹配当前架构

### 2.6 #7: 统一 unlinkSync

**问题**: Extension `restart` 子命令用 `rmSync` 清理 socket 文件，Daemon 用 `unlinkSync`。

**修复**: Extension 的 socket 清理改为 `unlinkSync`。

---

## 3. 不变内容

以下功能已验证正确，无需改动：
- 所有管理命令（start/stop/restart/status）
- 单连接 IPC
- 选择性 Pi→飞书转发（forwardingSessions）
- 离线消息缓冲（已在上次实现）
- 凭据管理流程
- 流式消息
- /help, /sessions, /model 命令卡片构建
- BotCommand 类型（继续保持 key 风格）

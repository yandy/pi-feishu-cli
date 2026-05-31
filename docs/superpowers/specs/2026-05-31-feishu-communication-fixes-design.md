# 飞书机器人通信问题修复 - 设计文档

**日期**: 2026-05-31
**状态**: 待评审
**参考**: [fix-log.md](../../fix-log.md)

---

## 1. 架构重设计

### 1.1 Session / Chat / Registry 关系

**前提约束**: `ctx.switchSession()` 在异步回调中不可靠（会导致 stale ctx），消息处理无法在异步回调中做 per-chat session 切换。

**使用场景**: 单 chat（一对一对话），但在对话中管理多个 Pi session。

**设计决策**:

- 所有 chat 消息使用当前 TUI session：`pi.sendUserMessage(prompt)` 发到当前 Pi session，不切换 session
- Registry 职责缩小为「机器人 session 白名单」：记录哪些 session 文件是由机器人产生的
- `/sessions` 展示 registry 中的 session（非磁盘所有 session）
- `/model` 在当前 session 中切换模型

**新 Registry 模型**:

```typescript
interface Registry {
  sessions: string[];   // 机器人产生的 session 文件列表（白名单）
  current?: string;     // 当前激活的 session 文件（缓存，用于展示）
}
```

**数据流**:

```
首次发消息 → 将 TUI 当前 session 加入 registry.sessions → pi.sendUserMessage(prompt)
（如果 registry.sessions 为空，自动添加入口；TUI 已有 session，无需额外创建）
/sessions
  ├─ 展示 registry.sessions 中各 session 的 name/messageCount/lastActive
  ├─ 切换 → ctx.switchSession(target, withSession) → 更新 registry.current
  ├─ 新建 → ctx.newSession(withSession) → 加入 registry.sessions + 设为 current
  └─ 删除 → ctx.newSession 生成新 session → rm 旧文件 → 更新 registry
消息转发 → pi.sendUserMessage(prompt) → 当前 TUI session
```

**去重保证**: 向 registry.sessions 添加时使用 Set 去重后写回数组。

**首次注册**: 首次消息到达时，从 ctx（withSession 安全访问）获取当前 session，若不在 registry.sessions 中则加入。

### 1.2 Daemon 进程唯一性（flock 方案）

**目标**: 同时只有一个 daemon 进程。

**方案**: 用 flock 作为 PID 文件的互斥锁。flock 是内核级 advisory lock，进程退出（包括 SIGKILL）时内核自动释放锁，无残留问题。

**设计**:

```
Daemon 启动:
  1. open(PID_FILE, O_RDWR | O_CREAT)
  2. flock(LOCK_EX | LOCK_NB)
     → 失败: 另一个 daemon 持有锁 → exit(0)
     → 成功: 我是唯一 daemon
  3. truncate + write PID
  4. ipcServer.listen()  → 此时可直接 unlink + bind socket，因为有锁保障

Daemon 退出:
  1. await channel?.disconnect()
  2. await ipcServer.close()
  3. unlinkSync(SOCKET_PATH)  ← 清理 socket 文件
  4. close pidFd              ← 释放锁
  5. rmSync(PID_FILE)         ← 删除 PID 文件
  6. exit(0)

Extension 检测存活:
  isDaemonRunning():
    try flock(PID_FILE, LOCK_EX | LOCK_NB)
    → 成功: 无人持有锁 → daemon 未运行 → 释放锁 → return false
    → 失败: 有人持有锁 → daemon 正在运行 → return true

Extension 重启:
  1. 发送 shutdown
  2. 轮询 isDaemonRunning() 直到 false（最多5s）← 等旧进程退出
  3. force clean 残留 socket/PID 文件
  4. spawn 新 daemon
```

### 1.3 Forwarding 简化

**删除**: `forwardingSessions: Set<string>`，registry 反向查找逻辑。

**替换**:

```typescript
let activeChatId: string | null = null;
let forwardingCount = 0;

// 收到消息时
activeChatId = msg.chatId;
forwardingCount++;
pi.sendUserMessage(prompt);

// message_update
if (!activeChatId) return;
sendToDaemon({ type: "stream", chatId: activeChatId, content });

// message_end
const chatId = activeChatId;
if (--forwardingCount <= 0) activeChatId = null;
sendToDaemon({ type: "streamEnd", chatId });
```

**`activeChatId` 来源**: 从 Feishu 消息事件的 `msg.chatId` 获取（`src/daemon/index.ts` 通过 IPC 传入）。

---

## 2. 修复清单

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| 1 | 多 daemon 进程（Socket 抢占） | `src/daemon/index.ts`, `src/ipc/server.ts`, `extensions/index.ts` | flock 方案，见 1.2 |
| 2 | 卡片 block 类型错误 `actions`→`action` | `extensions/feishu-card.ts`, `extensions/bot-commands/sessions.ts` | 类型定义 + 两处使用 |
| 3 | forwardingSessions 简化 | `extensions/index.ts` | 替换为 activeChatId，见 1.3 |
| 4 | 删除 registry 旧逻辑 + 重设计 | `extensions/index.ts`, `extensions/bot-commands/sessions.ts` | 按 1.1 新模型 |
| 5 | ctx stale 防护 | `extensions/index.ts` | 最小化 ctx 接触面，仅 pi.sendUserMessage 加 try/catch |
| 6 | 测试补充 | `tests/ipc/server.test.ts`, `tests/extensions/index.test.ts` | flock 锁、activeChatId 转发、registry 新模型 |

### 2.1 修复 #1: Daemon 进程唯一性（flock）

**`src/ipc/server.ts:listen()`**:
- 简化：直接 `existsSync` → `unlinkSync` → bind。flock 已保证无其他 daemon。

**`src/daemon/index.ts:main()`**:
- 启动时 open PID_FILE + flock(LOCK_EX|LOCK_NB)
- 失败则 exit(0)
- cleanup 顺序：disconnect channel → close server → unlink socket → close pidFd → rm PID_FILE

**`extensions/index.ts:isDaemonRunning()`**:
- 从 PID 文件检查改为 flock 检测
- `spawnDaemon()`: 排除 VITEST 环境变量
- `restart`: 轮询等 flock 释放后才 spawn

### 2.2 修复 #2: 卡片 Block 类型

- `feishu-card.ts:13`: `tag: "actions"` → `tag: "action"`
- `sessions.ts:100,106`: `tag: "actions"` → `tag: "action"`

### 2.3 修复 #3: Forwarding 简化

见 1.3。删除 `forwardingSessions` 和所有按 sessionFile 匹配的逻辑，用 `activeChatId` + `forwardingCount` 替代。

### 2.4 修复 #4: Registry 重设计

`extensions/index.ts`:
- 删除 `SessionRegistry` 接口，重命名为 `Registry`
- Registry 类型改为 `{ sessions: string[]; current?: string }`
- `loadRegistry`/`saveRegistry` 适配新格式
- 消息处理简化：`activeChatId = msg.chatId; forwardingCount++; pi.sendUserMessage(prompt)`
- 首次消息：若 registry.sessions 不含当前 session → 注册入列表
- `/sessions` 命令：从 registry.sessions 展示 session 列表
- `/model` 命令：直接使用 handleModelAction（withSession 模式）

`extensions/bot-commands/sessions.ts`:
- `buildSessionsCard` 参数改为 `(sessions: string[], currentSessionFile: string)`
- 移除 registry 参数（不再展示 chat 绑定关系）
- 操作改为：switch / delete / new（移除 unbind）
- `handleSessionsAction` 参数简化，不再接收 registry

#### 2.4.1 Card Action 交互实现

**/sessions 卡片交互流程**:

```
用户点击按钮 → cardAction 事件 → extension
  switch: ctx.switchSession(path, withSession: newCtx => {
    registry.current = newCtx.sessionManager.getSessionFile();
    saveRegistry(registry);
  })
  delete: ctx.newSession(withSession: newCtx => {
    registry.current = newCtx.sessionManager.getSessionFile();
    rmSync(oldSessionPath, { force: true });
    registry.sessions = registry.sessions.filter(s => s !== oldSessionPath);
    registry.sessions.push(registry.current);
    saveRegistry(registry);
  })
  new: ctx.newSession(withSession: newCtx => {
    registry.current = newCtx.sessionManager.getSessionFile();
    registry.sessions = dedupe([...registry.sessions, registry.current]);
    saveRegistry(registry);
  })
```

**/model 卡片交互流程**:

```
用户在下拉菜单选择模型 → select_static → cardAction 事件 → extension
  handleModelAction:
    model = ctx.modelRegistry.find(provider, id)  // 在 withSession 前获取模型对象
    if registry.current exists:
      ctx.switchSession(registry.current, withSession: () => {
        pi.setModel(model);  // 在 session 上下文中设置模型
      })
    // handleModelAction 内部处理 withSession
```

所有 session 操作都在 withSession 回调内完成，回调外不保留任何 ctx 引用。

### 2.5 修复 #5: Ctx Stale 防护

**背景**: `pi` 和 `ctx` 可能在任意时刻变 stale——不仅 bot 命令会触发，TUI 用户直接操作 session 也会。因此 `pi.sendUserMessage()` 的 try/catch 无法避免。但可以通过设计削减对其他 ctx 方法的依赖。

**设计原则**:

| 需要 ctx/pi 的地方 | 处理方式 |
|---|---|
| 正常消息 `pi.sendUserMessage(prompt)` | try/catch，stale 时通知用户 restart |
| 获取当前 session file | 不用 `ctx.sessionManager.getSessionFile()`，改用 `SessionManager.open()` 读 registry.current |
| /sessions 展示 session 列表 | 用 `SessionManager.open()` 直接读 session 文件获取 name/messageCount/lastActive |
| /model 模型切换 | `pi.setModel()` 直接调用 |
| Bot 命令中 session 操作 | 全部在 `withSession` 回调内完成 |

**stale 发生后**:
- `pi.sendUserMessage()` 抛出 stale 异常 → catch 后通知用户 `/feishu-im restart`
- 清除 `activeChatId` 和 `forwardingCount`
- 后续消息会再次触发 `getClient` → 重新建立 IPC 连接

### 2.6 修复 #6: 测试补充

| 测试 | 验证点 |
|------|--------|
| flock lock reject | daemon 启动时 flock 已被持有则 exit(0) |
| flock lock stale | 旧进程退出后锁自动释放，新进程可获取 |
| card action type | sessions 卡片使用 `tag: "action"` |
| activeChatId forwarding | message_update 用 activeChatId 转发 |
| streaming end | message_end 转发 streamEnd，不受 forwardingCount 竞态影响 |
| registry sessions 白名单 | /sessions 只展示 registry.sessions 中的项目 |
| stale ctx 防护 | ctx/pi 失效后不崩溃，输出回退内容 |

---

## 3. 实现顺序（6 个 Increment）

```
increment 1: flock 单 daemon + 生命周期
    ↓
increment 2: 卡片 tag: "actions" → "action"
    ↓
increment 3: forwardingSessions → activeChatId
    ↓
increment 4: Registry 重设计 (sessions 白名单 + /sessions 重写)
    ↓
increment 5: ctx stale 全线 try/catch
    ↓
increment 6: 测试补充 + 集成验证
```

每个 increment 遵循 TDD: RED（补测试）→ GREEN（实现）→ REFACTOR（整理代码）。

# 单连接 IPC + 选择性转发 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 IPCServer 恢复为单连接（spec 4.2），并将 Pi→飞书转发从"无条件同步"改为"仅飞书触发对话时转发"。

**Architecture:** IPCServer 内部改回维护单个 `_activeSocket`，新连接到达时直接 `bye` 拒绝。Extension 用 `Set<string>` 跟踪飞书触发的 sessionFile，仅在飞书消息处理期间转发 assistant 响应。

**Tech Stack:** TypeScript, Node.js `net` 模块, vitest

---

## 文件变更概览

| 文件 | 变更 |
|------|------|
| `src/ipc/server.ts` | 回退到原始单连接实现 |
| `src/daemon/index.ts` | 添加 `reject` 事件处理器 |
| `extensions/index.ts` | 删除 TUI 同步钩子，新增 forwarding set，清理 tag 逻辑 |
| `tests/ipc/server.test.ts` | 多连接测试替换为单连接拒绝测试 |

---

### Task 1: 回退 IPCServer 到单连接

**Files:**
- Modify: `src/ipc/server.ts`

- [ ] **Step 1: 替换 IPCServer 实现**

将 `src/ipc/server.ts` 完整替换为以下内容：

```typescript
import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { parseMessage, stringifyMessage, type DaemonMessage, type ExtensionMessage } from "./protocol.js";

export class IPCServer {
  private server: net.Server | null = null;
  private _activeSocket: net.Socket | null = null;
  private socketPath: string;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  get activeSocket(): net.Socket | null {
    return this._activeSocket && !this._activeSocket.destroyed ? this._activeSocket : null;
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }

      this.server = net.createServer((socket) => {
        if (this._activeSocket && !this._activeSocket.destroyed) {
          socket.write(stringifyMessage({ type: "bye", reason: "already connected" }));
          socket.end();
          socket.on("error", () => {});
          this.emit("reject");
          return;
        }

        this._activeSocket = socket;
        let buffer = "";

        socket.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = parseMessage(line);
              this.emit("message", msg, socket);
            } catch (err) {
              this.emit("error", err);
            }
          }
        });

        socket.on("close", () => {
          this._activeSocket = null;
          this.emit("disconnect");
        });

        socket.on("error", (err) => {
          this.emit("error", err);
        });

        this.emit("connect", socket);
      });

      this.server.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  send(socket: net.Socket, msg: DaemonMessage): void {
    if (socket.destroyed) return;
    socket.write(stringifyMessage(msg));
  }

  sendToClient(msg: DaemonMessage): boolean {
    const sock = this.activeSocket;
    if (!sock) return false;
    this.send(sock, msg);
    return true;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this._activeSocket && !this._activeSocket.destroyed) {
        this._activeSocket.end();
        this._activeSocket.destroy();
        this._activeSocket = null;
      }
      if (this.server) {
        this.server.close((err) => {
          if (err) this.emit("error", err);
          try { unlinkSync(this.socketPath); } catch {}
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export function createIPCServer(socketPath: string): IPCServer {
  return new IPCServer(socketPath);
}
```

- [ ] **Step 2: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/ipc/server.ts
git commit -m "feat: revert IPCServer to single-connection with bye rejection"
```

---

### Task 2: Daemon 添加 reject 处理器

**Files:**
- Modify: `src/daemon/index.ts`

- [ ] **Step 1: 添加 reject 事件处理器**

在 `src/daemon/index.ts` 中，找到 `ipcServer.on("disconnect", ...)` 之前插入：

```
  ipcServer.on("reject", () => {
    log("info", "Rejected new connection - already connected");
  });
```

最终 daemon 事件注册部分应变为：

```typescript
  ipcServer.on("disconnect", () => {
    log("info", "Extension disconnected");
  });

  ipcServer.on("reject", () => {
    log("info", "Rejected new connection - already connected");
  });
```

- [ ] **Step 2: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/daemon/index.ts
git commit -m "feat: add reject event handler for single-connection IPC"
```

---

### Task 3: Extension 选择性 Pi→飞书转发

**Files:**
- Modify: `extensions/index.ts`

本任务分三个子步骤，按顺序执行：

**3a: 添加 forwarding Sessions set 和清理 tag 逻辑**

- [ ] **Step 3a-1: 替换 state 变量声明**

在 `extensions/index.ts` 中，找到：

```typescript
    let ipcClient: IPCClient | null = null;
    const pendingInjects = new Set<string>();
    let injectSequence = 0;
```

替换为：

```typescript
    let ipcClient: IPCClient | null = null;
    const forwardingSessions = new Set<string>();
```

**3b: 修改飞书消息注入点**

注意：以下步骤需要按顺序执行，先定义 `prompt` 再修改两个分支。

- [ ] **Step 3b-1: 删除 tag 前缀，重新定义 prompt**

找到 tag 前缀相关代码（约 line 205-213），当前代码：

```typescript
                                const tag = `[feishu:#${++injectSequence}]`;
                                pendingInjects.add(tag);

                                let prompt = tag + " " + msg.content;
                                if (msg.resources?.length) {
                                    prompt += "\n\nAttachments: " + msg.resources
                                        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                                        .join(", ");
                                }
```

替换为：

```typescript
                                const prompt = msg.content + (msg.resources?.length
                                    ? "\n\nAttachments: " + msg.resources
                                        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                                        .join(", ")
                                    : "");
```

注意：替换后 `prompt` 仍然在 `botCmd` early return 之后、`sessionFile` 判断之前定义，两个分支可用。

- [ ] **Step 3b-2: 修改 user message 分支 — 有 session 路径**

找到 `message` case 中用户消息的 `switchSession` 路径（约 line 216-225），当前代码：

```typescript
                                const sessionFile = registry[msg.chatId];
                                if (sessionFile) {
                                    try {
                                        await ctx.switchSession(sessionFile, { withSession: async (newCtx) => {
                                            await newCtx.sendUserMessage(prompt);
                                            const newSessionFile = newCtx.sessionManager.getSessionFile();
                                            if (newSessionFile && !registry[msg.chatId]) {
                                                registry[msg.chatId] = newSessionFile;
                                                saveRegistry(registry);
                                            }
                                        }});
                                    } catch { }
```

改为：

```typescript
                                const sessionFile = registry[msg.chatId];
                                if (sessionFile) {
                                    try {
                                        forwardingSessions.add(sessionFile);
                                        await ctx.switchSession(sessionFile, { withSession: async (newCtx) => {
                                            try {
                                                await newCtx.sendUserMessage(prompt);
                                            } finally {
                                                forwardingSessions.delete(sessionFile);
                                            }
                                            const newSessionFile = newCtx.sessionManager.getSessionFile();
                                            if (newSessionFile && !registry[msg.chatId]) {
                                                registry[msg.chatId] = newSessionFile;
                                                saveRegistry(registry);
                                            }
                                        }});
                                    } catch {
                                        forwardingSessions.delete(sessionFile);
                                    }
```

- [ ] **Step 3b-3: 修改 user message 分支 — 无 session 路径**

找到 `message` case 中用户消息的 `pi.sendUserMessage` 路径（约 line 227-234），当前代码：

```typescript
                                } else {
                                    await pi.sendUserMessage(prompt);
                                    const newSessionFile = ctx.sessionManager.getSessionFile();
                                    if (newSessionFile && !registry[msg.chatId]) {
                                        registry[msg.chatId] = newSessionFile;
                                        saveRegistry(registry);
                                    }
                                }
```

改为：

```typescript
                                } else {
                                    const currentSession = ctx.sessionManager.getSessionFile();
                                    if (currentSession) forwardingSessions.add(currentSession);
                                    try {
                                        await pi.sendUserMessage(prompt);
                                    } finally {
                                        if (currentSession) forwardingSessions.delete(currentSession);
                                    }
                                    const newSessionFile = ctx.sessionManager.getSessionFile();
                                    if (newSessionFile && !registry[msg.chatId]) {
                                        registry[msg.chatId] = newSessionFile;
                                        saveRegistry(registry);
                                    }
                                }
```

**3c: 修改 event hooks**

- [ ] **Step 3c-1: 删除 before_agent_start hook**

删除整个 `pi.on("before_agent_start", ...)` 块（约 line 422-440）。

- [ ] **Step 3c-2: 修改 message_update hook**

找到 `pi.on("message_update", ...)`（约 line 442-457），当前代码：

```typescript
    pi.on("message_update", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;

        const sessionFile = _ctx.sessionManager.getSessionFile();
        if (!sessionFile) return;
        const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
        if (!chatId) return;

        const textContent = event.message.content?.find(
            (c: { type: string }) => c.type === "text"
        ) as { text?: string } | undefined;
        if (textContent?.text) {
            sendToDaemon({ type: "stream", chatId, content: textContent.text });
        }
    });
```

替换为（添加 forwardingSessions 判断）：

```typescript
    pi.on("message_update", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;

        const sessionFile = _ctx.sessionManager.getSessionFile();
        if (!sessionFile) return;
        if (!forwardingSessions.has(sessionFile)) return;
        const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
        if (!chatId) return;

        const textContent = event.message.content?.find(
            (c: { type: string }) => c.type === "text"
        ) as { text?: string } | undefined;
        if (textContent?.text) {
            sendToDaemon({ type: "stream", chatId, content: textContent.text });
        }
    });
```

- [ ] **Step 3c-3: 修改 message_end hook**

找到 `pi.on("message_end", ...)`（约 line 459-469），当前代码：

```typescript
    pi.on("message_end", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;

        const sessionFile = _ctx.sessionManager.getSessionFile();
        if (!sessionFile) return;
        const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
        if (!chatId) return;

        sendToDaemon({ type: "streamEnd", chatId });
    });
```

替换为（添加 forwardingSessions 判断 + cleanup）：

```typescript
    pi.on("message_end", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;

        const sessionFile = _ctx.sessionManager.getSessionFile();
        if (!sessionFile) return;
        if (!forwardingSessions.has(sessionFile)) return;
        const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
        if (!chatId) return;

        forwardingSessions.delete(sessionFile);
        sendToDaemon({ type: "streamEnd", chatId });
    });
```

- [ ] **Step 3c-4: 添加 bye 消息处理**

在 `start` 子命令的 `getClient` 回调的 message listener 中（`switch (msg.type)` 内），添加 `bye` case。找到最后一个 case 后插入：

```typescript
                            case "bye": {
                                ctx.ui.notify("Connection rejected: daemon already has an active client", "warning");
                                break;
                            }
```

该 case 应放在其他 case 之中（如 `status` case 附近），与其他 `switch` case 同级。

- [ ] **Step 3c-5: 删除 session_shutdown hook**

删除整个 `pi.on("session_shutdown", ...)` 块（约 line 471-473）。

- [ ] **Step 3c-6: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3c-7: 提交**

```bash
git add extensions/index.ts
git commit -m "feat: replace TUI sync with selective feishu-triggered forwarding"
```

---

### Task 4: 更新 server 测试

**Files:**
- Modify: `tests/ipc/server.test.ts`

- [ ] **Step 4-1: 替换多连接测试**

将 `tests/ipc/server.test.ts` 中的两个多连接测试替换为单连接拒绝测试：

删除以下两个测试：
- "accepts multiple concurrent clients"（line 115-138）
- "sendToClient broadcasts to all connected clients"（line 140-166）

替换为：

```typescript
  it("rejects second client with bye message", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    let rejectCount = 0;
    server.on("reject", () => { rejectCount++; });

    const client1 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).not.toBeNull();

    const client2 = await createClient();

    const byeData = await new Promise<string>((resolve) => {
      client2.once("data", (d) => resolve(d.toString()));
    });

    const bye = JSON.parse(byeData.trim());
    expect(bye.type).toBe("bye");
    expect(rejectCount).toBe(1);

    client1.destroy();
    client2.destroy();
    await server.close();
    server = null;
  });

  it("accepts new client after first disconnects", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const client1 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).not.toBeNull();

    client1.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.activeSocket).toBeNull();

    let connected = false;
    server.on("connect", () => { connected = true; });

    const client2 = await createClient();
    await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);

    client2.destroy();
    await server.close();
    server = null;
  });

  it("sendToClient returns false when no client connected", () => {
    server = createIPCServer(SOCK);
    const result = server.sendToClient({ type: "ready", botIdentity: { name: "bot" } });
    expect(result).toBe(false);
  });
```

- [ ] **Step 4-2: 运行 server 测试验证**

```bash
npx vitest run tests/ipc/server.test.ts
```

Expected: 所有测试通过。

- [ ] **Step 4-3: 提交**

```bash
git add tests/ipc/server.test.ts
git commit -m "test: replace multi-connection tests with single-connection rejection tests"
```

---

### Task 5: 全量测试验证

- [ ] **Step 5-1: 运行全量测试**

```bash
npx vitest run
```

Expected: 所有测试通过。

- [ ] **Step 5-2: 提交（如有修复）**

若测试有失败，修复后提交。

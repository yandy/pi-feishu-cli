# 单连接 IPC + 选择性转发 实施计划 (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 IPCServer 恢复为单连接（spec 4.2），并将 Pi→飞书转发从"无条件同步"改为"仅飞书触发对话时转发"。

**Architecture:** IPCServer 内部改回维护单个 `_activeSocket`，新连接到达时直接 `bye` 拒绝。Extension 用 `Set<string>` 跟踪飞书触发的 sessionFile，仅在飞书消息处理期间转发 assistant 响应。

**Tech Stack:** TypeScript, Node.js `net` 模块, vitest

---

## 文件变更概览

| 文件 | 变更 |
|------|------|
| `tests/ipc/server.test.ts` | 多连接测试 → 单连接拒绝测试 |
| `src/ipc/server.ts` | 回退到原始单连接实现 |
| `tests/extensions/index.test.ts` | 新增 TDD 测试：验证 TUI 同步钩子已移除 |
| `extensions/index.ts` | 删除 TUI 同步钩子，新增 forwarding set，清理 tag 逻辑 |
| `src/daemon/index.ts` | 添加 `reject` 事件处理器 |
| `docs/superpowers/specs/2026-05-30-pi-feishu-cli-rebuild-design.md` | 标记过期设计 |

---

### Task 1: RED — 编写失败的 server 单连接测试

**Files:**
- Modify: `tests/ipc/server.test.ts`

- [ ] **Step 1.1: 删除多连接测试，替换为单连接测试**

删除 `tests/ipc/server.test.ts` 中的两个多连接测试：
- "accepts multiple concurrent clients"（line 115-138）
- "sendToClient broadcasts to all connected clients"（line 140-166）

替换为以下三个新测试：

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

- [ ] **Step 1.2: 运行测试，确认失败 (RED)**

```bash
npx vitest run tests/ipc/server.test.ts
```

Expected: 三个新测试 FAIL——
- "rejects second client": 当前代码允许多连接，不会发送 bye
- "accepts new client after first disconnects": 当前 `activeSocket` getter 返回 `_sockets` 中的任意一个，disconnect 后行为不确定
- "sendToClient returns false": 当前 `sendToClient` 广播到所有 socket，无 socket 时不会返回 false 而是静默成功

```bash
git add tests/ipc/server.test.ts
git commit -m "test: add failing single-connection server tests (RED)"
```

---

### Task 2: GREEN — 实现单连接 IPCServer

**Files:**
- Modify: `src/ipc/server.ts`

- [ ] **Step 2.1: 替换 IPCServer 为原始单连接实现**

将 `src/ipc/server.ts` 完整替换为：

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

- [ ] **Step 2.2: 运行测试，确认通过 (GREEN)**

```bash
npx vitest run tests/ipc/server.test.ts
```

Expected: 全部 PASS（包括新增的三个测试和已有的五个测试）。

- [ ] **Step 2.3: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2.4: 提交**

```bash
git add src/ipc/server.ts
git commit -m "feat: revert IPCServer to single-connection with bye rejection (GREEN)"
```

---

### Task 3: RED — 编写失败的 extension forwarding 测试

**Files:**
- Modify: `tests/extensions/index.test.ts`

- [ ] **Step 3.1: 在文件末尾添加 forwarding 行为测试**

在 `tests/extensions/index.test.ts` 末尾（最后一条测试之后，`});` 之前）添加以下测试：

```typescript
  it("does NOT register before_agent_start hook (TUI sync removed)", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const calls = (api.on as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "before_agent_start"
    );
    expect(calls.length).toBe(0);
  });

  it("does NOT register session_shutdown hook (pendingInjects removed)", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const calls = (api.on as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "session_shutdown"
    );
    expect(calls.length).toBe(0);
  });

  it("message_update handler still forwards for feishu-triggered sessions", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const handler = (api.on as any).mock.calls.find(
      (call: [string, any]) => call[0] === "message_update"
    );
    expect(handler).toBeDefined();
  });

  it("message_end handler still forwards for feishu-triggered sessions", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const handler = (api.on as any).mock.calls.find(
      (call: [string, any]) => call[0] === "message_end"
    );
    expect(handler).toBeDefined();
  });
```

- [ ] **Step 3.2: 运行测试，确认失败 (RED)**

```bash
npx vitest run tests/extensions/index.test.ts
```

Expected: 前两个测试 FAIL——
- "does NOT register before_agent_start": 当前 `before_agent_start` 仍在注册
- "does NOT register session_shutdown": 当前 `session_shutdown` 仍在注册
- 后两个测试 PASS（`message_update`/`message_end` 已存在）

```bash
git add tests/extensions/index.test.ts
git commit -m "test: add failing extension forwarding tests (RED)"
```

---

### Task 4: GREEN — 实现 extension 选择性转发

**Files:**
- Modify: `extensions/index.ts`

按顺序执行以下步骤：

- [ ] **Step 4.1: 替换 state 变量声明**

找到：
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

- [ ] **Step 4.2: 删除 tag 前缀，重新定义 prompt**

找到：
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

- [ ] **Step 4.3: 修改有 session 的 user message 路径**

找到：
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

替换为：
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

- [ ] **Step 4.4: 修改无 session 的 user message 路径**

找到：
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

替换为：
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

- [ ] **Step 4.5: 删除 before_agent_start hook**

删除整个 `pi.on("before_agent_start", ...)` 块。

- [ ] **Step 4.6: 修改 message_update hook（添加 forwardingSessions 判断）**

找到：
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

替换为：
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

- [ ] **Step 4.7: 修改 message_end hook（添加判断 + cleanup）**

找到：
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

替换为：
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

- [ ] **Step 4.8: 删除 session_shutdown hook**

删除整个 `pi.on("session_shutdown", ...)` 块。

- [ ] **Step 4.9: 添加 bye 消息处理**

在 `start` 子命令的 `getClient` 回调中 `switch (msg.type)` 内，在已有 case 之中添加：

```typescript
                            case "bye": {
                                ctx.ui.notify("Connection rejected: daemon already has an active client", "warning");
                                break;
                            }
```

- [ ] **Step 4.10: 运行测试，确认通过 (GREEN)**

```bash
npx vitest run tests/extensions/index.test.ts
```

Expected: 全部 PASS——前两个新增测试通过（before_agent_start / session_shutdown 已不存在），后两个新增测试通过（message_update / message_end 仍存在），所有已有测试也通过。

- [ ] **Step 4.11: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4.12: 提交**

```bash
git add extensions/index.ts
git commit -m "feat: replace TUI sync with selective feishu-triggered forwarding (GREEN)"
```

---

### Task 5: Daemon 添加 reject 处理器

**Files:**
- Modify: `src/daemon/index.ts`

- [ ] **Step 5.1: 添加 reject 事件处理器**

在 `src/daemon/index.ts` 中，在 `ipcServer.on("disconnect", ...)` 之后添加：

```typescript
  ipcServer.on("reject", () => {
    log("info", "Rejected new connection - already connected");
  });
```

- [ ] **Step 5.2: 验证类型兼容性**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5.3: 提交**

```bash
git add src/daemon/index.ts
git commit -m "feat: add reject event handler for single-connection IPC"
```

---

### Task 6: 全量测试验证

- [ ] **Step 6.1: 运行全量测试**

```bash
npx vitest run
```

Expected: 所有测试通过。

- [ ] **Step 6.2: 提交（如有修复）**

若测试有失败，修复后提交。

---

### Task 7: 标记历史 spec 中的过期设计

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-pi-feishu-cli-rebuild-design.md`

- [ ] **Step 7.1: 标记过期章节**

在 `docs/superpowers/specs/2026-05-30-pi-feishu-cli-rebuild-design.md` 中：

**2.1 飞书会话机器人** 中 "双向同步：飞书对话 ↔ Pi TUI 对话" 这一行改为添加过期标记：

```
- **双向同步**：飞书对话 → Pi TUI 对话（已改为仅飞书消息触发 Pi 处理，Pi TUI 对话不再同步到飞书）
```

**5.2 Pi → 飞书** 和 **5.3 Pi 事件处理总览** 中 `before_agent_start` 相关内容标记为过期：

在 5.2 表格的 `before_agent_start` 行末尾添加 `~~（已废弃）~~`，并在 5.3 表格的 `before_agent_start` 行末尾添加 `~~（已废弃）~~`。

或者在文档开头添加一个醒目的过期标记块：

```
> **注意**: 以下设计已在新设计中修改——
> - 2.1 双向同步：Pi TUI 不再自动同步到飞书（见 [2026-05-31 设计](./2026-05-31-single-ipc-forwarding-design.md)）
> - 4.2 连接握手：已按原始设计回退为单连接，Daemon 同时仅服务 1 个 Extension
```

- [ ] **Step 7.2: 提交**

```bash
git add docs/superpowers/specs/2026-05-30-pi-feishu-cli-rebuild-design.md
git commit -m "docs: mark outdated designs in rebuild spec"
```

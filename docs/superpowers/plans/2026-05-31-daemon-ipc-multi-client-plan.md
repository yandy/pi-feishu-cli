# Daemon IPC 多连接 & 飞书连接去重 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 IPC server 单连接限制，改为支持多客户端并发连接；extensions 各子命令采用 fallback 模式（优先复用已有连接）；daemon 防止重复连接飞书 WebSocket。

**Architecture:** `_activeSocket` 改为 `_sockets: Set`，`sendToClient` 改为广播。`status`/`stop`/`restart` 先尝试通过模块级 `ipcClient` 操作，fallback 到临时连接。daemon `connect` handler 检查 `channel?.connected` 避免重建飞书连接。

**Tech Stack:** TypeScript, Node.js `net` module, vitest

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/ipc/server.ts` | 多连接 IPC 服务器 | 修改 |
| `tests/ipc/server.test.ts` | 多连接测试（并发 client、broadcast） | 修改 |
| `tests/ipc/client.test.ts` | 多 client 并行连接测试 | 修改 |
| `src/daemon/index.ts` | connect handler + connectChannel 防飞书重复连接 | 修改 |
| `extensions/index.ts` | status/stop/restart fallback 模式 | 修改 |

---

### Task 1: IPC Server 多连接支持

**Files:**
- Modify: `src/ipc/server.ts` (全文件)

- [ ] **Step 1: 将 `_activeSocket` 改为 `_sockets: Set<net.Socket>`，移除拒绝逻辑，`sendToClient` 改为广播，`close` 改遍历关闭**

将 `src/ipc/server.ts` 完整替换为：

```ts
import * as net from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { parseMessage, stringifyMessage, type DaemonMessage, type ExtensionMessage } from "./protocol.js";

export class IPCServer {
  private server: net.Server | null = null;
  private _sockets: Set<net.Socket> = new Set();
  private socketPath: string;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  get activeSocket(): net.Socket | null {
    for (const sock of this._sockets) {
      if (!sock.destroyed) return sock;
    }
    return null;
  }

  get socketCount(): number {
    let count = 0;
    for (const sock of this._sockets) {
      if (!sock.destroyed) count++;
    }
    return count;
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
        this._sockets.add(socket);
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
          this._sockets.delete(socket);
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
    let sent = false;
    for (const sock of this._sockets) {
      if (!sock.destroyed) {
        this.send(sock, msg);
        sent = true;
      }
    }
    return sent;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const sock of this._sockets) {
        if (!sock.destroyed) {
          sock.end();
          sock.destroy();
        }
      }
      this._sockets.clear();
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

- [ ] **Step 2: 运行 TypeScript 编译检查**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/ipc/server.ts
git commit -m "feat: IPCServer supports multiple concurrent connections"
```

---

### Task 2: 更新 Server 测试 — 多连接 + broadcast

**Files:**
- Modify: `tests/ipc/server.test.ts` (line 115-162 替换两个测试)

- [ ] **Step 1: 替换"rejects second client"和"sends bye message"两个测试为多连接测试**

将 `tests/ipc/server.test.ts` 中的两个测试（从 `it("rejects second client...` 到 `});` 之间的 `it("sends bye message...` 测试结束）替换为：

```ts
  it("accepts multiple concurrent clients", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    let connectCount = 0;
    server.on("connect", () => {
      connectCount++;
    });

    const client1 = await createClient();
    const client2 = await createClient();

    await new Promise((r) => setTimeout(r, 50));
    expect(connectCount).toBe(2);
    expect(server.socketCount).toBe(2);

    client1.destroy();
    client2.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.socketCount).toBe(0);

    await server.close();
    server = null;
  });

  it("sendToClient broadcasts to all connected clients", async () => {
    server = createIPCServer(SOCK);
    await server.listen();

    const client1 = await createClient();
    const client2 = await createClient();

    const data1 = new Promise<string>((resolve) => {
      client1.once("data", (d) => resolve(d.toString()));
    });
    const data2 = new Promise<string>((resolve) => {
      client2.once("data", (d) => resolve(d.toString()));
    });

    server.sendToClient({ type: "ready", botIdentity: { name: "broadcast" } });

    const [d1, d2] = await Promise.all([data1, data2]);
    expect(d1).toContain('"type":"ready"');
    expect(d1).toContain("broadcast");
    expect(d2).toContain('"type":"ready"');
    expect(d2).toContain("broadcast");

    client1.destroy();
    client2.destroy();
    await server.close();
    server = null;
  });
```

- [ ] **Step 2: 运行 test 验证失败（新测试应通过）**

```bash
npx vitest run tests/ipc/server.test.ts
```
Expected: 9 tests passed

- [ ] **Step 3: 提交**

```bash
git add tests/ipc/server.test.ts
git commit -m "test: update server tests for multi-connection support"
```

---

### Task 3: 更新 Client 测试 — 多 client 并行连接

**Files:**
- Modify: `tests/ipc/client.test.ts` (line 96-116 替换)

- [ ] **Step 1: 替换"handles bye message"测试为多 client 并行连接测试**

将 `tests/ipc/client.test.ts` 中 `it("handles bye message from server"` 整个测试块替换为：

```ts
  it("multiple clients can connect to server simultaneously", async () => {
    server = await startServer();
    const client1 = createIPCClient(SOCK);
    const client2 = createIPCClient(SOCK);

    await client1.connect();
    await client2.connect();

    expect(client1.connected).toBe(true);
    expect(client2.connected).toBe(true);

    client1.disconnect();
    client2.disconnect();
  });
```

- [ ] **Step 2: 运行 test 验证**

```bash
npx vitest run tests/ipc/client.test.ts
```
Expected: 9 tests passed

- [ ] **Step 3: 提交**

```bash
git add tests/ipc/client.test.ts
git commit -m "test: update client test for multi-connection support"
```

---

### Task 4: Daemon 防飞书重复连接

**Files:**
- Modify: `src/daemon/index.ts` (line 38-40 connectChannel, line 195-218 connect handler)

- [ ] **Step 1: `connectChannel` 开头加 guard，`connect` handler 加 channel 状态判断**

在 `connectChannel` 的 `channel = createFeishuChannel(...)` 之前插入 guard：

```ts
    if (channel?.connected) {
      await channel.disconnect();
    }
```

替换 `connect` handler（line 195-218）为已连接时直接回复 ready、未连接时才调 connectChannel 的版本：

```ts
  ipcServer.on("connect", (socket) => {
    log("info", "Extension connected");
    if (creds) {
      if (channel?.connected) {
        ipcServer.send(socket, {
          type: "ready",
          botIdentity: { name: channel.botIdentity?.name ?? "bot" },
        });
      } else {
        connectChannel(creds.appId, creds.appSecret)
          .then(() => {
            ipcServer.send(socket, {
              type: "ready",
              botIdentity: { name: channel?.botIdentity?.name ?? "bot" },
            });
          })
          .catch((err: Error) => {
            log("error", `Auto-connect failed: ${err.message}`);
            ipcServer.send(socket, {
              type: "needAuth",
              message: `自动连接失败: ${err.message}`,
            });
          });
      }
    } else {
      ipcServer.send(socket, {
        type: "needAuth",
        message: "请配置飞书应用凭据: App ID 和 App Secret",
      });
    }
  });
```

- [ ] **Step 2: 更新 `creds` 为 `let` 并在 auth handler 中更新以支持新连接获取已保存凭据**

```ts
// line 36: const creds → let creds
  let creds = loadAuth(FEISHU_IM_DIR);

// line 99: auth handler 中, saveAuth 之后加:
          creds = { appId: msg.appId, appSecret: msg.appSecret };
```

- [ ] **Step 3: 移除 `reject` 事件监听（多连接下不再触发）**

删除 line 224-226 的：
```ts
  ipcServer.on("reject", () => {
    log("info", "Rejected new connection");
  });
```

- [ ] **Step 4: 运行 TypeScript 编译检查**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 5: 运行全部测试验证**

```bash
npx vitest run
```
Expected: 54 tests passed

- [ ] **Step 6: 提交**

```bash
git add src/daemon/index.ts
git commit -m "fix: prevent duplicate Feishu channel connections with multi-client IPC"
```

---

### Task 5: Extensions Fallback 模式

**Files:**
- Modify: `extensions/index.ts` (line 209-281 三个 case)

- [ ] **Step 1: 替换 `status` / `stop` / `restart` 三个 case 为 fallback 模式**

将 `case "stop"` 替换为（优先复用 ipcClient）：

```ts
                case "stop": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "shutdown" });
                        ipcClient.disconnect();
                        ipcClient = null;
                        ctx.ui.notify("Shutdown sent, daemon will stop", "info");
                        return;
                    }

                    if (!existsSync(SOCKET_PATH)) {
                        ctx.ui.notify("Daemon is not running", "info");
                        return;
                    }

                    try {
                        const client = createIPCClient(SOCKET_PATH);
                        await client.connect();
                        client.send({ type: "shutdown" });
                        client.disconnect();
                        ctx.ui.notify("Shutdown sent, daemon will stop", "info");
                    } catch {
                        ctx.ui.notify("Failed to connect to daemon", "error");
                    }
                    break;
                }
```

将 `case "restart"` 替换为：

```ts
                case "restart": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "shutdown" });
                        ipcClient.disconnect();
                        ipcClient = null;
                        await new Promise((r) => setTimeout(r, 500));
                    } else if (existsSync(SOCKET_PATH)) {
                        try {
                            const client = createIPCClient(SOCKET_PATH);
                            await client.connect();
                            client.send({ type: "shutdown" });
                            client.disconnect();
                            await new Promise((r) => setTimeout(r, 500));
                        } catch { }
                    }

                    try { rmSync(SOCKET_PATH); } catch { }
                    try { rmSync(PID_FILE); } catch { }

                    const client = await getClient(ctx);
                    if (client) {
                        client.send({ type: "status" });
                    }
                    break;
                }
```

将 `case "status"` 替换为：

```ts
                case "status": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "status" });
                        return;
                    }

                    if (!isDaemonRunning()) {
                        ctx.ui.notify("Daemon is not running", "info");
                        return;
                    }

                    if (!existsSync(SOCKET_PATH)) {
                        ctx.ui.notify("Daemon PID found but socket not ready", "info");
                        return;
                    }

                    const client = createIPCClient(SOCKET_PATH);
                    try {
                        await client.connect();
                        client.on("message", (msg) => {
                            if (msg.type === "status") {
                                ctx.ui.notify(
                                    `PID: ${msg.pid}, Uptime: ${Math.round(msg.uptime / 1000)}s, WS: ${msg.wsConnected ? "connected" : "disconnected"}`,
                                    "info",
                                );
                                client.disconnect();
                            }
                        });
                        client.send({ type: "status" });
                    } catch {
                        ctx.ui.notify("Cannot query daemon status", "warning");
                    }
                    break;
                }
```

- [ ] **Step 2: 运行 TypeScript 编译检查**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 运行全部测试验证**

```bash
npx vitest run
```
Expected: 54 tests passed

- [ ] **Step 4: 提交**

```bash
git add extensions/index.ts
git commit -m "fix: status/stop/restart use fallback pattern — reuse ipcClient then temp connection"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 运行完整测试套件**

```bash
npx vitest run
```
Expected: 全部 7 个 test file、54 个 test 通过

- [ ] **Step 2: 运行 TypeScript 编译**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 检查 git status 确认所有修改到位**

```bash
git status
```

# Daemon IPC 多连接 & 飞书连接去重 设计

## 问题

单连接 IPC server 导致 `status`/`stop`/`restart` 独立创建 client 时被拒绝
（`Rejected new connection`）。之前的修复走的是"复用已有连接"路线
（各子命令共用 `ipcClient`），但用户选择改为去掉单连接限制。

## 设计

### 1. IPC Server 支持多连接 ~~（已废弃）~~

**文件:** `src/ipc/server.ts`

- `_activeSocket: net.Socket | null` → `_sockets: Set<net.Socket>`
- 移除 `createServer` 回调中的拒绝逻辑（`bye` 消息、`reject` 事件）
- `sendToClient(msg)` 改为遍历所有 socket，广播消息
- `close()` 改为遍历所有 socket 逐条关闭
- `activeSocket` getter 保持向后兼容：返回第一个未销毁的 socket
- 开放 `socketCount` 属性用于监控

### 2. Extension Fallback 模式

**文件:** `extensions/index.ts`

各子命令：**优先复用已有 `ipcClient`，若无则创建临时连接**

| 命令 | ipcClient 在线 | 回退（临时连接） |
|------|:--------:|:------:|
| `status` | 通过 ipcClient 发 status | 创建独立 client，连上发 status，收到响应后断开 |
| `stop` | 通过 ipcClient 发 shutdown → disconnect | 创建独立 client，发 shutdown，断开 |
| `restart` | 通过 ipcClient 发 shutdown → disconnect | 创建独立 client 发 shutdown → `getClient` 启动新 daemon |

`start` 保持不变：通过 `getClient(ctx, onMessage)` 建立持久连接。

### 3. Daemon 防飞书重复连接

**文件:** `src/daemon/index.ts`

多连接下每次新 client 接入都触发 `connect` 事件，需防止重复连接飞书
WebSocket：

- **`connectChannel`:** 开头加 guard，如果 `channel?.connected`，先 `await channel.disconnect()` 再重建。保护并发场景。
- **`connect` handler:** 若 `channel?.connected`，直接对该 socket 回复 `{ type: "ready" }`，不调 `connectChannel`。否则调 `connectChannel` 建立连接。

### 4. 保留已有修复

- **问题1（消息时序）:** `getClient` 的 `onMessage` 在 `connect()` 前注册，不丢失初始消息
- **问题3（socket 清理）:** cleanup 中 `unlinkSync(SOCKET_PATH)` + `await ipcServer.close()`

## 测试变更 ~~（已废弃）~~

- `server.test.ts`: "rejects second client" / "sends bye message" → 替换为多连接测试（并发 client、broadcast）— 现已恢复为单连接测试
- `client.test.ts`: "handles bye message" → 替换为多 client 同时连接测试

## 不涉及

- auth 流程、registry、channel 模块无需修改
- `start` 子命令逻辑无需修改

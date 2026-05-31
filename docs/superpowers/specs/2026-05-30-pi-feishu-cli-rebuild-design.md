# Pi Feishu CLI 重建设计文档

**日期**: 2026-05-30
**状态**: 部分已逾期

> **注意**: 以下设计已在新设计中修改——
> - 2.1 双向同步：Pi TUI 不再自动同步到飞书（见 [2026-05-31 设计](./2026-05-31-single-ipc-forwarding-design.md)）
> - 4.2 连接握手：已确认恢复为单连接（与 spec 一致），Daemon 同时仅服务 1 个 Extension

---

## 1. 总体目标

将 `pi-feishu-cli` 重建为一个 [Pi package](https://pi.dev/docs/latest/packages)，包含：

- 一个 [Pi Extension](https://pi.dev/docs/latest/extensions) —— 飞书 IM 集成
- 一组 [skills](./skills/) —— 飞书平台技能（26个，原样保留）

---

## 2. Extension 功能

### 2.1 飞书会话机器人

用户通过飞书与机器人对话，实现与 Pi 交互终端的双向同步：

- 飞书消息（含图片、文件）发送给 Pi，Pi 响应流式回到飞书
- Pi 回复正确渲染（markdown）
- 通过 card 消息进行 Pi session 管理 / model 切换
- 飞书消息 → Pi 处理（仅飞书消息触发 Pi，Pi TUI 对话不再同步到飞书）

### 2.2 管理命令

| 命令 | 行为 |
|------|------|
| `/feishu-im start` | 启动飞书通信（检查/创建 Daemon，连接 socket） |
| `/feishu-im stop` | 停止通信（通知 Daemon 退出） |
| `/feishu-im restart` | stop + start |
| `/feishu-im status` | 查看状态：pid、uptime、飞书 WebSocket 连接状态 |

飞书机器人通信是用户 scope 全局唯一的。

---

## 3. 架构

### 3.1 进程模型

```
                          Pi 进程
┌────────────────────────────────────────────────┐
│  Pi Extension (extensions/index.ts)            │
│                                                │
│  ┌──────────────┐   ┌──────────────────┐      │
│  │ /feishu-im   │   │ ChatId ↔ Session │      │
│  │ 命令管理     │   │ Registry         │      │
│  │              │   │ (JSON 持久化)    │      │
│  └──────┬───────┘   └────────┬─────────┘      │
│         │                    │                │
│  ┌──────┴────────────────────┴──────────┐     │
│  │    IPC Client (Unix Socket)          │     │
│  │  收: 飞书消息、cardAction 等         │     │
│  │  发: Pi 响应、TUI 消息、管理指令      │     │
│  └─────────────┬────────────────────────┘     │
└────────────────┼────────────────────────────────┘
                 │ /tmp/pi-feishu-im.sock
┌────────────────┼────────────────────────────────┐
│  Daemon 进程   │ (由 Extension spawn, detached)  │
│  ┌─────────────┴────────────────────────┐      │
│  │    IPC Server (Unix Socket)          │      │
│  └─────────────┬────────────────────────┘      │
│                │  1:1 (同时仅一个 Extension)    │
│  ┌─────────────┴────────────────────────┐      │
│  │  Feishu Channel                      │      │
│  │  createLarkChannel(appId, secret)    │      │
│  │  connect/send/stream                 │      │
│  │  on(message/cardAction/reaction...)  │      │
│  └──────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

**关键设计：**

- Daemon 由 Extension 的 `/feishu-im start` 以 `child_process.spawn` 创建（detach + unref），独立于 Pi 进程生命周期
- Pi 退出时 Daemon 不退出；若 socket 对端断开（EOF），Daemon 继续维持飞书 WebSocket 连接。飞书来消息时暂存内存，飞书侧回复"Pi 暂时离线"状态。Extension 重连后恢复转发
- `/feishu-im stop` 通过 IPC 发 `shutdown` 指令，Daemon 退出并清理 PID 文件
- `/feishu-im start` 时若 Daemon 已在线则直接连接 socket（复用已有 Daemon）
- Daemon 同时只服务 1 个 Extension 连接。新连接到达时，若已有连接则拒绝（`bye`）

### 3.2 项目结构

```
pi-feishu-cli/
├── package.json           # pi package manifest
├── extensions/
│   └── index.ts           # Pi Extension 入口
├── skills/                # 26 个 lark-* skills（原样保留）
├── src/
│   ├── daemon/
│   │   └── index.ts       # Daemon 进程入口
│   ├── ipc/
│   │   ├── protocol.ts    # IPC 消息类型定义
│   │   ├── server.ts      # Unix Socket 服务端（Daemon 用）
│   │   └── client.ts      # Unix Socket 客户端（Extension 用）
│   ├── channel/
│   │   └── index.ts       # Feishu Channel SDK 封装
│   ├── auth/
│   │   └── index.ts       # 凭证加载/持久化/交互
│   └── config.ts          # 路径常量
└── tests/                 # vitest 测试
```

**package.json 关键字段：**

```json
{
  "name": "pi-feishu-cli",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^x"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

`extensions/` 和 `skills/` 使用 Pi 的 convention directories 自动发现。`src/` 是内部实现，由 `extensions/index.ts` 通过 import 引用，jiti 直接加载 TypeScript。

### 3.3 运行时数据目录

```
~/.pi/agent/feishu-im/
├── auth.json       # 飞书凭据
├── daemon.pid      # Daemon PID
├── registry.json   # chatId → session 映射
└── daemon.log      # Daemon 日志
```

---

## 4. IPC 协议

Unix Socket 上运行 JSON-line 协议（每行一条 JSON，`\n` 分隔）。

### 4.1 消息类型

**Daemon → Extension：**

| type | 描述 |
|------|------|
| `ready` | 握手完成（含 `botIdentity.name`） |
| `bye` | 握手阶段被拒绝（已有其他连接） |
| `message` | 飞书归一化消息（NormalizedMessage 字段） |
| `cardAction` | 飞书卡片按钮点击 |
| `reaction` | 飞书表情表态 |
| `error` | 飞书连接/发送错误 |
| `needAuth` | 缺少凭据或认证失败 |
| `status` | 响应 status 查询（pid, uptime, wsConnected） |

**Extension → Daemon：**

| type | 描述 |
|------|------|
| `send` | 发送消息到飞书（text/markdown/card 等） |
| `stream` | 流式消息 chunk |
| `streamEnd` | 结束当前流式消息 |
| `updateCard` | 更新卡片内容 |
| `shutdown` | 通知 Daemon 退出 |
| `status` | 查询 Daemon 状态 |
| `auth` | 发送凭据（appId/appSecret）用于重试认证 |

### 4.2 连接握手

```
Extension                              Daemon
    │                                     │
    │ ──── connect ────────────────────►  │
    │                             检查是否已有连接
    │ ◄──── {"type":"bye"} ────────────  │  (已有连接，拒绝)
    │                                     │
    │ 或:                                  │
    │ ◄──── {"type":"ready",             │
    │         botIdentity:{name}} ──────  │  (接受，握手完成)
    │                                     │
    │ ──── {"type":"status"} ──────────►  │
    │ ◄──── {"type":"status",            │
    │         {pid,uptime,wsConnected}}──  │
```

### 4.3 流式消息

```
Ext ── {"type":"stream", chatId, replyTo, content} ──► Daemon
     ◄── (创建占位卡片，发送首个 chunk)
Ext ── {"type":"stream", chatId, content} ──────────► Daemon
Ext ── {"type":"stream", chatId, content} ──────────► Daemon
Ext ── {"type":"streamEnd", chatId} ────────────────► Daemon
     ◄── (最终消息/卡片)
```

---

## 5. 消息路由与会话同步

### 5.1 飞书 → Pi

```
飞书消息 → Daemon → [IPC: "message"] → Extension
  │
  ├─ 对话消息 → 检查 registry 中 chatId 映射
  │   ├─ 有映射 → 切换 Pi session → 已有消息（由 synchronized Pi 机制处理）
  │   └─ 无映射 → ctx.newSession() → 写入 registry
  │   └─ pi.sendUserMessage(msg) → Pi Agent 处理
  │       Agent 响应 → stream IPC → Daemon → 飞书
  │
  └─ 管理命令(/sessions, /model)
     ──► 返回 Card → Daemon → 飞书
         卡片按钮 → cardAction → IPC → Extension → 执行业务
```

### 5.2 Pi → 飞书

Pi 事件钩子：

| 事件 | 行为 |
|------|------|
| `before_agent_start` | 用户提交 prompt → 若 session 在 registry 中，转发用户消息文本到飞书 |
| `message_update` | Agent 流式响应 token → 转发到飞书（stream IPC） |
| `message_end` | Agent 响应结束 → streamEnd IPC |

**循环防止**：Extension 通过 `pi.sendUserMessage()` 注入的飞书消息也会触发上述 Pi 事件。Extension 维护一个 `injectingMessageIds` 集合，标记自己注入的消息，在事件处理中跳过这些消息的转发。

### 5.3 Pi 事件处理总览

| 事件 | 行为 |
|------|------|
| `before_agent_start` | 若 session 在 registry 中且非 Extension 注入 → 转发用户消息到飞书 |
| `message_update` | 若 session 在 registry 中 → 转发 token 到飞书 (stream) |
| `message_end` | 若 session 在 registry 中 → streamEnd IPC |
| `session_shutdown` | 清理当前 session 的内存状态（不清理 registry 持久化） |

### 5.4 管理交互（Card）

| 触发 | Card 内容 | 操作 |
|------|----------|------|
| `/sessions` | 会话列表（名称、消息数、时间） | 按钮：切换 / 删除 / 新建 |
| `/model` | 模型选择器（下拉） | 按钮：确认切换 → `pi.setModel()` |
| 卡片回调 | - | Extension 收到 cardAction → 执行业务 → updateCard |

Card 使用飞书卡片 V2 schema，按钮绑定 `callback` behavior。

---

## 6. 凭据管理

### 6.1 凭据文件

位置：`~/.pi/agent/feishu-im/auth.json`

```json
{
  "appId": "cli_xxxxx",
  "appSecret": "xxxxx"
}
```

### 6.2 流程

```
/feishu-im start
    → Daemon 启动
    → 读取 auth.json
        ├─ 有凭证 → channel.connect(appId, appSecret)
        │   ├─ 成功 → IPC "ready" → 正常运行
        │   └─ 失败 → IPC "needAuth"
        └─ 无凭据 → IPC "needAuth"

Extension 收到 "needAuth"
    → ctx.ui.input("请输入飞书 App ID")
    → ctx.ui.input("请输入飞书 App Secret")
    → IPC "auth" { appId, appSecret }
    → Daemon 重试连接
        ├─ 成功 → 写入 auth.json, IPC "ready"
        └─ 失败 → IPC "needAuth" (循环)
```

---

## 7. 技术栈

| 领域 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js (jiti 加载，无需编译) |
| 飞书通信 | `@larksuiteoapi/node-sdk` (Channel 模块) |
| Pi SDK | `@earendil-works/pi-coding-agent` (peer) |
| Schema | `typebox` (peer) |
| IPC | Node.js `net` 模块 (Unix Socket) |
| 进程管理 | `child_process.spawn` (detach + unref) |
| 测试 | vitest |

---

## 8. 边界条件

| 场景 | 处理 |
|------|------|
| Pi 退出（未 `/feishu-im stop`） | Daemon 存活，socket 对端断开。飞书消息暂存内存队列，飞书侧回复"Pi 暂时离线"。Extension 重连后恢复。 |
| Extension 崩溃重启 | `/feishu-im start` 检测 Daemon 在线 → 直接连 socket。Daemon 恢复转发。 |
| 飞书 WebSocket 断连 | Daemon 自动重连（Channel SDK 内置），emit `reconnecting`/`reconnected` |
| 发送时目标消息已删除 | Channel SDK 内置降级：去 `replyTo` 重发为普通消息 |
| 飞书消息格式为未知类型 | Channel SDK 自动归一化为 markdown + XML-style 标签 |
| Daemon 已有连接，新 Extension 尝试连接 | Daemon 返回 `bye`，拒绝新连接 |
| Daemon 进程僵尸 | `/feishu-im start` 检测 PID 不存活 → spawn 新 Daemon |

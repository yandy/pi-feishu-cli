# pi-feishu-cli 重构设计文档

> 日期: 2026-05-30 | 版本: v0.3.0

## 1. 概述与目标

`pi-feishu-cli` 是 Pi 的飞书 IM 集成扩展，允许用户从飞书客户端直接与 Pi 对话。它在后台运行一个守护进程（daemon），通过 `lark-cli` 与飞书开放平台交互，接收消息事件、调用 LLM（通过 `pi-coding-agent`）处理消息、并将回复发回飞书。

本次重构目标：从 main 分支干净代码重写，遵循本文档中的功能设计，同时移除 `--feishu-im` flag、清理废弃配置字段、提升代码质量。

## 2. 需求变更

| 项目 | 旧设计 | 重构后 |
|------|------|--------|
| `/feishu-im start\|stop\|status\|restart` | 保留 | 保留 |
| `--feishu-im` flag | 保留 | **删除** |
| `autoStart` 配置 | 定义 | **删除**（flag 已删，无消费方） |
| `pollInterval` 配置 | 定义 | **删除**（流式 consumer 不需要轮询） |

## 3. 架构

```
┌──────────────────────────────────────────────────────────┐
│  Pi CLI (extension.ts)                                   │
│  /feishu-im start|stop|status|restart                    │
│  ├── spawns daemon.ts as detached child process          │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Daemon (daemon.ts)                                      │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Event Consumer (consumer.ts: startEventConsumer) │    │
│  │  lark-cli event consume im.message.receive_v1     │    │
│  │  --as bot  →  stdout NDJSON stream                │    │
│  └───────────────┬──────────────────────────────────┘    │
│                  │ event                                  │
│                  ▼                                        │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Bot Router (bot.ts)                              │    │
│  │  route(event) → command | message | skip          │    │
│  └───────────────┬──────────────────────────────────┘    │
│                  │ route                                  │
│                  ▼                                        │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Event Queue + processNext()                      │    │
│  │  Serial processing, one message at a time         │    │
│  └───────────────┬──────────────────────────────────┘    │
│                  │ item                                   │
│                  ▼                                        │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Message Processor (processor.ts: processItem)    │    │
│  │  1. setTypingStatus(messageId, true)              │    │
│  │  2. create AgentSession (pi-coding-agent)         │    │
│  │  3. agentSession.prompt(text)                     │    │
│  │  4. subscribe → agent_end → extract text+thinking │    │
│  │  5. sendMessage(response, chatId, "markdown")     │    │
│  │  6. setTypingStatus(messageId, false)             │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## 4. 文件结构

```
src/
├── extension.ts               # Pi 扩展：注册 /feishu-im 命令、spawn daemon
└── im/
    ├── daemon.ts               # 守护进程入口：初始化、队列调度、信号处理
    ├── consumer.ts             # lark-cli NDJSON 事件流消费 + 自动重连
    ├── messaging.ts            # lark-cli 封装：发送、typing、下载、可用性检查
    ├── bot.ts                  # 事件路由：命令/消息识别、p2p/群聊策略
    ├── processor.ts            # 消息处理：Agent session + LLM 调用 + 响应提取
    ├── cards.ts                # 飞书交互卡片构建
    ├── config.ts               # 配置加载与默认值
    ├── types.ts                # 类型定义
    ├── session-registry.ts     # 会话管理：创建/切换/删除，持久化到 registry.json
    ├── logger.ts               # 诊断日志工具
    ├── paths.ts                # 路径常量
    └── renderer.ts             # 长文本拆分（预留，暂未使用）
```

### 删除

- `src/poller.ts` — 拆分为 `im/consumer.ts` + `im/messaging.ts`

### 核心变更

| 文件 | 变更 |
|------|------|
| `extension.ts` | 移到 `src/` 根级；**删除** `registerFlag("feishu-im")`；daemon 路径指向 `src/im/daemon.ts` |
| `types.ts` | 删除 `pollInterval`、`autoStart` 字段 |
| `config.ts` | 默认值只含 `strategy: "mention"`，不读取 `pollInterval`、`autoStart`；支持 `botName` |
| `daemon.ts` | 瘦身：拆出 `processItem` 到 `processor.ts`；消费者逻辑调 `consumer.ts`；通信调 `messaging.ts` |
| `bot.ts` | 使用扁平 `FeishuEvent` 结构；mention 检测用 botName 配置；跳过 bot 自身消息 |
| `cards.ts` | 卡片 JSON 不带 `card` 包裹层；添加 `config.wide_screen_mode` |

## 5. 事件类型

### 5.1 FeishuEvent（扁平化，在 types.ts 定义）

lark-cli 输出的原始事件经过 NDJSON 解析后映射为此类型：

```typescript
export interface FeishuEvent {
  type: string;           // "im.message.receive_v1"
  chat_id: string;        // "oc_xxx"
  chat_type: string;      // "p2p" | "group"
  content: string;        // 预渲染的人类可读文本
  message_id: string;     // "om_xxx"
  message_type: string;   // "text" | "post" | "image" | "file" | ...
  sender_id: string;      // "ou_xxx"
  create_time: string;    // ms 时间戳字符串
  event_id: string;       // 唯一去重 ID
  timestamp: string;      // 事件投递时间
  raw: Record<string, unknown>;  // 原始 JSON
}
```

`content` 字段已被 lark-cli 的 convertlib hook 预处理。对于 `text`/`post` 类型，是纯文本；对于 `interactive`（卡片），是原始 JSON 字符串。

### 5.2 配置类型

```typescript
export interface FeishuImConfig {
  strategy: "open" | "mention";  // 群聊策略，默认 "mention"
  model?: string;                 // 模型 ID
  botName?: string;               // 机器人显示名称，用于 mention 检测
}
```

### 5.3 其他类型

```typescript
export interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;  // unix ms timestamp
}

export interface ChatSessions {
  sessions: SessionInfo[];
  active: string | null;
}

export interface Registry {
  [chatId: string]: ChatSessions;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  sessionCount: number;
  chatCount: number;
}
```

## 6. 模块职责详述

### 6.1 extension.ts

- 注册 `/feishu-im start|stop|status|restart` 命令
- handler 函数签名使用 ExtensionCommandContext 类型，`ctx.ui.notify(message, type?)` 其中 type 为 `"info" | "error" | "warning" | undefined`
- `start`: spawn daemon 子进程（`node --import jiti/register src/im/daemon.ts`），detached + unref；先检查 lark-cli 可用性和配置，失败时 notify 错误
- `stop`: 从 PID_FILE 读 pid → kill SIGTERM → unlink PID_FILE
- `status`: 从 PID_FILE 读 pid → `process.kill(pid, 0)` 检查存活
- `restart`: stop → 等 1s → start
- 通过 `src/im/paths.ts` 导入路径常量

### 6.2 daemon.ts

守护进程入口（`#!/usr/bin/env node`）：

1. 检查 lark-cli 可用性和配置（调 `messaging.ts`）
2. 加载 config、初始化 `SessionRegistry`、`Bot`
3. 写 PID_FILE
4. 创建 `AgentSessionRuntime`（共享 `runtime.services` 给每次 `createAgentSessionFromServices`）
5. 启动 consumer（`startEventConsumer`）→ 事件路由后入 FIFO 队列
6. 队列串行处理（`processNext` 递归，同时只处理一个事件）
7. 注册 `process.on("SIGTERM", ...)` 和 `process.on("SIGINT", ...)` → 停止 consumer → exit(0)
8. 未捕获异常 → log + exit(1)

### 6.3 consumer.ts

`startEventConsumer(onEvent: (event: FeishuEvent) => void, onError: (err: Error) => void) → stop`

```bash
lark-cli event consume im.message.receive_v1 --as bot
```

**关键参数：**

- 无 `--max-events` 限制（默认 0 = 无限）
- 无 `--timeout` 限制（默认 0 = 无限）
- stdin 通过 `pipe` 保持打开（否则 consumer 退出）
- stdout 输出 NDJSON 流，每行一个事件

**实现细节：**

- 使用 `spawn`（非 `exec`），`stdio: ["pipe", "pipe", "pipe"]`
- `readline.createInterface` 从 stdout 逐行解析 NDJSON → 构造 `FeishuEvent`
- 解析失败的行静默跳过
- 子进程 crash（`close` 或 `error` 事件）→ 2 秒后自动重连（除非已调用 `stop()`）
- `stop()` 设 stopped 标志 + 对当前子进程 kill SIGTERM

**为什么不用轮询？**
原设计使用 `--max-events 1 --timeout 30s` 的轮询模式，存在事件丢失问题：consumer 消费 1 个事件后退出、事件处理（LLM 调用）可能耗时 30+s、期间新事件可能因 bus daemon 超时退出而丢失。流式 consumer 消除了轮询间隙。

### 6.4 messaging.ts

封装所有 lark-cli 的同步调用，全部使用 `execFileAsync`，返回 `boolean`：

| 函数 | lark-cli 命令 | 超时 |
|------|-------------|------|
| `sendMessage(content, chatId, msgType)` | `im +messages-send --chat-id oc_xx --as bot [--text\|--markdown\|--msg-type interactive --content]` | 10s |
| `setTypingStatus(messageId, typing)` | `im reactions create` / `im reactions list` + `im reactions delete` | 10s |
| `downloadResource(messageId, fileKey, fileType, outputPath)` | `im +messages-resources-download` | 30s |
| `larkCliAvailable()` | `lark-cli --help` | 5s |
| `larkCliConfigured()` | `lark-cli config show` | 5s |

**sendMessage 参数说明：**

```bash
# 纯文本
lark-cli im +messages-send --chat-id oc_xxx --text "hello" --as bot

# Markdown（LLM 回复专用）
lark-cli im +messages-send --chat-id oc_xxx --markdown "**bold**" --as bot

# 交互卡片
lark-cli im +messages-send --chat-id oc_xxx --msg-type interactive --content '<card json>' --as bot
```

`--markdown` 内部将 Markdown 转换为飞书 `post` 格式，支持粗体、代码块等渲染。

**setTypingStatus 实现：**
飞书没有独立的"正在输入" API，通过消息表情反应（reaction）模拟：

```bash
# 添加 typing 指示器
lark-cli im reactions create \
  --params '{"message_id":"om_xxx"}' \
  --data '{"reaction_type":{"emoji_type":"Typing"}}' \
  --as bot

# 查找并移除 typing 指示器
lark-cli im reactions list --params '{"message_id":"om_xxx"}' --as bot
lark-cli im reactions delete --params '{"message_id":"om_xxx","reaction_id":"..."}' --as bot
```

需要的 scope：`im:message.reactions:write_only`。缺失时优雅降级（静默失败）。

### 6.5 bot.ts

`Bot(registry, strategy, botName?)`

`route(event: FeishuEvent) → RouteResult`

路由流程：

```
FeishuEvent
  │
  ├─ content 为空？ → skip
  ├─ sender 是 bot 自身？(sender_id.startsWith("bot_")) → skip
  │
  ├─ strategy === "mention" && chat_type === "group" ?
  │   ├─ 是 command？ → command
  │   ├─ 包含 @BotName 或 /@\S/？ → message
  │   └─ 其他 → skip
  │
  ├─ p2p 或 strategy === "open" → 正常路由
  │
  ├─ 匹配 /new /sessions /switch /rm /model → command
  └─ 其他 → message
```

**策略对比：**

| 策略 | p2p 消息 | 群聊消息 |
|------|----------|----------|
| `"open"` | 全部处理 | 全部处理 |
| `"mention"` | 全部处理 | 仅 @mention 或 command |

**Mention 检测：**

- 优先：配置 `botName`，检查 `content` 中是否包含 `@<botName>`
- 回退：正则 `/@\S/` 启发式匹配

**命令解析：**

- `/new [name]` — 新建会话（name 默认为"默认会话"）
- `/sessions` — 列出会话
- `/switch <id>` — 切换会话
- `/rm <id>` — 删除会话
- `/model` — 选择模型

**路由结果类型：**

```typescript
export interface RouteResultCommand {
  type: "command";
  command: string;
  args: string;
  chatId: string;
}

export interface RouteResultMessage {
  type: "message";
  text: string;
  chatId: string;
}

export interface RouteResultSkip {
  type: "skip";
}
```

### 6.6 processor.ts

`processItem(item, runtime, registry, agentDir) → Promise<void>`

**Command 分支（`handleCommand` 函数，不涉及 LLM）：**

- `/new` → `registry.createSession(chatId, args || "未命名会话")` → 发送确认文本
- `/sessions` → `buildSessionListCard(...)` → 发送交互卡片
- `/switch` → `registry.switchSession(...)` → 发送确认文本
- `/rm` → `registry.deleteSession(...)` → 发送确认文本
- `/model` → `getAvailableModels()` + `buildModelSelectCard(...)` → 发送交互卡片

**Message 分支（LLM 处理）：**

1. `setTypingStatus(messageId, true)` — fire-and-forget
2. `registry.ensureSession(chatId)` → `SessionManager.open(sessionPath)`
3. `createAgentSessionFromServices({ services: runtime.services, sessionManager })`
4. 订阅 `agent_end` 事件 → 从 `messages` 中提取最后一条 assistant 消息：
   ```typescript
   const lastAssistant = [...agentEvent.messages]
     .reverse()
     .find((m) => m.role === "assistant");
   ```
5. 分别处理 ThinkingContent 和 TextContent：
   - `c.type === "thinking"` 且非 redacted 且有内容 → `"```思考\n" + c.thinking + "\n```"`
   - `c.type === "text"` → 直接拼接 `c.text`
6. `setTypingStatus(messageId, false)` — fire-and-forget
7. `sendMessage(responseText, chatId, "markdown")` — 使用 Markdown 模式

**异常处理：**
LLM 调用异常时 → 日志 + 给用户发送"处理消息时出错，请重试" + 移除 typing。

**多轮对话：**
每次调用前通过 `SessionManager.open(sessionPath)` 打开持久化文件，`pi-coding-agent` 的 session 机制自动保存/加载历史消息。每个 chat_id 对应独立会话。

### 6.7 config.ts

`loadConfig(configDir: string) → FeishuImConfig`

- 配置文件不存在时返回默认值
- 文件损坏时返回默认值（容错）
- 合并策略：每个字段用 `raw.field ?? DEFAULT_VALUE`

### 6.8 session-registry.ts

`SessionRegistry` 类 — 内存缓存 + `registry.json` 文件持久化：

| 方法 | 说明 |
|------|------|
| `getChatSessions(chatId)` | 获取某对话的所有会话 |
| `ensureSession(chatId)` | 获取活跃会话，无则创建默认会话 |
| `createSession(chatId, name)` | 创建新会话，自动设为活跃 |
| `switchSession(chatId, sessionId)` | 切换活跃会话 |
| `deleteSession(chatId, sessionId)` | 删除会话，删除活跃会话时自动切换 |

### 6.9 cards.ts

`buildSessionListCard(chatId, sessions, activeId) → string`

构建会话管理卡片（JSON 字符串），包含：
- 会话列表（活跃的以 `▶` 标记）
- "新建会话"按钮
- "切换模型"按钮

`buildModelSelectCard(chatId, models, current) → string`

构建模型选择卡片（JSON 字符串），包含：
- 当前模型名
- 可用模型列表（当前选中的高亮、其他为 default 样式）

### 6.10 paths.ts

```typescript
export const FEISHU_IM_DIR = join(homedir(), ".pi", "agent", "feishu-im");
export const PID_FILE = join(FEISHU_IM_DIR, "daemon.pid");
export const LOG_FILE = join(FEISHU_IM_DIR, "daemon.log");
export const CONFIG_FILE = join(FEISHU_IM_DIR, "config.json");
export const REGISTRY_FILE = join(FEISHU_IM_DIR, "registry.json");
```

### 6.11 logger.ts

```typescript
function log(msg: string): void {
  const ts = new Date().toISOString();
  try { appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`); } catch {}
}
```

### 6.12 renderer.ts

长文本拆分工具（暂未使用，预留不变）。

## 7. 运行时数据路径

| 路径 | 用途 |
|------|------|
| `~/.pi/agent/feishu-im/daemon.pid` | 守护进程 PID |
| `~/.pi/agent/feishu-im/daemon.log` | 诊断日志 |
| `~/.pi/agent/feishu-im/config.json` | 配置 |
| `~/.pi/agent/feishu-im/registry.json` | 会话注册表（chat_id → sessions 映射） |
| `~/.pi/agent/sessions/<sessionId>.jsonl` | Agent 会话持久化文件 |

## 8. 诊断日志

`daemon.log` 中的日志格式（ISO 时间戳 + 消息）：

```
[2026-05-30T03:20:33.315Z] Daemon started, pid=96411 strategy=mention
[2026-05-30T03:20:33.319Z] Event consumer started
[2026-05-30T03:20:46.912Z] Event: sender=ou_xxx type=text
[2026-05-30T03:20:46.912Z] Route: message
[2026-05-30T03:20:46.912Z] Queued, queue size=1
[2026-05-30T03:20:46.921Z] Calling agentSession.prompt...
[2026-05-30T03:20:47.839Z] Typing on: true
[2026-05-30T03:20:49.784Z] agent_end: messages.length=2
[2026-05-30T03:20:49.784Z] Response text length: 120
[2026-05-30T03:20:50.704Z] sendMessage result: true
```

## 9. 错误处理

| 层级 | 策略 |
|------|------|
| lark-cli 调用 (messaging.ts) | try/catch → return false，调用方决定 |
| consumer 崩溃 (consumer.ts) | 日志 + 2s 自动重连，不传播给上层 |
| LLM 调用异常 (processor.ts) | 日志 + 给用户发送错误消息 + 移除 typing |
| typing scope 缺失 | `setTypingStatus` 静默失败 |
| 顶级 (daemon.ts) | 未捕获异常 → log + exit(1) |

## 10. 飞书应用所需权限

| Scope | 用途 | 必需 |
|-------|------|------|
| `im:message.p2p_msg:readonly` | 接收消息事件 | 是 |
| `im:message:send_as_bot` | 以机器人身份发消息 | 是 |
| `im:message.reactions:write_only` | typing indicator（reaction） | 否（优雅降级） |

## 11. 事件订阅配置

在飞书开发者后台配置：

- **事件配置方式：** 长连接（由 lark-cli 的 bus daemon 管理）
- **订阅事件：** `im.message.receive_v1`

## 12. 命令行接口

```
/feishu-im start      启动守护进程
/feishu-im stop       停止守护进程
/feishu-im status     查看运行状态
/feishu-im restart    重启守护进程
```

## 13. 测试

### 13.1 策略：只 mock 外部 I/O

内部模块直接依赖不 mock。外部依赖 mock 方式：

- **lark-cli 进程**: mock `child_process.spawn` / `promisify(execFile)`
- **LLM**: 使用 `@earendil-works/pi-ai` 的 `registerFauxProvider()` + `@earendil-works/pi-coding-agent` 的 `SessionManager.inMemory()`
- **文件系统**: 使用 tmpdir（`node:os.tmpdir()`）

### 13.2 测试覆盖

| 测试文件 | 被测模块 | mock 外部依赖 |
|---------|---------|-------------|
| `tests/bot.test.ts` | bot.ts | 无（纯逻辑） |
| `tests/cards.test.ts` | cards.ts | 无（纯逻辑） |
| `tests/config.test.ts` | config.ts | fs（tmpdir） |
| `tests/session-registry.test.ts` | session-registry.ts | fs（tmpdir） |
| `tests/renderer.test.ts` | renderer.ts | 无（纯逻辑） |
| `tests/consumer.test.ts` | consumer.ts | spawn |
| `tests/messaging.test.ts` | messaging.ts | execFile |
| `tests/processor.test.ts` | processor.ts | `registerFauxProvider`、messaging 调用 |
| `tests/types.test.ts` | types.ts | 无（类型检查） |

### 13.3 processor 测试设计

```typescript
import { registerFauxProvider, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// 1. registerFauxProvider({ models: [...] }) → 获取 faux model
// 2. SessionManager.inMemory() → 无文件 I/O
// 3. 构造 runtime 走真实 createAgentSessionRuntime 流程
// 4. fauxProvider.setResponses([fauxAssistantMessage([fauxText("hello")])])
// 5. 验证 processor 的输出和副作用
```

## 14. 配置

### 14.1 config.json

位置：`~/.pi/agent/feishu-im/config.json`

```json
{
  "strategy": "mention",
  "model": "anthropic/claude-sonnet-4-20250514",
  "botName": "MyBot"
}
```

| 字段 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `strategy` | `"open" \| "mention"` | 否 | `"mention"` | 群聊策略 |
| `model` | `string` | 否 | — | 模型 ID |
| `botName` | `string` | 否 | — | mention 检测用的机器人名 |

### 14.2 默认值

```json
{
  "strategy": "mention"
}
```

## 15. 依赖

| 包 | 用途 |
|----|------|
| `lark-cli`（全局安装） | 飞书 CLI 工具：事件消费、消息发送、反应管理 |
| `@earendil-works/pi-coding-agent` | Agent session 创建和 LLM 调用 |
| `@earendil-works/pi-ai` | LLM 消息类型（AssistantMessage, TextContent, ThinkingContent）；测试用 faux provider |
| `vitest` | 测试框架（devDependency） |
| `typescript` | 类型检查（devDependency） |

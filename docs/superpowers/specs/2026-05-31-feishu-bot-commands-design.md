# 飞书机器人对话命令设计文档

**日期**: 2026-05-31
**状态**: 待实现
**前置依赖**: 基于 `pi-feishu-cli` 现有双进程架构

---

## 1. 目标

在飞书机器人对话中实现斜杠命令拦截，通过飞书卡片 V2 提供 session 管理和模型切换的交互界面。

## 2. 命令

| 命令 | Card 内容 | 操作 |
|------|----------|------|
| `/help` | 所有可用命令列表及说明 | 纯信息展示，无交互 |
| `/sessions` | 会话列表（名称、消息数、最后活跃时间） | 按钮：切换 / 解绑 / 删除 + 底部：新建会话 |
| `/model` | 模型选择器（下拉列表，当前模型标记） | 按钮：确认切换 |

## 3. 文件结构

```
extensions/
├── index.ts                  # 主入口（改动：message/cardAction case 添加命令路由）
├── bot-commands/
│   ├── router.ts             # 命令解析与路由分发
│   ├── help.ts               # /help 处理
│   ├── sessions.ts           # /sessions 处理
│   └── model.ts              # /model 处理
└── feishu-card.ts            # 飞书卡片 V2 JSON 构建工具
```

## 4. 命令路由 (`bot-commands/router.ts`)

### 4.1 接口

```typescript
const BOT_COMMANDS = { help: "/help", sessions: "/sessions", model: "/model" } as const;
type BotCommand = typeof BOT_COMMANDS[keyof typeof BOT_COMMANDS];

function parseBotCommand(content: string): BotCommand | null;
async function routeBotCommand(
  cmd: BotCommand,
  ctx: ExtensionCommandContext,
  chatId: string,
  registry: SessionRegistry,
): Promise<BotCommandResult>;
```

### 4.2 流程

1. `message` case 收到消息 → `parseBotCommand(content)`
2. 非命令（null）→ 走原有 `pi.sendUserMessage()` 流程
3. 是命令 → 检查 `registry[chatId]`（`/help` 除外，它不依赖 session）：
   - 无绑定 → 自动 `ctx.newSession()` + 写入 registry
   - 有绑定 → `ctx.switchSession(sessionFile)`
4. 调用对应 handler → 返回 `{ type: "card", card: object }`
5. 通过 `sendToDaemon({ type: "send", chatId, content: { card } })` 发回飞书

## 5. /sessions 命令 (`bot-commands/sessions.ts`)

### 5.1 卡片内容

- **标题**：会话列表
- **每行**（仅显示 registry 中的 session）：
  - 名称：`SessionManager.open(path).getSessionName()` 或 path basename
  - 消息数：`SessionManager.open(path).getEntries().length`
  - 最后活跃时间：文件 mtime
- **当前使用的 session 高亮标记**

### 5.2 卡片按钮

| 按钮 | 行为 | 按钮颜色 |
|------|------|---------|
| 切换 | `ctx.switchSession(path)` + 更新 registry | 蓝色 primary |
| 解绑 | 从 registry 移除，不删除 session 文件 | 灰色 default |
| 删除 | 删除 session 文件 + 从 registry 移除 | 红色 danger |
| 新建 | `ctx.newSession()` + 写入 registry + 刷新卡片 | 蓝色 primary（底部） |

### 5.3 cardAction 回调

action value 为 JSON 字符串：`{ "cmd": "sessions", "action": "switch"|"unbind"|"delete"|"new", "sessionPath": "..." }`

- `switch` → `ctx.switchSession(path)`，更新 registry，`updateCard` 刷新列表
- `unbind` → 从 registry 移除，`updateCard` 刷新列表
- `delete` → 删除 session 文件，从 registry 移除，`updateCard` 刷新列表
- `new` → `ctx.newSession()`，写入 registry，`updateCard` 刷新列表

## 6. /model 命令 (`bot-commands/model.ts`)

### 6.1 卡片内容

- **当前模型**：`ctx.model?.id` 显示在顶部
- **模型下拉选择器**：飞书卡片 V2 `select` 组件
  - 选项来源：`ctx.modelRegistry.getAvailable()`
  - 显示名：`model.name`
  - 默认选中：当前模型
- **确认切换按钮**

### 6.2 cardAction 回调

action value 为 JSON 字符串：`{ "cmd": "model", "action": "confirm", "modelProvider": "...", "modelId": "..." }`

1. 收到确认 → 根据 `modelProvider` + `modelId` 查找 Model 对象
2. `ctx.switchSession(boundSessionPath)` → 切换到当前群绑定的 session
3. `pi.setModel(selectedModel)` → 仅影响当前 session
4. `updateCard` 更新卡片显示切换结果

## 7. /help 命令 (`bot-commands/help.ts`)

### 7.1 卡片内容

- **标题**：帮助
- **内容**：所有可用命令列表，每个命令一行：
  - `/help` — 显示此帮助信息
  - `/sessions` — 管理会话（查看、切换、解绑、删除、新建）
  - `/model` — 切换 AI 模型

### 7.2 特点

- 纯信息展示卡片，无交互按钮
- 不需要 session 绑定（不触发自动创建 session）

## 8. 卡片构建工具 (`feishu-card.ts`)

提供飞书卡片 V2 JSON 构建函数，封装通用模板和组件：

- `createCardTemplate(title: string)` — 创建基础卡片模板
- `createActionElement(text: string, value: object, color?: string)` — 创建按钮
- `createSelectElement(placeholder: string, options: SelectOption[], defaultValue?: string)` — 创建下拉选择器
- `createMarkdownElement(content: string)` — 创建 markdown 文本块
- `createDividerElement()` — 创建分割线

## 9. 主入口改动 (`extensions/index.ts`)

### 8.1 message case 改动（L157-181）

```typescript
case "message": {
    // 先检测是否为斜杠命令
    const botCmd = parseBotCommand(msg.content);
    if (botCmd) {
        const result = await routeBotCommand(botCmd, ctx, msg.chatId, registry);
        if (result.type === "card") {
            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card: result.card } });
        }
        saveRegistry(registry);
        return;
    }

    // 原有消息处理逻辑保持不变
    const tag = `[feishu:#${++injectSequence}]`;
    // ...
}
```

### 8.2 cardAction case 改动（L183-185）

```typescript
case "cardAction": {
    const actionValue = msg.action?.value;
    if (!actionValue) return;
    let parsed: CardActionPayload;
    try { parsed = JSON.parse(actionValue); } catch { return; }
    if (parsed.cmd === "sessions") {
        await handleSessionsAction(parsed, ctx, registry, (c) => sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: c }));
        saveRegistry(registry);
    } else if (parsed.cmd === "model") {
        await handleModelAction(parsed, ctx, registry, (c) => sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: c }));
    }
    break;
}
```

## 10. 边界条件

| 场景 | 处理 |
|------|------|
| 无绑定 session 发 `/sessions` 或 `/model` | 自动 `ctx.newSession()` + 写入 registry，再执行命令 |
| 无绑定 session 发 `/help` | 直接返回帮助卡片，不创建 session |
| registry 为空时 `/sessions` | 显示空状态卡片 + "新建会话"按钮 |
| 删除当前正在使用的 session | 先 `ctx.newSession()`，再删除旧 session，更新 registry |
| 模型列表为空 | 卡片显示 "暂无可用模型" |
| cardAction value 解析失败 | 静默忽略，记录日志 |
| 切换/删除的 session 文件不存在 | 从 registry 清理，发出通知 |

## 11. 需要新增的 IPC 消息类型

现有 IPC 协议已支持所有需要的消息类型，无需新增：

- `send`（含 `card` 内容）— 发送命令响应卡片
- `updateCard` — 卡片按钮操作后刷新卡片
- `cardAction` — 接收卡片按钮回调（已从飞书 → Daemon → Extension 全程转发）

## 12. 涉及的外部 API

| API | 用途 | 位置 |
|-----|------|------|
| `ctx.switchSession(path)` | 切换会话 | ExtensionCommandContext |
| `ctx.newSession()` | 创建新会话 | ExtensionCommandContext |
| `ctx.sessionManager.getSessionFile()` | 获取当前 session 路径 | ReadonlySessionManager |
| `ctx.modelRegistry.getAvailable()` | 获取可用模型列表 | ModelRegistry |
| `ctx.model?.id` / `ctx.model?.provider` | 当前模型信息 | ExtensionContext |
| `pi.setModel(model)` | 设置模型 | ExtensionAPI |
| `SessionManager.open(path)` | 读取 session 元信息 | SessionManager 静态方法 |

# 飞书机器人中断生成功能设计

## 背景

TUI 模式中用户可通过 `esc` 键中断正在进行的 AI 生成（调用 `agent.abort()` → `AbortController.abort()` 中止 LLM 请求及工具执行）。飞书机器人模式缺少等价的交互，用户只能等待生成完成。

## 目标

在飞书流式卡片中提供「停止生成」按钮，允许用户中断正在进行的 AI 生成。

## 非目标

- 不实现 `/stop` 文本命令（仅停止卡片按钮）
- 不修改 `/help` 卡片内容
- 不影响 TUI 模式的中断行为

## 设计

### 架构概览

```
用户发送消息
  → promptLock
    → channel.send(停止卡片) → 拿到 messageId, 存入 stopCards Map
    → channel.stream() 流式输出开始
      │
      ├─ 用户点击「停止」按钮
      │   → cardAction 事件 → session.abort()
      │   → channel.updateCardByToken(token, "已中断"卡片)
      │   → (流结束时分支出 stopCards.delete 避免重复更新)
      │
      └─ 流自然结束（未被中断）
          → stopCards Map 中仍有 messageId
          → channel.updateCard(messageId, "生成完成"卡片)
          → stopCards.delete
    → unlock
```

### 无竞态条件

两种结束路径通过 `stopCards` Map 的存在性互斥：

- **cardAction 先触发**：已通过 token 更新卡片，流结束后 `finally` 检测到 Map 中无此 msgId，跳过
- **流先结束**：Map 中仍有 msgId，`finally` 用 `updateCard(msgId)` 更新卡片后删除
- cardAction 的 `setTimeout(fn, 0)` 和 `finally` 均在同一个事件循环内串行执行，不存在并发竞争

### 改动文件

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/feishu/channel.ts` | `send()` 返回值改为 `Promise<string>` | 原生 `raw.send()` 已返回 `message_id`，仅去包装层的丢弃 |
| `src/index.ts` | 新增停止卡片生命周期管理 | `stopCards` Map、停止卡片发送/更新/清理、`cardAction: "stop"` 处理 |
| `src/feishu/cards/stop.ts` | **新增** 停止卡片构建函数 | `buildStopCard()` 和 `buildStopCardDone(status: string)` |

### channel.ts 改动

```typescript
// 改动前
async send(chatId: string, content: unknown, options?: unknown) {
    await raw.send(chatId, content, options);  // 丢弃返回值
}

// 改动后
async send(chatId: string, content: unknown, options?: unknown): Promise<string> {
    return await raw.send(chatId, content, options);
}
```

`raw.send()` 内部调用 `im.v1.message.create()` 或 `im.v1.message.reply()`，已返回 `message_id: string`（SDK `index.js:91612`）。返回类型从 `void` 变 `string` 向下兼容，所有现有调用方不关心返回值。

### index.ts 改动

在 `setupFeishuHandlers` 闭包内：

```typescript
// 新增：追踪每个 chat 的停止卡片 messageId
const stopCards = new Map<string, string>();
```

**停止卡片 cardAction 处理**（在 `channel.on("cardAction", ...)` 内联处理，保证 `stopCards` 在闭包作用域内）：

```typescript
channel.on("cardAction", (evt: CardActionEvent) => {
    setTimeout(async () => {
        const value = (evt?.action?.value ?? {}) as Record<string, unknown>;
        const { cmd } = value;
        if (cmd === "stop") {
            if (runtime.session.isStreaming) {
                await runtime.session.abort();
            }
            const token = (evt?.raw as any)?.event?.token ?? (evt?.raw as any)?.token;
            if (token) {
                await channel.updateCardByToken(token, buildStopCardDone("已中断")).catch(() => {});
            }
            stopCards.delete(evt.chatId);  // 阻止 finally 重复更新
            return;
        }
        handleCardAction(evt, runtime, cwd, channel).catch((err) =>
            console.error("Card action failed:", err),
        );
    }, 0);
});
```

**流式上下文**（在 promptLock 内的流式处理中）：

```typescript
try {
    const stopCardMsgId = await channel.send(msg.chatId, {
        card: buildStopCard(),
    });
    stopCards.set(msg.chatId, stopCardMsgId);

    await channel.stream(msg.chatId, {
        markdown: async (s) => {
            const unbind = createStreamingHandler(runtime.session, s);
            try {
                await messageHandler(msg, attachments);
            } finally {
                unbind();
            }
        },
    }, { replyTo: msg.messageId });
} finally {
    const stopCardMsgId = stopCards.get(msg.chatId);
    if (stopCardMsgId) {
        const card = buildStopCardDone("生成完成");
        await channel.updateCard(stopCardMsgId, card).catch(() => {});
        stopCards.delete(msg.chatId);
    }
    unlock!();
}
```

### stop.ts（新增）

```typescript
export function buildStopCard(): Record<string, unknown> { ... }
export function buildStopCardDone(status: string): Record<string, unknown> { ... }
```

**停止卡片结构**（生成中）：

```json
{
  "schema": "2.0",
  "body": {
    "elements": [
      { "tag": "markdown", "content": "🤖 AI 正在生成中..." },
      {
        "tag": "action",
        "actions": [{
          "tag": "button",
          "text": { "tag": "plain_text", "content": "停止生成" },
          "type": "danger",
          "behaviors": [{
            "type": "callback",
            "value": { "cmd": "stop" }
          }]
        }]
      }
    ]
  }
}
```

**停止卡片结构**（已结束）：

```json
{
  "schema": "2.0",
  "body": {
    "elements": [
      { "tag": "markdown", "content": "✅ {status}" }
    ]
  }
}
```

### 不修改的文件

- `handler.ts` — 不需要 `/stop` 命令路由
- `streaming.ts` — 中止时 agent 停止发射事件，`unbind()` 自然清理，无需追加标记
- `feishu-ui.ts` — 不影响 dialog 流程
- `cards/help.ts` — 不需要展示 `/stop` 命令
- `cards/sessions.ts` / `cards/models.ts` — 不影响

## 状态表

| 状态 | 停止卡片内容 | 触发条件 |
|------|------------|---------|
| 生成中 | "🤖 AI 正在生成中..." + 停止按钮 | 发送非命令消息时 |
| 已中断 | "✅ 已中断" | 用户点击停止按钮 |
| 生成完成 | "✅ 生成完成" | 流自然结束 |

# 卡片消息交互原位更新 设计文档

> 2026-06-04

## 背景

当前项目中，卡片消息的交互处理方式为：用户点击卡片按钮后，bot **发送一条新的卡片消息**（`channel.send` + `replyTo`），而不是在原位更新卡片。这导致聊天中卡片消息堆积，用户体验差。

## 问题分析

### 当前实现

`src/index.ts:210-228` 通过 `channel.on("cardAction", handler)` 监听卡片交互事件，然后在 `handleCardAction`（行 247-309）中根据 `cmd` 分发给 help / session / model 分支，各分支通过 `channel.send(chatId, { card }, { replyTo: messageId })` 发送**新卡片消息**。

### 之前的迁移尝试为何失败（已废弃）

> **注意：此节描述的是过往尝试，已非当前方案。**

之前尝试使用 PATCH API（`channel.updateCard(messageId, card)`）实现原位更新，但遇到了 **"卡片更新后迅速被重置为原始内容"** 的竞态问题。

**根因**：`@larksuiteoapi/node-sdk` 的 `LarkChannel` 在 WebSocket 模式下处理 `card.action.trigger` 回调时，其内部 handler 返回 `undefined`，导致 SDK 向飞书响应**空内容**（`{ code: 200 }`），飞书将此理解为"卡片内容不变"。随后即使通过 PATCH API 更新了卡片，飞书客户端也会因回调响应指示"不变"而将卡片重置回初始状态。

### 正确的飞书卡片更新机制

飞书文档定义了三种卡片更新方式：

| 方式 | 适用场景 | 机制 |
|------|----------|------|
| ① 立即更新 | 3 秒内能完成 | 在回调 HTTP 200 响应 body 中返回新卡片 JSON |
| ② 不更新 | 仅收集点击数据 | 回调响应返回空值 |
| ③ 延时更新 | 需超过 3 秒 | 先返回 `{}`，再用 token 调延时更新 API（30 分钟有效，最多 2 次） |

本项目应使用**方式①**：在回调响应中直接返回新卡片，飞书客户端立即原位替换。

### SDK 机制：`onRawEvent` 是唯一入口

经深入调研 `@larksuiteoapi/node-sdk` 源码，`LarkChannel`（WebSocket 模式）下**不存在**任何配置 `card.action.trigger` 回调响应的机制：

| 路径 | 结论 |
|------|------|
| `channel.on("cardAction", handler)` | handler 返回值在 `SafetyPipeline.pushAction()` 中被丢弃（`yield handler()` 无赋值）；内置 dispatcher 再返回 `undefined` |
| `createLarkChannel` 构造选项 | 无 `cardAction` / `response` / `reply` / `webhookCallback` 等选项 |
| `SafetyPipeline` | 无 `pushActionWithResult` 或类似方法 |
| `EventDispatcher.register()` | 无 `setDefaultResponse` 或响应配置方法 |
| `CardActionHandler`（独立类，已导出） | 仅适用于 Webhook 模式，`LarkChannel` 内部不使用它 |

**唯一可用路径**：`channel.onRawEvent("card.action.trigger", handler)` → 调用 `dispatcher.register()` → **覆盖**内置 handler → handler 返回值直接经由 `EventDispatcher.invoke()` → `WSClient.handleEventData()` 作为 WS 响应发给飞书。

代价：失去 `SafetyPipeline`（去重、速率限制），但卡片更新是幂等操作，影响可控。

## 方案设计

### 架构

```
之前: cardAction event → handleCardAction(channel, ...) → channel.send(replyTo)
                                                   (发新卡)

之后: card.action.trigger event → onRawEvent handler
         → handleCardAction(runtime, cwd, value) → return { card }
         → onRawEvent return { card }
                                          (原位更新)
```

将业务逻辑保留在重构后的 `handleCardAction` 中（职责清晰、避免 onRawEvent 代码膨胀），`onRawEvent` 仅做事件解析和路由。

### 改动范围

**`src/index.ts`**：

1. **替换事件监听**：`channel.on("cardAction", ...)` → `channel.onRawEvent("card.action.trigger", ...)`
2. **重构 `handleCardAction`**：签名从 `(value, messageId, chatId, runtime, cwd, channel, handleSessions, handleModels) => void` 改为 `(runtime, cwd, value) => { card, toast? } | undefined`。不再接收 `channel` / `chatId` / `messageId` / `handleSessions` / `handleModels`，改为**返回**新卡片对象
3. **删除旧 `handleCardAction`**（行 247-309）
4. **清理不再使用的参数/变量**：`handleSessions` 和 `handleModels` 不再传给 `handleCardAction`

**不变**：`channel.ts`、`handleSessions` / `handleModels` / `handleHelp`（仍用于 `/` 文本命令发新卡）。

### 函数签名变更

```typescript
// 之前
async function handleCardAction(
  value: Record<string, any>,
  messageId: string | undefined,
  chatId: string | undefined,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
): Promise<void>

// 之后
async function handleCardAction(
  runtime: AgentSessionRuntime,
  cwd: string,
  value: Record<string, any>,
): Promise<{ card: Record<string, unknown>; toast?: { type: string; content: string } } | undefined>
```

### onRawEvent handler 伪代码

```typescript
channel.onRawEvent("card.action.trigger", async (raw: any) => {
    const value = raw?.action?.value ?? {};
    const messageId = raw?.open_message_id ?? raw?.context?.open_message_id;
    if (!messageId) return;

    try {
        const result = await handleCardAction(runtime, cwd, value);
        return result;
    } catch (err) {
        console.error("Card action failed:", err);
        return { toast: { type: "error", content: "操作失败" } };
    }
});
```

### handleCardAction 伪代码

```typescript
async function handleCardAction(runtime, cwd, value): Promise<...> {
    const { cmd, action } = value;

    if (cmd === "help") {
        if (action === "sessions") {
            const card = await buildSessionsCard({ runtime, cwd });
            return { card };
        }
        if (action === "models") {
            // build ModelsCard ...
            return { card };
        }
    }

    if (cmd === "session") {
        // new / switch / delete ...
        const card = await buildSessionsCard({ runtime, cwd });
        return { card };
    }

    if (cmd === "model" && action === "select") {
        // setModel / setThinkingLevel ...
        const card = await buildModelsCard({ ... });
        return { card };
    }
}
```

### 需清理的代码

| 代码 | 位置 | 原因 |
|------|------|------|
| `channel.on("cardAction", ...)` 整块 | 原行 210-228 | 已被 `onRawEvent` 替代 |
| 旧 `handleCardAction` 函数 | 原行 247-309 | 重构为新版本 |
| `FeishuCommandHandler` import | 原行 25 | `handleCardAction` 重构后不再引用 |
| `channel` / `handleSessions` / `handleModels` 传给 `handleCardAction` 的代码 | setupFeishuHandlers 内 | 新签名不再需要 |

### 限制

| 维度 | 限制 |
|------|------|
| 更新有效期 | 从卡片**原始发送时间**起 14 天（v2），过期后更新无效 |
| 交互有效期 | 同 14 天，过期后按钮不可点击 |
| 更新次数 | **无硬性限制**，每次点击均可立即返回新卡片 |
| 响应时限 | 每次 callback 须在 3 秒内返回 HTTP 200 |
| `onRawEvent` 代价 | 失去 SDK 内置 safety 管道（去重、速率限制），但卡片更新是幂等操作，影响可控 |

### 风险

- 若 handler 执行超过 3 秒，飞书会展示错误，卡片不更新。三个分支的资源操作（newSession、switchSession、buildCard）预期在秒级完成。
- 14 天后卡片不可更新，交互按钮会显示失效提示。这是飞书平台限制，无法绕过。

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

**根因**：`PATCH /im/v1/messages/{message_id}`（"更新应用发送的消息卡片"）是面向**无条件更新**场景的 API。飞书文档明确说明：交互触发的更新应使用**延时更新消息卡片**（`POST /open-apis/interactive/v1/card/update`，带 token），而非 PATCH API。用了错误的 API 导致竞态。

### 正确的飞书卡片更新机制

飞书文档定义了三种卡片更新方式：

| 方式 | 适用场景 | 机制 | API |
|------|----------|------|-----|
| ① 立即更新 | 3 秒内能完成 | 在回调 HTTP 200 响应 body 中返回新卡片 JSON | 回调响应 |
| ② 不更新 | 仅收集点击数据 | 回调响应返回空值 | 回调响应 |
| ③ 延时更新 | 需超过 3 秒（最宽松 30 分钟） | 先返回 `{}`，再用 token 调延时更新 API | `POST /open-apis/interactive/v1/card/update` |

本项目选用**方式 ③（延时更新）**。

### 为什么选方式 ③ 而非方式 ①

| | 方式 ① | 方式 ③ |
|---|---|---|
| 时间窗 | 3 秒 | 30 分钟 |
| SDK 侵入 | 需 `onRawEvent` 覆盖内置 handler，失去 SafetyPipeline | 保留 `channel.on("cardAction")`，完整 SafetyPipeline |
| 实现复杂度 | 低 | 中（新增 1 个 channel 方法 + `includeRawEvent`） |
| token 限制 | 无 | 每 token 可用 3 次，30 分钟过期 |
| 回调响应 | 由我们的 handler 返回新卡片 | SDK 自动返回 `{}`（不更新） |

方式 ③ 保留 SDK 的安全机制，30 分钟窗口足够宽裕，token 限制在交互场景中不构成瓶颈（每次点击都是新 token）。

## 方案设计

### 架构

```
之前: cardAction event → handleCardAction → channel.send(replyTo)
                                    (发新卡)

之后: cardAction event → handleCardAction → channel.updateCardByToken(token, card)
                                    (延时更新 → 原位替换)
```

### 数据流

```
用户点击卡片按钮
  → Feishu 发送 card.action.trigger 回调
  → SDK 自动响应 {}（不更新）
  → channel.on("cardAction", evt) 触发 ← 保留 safety 管道
  → handleCardAction(evt, runtime, cwd, channel)
     → 从 evt.raw.token 提取 token
     → 处理业务逻辑（newSession / setModel 等）
     → 构建新卡片
     → channel.updateCardByToken(token, card)
       → POST /open-apis/interactive/v1/card/update { token, card }
  → 飞书原位更新卡片
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/feishu/channel.ts` | ① `createLarkChannel` 加 `includeRawEvent: true`；② `RawLarkChannel.rawClient` 加 `request` 方法类型；③ `Channel` 接口加 `updateCardByToken`；④ 实现 `updateCardByToken` |
| `src/index.ts` | ① 重写 `handleCardAction`（签名、逻辑）；② 修改 cardAction 回调传参；③ 删除 `FeishuCommandHandler` import（不再需要） |

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
  evt: CardActionEvent,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
): Promise<void>
```

### handleCardAction 伪代码

```typescript
async function handleCardAction(evt, runtime, cwd, channel): Promise<void> {
    const value = evt?.action?.value ?? {};
    const token = (evt?.raw as any)?.event?.token
        ?? (evt?.raw as any)?.token;
    const { cmd, action } = value;

    if (cmd === "help") {
        if (action === "sessions") {
            const card = await buildSessionsCard({ runtime, cwd });
            if (token) await channel.updateCardByToken(token, card);
        }
        if (action === "models") {
            const card = await buildModelsCard({ ... });
            if (token) await channel.updateCardByToken(token, card);
        }
        return;
    }

    if (cmd === "session") {
        // new / switch / delete ...
        const card = await buildSessionsCard({ runtime, cwd });
        if (token) await channel.updateCardByToken(token, card);
        return;
    }

    if (cmd === "model" && action === "select") {
        // setModel / setThinkingLevel ...
        const card = await buildModelsCard({ ... });
        if (token) await channel.updateCardByToken(token, card);
        return;
    }
}
```

### 需清理的代码

| 代码 | 原因 |
|------|------|
| `handleSessions` / `handleModels` 参数传给 `handleCardAction` | 新签名不接收 |
| 旧 `handleCardAction` 中 `channel.send` + `replyTo` 逻辑 | 替换为 `updateCardByToken` |
| `FeishuCommandHandler` import | `handleCardAction` 签名中不再引用 |
| `chatId` 字段提取 | 延时更新不需要 chatId |

### 限制

| 维度 | 限制 |
|------|------|
| 更新有效期 | 从卡片**原始发送时间**起 14 天（v2），过期后更新无效 |
| token 有效期 | 30 分钟 |
| token 使用次数 | 每次交互可用 3 次 |
| 安全性 | 保留 SDK 完整 SafetyPipeline（去重、速率限制） |

### 风险

- token 有效期 30 分钟，交互响应在秒级完成，不构成瓶颈。
- 14 天后卡片不可更新，交互按钮会显示失效提示。这是飞书平台限制，无法绕过。
- `rawClient.request` 是 SDK 非文档化但实装可用的方法（LarkChannel 内部也用此调用 `bot/v3/info`）。

# Card v1 → CardKit v2 全量迁移设计

## 概述

将所有卡片消息（`/help`、`/sessions`、`/models`）从 card JSON 1.0 结构迁移到 card JSON 2.0 结构，并通过 CardKit API（`cardkit.v1.card.*`）管理卡片生命周期。卡片刷新从"发新消息"改为"原地更新"。

## 动机

- Card v1（JSON 1.0）是旧版协议，飞书不再维护
- Card v2（JSON 2.0 + CardKit）提供更好的 markdown 支持和更清晰的组件结构
- 原地更新卡片避免刷屏，改善用户体验

## 架构

```
src/feishu/
├── channel.ts              # +rawClient, +sendCardMessage(), +updateCardMessage()
├── handler.ts              # 不变
├── streaming.ts            # 不变
└── cards/
    ├── manager.ts          # NEW: CardKitManager (create/update/idConvert)
    ├── helpers.ts          # v1→v2 JSON 结构重构
    ├── help.ts             # 适配 v2
    ├── sessions.ts         # 适配 v2
    └── models.ts           # 适配 v2
```

- `CardKitManager`（`cards/manager.ts`）是 channel 的私有依赖，不对 index.ts 暴露
- Channel 对外只暴露 `sendCardMessage` / `updateCardMessage` 两个高层方法
- Card builders（help/sessions/models）只改 JSON 结构，不改调用逻辑

## Card v2 JSON 结构

### v1 → v2 结构对照

```jsonc
// v1 (当前)
{
  "config": { "wide_screen_mode": true, "update_multi": true },
  "header": { "title": { "tag": "plain_text", "content": "..." }, "template": "blue" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "..." } },
    { "tag": "hr" },
    { "tag": "action", "actions": [{ "tag": "button", "text": { "tag": "plain_text", "content": "..." }, "type": "primary", "value": {...} }] },
    { "tag": "note", "elements": [{ "tag": "plain_text", "content": "..." }] }
  ]
}

// v2 (目标)
{
  "schema": "2.0",
  "config": { "update_multi": true, "width_mode": "fill" },
  "header": { "title": { "tag": "plain_text", "content": "..." }, "template": "blue" },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "..." },
      { "tag": "hr" },
      { "tag": "action", "actions": [{ "tag": "button", "text": { "tag": "plain_text", "content": "..." }, "type": "primary", "value": {...} }] },
      { "tag": "note", "elements": [{ "tag": "plain_text", "content": "..." }] }
    ]
  }
}
```

### helpers.ts 构建函数映射

| 原函数 | 参数 | v2 产出 |
|--------|------|---------|
| `createCardHeader(title, template?)` | 不变 | `{ title: { tag: "plain_text", content: title }, template? }` |
| `createMarkdownBlock(content)` | 不变 | `{ tag: "markdown", content }` |
| `createDividerBlock()` | 不变 | `{ tag: "hr" }` |
| `createActionButton(text, value, type?)` | 不变 | 不变 |
| `createNoteBlock(content)` | 不变 | `{ tag: "note", elements: [{ tag: "plain_text", content }] }` |
| `buildCard(header, elements)` | 不变 | `{ schema: "2.0", config: { update_multi: true, width_mode: "fill" }, header, body: { elements } }` |

## CardKitManager（`cards/manager.ts`）

内部类，被 `channel.ts` 引用但不对外导出。

```typescript
class CardKitManager {
  constructor(client: RawClient);

  // cardkit.v1.card.create — 创建卡片实体
  createCard(cardJson: Record<string, unknown>): Promise<string>;  // → card_id

  // im.v1.message.create — 发送引用卡片的消息
  sendCardMessage(chatId: string, cardId: string): Promise<string>;  // → message_id

  // cardkit.v1.card.update — 更新卡片实体
  updateCard(cardId: string, cardJson: Record<string, unknown>): Promise<void>;

  // cardkit.v1.card.idConvert — 通过 message_id 反查 card_id
  getCardIdByMessageId(messageId: string): Promise<string>;  // → card_id
}
```

API 映射：

| 方法 | 飞书 API |
|------|----------|
| `createCard` | `POST /open-apis/cardkit/v1/cards`<br>`{ type: "card_json", data: JSON.stringify(cardJson) }` |
| `sendCardMessage` | `POST /open-apis/im/v1/messages`<br>`{ msg_type: "interactive", content: JSON.stringify({ type: "card", data: { card_id } }) }` |
| `updateCard` | `PUT /open-apis/cardkit/v1/cards/:card_id`<br>`{ card: { type: "card_json", data: JSON.stringify(cardJson) }, sequence: 0 }` |
| `getCardIdByMessageId` | `POST /open-apis/cardkit/v1/cards/id_convert`<br>`{ message_id }` |

## Channel 新增方法

```typescript
interface Channel {
  // 现有成员不变

  // card v2 方法
  sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<{ messageId: string; cardId: string }>;
  updateCardMessage(messageId: string, card: Record<string, unknown>): Promise<void>;
}
```

- `sendCardMessage` 内部流程：`manager.createCard(card)` → `manager.sendCardMessage(chatId, cardId)`
- `updateCardMessage` 内部流程：`manager.getCardIdByMessageId(messageId)` → `manager.updateCard(cardId, card)`
- `rawClient` 在 createChannel 内部获取，传给 CardKitManager，不对外暴露

## 数据流

### 首次发送卡片（/help、/sessions、/models）

```
用户发 /sessions
  → handleSessions(chatId)
  → card = buildSessionsCard()                    // v2 JSON
  → channel.sendCardMessage(chatId, card)         // cardkit.create → send
  → 返回 { messageId, cardId }（messageId 后续用于 cardAction 事件匹配）
```

### 卡片按钮交互

```
用户点按钮
  → cardAction event { messageId, action: { value: { cmd, action, ... } } }
  → handleCardAction(value, messageId, chatId, ...)
  → 执行业务逻辑（switch/delete/new session 等）
  → newCard = buildXxxCard()
  → channel.updateCardMessage(messageId, newCard) // idConvert → update
  → 卡片原地刷新
```

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/feishu/cards/manager.ts` | **新建** — CardKitManager 内部类 |
| `src/feishu/cards/helpers.ts` | 重构 — v1→v2 JSON 结构，`buildCard` 产出 v2 格式 |
| `src/feishu/cards/help.ts` | 适配 — 使用更新后的 helpers |
| `src/feishu/cards/sessions.ts` | 适配 — 使用更新后的 helpers |
| `src/feishu/cards/models.ts` | 适配 — 使用更新后的 helpers |
| `src/feishu/channel.ts` | 新增 `sendCardMessage`、`updateCardMessage` 方法；`createChannel` 内部将 rawClient 注入 CardKitManager |
| `src/index.ts` | `handleSessions`/`handleModels`/`handleHelp` 改为 `sendCardMessage`；`handleCardAction` 中卡片刷新改为 `updateCardMessage` |
| `tests/feishu/cards.test.ts` | 更新 — v2 JSON 结构断言 |
| `tests/feishu/channel.test.ts` | 更新 — 新增方法测试 |
| `tests/feishu/wiring.test.ts` | 更新 — mock 新增方法 |

## 不涉及

- `channel.stream()` — AI 响应仍用 markdown 流式，不迁移
- `channel.send()` — 保留原有方法，非卡片消息仍可用
- `channel.updateCard()` — 保留原有方法（基于 `im.v1.message.patch`），作为 fallback
- `handler.ts`、`streaming.ts`、`attachments.ts` — 无改动

## 错误处理

- `cardkit.create` 失败 → 抛异常，上层 try/catch 记录日志
- `cardkit.idConvert` 失败 → 卡片可能已过期（14天），回退到发新卡片消息
- `cardkit.update` 失败 → 同上，回退发新卡

## 约束

- Card v2 仅支持飞书客户端 V7.20+，低版本客户端看到升级提示文案
- `update_multi` 仅支持 `true`（共享卡片模式）
- 卡片实体有效期 14 天

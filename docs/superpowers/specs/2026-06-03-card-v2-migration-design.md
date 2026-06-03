# Card v1 → Card v2 迁移设计

## 概述

将所有卡片消息（`/help`、`/sessions`、`/models`）从 card JSON 1.0 格式迁移到 card JSON 2.0 格式。不引入 CardKit API——发送和更新均通过 `im.v1.message` API 内联 v2 card JSON。

## 动机

- Card v1（JSON 1.0）是旧版协议，飞书不再维护
- Card v2（JSON 2.0）提供更好的 markdown 支持、更清晰的组件结构
- 卡片刷新改为原地更新，不堆积多条消息；失败时回退到 reply 新消息

## 关键设计决策

**不使用 CardKit（`cardkit.v1.card.*`）API。**

在实践中发现：CardKit 创建 card 实体后，消息通过 `{ type: "card", data: { card_id } }` 引用它。当用 `im.v1.message.patch` 更新消息内容时，card 实体中的旧内容会和 patch 的新内容冲突，导致卡片"先正确再回滚"。

而 `im.v1.message.create` 和 `im.v1.message.patch` 完全支持内联发送/更新 v2 card JSON，无需 CardKit。消息本身是 card 的唯一数据源，不存在两个数据源冲突的问题。

## 架构

不新增文件、不新增 channel 方法。改动集中在：
- `cards/helpers.ts` — v2 JSON 结构
- `cards/*.ts` — 组件适配
- `index.ts` — 卡片刷新路径

```
src/feishu/
├── channel.ts              # 不变（复用 send / updateCard）
├── handler.ts              # 不变
├── streaming.ts            # 不变
└── cards/
    ├── helpers.ts          # v1→v2 JSON 结构重构
    ├── help.ts             # 适配
    ├── sessions.ts         # 适配
    └── models.ts           # 适配
```

## Card v2 JSON 结构

### v1 → v2 完整对照

```jsonc
// v1 (当前)
{
  "config": { "wide_screen_mode": true, "update_multi": true },
  "header": { "title": { "tag": "plain_text", "content": "..." }, "template": "blue" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "**bold**" } },
    { "tag": "hr" },
    { "tag": "action", "actions": [
      { "tag": "button", "text": { "tag": "plain_text", "content": "..." },
        "type": "primary", "value": { "cmd": "x", "action": "y" } }
    ]},
    { "tag": "note", "elements": [{ "tag": "plain_text", "content": "footer" }] }
  ]
}

// v2 (目标)
{
  "schema": "2.0",
  "config": { "update_multi": true, "width_mode": "fill" },
  "header": { "title": { "tag": "plain_text", "content": "..." }, "template": "blue" },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "**bold**" },
      { "tag": "hr" },
      { "tag": "button",
        "text": { "tag": "plain_text", "content": "..." },
        "type": "primary",
        "behaviors": [{ "type": "callback", "value": { "cmd": "x", "action": "y" } }]
      },
      { "tag": "markdown", "content": "footer" }
    ]
  }
}
```

### v1 → v2 组件迁移表

| 组件 | v1 标签/字段 | v2 标签/字段 |
|------|-------------|------------|
| 富文本 | `tag: "div"`, `text.tag: "lark_md"` | `tag: "markdown"`, `content` 直接字符串 |
| 分割线 | `tag: "hr"` | 不变 |
| 按钮容器 | `tag: "action"`, `actions: [...]` | **无容器**，button 直接放 `elements` |
| 按钮回调 | `value: {...}` | `behaviors: [{ type: "callback", value: {...} }]` |
| 备注 | `tag: "note"` | 改为 `tag: "markdown"` |
| 卡片结构 | 顶层 `elements: [...]` | `body: { elements: [...] }` |
| 宽屏模式 | `config.wide_screen_mode: true` | `config.width_mode: "fill"` |

### helpers.ts 构建函数映射

| 函数 | v2 产出 |
|------|---------|
| `createCardHeader(title, template?)` | `{ title: { tag: "plain_text", content: title }, template? }` |
| `createMarkdownBlock(content)` | `{ tag: "markdown", content }` |
| `createDividerBlock()` | `{ tag: "hr" }` |
| `createActionButton(text, value, type?)` | `{ tag: "button", text: { tag: "plain_text", content: text }, type, behaviors: [{ type: "callback", value }] }` |
| `createNoteBlock(content)` | `createMarkdownBlock(content)` |
| `buildCard(header, elements)` | `{ schema: "2.0", config: { update_multi: true, width_mode: "fill" }, header, body: { elements } }` |

## 按钮回调适配（关键）

v2 中 button 的 `value` 字段是废弃历史属性，回调数据必须放在 `behaviors` 里：

```jsonc
// v1 — 有效
{ "tag": "button", "value": { "cmd": "session", "action": "new" } }

// v2 — 失效（feishu 不发 card action 事件）
{ "tag": "button", "value": { "cmd": "session", "action": "new" } }

// v2 — 正确
{ "tag": "button",
  "behaviors": [{ "type": "callback", "value": { "cmd": "session", "action": "new" } }]
}
```

飞书 SDK 的 `CardActionEvent.action.value` 仍会正常携带 `behaviors[].value` 内容，无需修改 `handleCardAction` 的事件处理代码。

## Channel 接口

不新增方法。使用现有接口：

| 方法 | 用途 | 底层 API |
|------|------|---------|
| `channel.send(chatId, { card })` | 首次发送卡片 | `im.v1.message.create` |
| `channel.send(chatId, { card }, { replyTo: messageId })` | 发新卡作为回复（更新失败时回退） | `im.v1.message.create` |
| `channel.updateCard(messageId, card)` | 原地更新卡片 | `im.v1.message.patch` |

## 数据流

### 首次发送卡片

```
用户发 /sessions
  → handleSessions(chatId)
  → card = buildSessionsCard()                    // v2 JSON
  → channel.send(chatId, { card })               // im.v1.message.create
```

### 卡片按钮交互（核心流程）

```
用户点按钮
  → cardAction event { messageId, action: { value: { cmd, action, ... } } }
  → handleCardAction(value, messageId, chatId, ...)
  → 执行业务逻辑（setModel / switchSession / deleteSession 等）
  → newCard = buildXxxCard()                      // v2 JSON
  → try:
      channel.updateCard(messageId, newCard)      // 原地更新（优先）
    catch:
      log + channel.send(chatId, { newCard },     // 回退：reply 新消息
                         { replyTo: messageId })
```

### 错误处理

`updateCard` 失败时，回退到原有的 reply 方式：`channel.send(chatId, { card }, { replyTo: messageId })`。这保证了：
- 更新失败时用户体验不变（仍能看到新卡片，以 reply 形式出现）
- `messageId` 就是 card action event 中的 `messageId`

## 涉及文件（基于原始代码，最小改动）

| 文件 | 改动 |
|------|------|
| `src/feishu/cards/helpers.ts` | v1→v2 JSON 结构：`buildCard`、`createMarkdownBlock`、`createActionButton`、`createNoteBlock` 产出 v2 格式 |
| `src/feishu/cards/sessions.ts` | 按钮从 `{ tag: "action", actions: [...] }` 改为直放 `{ tag: "button", ... }` + `behaviors` |
| `src/feishu/cards/models.ts` | 同上 |
| `src/feishu/cards/help.ts` | `createNoteBlock` → `createMarkdownBlock` |
| `src/index.ts` | `handleCardAction` 中卡片刷新：`send({ replyTo })` → `updateCard`，失败回退到 `send({ replyTo })` |
| `tests/feishu/cards.test.ts` | 更新断言 |
| `tests/feishu/builders.test.ts` | 适配 `body.elements` |

## 不涉及

- CardKit（`cardkit.v1.card.*`）— 完全不使用
- `channel.ts` — 无修改
- `channel.stream()` / `handler.ts` / `streaming.ts` / `attachments.ts` — 无改动
- 卡片首次发送路径 — 保持 `channel.send(chatId, { card })` 不变

## 约束

- Card v2 仅支持飞书客户端 V7.20+
- `update_multi` 仅支持 `true`
- `updateCard` 失败时回退到 reply 新消息（保持原有用户体验）

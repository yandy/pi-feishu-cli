# Card v1 → Card v2 迁移 实施方案 (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有卡片消息从 card JSON 1.0 迁移到 card JSON 2.0，卡片刷新改为原地更新（updateCard），失败回退到 reply 新卡。**不使用 CardKit API**。

> **⚠️ 已过时：** 原位更新部分的方案（Task 4）已废弃。`channel.updateCard()`（PATCH API）在 WebSocket 模式下存在"更新后被重置"的竞态问题，详见 `docs/superpowers/specs/2026-06-04-card-in-place-update-design.md`。Task 1-3（v2 JSON 格式迁移）已完成且有效。

**Architecture:** 不新增文件、不新增 channel 方法。只改 helpers.ts（v2 JSON 结构）、三个 card builder（组件适配）、index.ts（updateCard + fallback ~~→ 已由 `onRawEvent` 方案替代~~）。channel.ts 完全不变。

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk` v1.66, vitest

---

### File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/feishu/cards/helpers.ts` | v2 card JSON 构建函数 | 重构 |
| `src/feishu/cards/help.ts` | help 卡片 | `createNoteBlock` → `createMarkdownBlock` |
| `src/feishu/cards/sessions.ts` | sessions 卡片 | action → 直接 button + behaviors |
| `src/feishu/cards/models.ts` | models 卡片 | action → 直接 button + behaviors |
| `src/index.ts` | 卡片刷新改为 updateCard + fallback | 重构 |
| `tests/feishu/cards.test.ts` | 更新断言 | 更新测试 |
| `tests/feishu/builders.test.ts` | 适配 body.elements | 更新测试 |

---

### Task 1: RED — 更新测试，期望 v2 格式

**Files:**
- Modify: `tests/feishu/cards.test.ts`
- Modify: `tests/feishu/builders.test.ts`

Tests should expect:
- `createMarkdownBlock` → `{ tag: "markdown", content }` (not `div` + `lark_md`)
- `buildCard` → `{ schema: "2.0", config: { update_multi: true, width_mode: "fill" }, header, body: { elements } }`
- `createActionButton` → `{ tag: "button", text, type, behaviors: [{ type: "callback", value }] }`
- `createNoteBlock` → `{ tag: "markdown", content }` (same as createMarkdownBlock)
- Card access via `body.elements` instead of `card.elements`
- Filters use `e.tag === "markdown"` instead of `e.tag === "div"`

Run tests → FAIL (helpers still produce v1).

---

### Task 2: GREEN — helpers.ts v2 结构

**Files:**
- Modify: `src/feishu/cards/helpers.ts`

Changes:
1. `CardConfig`: `wide_screen_mode?: boolean` → `width_mode?: "fill" | "compact"`
2. `CardElement`:
   - Remove `{ tag: "div"; text?: { tag: "lark_md"; content: string } }`
   - Add `{ tag: "markdown"; content: string }`
   - Remove `{ tag: "action"; actions: CardButton[] }`
   - Add `CardButton` (with `behaviors`) as union member
   - Remove `{ tag: "note"; ... }`
3. `CardButton`:
   - Remove `value: Record<string, unknown>`
   - Add `behaviors: { type: "callback"; value: Record<string, unknown> }[]`
4. `createMarkdownBlock`: `{ tag: "markdown", content }`
5. `createActionButton`: `behaviors: [{ type: "callback", value }]` instead of `value`
6. `createNoteBlock`: delegate to `createMarkdownBlock`
7. `buildCard`: `{ schema: "2.0", config: { update_multi: true, width_mode: "fill" }, header, body: { elements } }`

Run tests → PASS.

---

### Task 3: GREEN — card builders 适配

**Files:**
- Modify: `src/feishu/cards/help.ts` — `createNoteBlock` → `createMarkdownBlock`
- Modify: `src/feishu/cards/sessions.ts` — inline button 对象：`value` → `behaviors`，移除 `tag: "action"` 容器
- Modify: `src/feishu/cards/models.ts` — 同上

Run tests → PASS.

---

### Task 4: ~~GREEN — index.ts 卡片刷新改用 updateCard~~ ⚠️ 已废弃

> **此任务已过时。** 替换方案见 `docs/superpowers/specs/2026-06-04-card-in-place-update-design.md`。`updateCard`（PATCH API）方案存在竞态问题，新方案改用 `onRawEvent` 覆盖 SDK handler 在回调响应中直接返回新卡片。

~~**Files:**~~
- Modify: `src/index.ts`

在 `handleCardAction` 中，将 session 和 model 分支的：
```typescript
if (chatId) {
    await channel.send(chatId, { card }, { replyTo: _messageId });
}
```

改为：
```typescript
if (_messageId) {
    try {
        await channel.updateCard(_messageId, card);
    } catch (err) {
        console.error("updateCard failed, falling back to reply with new card:", err);
        if (chatId) await channel.send(chatId, { card }, { replyTo: _messageId });
    }
} else if (chatId) {
    await channel.send(chatId, { card }, { replyTo: _messageId });
}
```

注意：`_messageId` 改名为 `messageId`（因为它现在被使用了），去掉下划线前缀。

Run all tests → PASS.

---

### Task 5: 全量验证

```bash
npx tsc --noEmit
npx vitest run
npx biome check src/ tests/
```

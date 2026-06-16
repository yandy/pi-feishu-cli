# Feishu Stop Generation Implementation Plan

> **⚠️** 本文档中的 `tag: "action"` 代码已废弃。Card V2 不支持 `action` 容器，按钮应使用 `createActionButton("停止生成", { cmd: "stop" }, "danger")` 直接放入 `elements`。修正后的代码见 `src/feishu/cards/stop.ts`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stop" button to Feishu streaming conversations, allowing users to abort ongoing AI generation.

**Architecture:** Send a standalone interactive card with a "停止生成" button alongside each streaming markdown card. Button click triggers `cardAction` → `session.abort()`. A `stopCards` Map tracks active stop card message IDs per chat to handle cleanup when streaming completes normally vs. via abort.

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk`, `@earendil-works/pi-coding-agent`, vitest

---

### File Structure

| File | Responsibility |
|------|---------------|
| `src/feishu/cards/stop.ts` (NEW) | `buildStopCard()` and `buildStopCardDone(status)` — stop card JSON builders |
| `src/feishu/channel.ts` (MODIFY) | Change `send()` return type from `Promise<void>` to `Promise<string>` |
| `src/index.ts` (MODIFY) | `stopCards` Map, inline cardAction for "stop" cmd, stop card lifecycle in streaming context |
| `tests/feishu/cards.test.ts` (MODIFY) | Tests for `buildStopCard` and `buildStopCardDone` |
| `tests/feishu/channel.test.ts` (MODIFY) | Test that `send()` returns `message_id` |

---

### Task 1: Stop card builders (TDD: tests → impl)

**Files:**
- Create: `src/feishu/cards/stop.ts`
- Modify: `tests/feishu/cards.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/feishu/cards.test.ts`, at the top add import:
```typescript
import { buildStopCard, buildStopCardDone } from "../../src/feishu/cards/stop.js";
```

At the end of the file (before last closing), add:
```typescript
describe("stop card", () => {
  it("buildStopCard returns card with stop button", () => {
    const card = buildStopCard();
    expect(card).toHaveProperty("schema", "2.0");
    const body = (card as any).body;
    expect(body.elements).toHaveLength(2);
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "🤖 AI 正在生成中...",
    });
    // ⚠️ 已废弃: Card V2 按钮直放 elements，应为 body.elements[1].tag === "button"
    expect(body.elements[1].tag).toBe("action");
    expect(body.elements[1].actions[0].tag).toBe("button");
    expect(body.elements[1].actions[0].behaviors[0].value).toEqual({
      cmd: "stop",
    });
  });

  it("buildStopCardDone returns done card with status text", () => {
    const card = buildStopCardDone("生成完成");
    const body = (card as any).body;
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "✅ 生成完成",
    });
  });

  it("buildStopCardDone shows stopped symbol for 已中断", () => {
    const card = buildStopCardDone("已中断");
    const body = (card as any).body;
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "🛑 已中断",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: 3 new tests FAIL (module `../../src/feishu/cards/stop.js` not found).

- [ ] **Step 3: Write implementation to make tests pass**

Create `src/feishu/cards/stop.ts`:
> **⚠️ 已废弃**：以下代码中的 `tag: "action"` 容器在 Card V2 中已不支持。正确写法：按钮使用 `createActionButton(...)` 直接放入 `elements` 数组。详见 `src/feishu/cards/stop.ts`。

```typescript
export function buildStopCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "🤖 AI 正在生成中...",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "停止生成" },
              type: "danger",
              behaviors: [{ type: "callback", value: { cmd: "stop" } }],
            },
          ],
        },
      ],
    },
  };
}

export function buildStopCardDone(status: string): Record<string, unknown> {
  const symbols: Record<string, string> = {
    生成完成: "✅",
    已中断: "🛑",
  };
  const symbol = symbols[status] ?? "✅";
  return {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      elements: [{ tag: "markdown", content: `${symbol} ${status}` }],
    },
  };
}
```

- [ ] **Step 4: Run typecheck + tests to verify pass**

```bash
npm run check
```
Expected: No errors.

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: 3 new tests PASS (total 26).

- [ ] **Step 5: Commit**

```bash
git add src/feishu/cards/stop.ts tests/feishu/cards.test.ts
git commit -m "feat: add stop card builders with tests"
```

---

### Task 2: channel.send() returns message_id (TDD: test → impl)

**Files:**
- Modify: `src/feishu/channel.ts`
- Modify: `tests/feishu/channel.test.ts`

- [ ] **Step 1: Write failing test**

The test should verify `send()` returns the `message_id` that `raw.send()` already returns. Append to `tests/feishu/channel.test.ts`:

```typescript
describe("send returns message_id", () => {
  it("returns message_id from raw.send", async () => {
    mockRawChannel.send.mockResolvedValue("msg_abc123");
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    const result = await channel.send("chat_1", { text: "hello" });
    expect(result).toBe("msg_abc123");
    expect(mockRawChannel.send).toHaveBeenCalledWith(
      "chat_1",
      { text: "hello" },
      undefined,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/feishu/channel.test.ts
```
Expected: TypeScript compilation error — `channel.send(...)` returns `Promise<void>` (not assignable to `string`).

- [ ] **Step 3: Fix implementation to make test pass**

In `src/feishu/channel.ts`, two changes:

**Interface** (line 82-86): change return type
```typescript
// Before:
  send(
    chatId: string,
    content: { text?: string; markdown?: string; card?: unknown },
    options?: { replyTo?: string },
  ): Promise<void>;

// After:
  send(
    chatId: string,
    content: { text?: string; markdown?: string; card?: unknown },
    options?: { replyTo?: string },
  ): Promise<string>;
```

**Implementation** (line 141-143): return the value
```typescript
// Before:
    async send(chatId: string, content: unknown, options?: unknown) {
      await raw.send(chatId, content, options);
    },

// After:
    async send(chatId: string, content: unknown, options?: unknown) {
      return await raw.send(chatId, content, options);
    },
```

`raw.send()` already returns `Promise<string>` (SDK `index.js:91612`). The `as Channel` type assertion on line 122 may need `as unknown as Channel` if the interface mismatch causes a type error.

- [ ] **Step 4: Run typecheck + tests to verify pass**

```bash
npm run check
```
Expected: No errors.

```bash
npx vitest run tests/feishu/channel.test.ts
```
Expected: New test PASS.

- [ ] **Step 5: Run all channel-related tests to ensure no regression**

```bash
npx vitest run tests/feishu/channel.test.ts tests/feishu/channel-send-file.test.ts
```
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/feishu/channel.ts tests/feishu/channel.test.ts
git commit -m "feat: channel.send() returns message_id"
```

---

### Task 3: Integrate stop card lifecycle into streaming context

**Files:**
- Modify: `src/index.ts`

> **Note:** This task modifies the streaming context in `setupFeishuHandlers()` and the `cardAction` handler. Writing unit tests for the streaming lifecycle requires a live Feishu bot connection, which is impractical. Verification relies on `npm run check` (type safety) and `npx vitest run` (existing tests pass without regression).

- [ ] **Step 1: Import stop card builders**

At the top of `src/index.ts`, add alongside other card imports (near line 20-22):
```typescript
import { buildStopCard, buildStopCardDone } from "./feishu/cards/stop.js";
```

- [ ] **Step 2: Add `stopCards` Map**

In `setupFeishuHandlers()`, after `let promptLock: Promise<void> = Promise.resolve();` (line 350):
```typescript
const stopCards = new Map<string, string>();
```

- [ ] **Step 3: Replace cardAction handler with inline stop interception**

Replace the `channel.on("cardAction", ...)` block (lines 419-425):
```typescript
// Before:
  channel.on("cardAction", (evt: CardActionEvent) => {
    setTimeout(() => {
      handleCardAction(evt, runtime, cwd, channel).catch((err) =>
        console.error("Card action failed:", err),
      );
    }, 0);
  });

// After:
  channel.on("cardAction", (evt: CardActionEvent) => {
    setTimeout(() => {
      const value = (evt?.action?.value ?? {}) as Record<string, unknown>;
      if (value.cmd === "stop") {
        if (runtime.session.isStreaming) {
          runtime.session.abort().catch(() => {});
        }
        const raw = evt?.raw as
          | { event?: { token?: string }; token?: string }
          | undefined;
        const token: string | undefined = raw?.event?.token ?? raw?.token;
        if (token) {
          channel
            .updateCardByToken(token, buildStopCardDone("已中断"))
            .catch(() => {});
        }
        stopCards.delete(evt.chatId);
        return;
      }
      handleCardAction(evt, runtime, cwd, channel).catch((err) =>
        console.error("Card action failed:", err),
      );
    }, 0);
  });
```

- [ ] **Step 4: Add stop card send/update/cleanup in streaming context**

Replace the streaming block (lines 395-416):
```typescript
// Before:
      await channel.stream(
        msg.chatId,
        {
          markdown: async (s) => {
            const unbind = createStreamingHandler(runtime.session, s);
            try {
              await messageHandler(msg, attachments);
            } finally {
              unbind();
              if (downloadDir) {
                rm(downloadDir, { recursive: true, force: true }).catch(
                  () => {},
                );
              }
            }
          },
        },
        { replyTo: msg.messageId },
      );
    } finally {
      unlock!();
    }

// After:
      const stopCardMsgId = await channel.send(msg.chatId, {
        card: buildStopCard(),
      });
      stopCards.set(msg.chatId, stopCardMsgId);

      await channel.stream(
        msg.chatId,
        {
          markdown: async (s) => {
            const unbind = createStreamingHandler(runtime.session, s);
            try {
              await messageHandler(msg, attachments);
            } finally {
              unbind();
              if (downloadDir) {
                rm(downloadDir, { recursive: true, force: true }).catch(
                  () => {},
                );
              }
            }
          },
        },
        { replyTo: msg.messageId },
      );
    } finally {
      const cardMsgId = stopCards.get(msg.chatId);
      if (cardMsgId) {
        channel
          .updateCard(cardMsgId, buildStopCardDone("生成完成"))
          .catch(() => {});
        stopCards.delete(msg.chatId);
      }
      unlock!();
    }
```

- [ ] **Step 5: Run typecheck**

```bash
npm run check
```
Expected: No errors.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```
Expected: All existing tests PASS (no regression).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add stop card lifecycle to feishu streaming"
```

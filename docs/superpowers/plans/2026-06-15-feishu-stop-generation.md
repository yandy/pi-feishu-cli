# Feishu Stop Generation Implementation Plan

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
| `tests/feishu/cards.test.ts` (MODIFY) | Add tests for `buildStopCard` and `buildStopCardDone` |

---

### Task 1: Create stop card builders

**Files:**
- Create: `src/feishu/cards/stop.ts`

- [ ] **Step 1: Write the stop card builder file**

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
              text: {
                tag: "plain_text",
                content: "停止生成",
              },
              type: "danger",
              behaviors: [
                {
                  type: "callback",
                  value: { cmd: "stop" },
                },
              ],
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
      elements: [
        {
          tag: "markdown",
          content: `${symbol} ${status}`,
        },
      ],
    },
  };
}
```

- [ ] **Step 2: Run typecheck to verify the new file compiles**

```bash
npx tsc --noEmit
```
Expected: No errors related to `stop.ts`.

- [ ] **Step 3: Write tests**

Append to `tests/feishu/cards.test.ts`:

```typescript
import { buildStopCard, buildStopCardDone } from "../../src/feishu/cards/stop.js";
```

Add tests at end of file:

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

- [ ] **Step 4: Run card tests**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: 3 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/cards/stop.ts tests/feishu/cards.test.ts
git commit -m "feat: add stop card builders with tests"
```

---

### Task 2: Modify channel.send() to return message_id

**Files:**
- Modify: `src/feishu/channel.ts`

- [ ] **Step 1: Update `send()` return type and implementation**

In `src/feishu/channel.ts`, change the `send` method in the `Channel` interface (line 81-85) and the implementation (line 141-143).

**Interface change** (line 81-85):
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

**Implementation change** (line 141-143):
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

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: No errors. `raw.send()` already returns `string` (SDK `index.js:91612`), so existing callers that ignore the return value remain unaffected.

- [ ] **Step 3: Verify existing channel tests still pass**

```bash
npx vitest run tests/feishu/channel.test.ts tests/feishu/channel-send-file.test.ts
```
Expected: All existing tests PASS (no behavior change, only return type annotation).

- [ ] **Step 4: Commit**

```bash
git add src/feishu/channel.ts
git commit -m "feat: channel.send() returns message_id"
```

---

### Task 3: Integrate stop card lifecycle into streaming context

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import stop card builders**

At the top of `src/index.ts`, add the import alongside other card imports (near line 20-22):

```typescript
import { buildStopCard, buildStopCardDone } from "./feishu/cards/stop.js";
```

- [ ] **Step 2: Add `stopCards` Map and inline cardAction stop handler**

In `setupFeishuHandlers()`, add the Map declaration after `let promptLock` (line 350):

```typescript
const stopCards = new Map<string, string>();
```

Replace the `channel.on("cardAction", ...)` handler (lines 419-425):

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

- [ ] **Step 3: Add stop card send/update/cleanup in streaming context**

Replace the streaming context block (lines 395-416):

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

Note: The `unlock!()` call stays inside the `finally` block (same as before), just now accompanied by the stop card cleanup.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: add stop card lifecycle to feishu streaming"
```

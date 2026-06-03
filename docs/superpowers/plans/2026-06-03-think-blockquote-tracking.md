# Think Blockquote Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the naive `stream.append(`> ${delta}`)` in `thinking_delta` handling with a state machine that correctly tracks line boundaries across chunks, producing contiguous blockquotes for think blocks and plain text for text blocks.

**Architecture:** Three boolean state variables in `createStreamingHandler` closure (`inThinkBlock`, `needsQuotePrefix`, `needLineBreak`) drive a character-level state machine for `thinking_delta` content and boundary-aware appends for `text_delta`/think transitions.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/feishu/streaming.test.ts` | Modify | Add 8 new test cases covering all think/text transition scenarios |
| `src/feishu/streaming.ts` | Modify | Replace `thinking_delta` handler with state machine, enhance `text_delta` |

---

### Task 1: Write all new failing tests

**Files:**
- Modify: `tests/feishu/streaming.test.ts`

- [ ] **Step 1: Replace test file with complete version containing all new tests**

Remove the unused `_events` parameter from `createMockSession`. Insert 8 new test cases after the existing `streams thinking_delta as blockquote` test. The full test file:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createStreamingHandler } from "../../src/feishu/streaming.js";

function createMockSession() {
  let listener: ((e: any) => void) | null = null;
  return {
    subscribe: (fn: (e: any) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    emit: (e: any) => {
      listener?.(e);
    },
  };
}

function createMockStream() {
  const chunks: string[] = [];
  return {
    chunks,
    append: vi.fn(async (chunk: string) => {
      chunks.push(chunk);
    }),
  };
}

describe("createStreamingHandler", () => {
  it("streams text_delta chunks", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.append).toHaveBeenCalledWith("Hello");
    unsub();
  });

  it("streams thinking_delta as blockquote", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "hmm",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.append).toHaveBeenCalledWith("> hmm");
    unsub();
  });

  it("streams multi-line thinking_delta with > on each line", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "line1\nline2\nline3",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> line1\n> line2\n> line3"]);
    unsub();
  });

  it("streams consecutive think chunks without redundant >", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "I think ",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "we should",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> I think ", "we should"]);
    unsub();
  });

  it("streams think chunk starting with newlines", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "\n\nSecond thought.",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> \n> \n> Second thought."]);
    unsub();
  });

  it("closes blockquote when text follows think without trailing newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "answer",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> think\n", "answer"]);
    unsub();
  });

  it("does not add extra newline when think ends with newline before text", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think\n",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "answer\n",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> think\n", "answer\n"]);
    unsub();
  });

  it("adds newline before new think block when text does not end with newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "some text",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "rethink",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["some text", "\n> rethink"]);
    unsub();
  });

  it("does not add extra newline before new think when text ends with newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "some text\n",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "rethink",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["some text\n", "> rethink"]);
    unsub();
  });

  it("streams consecutive text_delta without adding newlines", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: " World",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["Hello", " World"]);
    unsub();
  });

  it("streams tool_execution_start", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "1",
      args: {},
    });

    expect(stream.append).toHaveBeenCalledWith("🔧 bash");
    unsub();
  });

  it("streams tool_execution_update", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "tool_execution_update",
      toolName: "bash",
      toolCallId: "1",
      args: {},
      partialResult: "output",
    });

    expect(stream.append).toHaveBeenCalledWith("output");
    unsub();
  });

  it("ignores structural events (agent_start, turn_start, message_start)", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "agent_start" });
    session.emit({ type: "turn_start" });
    session.emit({ type: "message_start", message: {} });

    expect(stream.append).not.toHaveBeenCalled();
    unsub();
  });

  it("returns unsubscribe function", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
```

### Task 2: Run tests and verify 8 failures

**Files:** None (verification only)

- [ ] **Step 1: Run the streaming tests**

```bash
npx vitest run tests/feishu/streaming.test.ts
```

Expected: 8 new tests FAIL, 7 existing tests PASS (15 total, 8 failed).

Key failures to confirm:
- `streams multi-line thinking_delta`: only `> ` at start, missing on subsequent lines
- `streams consecutive think chunks`: second chunk gets redundant `> `
- `closes blockquote when text follows think`: think doesn't end with `\n`, no blockquote break added
- `adds newline before new think block`: text→think transition missing `\n`

---

### Task 3: Implement the state machine

**Files:**
- Modify: `src/feishu/streaming.ts`

- [ ] **Step 1: Replace `createStreamingHandler` body with state machine implementation**

Replace the entire function body of `createStreamingHandler`. The complete file:

```typescript
export interface StreamWriter {
  append(chunk: string): Promise<void>;
}

interface AssistantMessageEvent {
  type: string;
  delta?: string;
  error?: unknown;
}

interface StreamEvent {
  type: string;
  assistantMessageEvent?: AssistantMessageEvent;
  toolName?: string;
  partialResult?: unknown;
  isError?: boolean;
  attempt?: number;
  maxAttempts?: number;
  success?: boolean;
}

export function createStreamingHandler(
  session: {
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
  },
  stream: StreamWriter,
): () => void {
  let inThinkBlock = false;
  let needsQuotePrefix = true;
  let needLineBreak = false;

  return session.subscribe((event: StreamEvent) => {
    switch (event.type) {
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (!sub) break;
        if (sub.type === "text_delta") {
          if (inThinkBlock && !needsQuotePrefix) {
            stream.append("\n");
          }
          inThinkBlock = false;
          needsQuotePrefix = true;
          const delta = sub.delta ?? "";
          stream.append(delta);
          needLineBreak = !delta.endsWith("\n");
        } else if (sub.type === "thinking_delta") {
          if (needLineBreak) {
            stream.append("\n");
            needLineBreak = false;
          }
          const delta = sub.delta ?? "";
          let out = "";
          for (let i = 0; i < delta.length; i++) {
            if (needsQuotePrefix) {
              out += "> ";
              needsQuotePrefix = false;
            }
            const ch = delta[i];
            out += ch;
            if (ch === "\n") {
              needsQuotePrefix = true;
            }
          }
          stream.append(out);
          inThinkBlock = true;
        } else if (sub.type === "error") {
          stream.append("— 模型返回错误 —");
        }
        break;
      }

      case "tool_execution_start":
        stream.append(`🔧 ${event.toolName ?? ""}`);
        break;

      case "tool_execution_update":
        stream.append(String(event.partialResult ?? ""));
        break;

      case "tool_execution_end":
        stream.append(event.isError ? "❌" : "✅");
        break;

      case "queue_update":
        stream.append("— 消息已排队 —");
        break;

      case "compaction_start":
        stream.append("— 压缩中... —");
        break;

      case "compaction_end":
        stream.append("— 压缩完成 —");
        break;

      case "auto_retry_start":
        stream.append(
          `— 自动重试 (${event.attempt}/${event.maxAttempts})... —`,
        );
        break;

      case "auto_retry_end":
        stream.append(event.success ? "✅ 重试成功" : "❌ 重试失败");
        break;
    }
  });
}
```

### Task 4: Run tests and verify all pass

**Files:** None (verification only)

- [ ] **Step 1: Run streaming tests**

```bash
npx vitest run tests/feishu/streaming.test.ts
```

Expected: 15 tests PASS, 0 failures.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass except the pre-existing `tests/runtime.test.ts > loads bundled skills from packageRoot, not from cwd` failure (unrelated environment issue).

### Task 5: Commit

**Files:**
- `src/feishu/streaming.ts` (modified)
- `tests/feishu/streaming.test.ts` (modified)

- [ ] **Step 1: Stage and commit**

```bash
git add src/feishu/streaming.ts tests/feishu/streaming.test.ts
git commit -m "feat: state-machine think blockquote tracking across chunk boundaries"
```

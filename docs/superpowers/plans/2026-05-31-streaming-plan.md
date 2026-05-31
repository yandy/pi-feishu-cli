# Streaming Implementation Plan (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace batch-at-end streaming with real-time incremental streaming so Feishu users see typewriter animation as Pi generates.

**Architecture:** Refactor `src/daemon/index.ts` stream handlers to start `channel.stream()` on first IPC stream message and append subsequent chunks via an async notification queue; add `outbound` passthrough in `src/channel/index.ts`.

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk`, `vitest`

---

### Task 1: TDD — Channel outbound config passthrough

**Files:**
- Create: `tests/channel/outbound.test.ts`
- Modify: `src/channel/index.ts:5-8`

- [ ] **Step 1 (RED): Write failing test for outbound passthrough**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createFeishuChannel, type Channel } from "../../src/channel/index.js";

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: vi.fn((opts: any) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    get botIdentity() { return { name: "test" }; },
    send: vi.fn(),
    stream: vi.fn(),
    updateCard: vi.fn(),
  })),
  LoggerLevel: { info: "info" },
}));

describe("Channel outbound config", () => {
  it("should pass outbound.streamInitialText to createLarkChannel", async () => {
    const { createLarkChannel } = await import("@larksuiteoapi/node-sdk");

    createFeishuChannel({
      appId: "a",
      appSecret: "s",
      outbound: { streamInitialText: "🤔 Testing..." },
    });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        outbound: { streamInitialText: "🤔 Testing..." },
      })
    );
  });

  it("should not pass outbound when undefined", async () => {
    const { createLarkChannel } = await import("@larksuiteoapi/node-sdk");
    vi.mocked(createLarkChannel).mockClear();

    createFeishuChannel({ appId: "a", appSecret: "s" });

    const callOpts = vi.mocked(createLarkChannel).mock.calls[0][0];
    expect(callOpts).not.toHaveProperty("outbound");
  });
});
```

- [ ] **Step 2 (VERIFY RED): Run test to confirm failure**

Run: `npx vitest run tests/channel/outbound.test.ts`
Expected: FAIL — TypeScript error or runtime error because `outbound` not in `CreateChannelOptions`

- [ ] **Step 3 (GREEN): Add outbound to CreateChannelOptions**

In `src/channel/index.ts`:

```typescript
export interface CreateChannelOptions {
  appId: string;
  appSecret: string;
  outbound?: {
    streamInitialText?: string;
    streamThrottleMs?: number;
    streamThrottleChars?: number;
  };
}
```

- [ ] **Step 4 (GREEN): Pass outbound to createLarkChannel**

```typescript
export function createFeishuChannel(options: CreateChannelOptions): Channel {
  const { createLarkChannel, LoggerLevel } = require("@larksuiteoapi/node-sdk") as typeof import("@larksuiteoapi/node-sdk");

  const channel = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: LoggerLevel.info,
    policy: { requireMention: true, dmMode: "open" },
    ...(options.outbound ? { outbound: options.outbound } : {}),
  });
  // ... rest unchanged
}
```

- [ ] **Step 5 (VERIFY GREEN): Run test to confirm pass**

Run: `npx vitest run tests/channel/outbound.test.ts`
Expected: PASS

- [ ] **Step 6: Run all tests + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All PASS, no errors

- [ ] **Step 7: Commit**

```bash
git add tests/channel/outbound.test.ts src/channel/index.ts
git commit -m "feat: pass outbound config through channel wrapper"
```

---

### Task 2: TDD — Daemon incremental streaming core

**Files:**
- Modify: `src/daemon/index.ts:142-225`
- Modify: `tests/daemon/offline-queue.test.ts` (adjust streamMap → activeStreams if needed)
- (existing `src/channel/index.ts` mock in offline-queue tests may need stream mock update)

- [ ] **Step 1 (RED): Write failing test for incremental streaming**

In a new file `tests/daemon/streaming.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as net from "node:net";
import { mkdirSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stringifyMessage } from "../../src/ipc/protocol.js";

const SOCK = "/tmp/test-pi-feishu-streaming.sock";
const TEST_DIR = "/tmp/test-pi-feishu-daemon-streaming";

const { messageHandlers } = vi.hoisted(() => {
  const handlers: Array<(msg: any) => Promise<void> | void> = [];
  return { messageHandlers: handlers };
});

const mockAppend = vi.fn().mockResolvedValue(undefined);
let streamProducer: any = null;
let streamInvoked = false;

vi.mock("../../src/channel/index.js", () => ({
  createFeishuChannel: vi.fn(() => ({
    on: (event: string, handler: any) => {
      if (event === "message") messageHandlers.push(handler);
    },
    connected: true,
    botIdentity: { name: "test-bot" },
    send: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    stream: vi.fn(async (_to: string, input: any) => {
      streamInvoked = true;
      streamProducer = input.markdown;
      if (input.markdown) {
        await input.markdown({ append: mockAppend, messageId: "mock_msg_1" });
      }
    }),
    updateCard: vi.fn(),
  })),
}));

vi.mock("../../src/config.js", () => ({
  FEISHU_IM_DIR: TEST_DIR,
  AUTH_FILE: join(TEST_DIR, "auth.json"),
  SOCKET_PATH: SOCK,
  PID_FILE: join(TEST_DIR, "daemon.pid"),
  DAEMON_LOG: join(TEST_DIR, "daemon.log"),
}));

import { main } from "../../src/daemon/index.js";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectClient(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK, () => resolve(s));
    s.on("error", reject);
  });
}

describe("Incremental streaming", () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "auth.json"), JSON.stringify({
      appId: "test-app", appSecret: "test-secret",
    }));
    await main();
  });

  afterAll(() => {
    try { unlinkSync(SOCK); } catch {}
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    messageHandlers.length = 0;
    streamInvoked = false;
    streamProducer = null;
    mockAppend.mockClear();
  });

  it("should call channel.stream immediately on first stream IPC message", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "stream", chatId: "chat_001", content: "Hello",
    }));
    await delay(200);

    expect(streamInvoked).toBe(true);
    client.destroy();
    await delay(50);
  });

  it("should append each chunk to the active stream as it arrives", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "stream", chatId: "chat_002", content: "Hello",
    }));
    await delay(100);
    client.write(stringifyMessage({
      type: "stream", chatId: "chat_002", content: "Hello world",
    }));
    await delay(100);
    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_002",
    }));
    await delay(200);

    expect(mockAppend).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenNthCalledWith(1, "Hello");
    expect(mockAppend).toHaveBeenNthCalledWith(2, "Hello world");

    client.destroy();
    await delay(50);
  });

  it("should queue chunks arriving before first append resolves", async () => {
    const client = await connectClient();
    await delay(50);

    // Send both chunks before stream has time to process
    client.write(stringifyMessage({
      type: "stream", chatId: "chat_003", content: "First",
    }));
    client.write(stringifyMessage({
      type: "stream", chatId: "chat_003", content: "Second",
    }));
    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_003",
    }));
    await delay(300);

    expect(mockAppend).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenNthCalledWith(1, "First");
    expect(mockAppend).toHaveBeenNthCalledWith(2, "Second");

    client.destroy();
    await delay(50);
  });

  it("should handle streamEnd without preceding stream (noop)", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_nonexistent",
    }));
    await delay(100);

    // stream should never have been invoked for this chat
    // (stream was started for previous test's chat_003, but not for chat_nonexistent)
    client.destroy();
    await delay(50);
  });
});
```

- [ ] **Step 2 (VERIFY RED): Run test to confirm failure**

Run: `npx vitest run tests/daemon/streaming.test.ts`
Expected: FAIL — tests expect incremental behavior but current daemon batches at end

- [ ] **Step 3 (GREEN): Refactor daemon stream handlers**

Replace the `streamMap` and both `case "stream"` and `case "streamEnd"` handlers in `src/daemon/index.ts`:

Remove:
```typescript
const streamMap = new Map<string, { replyTo?: string; chunks: string[]; active: boolean }>();
```

Add:
```typescript
interface StreamSession {
  replyTo?: string;
  pendingChunks: string[];
  ended: boolean;
  notify: () => void;
}
const activeStreams = new Map<string, StreamSession>();
```

Replace the `case "stream"` block:
```typescript
case "stream": {
  if (!channel?.connected) return;
  let session = activeStreams.get(msg.chatId);
  if (!session) {
    session = {
      replyTo: msg.replyTo,
      pendingChunks: [msg.content],
      ended: false,
      notify: () => {},
    };
    activeStreams.set(msg.chatId, session);

    channel.stream(msg.chatId, {
      markdown: async (controller) => {
        while (!session!.ended || session!.pendingChunks.length > 0) {
          if (session!.pendingChunks.length > 0) {
            await controller.append(session!.pendingChunks.shift()!);
          } else {
            await new Promise<void>((resolve) => {
              session!.notify = resolve;
            });
          }
        }
      },
    }, { replyTo: msg.replyTo }).catch((err) => {
      log("error", `Stream failed: ${(err as Error).message}`);
    }).finally(() => {
      activeStreams.delete(msg.chatId);
    });
  } else {
    session.pendingChunks.push(msg.content);
    session.notify();
  }
  break;
}
```

Replace the `case "streamEnd"` block:
```typescript
case "streamEnd": {
  if (!channel?.connected) return;
  const session = activeStreams.get(msg.chatId);
  if (session) {
    session.ended = true;
    session.notify();
  }
  break;
}
```

- [ ] **Step 4 (GREEN): Add outbound config when creating channel**

In `connectChannel`, update the `createFeishuChannel` call:
```typescript
channel = createFeishuChannel({
  appId,
  appSecret,
  outbound: {
    streamInitialText: "🤔 Pi 思考中...",
  },
});
```

- [ ] **Step 5 (VERIFY GREEN): Run streaming test + all tests**

Run: `npx vitest run tests/daemon/streaming.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: All PASS

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add tests/daemon/streaming.test.ts src/daemon/index.ts
git commit -m "feat: incremental real-time streaming"
```

---

### Task 3: Verify existing tests still pass

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All PASS (including offline-queue, pid-lock, channel, bot-commands, feishu-card, config)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

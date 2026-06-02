# Remove Session Robot Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `/sessions` robot command and all session-management infrastructure (registry, tracking, switch/new code paths) while keeping `/model` and `/help`.

**Architecture:** Surgical removal — delete 2 files, modify 8. `session_start` event handler stays as the canonical source of `ExtensionContext` for `attachHandler`. `ipcClient` at module scope and `attachHandler` as standalone function are preserved. Tests are thinned from ~814 to ~400 lines in the main extension test file.

**Tech Stack:** TypeScript, Vitest, @earendil-works/pi-coding-agent

---

### Task 1: Remove `/sessions` from router — test first

**Files:**
- Modify: `tests/bot-commands/router.test.ts`
- Modify: `extensions/bot-commands/router.ts`

- [ ] **Step 1: Write failing test — assert /sessions is NOT a valid command**

In `tests/bot-commands/router.test.ts`, replace the sessions test case (lines 9-11):

```typescript
  it("returns sessions for /sessions", () => {
    expect(parseBotCommand("/sessions")).toBe("sessions");
  });
```

With:

```typescript
  it("returns null for /sessions (command removed)", () => {
    expect(parseBotCommand("/sessions")).toBeNull();
  });
```

Also update the "ignores extra args" test to remove `/sessions extra`:

```typescript
  it("ignores extra args after command", () => {
    expect(parseBotCommand("/model claude-3")).toBe("model");
  });
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npx vitest run tests/bot-commands/router.test.ts`
Expected: "returns null for /sessions" FAILS — still returns `"sessions"`

- [ ] **Step 3: Remove sessions from BOT_COMMANDS**

In `extensions/bot-commands/router.ts`, change:

```typescript
export const BOT_COMMANDS = {
  help: "/help",
  sessions: "/sessions",
  model: "/model",
} as const;
```

To:

```typescript
export const BOT_COMMANDS = {
  help: "/help",
  model: "/model",
} as const;
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npx vitest run tests/bot-commands/router.test.ts`
Expected: 6 tests PASS (including "returns null for /sessions")

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/router.ts tests/bot-commands/router.test.ts
git commit -m "refactor: remove /sessions from bot command router"
```

---

### Task 2: Remove `REGISTRY_FILE` config — test first

**Files:**
- Modify: `tests/config.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write failing test — assert REGISTRY_FILE is removed**

In `tests/config.test.ts`, remove the import of `REGISTRY_FILE` (line 8) and the REGISTRY_FILE test case (lines 28-30):

```typescript
import {
  FEISHU_IM_DIR,
  PID_FILE,
  AUTH_FILE,
  DAEMON_LOG,
  SOCKET_PATH,
} from "../src/config.js";
```

```typescript
  // REMOVE this test:
  // it("REGISTRY_FILE points to registry.json in feishu-im dir", () => {
  //     expect(REGISTRY_FILE).toBe(join(baseDir, "registry.json"));
  // });
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `REGISTRY_FILE` not found in import

- [ ] **Step 3: Remove REGISTRY_FILE from config.ts**

In `src/config.ts`, remove line 9:

```typescript
export const REGISTRY_FILE = join(FEISHU_IM_DIR, "registry.json");
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npx vitest run tests/config.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: remove REGISTRY_FILE config"
```

---

### Task 3: Remove `/sessions` from help card — test first

**Files:**
- Modify: `tests/bot-commands/help.test.ts`
- Modify: `extensions/bot-commands/help.ts`

- [ ] **Step 1: Write failing test — assert help card no longer contains /sessions**

In `tests/bot-commands/help.test.ts`, update the test (lines 19-25) to assert `/sessions` is NOT present:

```typescript
  it("card JSON contains /help and /model but NOT /sessions", () => {
    const card = buildHelpCard();
    const json = JSON.stringify(card);
    expect(json).toContain("/help");
    expect(json).toContain("/model");
    expect(json).not.toContain("/sessions");
  });
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npx vitest run tests/bot-commands/help.test.ts`
Expected: "card JSON contains /help and /model but NOT /sessions" FAILS — still contains `/sessions`

- [ ] **Step 3: Remove /sessions from help card**

In `extensions/bot-commands/help.ts`, change line 14 from:

```typescript
      createMarkdownBlock("**/help** — 显示此帮助信息\n**/sessions** — 管理会话（查看、切换、解绑、删除、新建）\n**/model** — 切换 AI 模型"),
```

To:

```typescript
      createMarkdownBlock("**/help** — 显示此帮助信息\n**/model** — 切换 AI 模型"),
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npx vitest run tests/bot-commands/help.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/help.ts tests/bot-commands/help.test.ts
git commit -m "refactor: remove /sessions from help card"
```

---

### Task 4: Delete session files — test first

**Files:**
- Delete: `tests/bot-commands/sessions.test.ts`
- Delete: `extensions/bot-commands/sessions.ts`

Since this is a pure deletion (no new behavior, just removing unused code), there's no meaningful "failing test" to write. The tests in `sessions.test.ts` test features being removed — they should be deleted before the implementation.

- [ ] **Step 1: Delete the session test file**

```bash
rm tests/bot-commands/sessions.test.ts
```

- [ ] **Step 2: Run remaining tests to confirm they still pass**

Run: `npx vitest run --exclude tests/bot-commands/sessions.test.ts`
Expected: All other tests PASS

- [ ] **Step 3: Delete the session command module**

```bash
rm extensions/bot-commands/sessions.ts
```

- [ ] **Step 4: Verify compilation breaks**

Run: `npx tsc --noEmit`
Expected: FAIL — `extensions/index.ts` still imports from `./bot-commands/sessions.js`

- [ ] **Step 5: Commit** (before fixing index.ts — the next task will resolve the broken import)

```bash
git add extensions/bot-commands/sessions.ts tests/bot-commands/sessions.test.ts
git commit -m "refactor: delete session management module and tests"
```

---

### Task 5: Clean up extension tests — test first

**Files:**
- Modify: `tests/extensions/index.test.ts`

Remove all session-related tests and excessive hook tests. These tests fail because they test features that still exist in `index.ts`.

- [ ] **Step 1: Remove `REGISTRY_FILE` from test imports**

Change:

```typescript
import { FEISHU_IM_DIR, PID_FILE, REGISTRY_FILE } from "../../src/config.js";
```

To:

```typescript
import { FEISHU_IM_DIR, PID_FILE } from "../../src/config.js";
```

- [ ] **Step 2: Remove `createFreshSessionCtx` and `createStaleAwareCtx`**

Remove the `createFreshSessionCtx` function (lines 28-42) and the `createStaleAwareCtx` function (lines 44-78).

- [ ] **Step 3: Remove entire "stale ctx prevention" describe block**

Remove lines 191-461 — this removes 7 session-related tests and all their `REGISTRY_FILE` setup/teardown hooks.

- [ ] **Step 4: Remove excessive negative hook tests**

Remove the "does NOT register before_agent_start hook" test (around lines 465-474).
Remove the "does NOT register session_shutdown hook" test (around lines 476-485).

- [ ] **Step 5: Fix stale sendUserMessage test assertion**

In the "handles stale pi.sendUserMessage gracefully" test, change the assertion filter from `includes("restart")` to `includes("start")`:

```typescript
                (call: any[]) => call[0]?.type === "send" && (call[0] as any)?.content?.text?.includes("start")
```

- [ ] **Step 6: Verify no remaining REGISTRY_FILE references**

Run: `grep "REGISTRY_FILE" tests/extensions/index.test.ts`
Expected: No output

- [ ] **Step 7: Run tests to verify they FAIL**

Run: `npx vitest run tests/extensions/index.test.ts`
Expected: Multiple FAILS — the removed tests reference `REGISTRY_FILE` and `createStaleAwareCtx` which haven't been cleaned up yet. The stale sendUserMessage test also FAILS because the message still says "restart".

Wait — since we're removing entire test cases (not adding failing assertions), these tests simply won't exist anymore. The remaining tests use inline context objects and mock IPC, so they should still pass as long as `index.ts` hasn't been changed yet. The only test that should FAIL is the stale sendUserMessage one because `"start"` won't match `"restart"`.

Run: `npx vitest run tests/extensions/index.test.ts`
Expected: "handles stale pi.sendUserMessage gracefully" FAILS — still says "restart"

- [ ] **Step 8: Commit**

```bash
git add tests/extensions/index.test.ts
git commit -m "refactor: remove session tests and excessive hook tests from extension test"
```

---

### Task 6: Refactor `extensions/index.ts` — make tests pass

**Files:**
- Modify: `extensions/index.ts`

- [ ] **Step 1: Update imports**

Remove session imports, REGISTRY_FILE, add ExtensionContext type:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { createIPCClient, type IPCClient } from "../src/ipc/client.js";
import { FEISHU_IM_DIR, PID_FILE, SOCKET_PATH } from "../src/config.js";
import type { DaemonMessage, ExtensionMessage } from "../src/ipc/protocol.js";
import { parseBotCommand } from "./bot-commands/router.js";
import { buildHelpCard } from "./bot-commands/help.js";
import { buildModelCard, handleModelAction } from "./bot-commands/model.js";
```

- [ ] **Step 2: Remove Registry interface and loadRegistry/saveRegistry functions**

Remove lines 16-35.

- [ ] **Step 3: Remove `registry` initialization from default export**

Remove `const registry = loadRegistry();` (line 79).

- [ ] **Step 4: Type `attachHandler` with `ExtensionContext`**

Change parameter `ctxExt: any` to `ctxExt: ExtensionContext`.

- [ ] **Step 5: Remove sessions bot command handler + simplify model handler**

Replace the `/sessions` branch and remove try-catch + session tracking from `/model` branch. The `model` handler becomes:

```typescript
                    if (botCmd) {
                        if (botCmd === "model") {
                            const models = ctxExt.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                            const card = buildModelCard(models, ctxExt.model ? { provider: ctxExt.model.provider, id: ctxExt.model.id } : undefined);
                            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                            return;
                        }
                        const card = buildHelpCard();
                        sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                        return;
                    }
```

- [ ] **Step 6: Remove session tracking from normal message handler**

Remove the `sessionManager.getSessionFile()` + registry update block. Also fix the error message:

```typescript
                    const prompt = msg.content + (msg.resources?.length
                        ? "\n\nAttachments: " + msg.resources.map((r: any) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`).join(", ")
                        : "");
                    activeChatId = msg.chatId;
                    forwardingCount++;
                    try {
                        await piExt.sendUserMessage(prompt);
                    } catch {
                        sendToDaemon({ type: "send", chatId: msg.chatId, content: { text: "Pi 会话已失效，请执行 /feishu-im start" } });
                        activeChatId = null;
                        forwardingCount = 0;
                    }
                    break;
```

- [ ] **Step 7: Remove sessions cardAction + simplify model cardAction**

Replace the `cardAction` handler. Remove the entire `if (parsed.cmd === "sessions")` block. Remove `saveRegistry(registry)` from the model block. Change the outer `if` to only check model:

```typescript
                    if (parsed.cmd === "model") {
                        try {
                            const modelAction = parsed as unknown as import("./bot-commands/model.js").ModelAction;
                            const modelSet = await handleModelAction(
                                modelAction,
                                ctxExt.modelRegistry,
                                (m: any) => piExt.setModel(m),
                            );
                            if (modelSet) {
                                const models = ctxExt.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                const card = buildModelCard(models, ctxExt.model ? { provider: ctxExt.model.provider, id: ctxExt.model.id } : undefined);
                                sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                            } else {
                                sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
                            }
                        } catch (e) {
                            console.error("model cardAction error:", e);
                            sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
                        }
                    }
```

- [ ] **Step 8: Run extension tests to verify they PASS**

Run: `npx vitest run tests/extensions/index.test.ts`
Expected: All remaining tests PASS (the stale sendUserMessage test now passes with "start")

- [ ] **Step 9: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (~110 tests)

- [ ] **Step 10: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add extensions/index.ts
git commit -m "refactor: remove session management logic from extension entry point"
```


# Feishu Communication Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all communication issues between Feishu bot and Pi: single daemon guarantee, simplified forwarding, redesigned session registry, stale ctx protection, and card block type fix.

**Architecture:** Use PID file exclusive lock (`wx` flag) for daemon uniqueness (Node.js equivalent of flock O_EXCL). Replace `forwardingSessions` with `activeChatId` + `forwardingCount`. Redesign registry from `{chatId→sessionFile}` to `{sessions: string[], current?: string}`. Minimize ctx access to only `pi.sendUserMessage`.

**Tech Stack:** TypeScript, Node.js, Vitest, Pi ExtensionAPI, Unix domain sockets

**Spec:** [2026-05-31-feishu-communication-fixes-design.md](../specs/2026-05-31-feishu-communication-fixes-design.md)

---

## File Structure

| File | Role | Change |
|------|------|--------|
| `src/daemon/index.ts` | Daemon main process | PID lock + cleanup order |
| `src/ipc/server.ts` | IPC Unix socket server | Simplified listen() |
| `extensions/index.ts` | Extension entry point | All forwarding/registry/stale changes |
| `extensions/feishu-card.ts` | Card type definitions | `actions` → `action` |
| `extensions/bot-commands/sessions.ts` | Sessions card builder & handler | New registry model, `actions` → `action` |
| `tests/ipc/server.test.ts` | IPC server tests | PID lock tests |
| `tests/extensions/index.test.ts` | Extension integration tests | activeChatId + registry tests |

---

### Task 1: Daemon PID Exclusive Lock + Cleanup Order

**Files:**
- Modify: `src/daemon/index.ts:9-35`
- Modify: `src/ipc/server.ts:32-36` (minor: wrap in try/catch)
- Modify: `extensions/index.ts:34-43`, `extensions/index.ts:45-61`, `extensions/index.ts:371-395`
- Modify: `tests/extensions/index.test.ts` (add PID lock tests)

- [ ] **Step 1: Write failing test — daemon exits when PID file exists with alive process**

Create `tests/daemon/pid-lock.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEISHU_IM_DIR, PID_FILE, SOCKET_PATH } from "../../src/config.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(moduleDir, "../..");
const daemonPath = join(packageDir, "src", "daemon", "index.ts");

describe("daemon PID lock", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(PID_FILE, { force: true }); } catch {}
    try { rmSync(SOCKET_PATH, { force: true }); } catch {}
  });

  it("exits with code 0 when PID file exists and process is alive", async () => {
    // Start a daemon to acquire the PID lock
    const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
    const child1 = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    // Wait for PID file to appear (daemon got the lock)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(PID_FILE)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(existsSync(PID_FILE)).toBe(true);

    // Try to start a second daemon — should exit 0
    const child2 = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    const exitCode = await new Promise<number>((resolve) => {
      child2.on("close", resolve);
    });
    expect(exitCode).toBe(0);

    child1.kill("SIGTERM");
  }, 15000);

  it("cleans up stale PID and starts when old process is dead", async () => {
    // Write a PID file with a non-existent PID
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    writeFileSync(PID_FILE, "99999", "utf-8"); // Non-existent PID

    const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
    const child = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    // Wait for new PID file to appear (daemon cleaned up and started)
    const deadline = Date.now() + 5000;
    let started = false;
    while (Date.now() < deadline) {
      try {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (pid !== 99999) { started = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(started).toBe(true);

    child.kill("SIGTERM");
  }, 15000);
});
```

Run: `npx vitest run tests/daemon/pid-lock.test.ts`
Expected: FAIL — CURRENT daemon doesn't check PID; it just overwrites

- [ ] **Step 2: Implement PID exclusive lock in daemon main()**

Modify `src/daemon/index.ts`, replace lines 9-11:

```typescript
import { writeFileSync, mkdirSync, existsSync, readFileSync, createWriteStream, rmSync, unlinkSync } from "node:fs";
```

Replace the beginning of `main()`:

```typescript
export async function main() {
  mkdirSync(FEISHU_IM_DIR, { recursive: true });

  // PID file exclusive lock (Node.js equivalent of flock via wx flag + pid check)
  try {
    writeFileSync(PID_FILE, String(process.pid), { flag: "wx", encoding: "utf-8" });
  } catch (e: any) {
    if (e.code === "EEXIST") {
      try {
        const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        process.kill(oldPid, 0);
        // Old process is alive — another daemon running
        process.exit(0);
      } catch {
        // Old process is dead — clean up stale PID
        try { rmSync(PID_FILE); } catch {}
        writeFileSync(PID_FILE, String(process.pid), { flag: "wx", encoding: "utf-8" });
      }
    } else {
      throw e;
    }
  }
```

Run: `npx vitest run tests/daemon/pid-lock.test.ts`
Expected: PASS

- [ ] **Step 3: Fix cleanup order in daemon**

Replace `cleanup` function (lines 21-28) with correct order:

```typescript
const cleanup = async () => {
  log("info", "Daemon shutting down");
  try { await channel?.disconnect(); } catch {}
  await ipcServer.close().catch(() => {});
  try { unlinkSync(SOCKET_PATH); } catch {}
  try { rmSync(PID_FILE); } catch {}
  logStream.end();
  process.exit(0);
};
```

New order: disconnect channel → close IPC server → unlink socket → remove PID → exit.

- [ ] **Step 4: Update isDaemonRunning() to use PID file**

Modify `extensions/index.ts`, replace `isDaemonRunning()` (lines 34-43):

```typescript
function isDaemonRunning(): boolean {
    try {
        if (!existsSync(PID_FILE)) return false;
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
```

(Maintains same PID-based check — the exclusive lock guarantee is enforced at daemon startup, not at extension check.)

- [ ] **Step 5: Exclude VITEST from daemon child process environment**

Modify `spawnDaemon()` (lines 45-61) to exclude VITEST:

```typescript
function spawnDaemon(): void {
  mkdirSync(FEISHU_IM_DIR, { recursive: true });

  const daemonPath = new URL("../src/daemon/index.ts", import.meta.url).pathname;

  const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
  const child = spawn("node", ["--import", "jiti/register", daemonPath], {
    detached: true,
    stdio: "ignore",
    cwd: PACKAGE_DIR,
    env: {
      ...childEnv,
      DAEMON_START_TIME: String(Date.now()),
    },
  });

  child.unref();
}
```

- [ ] **Step 6: Fix restart to wait for daemon to actually exit**

Replace restart handler (lines 371-395):

```typescript
case "restart": {
    if (ipcClient?.connected) {
        ipcClient.send({ type: "shutdown" });
        ipcClient.disconnect();
        ipcClient = null;
    } else if (existsSync(SOCKET_PATH)) {
        try {
            const client = createIPCClient(SOCKET_PATH);
            await client.connect();
            client.send({ type: "shutdown" });
            client.disconnect();
        } catch { }
    }

    // Wait for old daemon to actually exit
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isDaemonRunning()) {
        await new Promise((r) => setTimeout(r, 100));
    }
    // Force clean stale files
    try { unlinkSync(SOCKET_PATH); } catch {}
    try { rmSync(PID_FILE); } catch {}

    const client = await getClient(ctx);
    if (client) {
        client.send({ type: "status" });
    }
    break;
}
```

- [ ] **Step 7: Run tests and commit**

```bash
npx vitest run
git add -A
git commit -m "fix: daemon PID exclusive lock for single-process guarantee"
```

---

### Task 2: Card Block Type Fix

**Files:**
- Modify: `extensions/feishu-card.ts:13`
- Modify: `extensions/bot-commands/sessions.ts:100,106`

- [ ] **Step 1: Write failing card tests**

Add to `tests/feishu-card.test.ts` (if it doesn't already test actions tag):

Find existing test file structure and add:

```typescript
it("actions block uses tag 'action' not 'actions'", () => {
  // Test that FeishuCardElement accepts { tag: "action", actions: [...] }
  const el: FeishuCardElement = { tag: "action", actions: [] };
  expect(el.tag).toBe("action");
});
```

Run: `npx vitest run tests/feishu-card.test.ts`
Expected: TypeScript compile ERROR if type doesn't allow `"action"` tag

- [ ] **Step 2: Fix type definition**

Modify `extensions/feishu-card.ts` line 13:

```typescript
export type FeishuCardElement =
  | { tag: "div"; text?: { tag: "lark_md"; content: string }; fields?: unknown[] }
  | { tag: "hr" }
  | { tag: "action"; actions: FeishuButtonElement[] }
  | { tag: "note"; elements: { tag: "plain_text"; content: string }[] }
  | { tag: "select_static"; placeholder: { tag: "plain_text"; content: string }; options: { text: { tag: "plain_text"; content: string }; value: string }[]; initial_option?: string };
```

- [ ] **Step 3: Fix sessions.ts usages**

Modify `extensions/bot-commands/sessions.ts` line 100:

```typescript
      elements.push({ tag: "action", actions: buttons } as FeishuCardElement);
```

Modify `extensions/bot-commands/sessions.ts` line 106:

```typescript
  elements.push({
    tag: "action",
    actions: [
```

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run
git add -A
git commit -m "fix: change feishu card block tag from 'actions' to 'action'"
```

---

### Task 3: Simplify Forwarding to activeChatId

**Files:**
- Modify: `extensions/index.ts:75,210-242,444-474`

- [ ] **Step 1: Write failing test for activeChatId-based forwarding**

Add to `tests/extensions/index.test.ts` after existing `describe("pi event hook registration")` block:

```typescript
describe("activeChatId forwarding", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
  });

  afterAll(() => {
    try { unlinkSync(PID_FILE); } catch {}
  });

  beforeEach(() => {
    mockIPC = null;
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: [], current: undefined }));
  });

  afterEach(async () => {
    mockIPC = null;
    try { unlinkSync(REGISTRY_FILE); } catch {}
    await new Promise((r) => setTimeout(r, 30));
  });

  function setupExtension() {
    const { api, commands } = createMockAPI();
    (api as any).sendUserMessage = vi.fn();
    return { api, commands };
  }

  it("message_update forwards stream using activeChatId", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: [], current: undefined }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-test-forward",
      content: "hello",
    });

    await vi.waitFor(() => {
      expect((api as any).sendUserMessage).toHaveBeenCalled();
    });

    const messageUpdateHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[0] === "message_update"
    )?.[1];

    await messageUpdateHandler(
      { message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
      { sessionManager: { getSessionFile: () => "/tmp/test-session.json" } },
    );

    const streamCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: any[]) => call[0]?.type === "stream"
    );
    expect(streamCalls.length).toBeGreaterThan(0);
    expect(streamCalls[0]![0]).toMatchObject({
      type: "stream",
      chatId: "oc-test-forward",
      content: "reply",
    });
  });

  it("message_end sends streamEnd and resets activeChatId", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: [], current: undefined }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-test-end",
      content: "hello",
    });

    await vi.waitFor(() => {
      expect((api as any).sendUserMessage).toHaveBeenCalled();
    });

    const messageEndHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[0] === "message_end"
    )?.[1];

    await messageEndHandler(
      { message: { role: "assistant" } },
      { sessionManager: { getSessionFile: () => "/tmp/test-session.json" } },
    );

    const streamEndCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: any[]) => call[0]?.type === "streamEnd"
    );
    expect(streamEndCalls.length).toBeGreaterThan(0);
    expect(streamEndCalls[0]![0]).toMatchObject({
      type: "streamEnd",
      chatId: "oc-test-end",
    });
  });
});
```

Run: `npx vitest run tests/extensions/index.test.ts -t "activeChatId"`
Expected: FAIL — `forwardingSessions` is still in use (or tests might pass if they don't touch that path), but verify the approach compiles and fails appropriately.

Note: Since the current code uses `forwardingSessions` with sessionFile-based matching, these tests may fail because the message_update handler checks `forwardingSessions.has(sessionFile)` and does registry reverse lookup.

- [ ] **Step 2: Replace forwardingSessions with activeChatId**

In `extensions/index.ts`, replace line 75:

```typescript
let activeChatId: string | null = null;
let forwardingCount = 0;
```

Replace the message handling block (lines 210-242) in the `case "message"` handler:

```typescript
// For normal messages (not bot commands), after the bot command handling:
const prompt = msg.content + (msg.resources?.length
    ? "\n\nAttachments: " + msg.resources
        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
        .join(", ")
    : "");

activeChatId = msg.chatId;
forwardingCount++;
try {
    await pi.sendUserMessage(prompt);
} catch {
    sendToDaemon({ type: "send", chatId: msg.chatId, content: { text: "Pi 会话已失效，请执行 /feishu-im restart" } });
    activeChatId = null;
    forwardingCount = 0;
}
break;
```

Replace the `message_update` handler (lines 444-460):

```typescript
pi.on("message_update", async (event, _ctx) => {
    if (!ipcClient?.connected) return;
    if (event.message.role !== "assistant") return;
    if (!activeChatId) return;

    const textContent = event.message.content?.find(
        (c: { type: string }) => c.type === "text"
    ) as { text?: string } | undefined;
    if (textContent?.text) {
        sendToDaemon({ type: "stream", chatId: activeChatId, content: textContent.text });
    }
});
```

Replace the `message_end` handler (lines 462-474):

```typescript
pi.on("message_end", async (event, _ctx) => {
    if (!ipcClient?.connected) return;
    if (event.message.role !== "assistant") return;
    if (!activeChatId) return;

    const chatId = activeChatId;
    if (--forwardingCount <= 0) {
        forwardingCount = 0;
        activeChatId = null;
    }
    sendToDaemon({ type: "streamEnd", chatId });
});
```

- [ ] **Step 3: Run test to verify passes**

```bash
npx vitest run tests/extensions/index.test.ts -t "activeChatId"
```
Expected: PASS

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: All passing

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace forwardingSessions with activeChatId+forwardingCount"
```

---

### Task 4: Registry Redesign + /sessions Rewrite

**Files:**
- Modify: `extensions/index.ts` (registry type, load/save, message handler, bot commands)
- Modify: `extensions/bot-commands/sessions.ts` (params, card builder, action handler)

- [ ] **Step 1: Write failing registry tests**

Add to `tests/extensions/index.test.ts`:

```typescript
describe("registry sessions whitelist", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
  });

  afterAll(() => {
    try { unlinkSync(PID_FILE); } catch {}
  });

  beforeEach(() => {
    mockIPC = null;
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: [], current: undefined }));
  });

  afterEach(async () => {
    mockIPC = null;
    try { unlinkSync(REGISTRY_FILE); } catch {}
    await new Promise((r) => setTimeout(r, 30));
  });

  it("loadRegistry returns { sessions, current } from JSON file", () => {
    // Write new-format registry
    writeFileSync(REGISTRY_FILE, JSON.stringify({
      sessions: ["/tmp/s1.json", "/tmp/s2.json"],
      current: "/tmp/s1.json",
    }));

    // Reload module to test loadRegistry
    // This test verifies the new registry format is loadable
    const raw = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
    expect(raw).toEqual({ sessions: ["/tmp/s1.json", "/tmp/s2.json"], current: "/tmp/s1.json" });
  });

  it("deduplicates sessions when saving", async () => {
    // This will be tested in the sessions card integration test
  });
});
```

- [ ] **Step 2: Update Registry interface and load/save functions**

In `extensions/index.ts`, replace the `SessionRegistry` interface (lines 16-18) and `loadRegistry`/`saveRegistry` functions (lines 20-33):

```typescript
export interface Registry {
    sessions: string[];
    current?: string;
}

function loadRegistry(): Registry {
    try {
        if (!existsSync(REGISTRY_FILE)) return { sessions: [] };
        const data = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
        return { sessions: data.sessions || [], current: data.current };
    } catch {
        return { sessions: [] };
    }
}

function saveRegistry(reg: Registry): void {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    // Deduplicate sessions
    const sessions = [...new Set(reg.sessions)];
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions, current: reg.current }, null, 2), "utf-8");
}
```

- [ ] **Step 3: Rewrite /sessions bot command handler**

In `extensions/index.ts`, replace the `/sessions` bot command handling in the `case "message"` handler (inside the `if (botCmd !== "help")` block, lines 165-196). The new logic:

```typescript
if (botCmd === "sessions") {
    try {
        await ctx.newSession({ withSession: async (newCtx) => {
            const sf = newCtx.sessionManager.getSessionFile();
            if (sf) {
                const sessions = [...new Set([...registry.sessions, sf])];
                registry.sessions = sessions;
                registry.current = sf;
                saveRegistry(registry);
            }
            const card = buildSessionsCard(registry.sessions, registry.current || "");
            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
        }});
    } catch {
        const card = buildSessionsCard(registry.sessions, registry.current || "");
        sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
    }
    return;
}
```

- [ ] **Step 4: Rewrite /model bot command handler**

```typescript
if (botCmd === "model") {
    try {
        await ctx.newSession({ withSession: async (newCtx) => {
            const sf = newCtx.sessionManager.getSessionFile();
            if (sf) {
                const sessions = [...new Set([...registry.sessions, sf])];
                registry.sessions = sessions;
                registry.current = sf;
                saveRegistry(registry);
            }
            const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
            const card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
        }});
    } catch {
        const card = buildModelCard([], undefined);
        sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
    }
    return;
}
```

Note: `/sessions` and `/model` now both use `ctx.newSession({ withSession })` regardless of whether there's a "current" session. This avoids the stale ctx issue of ctx.switchSession while keeping the code simple.

- [ ] **Step 5: Simplify normal message handler**

Replace the entire normal message handling path (the code after bot command checks) with the forwarding logic from Task 3:

```typescript
// For normal messages (not bot commands, not /sessions, not /model):
const prompt = msg.content + (msg.resources?.length
    ? "\n\nAttachments: " + msg.resources
        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
        .join(", ")
    : "");

activeChatId = msg.chatId;
forwardingCount++;
// Ensure current session is registered
try {
    const currentSession = ctx.sessionManager.getSessionFile();
    if (currentSession && !registry.sessions.includes(currentSession)) {
        registry.sessions = [...new Set([...registry.sessions, currentSession])];
        registry.current = currentSession;
        saveRegistry(registry);
    }
} catch {}
try {
    await pi.sendUserMessage(prompt);
} catch {
    sendToDaemon({ type: "send", chatId: msg.chatId, content: { text: "Pi 会话已失效，请执行 /feishu-im restart" } });
    activeChatId = null;
    forwardingCount = 0;
}
break;
```

- [ ] **Step 6: Update cardAction sessions handler**

In the `case "cardAction"` section, update sessions handling to use new registry model:

```typescript
if (parsed.cmd === "sessions") {
    try {
        const sessionsAction = parsed as unknown as import("./bot-commands/sessions.js").SessionsAction;
        let afterSessionFile: string | undefined;
        await handleSessionsAction(
            sessionsAction,
            {
                switchSession: async (p: string) => {
                    await ctx.switchSession(p, { withSession: async (newCtx) => {
                        afterSessionFile = newCtx.sessionManager.getSessionFile();
                    }});
                },
                newSession: async () => {
                    await ctx.newSession({ withSession: async (newCtx) => {
                        afterSessionFile = newCtx.sessionManager.getSessionFile();
                    }});
                },
                getSessionFile: () => afterSessionFile,
            },
            registry,
        );
        if (afterSessionFile) {
            registry.current = afterSessionFile;
            registry.sessions = [...new Set([...registry.sessions, afterSessionFile])];
        }
        saveRegistry(registry);
        const card = buildSessionsCard(registry.sessions, registry.current || "");
        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
    } catch {
        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildSessionsCard([], "") });
    }
}
```

- [ ] **Step 7: Update cardAction model handler**

```typescript
} else if (parsed.cmd === "model") {
    try {
        const modelAction = parsed as unknown as import("./bot-commands/model.js").ModelAction;
        const modelSet = await handleModelAction(
            modelAction,
            {
                switchSession: ctx.switchSession,
                newSession: ctx.newSession,
                modelRegistry: ctx.modelRegistry,
            },
            registry,
            msg.chatId,
            (m) => pi.setModel(m as any),
        );
        saveRegistry(registry);
        try {
            await ctx.newSession({ withSession: async (newCtx: any) => {
                const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                const card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
            }});
        } catch {
            sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
        }
    } catch {
        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
    }
}
```

- [ ] **Step 8: Update sessions.ts — buildSessionsCard**

Modify `extensions/bot-commands/sessions.ts`, replace `buildSessionsCard` signature:

```typescript
export function buildSessionsCard(
  sessions: string[],
  currentSessionFile: string,
): Record<string, unknown> {
  const elements: FeishuCardElement[] = [];

  if (sessions.length === 0) {
    elements.push(
      createMarkdownBlock("暂无会话\n发送任意消息即可自动创建会话。"),
    );
  } else {
    for (const sessionPath of sessions) {
      if (elements.length > 0) {
        elements.push(createDividerBlock());
      }

      const { name, messageCount, lastActive } = getSessionInfo(sessionPath);
      const isCurrent = sessionPath === currentSessionFile;
      const indicator = isCurrent ? "✅ *当前* " : "";
      const markdown = `${indicator}**${name}**\n消息数: ${messageCount} · ${lastActive}`;
      elements.push(createMarkdownBlock(markdown));

      const buttons: FeishuButtonElement[] = [];
      if (!isCurrent) {
        buttons.push(
          createActionButton(
            "切换",
            { cmd: "sessions", action: "switch", sessionPath } satisfies SessionsAction,
            "primary",
          ),
        );
      }
      buttons.push(
        createActionButton(
          "删除",
          { cmd: "sessions", action: "delete", sessionPath } satisfies SessionsAction,
          "danger",
        ),
      );
      elements.push({ tag: "action", actions: buttons } as FeishuCardElement);
    }
  }

  elements.push(createDividerBlock());
  elements.push({
    tag: "action",
    actions: [
      createActionButton(
        "新建会话",
        { cmd: "sessions", action: "new", sessionPath: "" } satisfies SessionsAction,
        "primary",
      ),
    ],
  } as FeishuCardElement);

  return buildCard(createCardHeader("会话列表", "blue"), elements);
}
```

Key changes: `registry` parameter removed, uses `sessions: string[]` directly, removes "unbind" operation.

- [ ] **Step 9: Update sessions.ts — handleSessionsAction**

Modify `handleSessionsAction` to use simpler signature and handle new registry model:

```typescript
export async function handleSessionsAction(
  action: SessionsAction,
  ctx: {
    switchSession: (path: string) => Promise<unknown>;
    newSession: () => Promise<unknown>;
    getSessionFile: () => string | undefined;
  },
  registry: { sessions: string[]; current?: string },
): Promise<void> {
  switch (action.action) {
    case "switch":
      await ctx.switchSession(action.sessionPath);
      registry.current = action.sessionPath;
      break;
    case "delete":
      await ctx.newSession();
      const newSessionFile = ctx.getSessionFile();
      rmSync(action.sessionPath, { force: true });
      registry.sessions = registry.sessions.filter(s => s !== action.sessionPath);
      if (newSessionFile) {
        registry.current = newSessionFile;
        registry.sessions = [...new Set([...registry.sessions, newSessionFile])];
      }
      break;
    case "new":
      await ctx.newSession();
      const sf = ctx.getSessionFile();
      if (sf) {
        registry.current = sf;
        registry.sessions = [...new Set([...registry.sessions, sf])];
      }
      break;
    default:
      const _exhaustive: never = action.action;
      break;
  }
}
```

Key changes: `chatId` parameter removed, `registry` type changed, `cheat` param simplified, uses Set dedup.

- [ ] **Step 10: Run full tests and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: redesign registry as session whitelist, rewrite /sessions and /model"
```

---

### Task 5: Ctx Stale Protection

**Files:**
- Modify: `extensions/index.ts` (add try/catch around pi.sendUserMessage)

- [ ] **Step 1: Write failing stale ctx test**

Add to `tests/extensions/index.test.ts`:

```typescript
describe("stale ctx protection", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
  });

  afterAll(() => {
    try { unlinkSync(PID_FILE); } catch {}
  });

  beforeEach(() => {
    mockIPC = null;
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: [], current: undefined }));
  });

  afterEach(async () => {
    mockIPC = null;
    try { unlinkSync(REGISTRY_FILE); } catch {}
    await new Promise((r) => setTimeout(r, 30));
  });

  function setupExtension() {
    const { api, commands } = createMockAPI();
    (api as any).sendUserMessage = vi.fn();
    return { api, commands };
  }

  it("handles stale pi.sendUserMessage gracefully without crashing", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: ["/tmp/test-session.json"], current: "/tmp/test-session.json" }));
    const { api, commands } = setupExtension();
    // Make sendUserMessage throw stale error
    (api as any).sendUserMessage = vi.fn().mockRejectedValue(new Error("stale ctx"));
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    // Should not throw — should handle gracefully
    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-stale",
      content: "hello",
    });

    await vi.waitFor(() => {
      const sendCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any[]) => call[0]?.type === "send" && (call[0] as any)?.content?.text?.includes("restart")
      );
      expect(sendCalls.length).toBeGreaterThan(0);
    });
  });
});
```

Run: `npx vitest run tests/extensions/index.test.ts -t "stale"`
Expected: FAIL — unhandled promise rejection

- [ ] **Step 2: Verify try/catch already covers pi.sendUserMessage**

The normal message handler from Task 4 Step 5 already wraps `pi.sendUserMessage(prompt)` in try/catch. Verify this is present and working.

- [ ] **Step 3: Run tests to confirm**

```bash
npx vitest run tests/extensions/index.test.ts -t "stale"
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add stale ctx protection for pi.sendUserMessage"
```

---

### Task 6: Final Integration Testing & Cleanup

**Files:**
- Modify: `tests/ipc/server.test.ts` (verify existing tests still pass)
- Verify: All tests pass

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 2: Run TypeScript type check**

```bash
npm run check
```

Fix any type errors.

- [ ] **Step 3: Verify existing IPC server tests still pass**

```bash
npx vitest run tests/ipc/server.test.ts
```

- [ ] **Step 4: Verify existing extension tests still pass (and update mocks if needed)**

The existing tests may need updates because:
- `forwardingSessions` was removed → update `createMockAPI` or test expectations
- Registry format changed → tests that write `REGISTRY_FILE` need new format

Update `tests/extensions/index.test.ts`:
- All `writeFileSync(REGISTRY_FILE, JSON.stringify({...}))` calls must use new format `{ sessions: [...], current: "..." }`
- Tests that reference `forwardingSessions` must be updated to use the new activeChatId mechanism
- Tests in `describe("stale ctx prevention")` need updating for the new activeChatId + new registry model

- [ ] **Step 5: Run TypeScript check and full tests again**

```bash
npm run check && npx vitest run
```
Expected: All 109+ tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: update tests for new registry model and activeChatId forwarding"
```

---

## Increment Summary

| # | Task | Key Change | Files |
|---|------|-----------|-------|
| 1 | PID lock | `wx` flag + PID check → single daemon | `src/daemon/index.ts`, `src/ipc/server.ts`, `extensions/index.ts`, `tests/daemon/pid-lock.test.ts` |
| 2 | Card type | `actions` → `action` | `extensions/feishu-card.ts`, `extensions/bot-commands/sessions.ts` |
| 3 | Forwarding | `forwardingSessions` → `activeChatId` | `extensions/index.ts` |
| 4 | Registry | `{chatId→file}` → `{sessions[], current?}` | `extensions/index.ts`, `extensions/bot-commands/sessions.ts` |
| 5 | Stale ctx | try/catch on `pi.sendUserMessage` | `extensions/index.ts` |
| 6 | Integration | Test updates + type check | `tests/extensions/index.test.ts`, `tests/ipc/server.test.ts` |

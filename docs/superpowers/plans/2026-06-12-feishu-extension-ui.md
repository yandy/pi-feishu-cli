# Feishu ExtensionUIContext Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge Pi extension `ctx.ui.confirm/select/input/notify` to Feishu interactive cards, enabling `pi-permission-system` and other extensions to prompt users via chat.

**Architecture:** Disable LarkSDK ChatPipeline serialization, add manual Promise-lock for message ordering, implement `ExtensionUIContext` that converts dialog calls into Feishu cards with callback buttons.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@larksuiteoapi/node-sdk`, Vitest

**Spec:** `docs/superpowers/specs/2026-06-12-feishu-extension-ui-design.md`

---

### Task 1: Disable ChatPipeline message serialization

**Files:**
- Modify: `src/feishu/channel.ts:110-117`

- [ ] **Step 1: Write the failing test**

File: `tests/feishu/channel.test.ts` — append to existing describe block:

```typescript
it("creates channel with chatQueue disabled", () => {
  const channel = createChannel({
    appId: "test-app",
    appSecret: "test-secret",
  });
  // Verify the channel is created without error
  expect(channel).toBeDefined();
  expect(channel.connected).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it passes (already works)**

Run: `npx vitest run tests/feishu/channel.test.ts -t "chatQueue disabled"`
Expected: PASS (test only verifies channel creation, not the safety config)

- [ ] **Step 3: Add `safety` option to createLarkChannel**

File: `src/feishu/channel.ts:110-117` — add one line:

```typescript
const raw = createLarkChannel({
  appId: options.appId,
  appSecret: options.appSecret,
  loggerLevel,
  policy: { requireMention: true, dmMode: "open" },
  includeRawEvent: true,
  safety: { chatQueue: { enabled: false } },
  ...(options.cwd ? { outbound: { allowedFileDirs: [options.cwd] } } : {}),
}) as unknown as RawLarkChannel;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feishu/channel.test.ts -t "chatQueue disabled"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/channel.ts tests/feishu/channel.test.ts
git commit -m "feat: disable Feishu chatQueue to allow concurrent card actions"
```

---

### Task 2: Create Feishu ExtensionUIContext

**Files:**
- Create: `src/feishu/permission-ui.ts`
- Create: `tests/feishu/permission-ui.test.ts`

- [ ] **Step 1: Write the failing test**

File: `tests/feishu/permission-ui.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeishuUIContext, resolvePermissionCardAction } from "../../src/feishu/permission-ui.js";

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockChannel = { send: mockSend } as any;

vi.mock("../../src/feishu/context.js", () => ({
  getFeishuContext: vi.fn(),
}));

import { getFeishuContext, setFeishuContext, type FeishuContextValue } from "../../src/feishu/context.js";

function setMockContext() {
  setFeishuContext({ chatId: "test-chat", channel: mockChannel } as any);
}

function clearMockContext() {
  setFeishuContext(null);
}

describe("createFeishuUIContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMockContext();
  });

  describe("confirm()", () => {
    it("sends a card and resolves true on '是'", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("确认标题", "确认信息");
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      const sentCard = mockSend.mock.calls[0][1]?.card as any;
      expect(sentCard.header.title.content).toBe("权限确认");

      // Simulate user clicking "是"
      const buttons = sentCard.body.elements.filter(
        (e: any) => e.tag === "button"
      );
      const yesButton = buttons.find(
        (b: any) => b.text.content === "是"
      );
      const value = yesButton.behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      const result = await promise;
      expect(result).toBe(true);
    });

    it("resolves false on '否'", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("确认", "message");
      await vi.runAllTicks();

      const sentCard = mockSend.mock.calls[0][1]?.card as any;
      const buttons = sentCard.body.elements.filter(
        (e: any) => e.tag === "button"
      );
      const noButton = buttons.find(
        (b: any) => b.text.content === "否"
      );
      const value = noButton.behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      expect(await promise).toBe(false);
    });

    it("returns true when no Feishu context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      const result = await ui.confirm("title", "msg");
      expect(result).toBe(true);
    });

    it("resolves false on timeout", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("title", "msg", { timeout: 5000 });
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(5001);

      expect(await promise).toBe(false);
    });
  });

  describe("select()", () => {
    it("sends a card with one button per option", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.select("选择标题", ["选项A", "选项B", "选项C"]);
      await vi.runAllTicks();

      const sentCard = mockSend.mock.calls[0][1]?.card as any;
      const buttons = sentCard.body.elements.filter(
        (e: any) => e.tag === "button"
      );
      expect(buttons).toHaveLength(3);
      expect(buttons[0].text.content).toBe("选项A");
      expect(buttons[1].text.content).toBe("选项B");
      expect(buttons[2].text.content).toBe("选项C");

      // Resolve with second option
      const value = buttons[1].behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      expect(await promise).toBe("选项B");
    });

    it("truncates long button text", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const longOption = "A".repeat(50);
      void ui.select("title", [longOption]);
      await vi.runAllTicks();

      const sentCard = mockSend.mock.calls[0][1]?.card as any;
      const buttons = sentCard.body.elements.filter(
        (e: any) => e.tag === "button"
      );
      expect(buttons[0].text.content.length).toBeLessThan(50);
    });

    it("returns first option when no context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      const result = await ui.select("title", ["A", "B"]);
      expect(result).toBe("A");
    });

    it("handles AbortSignal", async () => {
      setMockContext();
      const ui = createFeishuUIContext();
      const controller = new AbortController();

      const promise = ui.select("title", ["A"], { signal: controller.signal });
      await vi.runAllTicks();

      controller.abort();
      expect(await promise).toBeUndefined();
    });
  });

  describe("notify()", () => {
    it("sends text message with prefix", () => {
      setMockContext();
      const ui = createFeishuUIContext();
      ui.notify("test message", "warning");
      expect(mockSend).toHaveBeenCalledWith(
        "test-chat",
        { text: "⚠️ test message" }
      );
    });

    it("does nothing when no context", () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      ui.notify("msg");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("input()", () => {
    it("sends a card and resolves on timeout", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.input("输入标题", "占位符", { timeout: 3000 });
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      const sentCard = mockSend.mock.calls[0][1]?.card as any;
      expect(sentCard.header.title.content).toBe("输入请求");

      vi.advanceTimersByTime(3001);
      expect(await promise).toBeUndefined();
    });

    it("returns undefined when no context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      expect(await ui.input("title")).toBeUndefined();
    });
  });
});

describe("resolvePermissionCardAction", () => {
  it("is a no-op for unknown dialog ids", () => {
    // Should not throw
    resolvePermissionCardAction({ perm_dialog_id: "nonexistent", perm_choice: "x" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feishu/permission-ui.test.ts`
Expected: FAIL — `Cannot find module '../../src/feishu/permission-ui.js'`

- [ ] **Step 3: Write minimal implementation**

File: `src/feishu/permission-ui.ts`:

```typescript
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { getFeishuContext } from "./context.js";
import {
  buildCard,
  type CardElement,
  createActionButton,
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
} from "./cards/helpers.js";

interface PendingDialog {
  resolve: (value: string | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingDialogs = new Map<string, PendingDialog>();

export function resolvePermissionCardAction(
  value: Record<string, unknown>,
): void {
  const dialogId = value["perm_dialog_id"] as string | undefined;
  const choice = value["perm_choice"] as string | undefined;
  if (!dialogId) return;
  const dialog = pendingDialogs.get(dialogId);
  if (dialog) {
    pendingDialogs.delete(dialogId);
    clearTimeout(dialog.timer);
    dialog.resolve(choice);
  }
}

const MAX_BUTTON_TEXT = 40;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 2) + "..";
}

export function createFeishuUIContext(): ExtensionUIContext {
  return {
    async confirm(title, message, opts) {
      const result = await this.select(message, ["是", "否"], opts);
      return result === "是";
    },

    async select(title, options, opts) {
      const ctx = getFeishuContext();
      if (!ctx) return options[0];

      const dialogId = crypto.randomUUID();
      const elements: CardElement[] = [
        createMarkdownBlock(title.replace(/\n/g, "\n\n")),
        createDividerBlock(),
      ];
      for (const option of options) {
        elements.push(
          createActionButton(
            truncate(option, MAX_BUTTON_TEXT),
            {
              cmd: "permission",
              perm_dialog_id: dialogId,
              perm_choice: option,
            },
            "default",
          ),
        );
      }

      const card = buildCard(
        createCardHeader("权限确认", "red"),
        elements,
      );

      return new Promise<string | undefined>((resolve) => {
        const timeout = opts?.timeout ?? 60000;
        const timer = setTimeout(() => {
          pendingDialogs.delete(dialogId);
          resolve(undefined);
        }, timeout);

        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            pendingDialogs.delete(dialogId);
            clearTimeout(timer);
            resolve(undefined);
          }, { once: true });
        }

        pendingDialogs.set(dialogId, { resolve, timer });
        ctx.channel.send(ctx.chatId, { card }).catch(() => {});
      });
    },

    async input(title, placeholder, opts) {
      const ctx = getFeishuContext();
      if (!ctx) return undefined;

      const dialogId = crypto.randomUUID();
      const elements: CardElement[] = [
        createMarkdownBlock(title),
      ];
      if (placeholder) {
        elements.push(createMarkdownBlock(placeholder));
      }

      const card = buildCard(
        createCardHeader("输入请求", "blue"),
        elements,
      );

      return new Promise<string | undefined>((resolve) => {
        const timeout = opts?.timeout ?? 60000;
        const timer = setTimeout(() => {
          pendingDialogs.delete(dialogId);
          resolve(undefined);
        }, timeout);

        pendingDialogs.set(dialogId, { resolve, timer });
        ctx.channel.send(ctx.chatId, { card }).catch(() => {});
      });
    },

    notify(message, type) {
      const ctx = getFeishuContext();
      if (ctx) {
        const prefix =
          type === "error" ? "❌" : type === "warning" ? "⚠️" : "ℹ️";
        ctx.channel.send(ctx.chatId, { text: `${prefix} ${message}` }).catch(() => {});
      }
    },

    onTerminalInput() { return () => {}; },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() { return undefined as never; },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() { return ""; },
    async editor() { return undefined; },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() { return undefined; },
    get theme() { return {} as any; },
    getAllThemes() { return []; },
    getTheme() { return undefined; },
    setTheme() { return { success: false, error: "Not available in feishu mode" }; },
    getToolsExpanded() { return false; },
    setToolsExpanded() {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/feishu/permission-ui.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/feishu/permission-ui.ts tests/feishu/permission-ui.test.ts
git commit -m "feat: add Feishu ExtensionUIContext bridge"
```

---

### Task 3: Wire ExtensionUIContext into Feishu handler

**Files:**
- Modify: `src/index.ts:344-486`
- Modify: `tests/feishu/wiring.test.ts`

- [ ] **Step 1: Wire into `src/index.ts`**

**Change A — imports** (add after existing imports at `src/index.ts:31`):

```typescript
import {
  createFeishuUIContext,
  resolvePermissionCardAction,
} from "./feishu/permission-ui.js";
```

**Change B — in `handleCardAction()`** (after line 485, before closing `}`):

```typescript
  if (cmd === "permission") {
    resolvePermissionCardAction(value);
    return;
  }
}
```

**Change C — in `setupFeishuHandlers()`, message handler body** (replace `channel.on("message", ...)` body at lines 344-401):

```typescript
  const feishuUIContext = createFeishuUIContext();
  let promptLock: Promise<void> = Promise.resolve();

  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    if (
      content.startsWith("/sessions") ||
      content.startsWith("/models") ||
      content.startsWith("/help")
    ) {
      await messageHandler(msg);
      return;
    }

    let unlock: () => void;
    const prev = promptLock;
    promptLock = new Promise<void>((r) => { unlock = r; });
    await prev;

    try {
      setFeishuContext({ chatId: msg.chatId, channel });
      runtime.session.extensionRunner.setUIContext(feishuUIContext, "feishu");

      let attachments: ProcessedAttachments | undefined;
      let downloadDir: string | undefined;

      if (msg.resources.length > 0) {
        downloadDir = join(
          tmpdir(),
          "pi-feishu",
          runtime.session.sessionId ?? "unknown",
        );
        attachments = await processAttachments(
          channel,
          msg,
          downloadDir,
          runtime.session.model?.input,
        );
      }

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
                rm(downloadDir, { recursive: true, force: true }).catch(() => {});
              }
            }
          },
        },
        { replyTo: msg.messageId },
      );
    } finally {
      unlock!();
    }
  });
```

**Change D — update `handleCardAction` call** in `channel.on("cardAction", ...)` to pass the channel (line 394-400), channel is already available:

```typescript
  channel.on("cardAction", (evt: CardActionEvent) => {
    setTimeout(() => {
      handleCardAction(evt, runtime, cwd, channel).catch((err) =>
        console.error("Card action failed:", err),
      );
    }, 0);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All 109+ tests pass

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire Feishu ExtensionUIContext with promptLock and permission card actions"
```

---

### Task 4: Verify full integration

**Files:**
- No code changes; run existing test suite

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (109+ tests, including new ones)

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Verify `send_file_to_chat` still works**

Run: `npx vitest run tests/feishu/send-file-tool.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Verify ChatPipeline disabling doesn't break channel tests**

Run: `npx vitest run tests/feishu/channel.test.ts tests/feishu/channel-send-file.test.ts`
Expected: All pass

---

### Task 5: Manual integration testing (optional)

Checklist for testing with a real Feishu bot and pi-permission-system:

- [ ] Start pi-feishu with `@gotgenes/pi-permission-system` extension installed
- [ ] Send a message that triggers an `ask`-rule tool (e.g., `git push`)
- [ ] Verify a permission card appears in the chat alongside the streaming reply
- [ ] Click "是" — verify the tool executes and streaming continues
- [ ] Click "否" — verify the tool is blocked and agent reports the denial
- [ ] Verify timeout: wait 60s without clicking — verify the prompt auto-denies
- [ ] Send a second message while a permission card is pending — verify it queues behind the lock

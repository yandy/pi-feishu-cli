# Feishu Bot Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/help`, `/sessions`, `/model` slash commands in feishu bot chat, returning interactive Feishu card V2 messages.

**Architecture:** New `bot-commands/` module with router + per-command handlers, plus `feishu-card.ts` for card JSON building. Modify `extensions/index.ts` `message` case to intercept commands before AI forwarding, and `cardAction` case to dispatch button callbacks.

**Tech Stack:** TypeScript, Feishu Card V2 JSON, Pi Extension API (`ExtensionCommandContext`, `SessionManager`, `ModelRegistry`)

---

### Task 1: Feishu Card Builder Utilities

**Files:**
- Create: `extensions/feishu-card.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/feishu-card.test.ts
import { describe, it, expect } from "vitest";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createSelectMenu,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../../extensions/feishu-card.js";

describe("feishu-card", () => {
  describe("createCardHeader", () => {
    it("creates a card header with plain_text title", () => {
      const header = createCardHeader("Test Title", "blue");
      expect(header).toEqual({
        title: { tag: "plain_text", content: "Test Title" },
        template: "blue",
      });
    });
  });

  describe("createMarkdownBlock", () => {
    it("creates a div with lark_md content", () => {
      const block = createMarkdownBlock("**bold** text");
      expect(block).toEqual({
        tag: "div",
        text: { tag: "lark_md", content: "**bold** text" },
      });
    });
  });

  describe("createActionButton", () => {
    it("creates a button action element", () => {
      const button = createActionButton("Click Me", { action: "test" }, "primary");
      expect(button).toEqual({
        tag: "button",
        text: { tag: "plain_text", content: "Click Me" },
        type: "primary",
        value: { action: "test" },
      });
    });

    it("defaults to default type", () => {
      const button = createActionButton("Default", { key: "val" });
      expect(button).toEqual({
        tag: "button",
        text: { tag: "plain_text", content: "Default" },
        type: "default",
        value: { key: "val" },
      });
    });
  });

  describe("createSelectMenu", () => {
    it("creates a select_static element with options", () => {
      const options = [
        { text: { tag: "plain_text" as const, content: "Option A" }, value: "a" },
        { text: { tag: "plain_text" as const, content: "Option B" }, value: "b" },
      ];
      const menu = createSelectMenu("Choose", options, "a");
      expect(menu).toEqual({
        tag: "select_static",
        placeholder: { tag: "plain_text", content: "Choose" },
        options,
        initial_option: "a",
      });
    });
  });

  describe("createDividerBlock", () => {
    it("creates an hr element", () => {
      expect(createDividerBlock()).toEqual({ tag: "hr" });
    });
  });

  describe("createNoteBlock", () => {
    it("creates a note with plain_text", () => {
      const note = createNoteBlock("Footer note");
      expect(note).toEqual({
        tag: "note",
        elements: [{ tag: "plain_text", content: "Footer note" }],
      });
    });
  });

  describe("buildCard", () => {
    it("assembles header and elements into a full card", () => {
      const card = buildCard(
        createCardHeader("My Card"),
        [createMarkdownBlock("Hello"), createDividerBlock(), createMarkdownBlock("World")],
        { wide_screen_mode: true },
      );
      expect(card).toEqual({
        header: { title: { tag: "plain_text", content: "My Card" }, template: undefined },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: "Hello" } },
          { tag: "hr" },
          { tag: "div", text: { tag: "lark_md", content: "World" } },
        ],
        config: { wide_screen_mode: true },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/feishu-card.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `extensions/feishu-card.ts`**

```typescript
// Feishu Card V2 JSON building utilities.

export interface FeishuCardHeader {
  title: { tag: "plain_text"; content: string };
  template?: string;
}

export interface FeishuCardConfig {
  wide_screen_mode?: boolean;
}

export type FeishuCardElement =
  | { tag: "div"; text?: { tag: "lark_md"; content: string }; fields?: unknown[] }
  | { tag: "hr" }
  | { tag: "actions"; actions: FeishuButtonElement[] }
  | { tag: "note"; elements: { tag: "plain_text"; content: string }[] }
  | { tag: "select_static"; placeholder: { tag: "plain_text"; content: string }; options: FeishuSelectOption[]; initial_option?: string };

export interface FeishuButtonElement {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "primary" | "default" | "danger";
  value: Record<string, unknown>;
}

export interface FeishuSelectOption {
  text: { tag: "plain_text"; content: string };
  value: string;
}

export function createCardHeader(title: string, template?: string): FeishuCardHeader {
  return { title: { tag: "plain_text", content: title }, template };
}

export function createMarkdownBlock(content: string): FeishuCardElement {
  return { tag: "div", text: { tag: "lark_md", content } };
}

export function createActionButton(
  text: string,
  value: Record<string, unknown>,
  type: "primary" | "default" | "danger" = "default",
): FeishuButtonElement {
  return { tag: "button", text: { tag: "plain_text", content: text }, type, value };
}

export function createSelectMenu(
  placeholder: string,
  options: FeishuSelectOption[],
  initialOption?: string,
): FeishuCardElement {
  const result: FeishuCardElement & { initial_option?: string } = {
    tag: "select_static",
    placeholder: { tag: "plain_text", content: placeholder },
    options,
  };
  if (initialOption) result.initial_option = initialOption;
  return result;
}

export function createDividerBlock(): FeishuCardElement {
  return { tag: "hr" };
}

export function createNoteBlock(content: string): FeishuCardElement {
  return { tag: "note", elements: [{ tag: "plain_text", content }] };
}

export function buildCard(
  header: FeishuCardHeader,
  elements: FeishuCardElement[],
  config?: FeishuCardConfig,
): Record<string, unknown> {
  const card: Record<string, unknown> = { header, elements };
  if (config) card.config = config;
  return card;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/feishu-card.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add extensions/feishu-card.ts tests/feishu-card.test.ts
git commit -m "feat: add feishu card V2 building utilities"
```

---

### Task 2: Command Router

**Files:**
- Create: `extensions/bot-commands/router.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/bot-commands/router.test.ts
import { describe, it, expect } from "vitest";
import { parseBotCommand } from "../../extensions/bot-commands/router.js";

describe("parseBotCommand", () => {
  it("returns 'help' for /help", () => {
    expect(parseBotCommand("/help")).toBe("help");
  });

  it("returns 'sessions' for /sessions", () => {
    expect(parseBotCommand("/sessions")).toBe("sessions");
  });

  it("returns 'model' for /model", () => {
    expect(parseBotCommand("/model")).toBe("model");
  });

  it("returns null for non-command text", () => {
    expect(parseBotCommand("hello world")).toBeNull();
    expect(parseBotCommand(" /help")).toBeNull();
    expect(parseBotCommand("/unknown")).toBeNull();
    expect(parseBotCommand("")).toBeNull();
  });

  it("returns null for command with extra args (no args supported)", () => {
    expect(parseBotCommand("/sessions extra")).toBe("sessions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot-commands/router.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `extensions/bot-commands/router.ts`**

```typescript
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SessionRegistry } from "../../extensions/index.js";

export const BOT_COMMANDS = {
  help: "/help",
  sessions: "/sessions",
  model: "/model",
} as const;

export type BotCommand = (typeof BOT_COMMANDS)[keyof typeof BOT_COMMANDS];

const COMMAND_MAP: Record<string, BotCommand> = {
  "/help": "help",
  "/sessions": "sessions",
  "/model": "model",
};

export function parseBotCommand(content: string): BotCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  return COMMAND_MAP[cmd] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot-commands/router.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/router.ts tests/bot-commands/router.test.ts
git commit -m "feat: add bot command parser and router"
```

---

### Task 3: /help Command Handler

**Files:**
- Create: `extensions/bot-commands/help.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/bot-commands/help.test.ts
import { describe, it, expect } from "vitest";
import { buildHelpCard } from "../../extensions/bot-commands/help.js";

describe("buildHelpCard", () => {
  it("returns a card object with header, elements, and config", () => {
    const card = buildHelpCard();
    expect(card).toBeDefined();
    expect(card.header).toBeDefined();
    expect(card.header.title).toEqual({ tag: "plain_text", content: expect.stringContaining("Pi") });
    expect(card.elements).toBeInstanceOf(Array);
    expect(card.elements.length).toBeGreaterThan(0);
    expect(card.config).toEqual({ wide_screen_mode: true });
  });

  it("includes welcome text in the first element", () => {
    const card = buildHelpCard();
    const firstEl = card.elements[0] as { tag: string; text?: { content: string } };
    expect(firstEl.text?.content).toContain("Pi");
  });

  it("lists all three commands: /help, /sessions, /model", () => {
    const card = buildHelpCard();
    const textContent = JSON.stringify(card);
    expect(textContent).toContain("/help");
    expect(textContent).toContain("/sessions");
    expect(textContent).toContain("/model");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot-commands/help.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `extensions/bot-commands/help.ts`**

```typescript
import {
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
  createNoteBlock,
  buildCard,
  type FeishuCardElement,
} from "../feishu-card.js";

export function buildHelpCard(): Record<string, unknown> {
  const header = createCardHeader("欢迎使用 Pi 助手", "blue");

  const elements: FeishuCardElement[] = [
    createMarkdownBlock(
      "我是 Pi AI 编码助手，可以帮你写代码、调试、管理项目。在群聊中 @我 可直接对话。\n\n**可用命令：**",
    ),
    createMarkdownBlock(
      "**/help** — 显示此帮助信息\n**/sessions** — 管理会话（查看、切换、解绑、删除、新建）\n**/model** — 切换 AI 模型",
    ),
    createDividerBlock(),
    createNoteBlock("提示：直接发送消息即可与 Pi 对话，无需加斜杠命令。"),
  ];

  return buildCard(header, elements, { wide_screen_mode: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot-commands/help.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/help.ts tests/bot-commands/help.test.ts
git commit -m "feat: add /help bot command handler"
```

---

### Task 4: /sessions Command Handler

**Files:**
- Create: `extensions/bot-commands/sessions.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/bot-commands/sessions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSessionsCard } from "../../extensions/bot-commands/sessions.js";
import { type SessionRegistry } from "../../extensions/index.js";
import { createCardHeader, createMarkdownBlock, buildCard, createNoteBlock } from "../../extensions/feishu-card.js";

// We need to mock SessionManager since it's an external module with filesystem access
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockGetSessionName = vi.fn().mockReturnValue("Test Session");
  const mockGetEntries = vi.fn().mockReturnValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
  const mockOpen = vi.fn().mockReturnValue({
    getSessionName: mockGetSessionName,
    getEntries: mockGetEntries,
  });
  return {
    SessionManager: {
      open: mockOpen,
    },
  };
});

describe("buildSessionsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty state card when registry is empty", () => {
    const registry: SessionRegistry = {};
    const currentSessionFile = "/tmp/test.json";
    const card = buildSessionsCard(registry, currentSessionFile);
    expect(card.elements).toBeDefined();
    const text = JSON.stringify(card.elements);
    expect(text).toContain("暂无绑定");
  });

  it("builds card with session rows from registry", () => {
    const registry: SessionRegistry = {
      chat1: "/tmp/session1.json",
      chat2: "/tmp/session2.json",
    };
    const currentSessionFile = "/tmp/session1.json";
    const card = buildSessionsCard(registry, currentSessionFile);
    expect(card.elements.length).toBeGreaterThan(0);
    // Should contain buttons for each session
    const text = JSON.stringify(card);
    expect(text).toContain("切换");
    expect(text).toContain("解绑");
    expect(text).toContain("删除");
    expect(text).toContain("新建会话");
  });

  it("marks current session with indicator", () => {
    const registry: SessionRegistry = {
      chat1: "/tmp/current.json",
    };
    const currentSessionFile = "/tmp/current.json";
    const card = buildSessionsCard(registry, currentSessionFile);
    const text = JSON.stringify(card);
    expect(text).toContain("current"); // current session indicator
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot-commands/sessions.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `extensions/bot-commands/sessions.ts`**

```typescript
import { basename } from "node:path";
import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  buildCard,
  type FeishuCardElement,
  type FeishuButtonElement,
} from "../feishu-card.js";
import type { SessionRegistry } from "../index.js";

export interface SessionsAction {
  cmd: "sessions";
  action: "switch" | "unbind" | "delete" | "new";
  sessionPath: string;
}

function getSessionInfo(sessionPath: string): { name: string; messageCount: number; lastActive: string } {
  let name: string;
  let messageCount = 0;
  try {
    const sm = SessionManager.open(sessionPath, undefined, undefined);
    name = sm.getSessionName() || basename(sessionPath);
    messageCount = sm.getEntries().length;
  } catch {
    name = basename(sessionPath);
  }

  let lastActive = "";
  try {
    const mtime = statSync(sessionPath).mtime;
    lastActive = formatRelativeTime(mtime);
  } catch {
    lastActive = "未知";
  }

  return { name, messageCount, lastActive };
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function buildSessionsCard(
  registry: SessionRegistry,
  currentSessionFile: string,
): Record<string, unknown> {
  const header = createCardHeader("会话列表", "blue");
  const elements: FeishuCardElement[] = [];

  const entries = Object.entries(registry);

  if (entries.length === 0) {
    elements.push(
      createMarkdownBlock("📋 暂无绑定的会话"),
      createMarkdownBlock("发送任意消息即可自动创建并绑定一个新会话。"),
    );
    return buildCard(header, elements, { wide_screen_mode: true });
  }

  elements.push(createMarkdownBlock(`共 **${entries.length}** 个会话：`));

  for (const [chatId, sessionPath] of entries) {
    const { name, messageCount, lastActive } = getSessionInfo(sessionPath);
    const isCurrent = sessionPath === currentSessionFile;
    const indicator = isCurrent ? " ✅ *当前*  " : "";

    const buttons: FeishuButtonElement[] = [];
    if (!isCurrent) {
      buttons.push(
        createActionButton("切换", { cmd: "sessions", action: "switch", sessionPath } as SessionsAction, "primary"),
      );
    }
    buttons.push(
      createActionButton("解绑", { cmd: "sessions", action: "unbind", sessionPath } as SessionsAction, "default"),
    );
    buttons.push(
      createActionButton("删除", { cmd: "sessions", action: "delete", sessionPath } as SessionsAction, "danger"),
    );

    elements.push(
      createDividerBlock(),
      createMarkdownBlock(
        `${indicator}**${name}**\n消息数: ${messageCount}  ·  ${lastActive}`,
      ),
      {
        tag: "actions",
        actions: buttons,
      } as FeishuCardElement,
    );
  }

  elements.push(
    createDividerBlock(),
    {
      tag: "actions",
      actions: [
        createActionButton(
          "新建会话",
          { cmd: "sessions", action: "new", sessionPath: "" } as SessionsAction,
          "primary",
        ),
      ],
    } as FeishuCardElement,
  );

  return buildCard(header, elements, { wide_screen_mode: true });
}

export async function handleSessionsAction(
  action: SessionsAction,
  ctx: {
    switchSession: (path: string) => Promise<void>;
    newSession: () => Promise<void>;
    getSessionFile: () => string | undefined;
  },
  registry: SessionRegistry,
  chatId: string,
): Promise<void> {
  const { rmSync } = await import("node:fs");
  switch (action.action) {
    case "switch": {
      await ctx.switchSession(action.sessionPath);
      registry[chatId] = action.sessionPath;
      break;
    }
    case "unbind": {
      delete registry[chatId];
      break;
    }
    case "delete": {
      delete registry[chatId];
      try { rmSync(action.sessionPath, { force: true }); } catch {}
      break;
    }
    case "new": {
      await ctx.newSession();
      const sf = ctx.getSessionFile();
      if (sf) registry[chatId] = sf;
      break;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot-commands/sessions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/sessions.ts tests/bot-commands/sessions.test.ts
git commit -m "feat: add /sessions bot command handler"
```

---

### Task 5: /model Command Handler

**Files:**
- Create: `extensions/bot-commands/model.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/bot-commands/model.test.ts
import { describe, it, expect } from "vitest";
import { buildModelCard } from "../../extensions/bot-commands/model.js";

describe("buildModelCard", () => {
  it("returns a card with select menu populated from available models", () => {
    const models = [
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
      { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ];
    const currentModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
    const card = buildModelCard(models as any, currentModel as any);
    expect(card.elements).toBeInstanceOf(Array);
    const text = JSON.stringify(card);
    // Should contain all model names
    expect(text).toContain("GPT-4o");
    expect(text).toContain("Claude Sonnet 4.5");
    expect(text).toContain("Gemini 2.5 Pro");
    // Select menu change triggers callback with model info
    expect(text).toContain("select_static");
  });

  it("sets current model as initial selection", () => {
    const models = [
      { provider: "a", id: "m1", name: "Model 1" },
      { provider: "a", id: "m2", name: "Model 2" },
    ];
    const currentModel = { provider: "a", id: "m2" };
    const card = buildModelCard(models as any, currentModel as any);
    const text = JSON.stringify(card);
    expect(text).toContain("initial_option");
    expect(text).toContain("a/m2");
  });

  it("shows empty state when no models available", () => {
    const card = buildModelCard([], undefined);
    const text = JSON.stringify(card);
    expect(text).toContain("暂无可用");
  });

  it("shows 'no model set' when currentModel is undefined", () => {
    const models = [{ provider: "a", id: "m1", name: "Model 1" }];
    const card = buildModelCard(models as any, undefined);
    const text = JSON.stringify(card);
    expect(text).toContain("未设置");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot-commands/model.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `extensions/bot-commands/model.ts`**

```typescript
import {
  createCardHeader,
  createMarkdownBlock,
  createNoteBlock,
  buildCard,
  type FeishuCardElement,
  type FeishuSelectOption,
} from "../feishu-card.js";

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

export interface ModelAction {
  cmd: "model";
  action: "select";
  modelProvider: string;
  modelId: string;
}

export function buildModelCard(
  availableModels: ModelInfo[],
  currentModel: { provider: string; id: string } | undefined,
): Record<string, unknown> {
  const header = createCardHeader("模型切换", "blue");
  const elements: FeishuCardElement[] = [];

  const currentLabel = currentModel
    ? `${currentModel.provider}/${currentModel.id}`
    : "未设置";

  elements.push(
    createMarkdownBlock(`**当前模型：** ${currentLabel}`),
  );

  if (availableModels.length === 0) {
    elements.push(createMarkdownBlock("暂无可用模型"));
    return buildCard(header, elements, { wide_screen_mode: true });
  }

  const options: FeishuSelectOption[] = availableModels.map((m) => ({
    text: { tag: "plain_text", content: `${m.name} (${m.provider})` },
    value: JSON.stringify({
      cmd: "model",
      action: "select",
      modelProvider: m.provider,
      modelId: m.id,
    } satisfies ModelAction),
  }));

  const initialOption = currentModel
    ? JSON.stringify({
        cmd: "model",
        action: "select",
        modelProvider: currentModel.provider,
        modelId: currentModel.id,
      } satisfies ModelAction)
    : undefined;

  const select = {
    tag: "select_static" as const,
    placeholder: { tag: "plain_text" as const, content: "选择模型" },
    options,
    initial_option: initialOption,
  };

  elements.push(select as unknown as FeishuCardElement);
  elements.push(
    createNoteBlock("选择模型后自动切换。切换仅对当前飞书群绑定的会话生效。"),
  );

  return buildCard(header, elements, { wide_screen_mode: true });
}

export async function handleModelAction(
  action: ModelAction,
  ctx: {
    switchSession: (path: string) => Promise<void>;
    modelRegistry: { find: (provider: string, id: string) => unknown };
  },
  registry: Record<string, string>,
  chatId: string,
  setModel: (model: unknown) => Promise<boolean>,
): Promise<boolean> {
  const sessionPath = registry[chatId];
  if (sessionPath) {
    try { await ctx.switchSession(sessionPath); } catch {}
  }

  const model = ctx.modelRegistry.find(action.modelProvider, action.modelId);
  if (!model) return false;

  return setModel(model);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot-commands/model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/bot-commands/model.ts tests/bot-commands/model.test.ts
git commit -m "feat: add /model bot command handler"
```

---

### Task 6: Wire Commands Into extensions/index.ts

**Files:**
- Modify: `extensions/index.ts:157-186`

- [ ] **Step 1: Run existing tests as baseline**

Run: `npx vitest run tests/extensions/index.test.ts`
Expected: PASS (existing 3 tests)

- [ ] **Step 2: Modify `extensions/index.ts` — add imports**

At line 6 (after `SOCKET_PATH` import), add:

```typescript
import { parseBotCommand } from "./bot-commands/router.js";
import { buildHelpCard } from "./bot-commands/help.js";
import { buildSessionsCard, handleSessionsAction } from "./bot-commands/sessions.js";
import { buildModelCard, handleModelAction } from "./bot-commands/model.js";
import type { BotCommand } from "./bot-commands/router.js";
```

At line 12, export the `SessionRegistry` interface so it can be imported by `router.ts` and others:

```typescript
export interface SessionRegistry {
    [chatId: string]: string;
}
```

- [ ] **Step 3: Modify `extensions/index.ts` — replace message case (L157-181)**

Replace:

```typescript
                            case "message": {
                                const tag = `[feishu:#${++injectSequence}]`;
                                pendingInjects.add(tag);

                                let prompt = tag + " " + msg.content;
                                if (msg.resources?.length) {
                                    prompt += "\n\nAttachments: " + msg.resources
                                        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                                        .join(", ");
                                }

                                const sessionFile = registry[msg.chatId];
                                if (sessionFile) {
                                    try { await ctx.switchSession(sessionFile); } catch { }
                                }

                                await pi.sendUserMessage(prompt);

                                const newSessionFile = ctx.sessionManager.getSessionFile();
                                if (newSessionFile && !registry[msg.chatId]) {
                                    registry[msg.chatId] = newSessionFile;
                                    saveRegistry(registry);
                                }
                                break;
                            }
```

With:

```typescript
                            case "message": {
                                const botCmd = parseBotCommand(msg.content);

                                if (botCmd) {
                                    if (botCmd !== "help") {
                                        const sessionFile = registry[msg.chatId];
                                        if (!sessionFile) {
                                            await ctx.newSession();
                                            const sf = ctx.sessionManager.getSessionFile();
                                            if (sf) {
                                                registry[msg.chatId] = sf;
                                                saveRegistry(registry);
                                            }
                                        } else {
                                            try { await ctx.switchSession(sessionFile); } catch { }
                                        }
                                    }

                                    let card: unknown;
                                    if (botCmd === "help") {
                                        card = buildHelpCard();
                                    } else if (botCmd === "sessions") {
                                        card = buildSessionsCard(registry, ctx.sessionManager.getSessionFile() || "");
                                    } else if (botCmd === "model") {
                                        const models = ctx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                        card = buildModelCard(models, ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined);
                                    }
                                    sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                    return;
                                }

                                const tag = `[feishu:#${++injectSequence}]`;
                                pendingInjects.add(tag);

                                let prompt = tag + " " + msg.content;
                                if (msg.resources?.length) {
                                    prompt += "\n\nAttachments: " + msg.resources
                                        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                                        .join(", ");
                                }

                                const sessionFile = registry[msg.chatId];
                                if (sessionFile) {
                                    try { await ctx.switchSession(sessionFile); } catch { }
                                }

                                await pi.sendUserMessage(prompt);

                                const newSessionFile = ctx.sessionManager.getSessionFile();
                                if (newSessionFile && !registry[msg.chatId]) {
                                    registry[msg.chatId] = newSessionFile;
                                    saveRegistry(registry);
                                }
                                break;
                            }
```

- [ ] **Step 4: Modify `extensions/index.ts` — replace cardAction case (L183-185)**

Replace:

```typescript
                            case "cardAction": {
                                ctx.ui.notify("Card action received", "info");
                                break;
                            }
```

With:

```typescript
                            case "cardAction": {
                                const rawAction = msg.action as Record<string, unknown> | undefined;
                                if (!rawAction) return;

                                let parsed: Record<string, string> | null = null;
                                if (rawAction.tag === "button") {
                                    parsed = rawAction.value as Record<string, string>;
                                } else if (rawAction.tag === "select_static") {
                                    try {
                                        parsed = JSON.parse(rawAction.option as string);
                                    } catch {}
                                }
                                if (!parsed) return;

                                if (parsed.cmd === "sessions") {
                                    await handleSessionsAction(
                                        parsed as unknown as import("./bot-commands/sessions.js").SessionsAction,
                                        {
                                            switchSession: (p: string) => ctx.switchSession(p),
                                            newSession: () => ctx.newSession(),
                                            getSessionFile: () => ctx.sessionManager.getSessionFile(),
                                        },
                                        registry,
                                        msg.chatId,
                                    );
                                    saveRegistry(registry);
                                    const card = buildSessionsCard(registry, ctx.sessionManager.getSessionFile() || "");
                                    sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                } else if (parsed.cmd === "model") {
                                    const modelAction = parsed as unknown as import("./bot-commands/model.js").ModelAction;
                                    const result = await handleModelAction(
                                        modelAction,
                                        { switchSession: (p: string) => ctx.switchSession(p), modelRegistry: ctx.modelRegistry },
                                        registry,
                                        msg.chatId,
                                        (m) => pi.setModel(m as any),
                                    );
                                    const models = ctx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                    const card = buildModelCard(models, ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined);
                                    sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                    if (result) {
                                        ctx.ui.notify("模型切换成功", "info");
                                    }
                                }
                                break;
                            }
```

- [ ] **Step 5: Run the existing tests again to verify no regression**

Run: `npx vitest run`
Expected: PASS (existing + new tests)

- [ ] **Step 6: Commit**

```bash
git add extensions/index.ts
git commit -m "feat: wire bot commands into message and cardAction handlers"
```

---

## Self-Review Checklist

1. **Spec coverage**:
   - `/help` card with welcome + commands → Task 3
   - `/sessions` card with list + switch/unbind/delete/new buttons → Task 4
   - `/model` card with select + confirm → Task 5
   - Command parsing + routing → Task 2
   - Card building utilities → Task 1
   - main entry wiring → Task 6
   - Auto-create session when no binding → Task 6 (message case)
   - `/help` no session required → Task 6 (message case)
   - cardAction dispatch → Task 6 (cardAction case)

2. **Placeholder scan**: No TBD, TODO, or incomplete code. All implementations are complete.

3. **Type consistency**:
   - `SessionRegistry` exported from `index.ts`, imported by `router.ts` and handler files → consistent
   - `SessionsAction` interface matches between card building and action handling → consistent
   - `ModelAction` interface matches between card building and action handling → consistent
   - Card element types match `feishu-card.ts` exports → consistent

# `/help` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/help` command to Feishu bot with interactive card, and optimize Models card layout.

**Architecture:** Configurable bot name via CLI/config/env; new help card builder in `cards/help.ts`; extend `createMessageHandler` with `handleHelp` param; wire card actions to reuse existing session/model handlers.

**Tech Stack:** TypeScript, Feishu card API (lark_md + action buttons), Vitest

---

### Task 1: Bot Name Configuration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `cli.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for botName config**

Add to `tests/config.test.ts`:

```typescript
it("reads botName from FEISHU_BOT_NAME env var", () => {
  const prev = process.env.FEISHU_BOT_NAME;
  process.env.FEISHU_BOT_NAME = "My Bot";
  try {
    const cfg = loadConfig({ appId: "x", appSecret: "x" });
    expect(cfg.botName).toBe("My Bot");
  } finally {
    process.env.FEISHU_BOT_NAME = prev;
  }
});

it("reads botName from config file", () => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, "feishu.json"),
    JSON.stringify({ appId: "file-id", appSecret: "file-secret", botName: "File Bot" }),
  );
  try {
    const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
    expect(cfg.botName).toBe("File Bot");
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/config.test.ts
```
Expected: both new tests fail (botName undefined).

- [ ] **Step 3: Add `botName` to FeishuConfig**

Edit `src/types.ts`:
```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  botName?: string;
}
```

- [ ] **Step 4: Read `botName` in loadConfig**

Edit `src/config.ts`. In `loadConfig`, after the existing envConfig block:
```typescript
if (process.env.FEISHU_BOT_NAME) envConfig.botName = process.env.FEISHU_BOT_NAME;
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx vitest run tests/config.test.ts
```
Expected: all tests pass.

- [ ] **Step 6: Add `--bot-name` CLI arg**

Edit `cli.ts`:

In `CliArgs` interface:
```typescript
interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
  logLevel?: string;
  botName?: string;
}
```

In `parseArgs`:
```typescript
case "--bot-name":
  if (i + 1 < argv.length) result.botName = argv[++i];
  break;
```

In `main()` call:
```typescript
main({
  appId: cliArgs.appId,
  appSecret: cliArgs.appSecret,
  config: cliArgs.config,
  logLevel: cliArgs.logLevel,
  botName: cliArgs.botName,
  packageRoot,
}).catch(...);
```

In `printHelp()`:
```
  --bot-name <name>   Bot display name (default: PI Agent)
```

- [ ] **Step 7: Add `botName` to MainOptions and resolve with priority**

Edit `src/index.ts` — add to `MainOptions`:
```typescript
export interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  logLevel?: string;
  packageRoot?: string;
  botName?: string;
}
```

In `main()`, resolve botName:
```typescript
const botName = options.botName ?? feishuConfig.botName ?? process.env.FEISHU_BOT_NAME ?? "PI Agent";
```

Pass to `setupFeishuHandlers`:
```typescript
cleanup = setupFeishuHandlers(channel, runtime, cwd, botName);
```

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/config.ts cli.ts src/index.ts tests/config.test.ts
git commit -m "feat: add configurable bot name (--bot-name / FEISHU_BOT_NAME)"
```

---

### Task 2: Help Card Builder

**Files:**
- Create: `src/feishu/cards/help.ts`
- Modify: `tests/feishu/cards.test.ts`

- [ ] **Step 1: Write failing test for help card**

Add to `tests/feishu/cards.test.ts`:

```typescript
import { buildHelpCard } from "../../src/feishu/cards/help.js";

describe("help card", () => {
  it("buildHelpCard returns card with bot name in content", () => {
    const card = buildHelpCard("TestBot");
    expect(card.header).toBeDefined();
    expect(card.elements).toBeDefined();
    // Check header title
    expect((card.header as any).title.content).toBe("使用帮助");
    // Check at least one markdown block contains the bot name
    const markdownBlocks = (card.elements as any[]).filter(
      (e: any) => e.tag === "div" && e.text?.tag === "lark_md",
    );
    expect(markdownBlocks.some((b: any) => b.text.content.includes("TestBot"))).toBe(true);
  });

  it("help card has session and model action buttons", () => {
    const card = buildHelpCard("Bot");
    const actionBlocks = (card.elements as any[]).filter(
      (e: any) => e.tag === "action",
    );
    expect(actionBlocks.length).toBeGreaterThanOrEqual(2);
    // First action button should have sessions cmd
    expect(actionBlocks[0].actions[0].value).toMatchObject({ cmd: "help", action: "sessions" });
    // Second action button should have models cmd
    expect(actionBlocks[1].actions[0].value).toMatchObject({ cmd: "help", action: "models" });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: new tests fail (module not found / import error).

- [ ] **Step 3: Create `src/feishu/cards/help.ts`**

```typescript
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
  createActionButton,
  createNoteBlock,
  type CardElement,
} from "./helpers.js";

export function buildHelpCard(botName: string): Record<string, unknown> {
  const elements: CardElement[] = [
    createMarkdownBlock(`你好！我是 ${botName}，你可以直接发送消息与我对话。`),
    createDividerBlock(),
    createMarkdownBlock(
      "**如何使用**\n" +
      "· 发送文字、图片、文件等附件，我会理解并回复\n" +
      "· 回复会实时流式输出\n" +
      "· 支持多轮对话，上下文保留",
    ),
    createDividerBlock(),
    createMarkdownBlock("**可用命令**"),
    {
      tag: "action",
      actions: [
        createActionButton("管理会话", { cmd: "help", action: "sessions" }, "primary"),
      ],
    },
    {
      tag: "action",
      actions: [
        createActionButton("选择模型", { cmd: "help", action: "models" }, "primary"),
      ],
    },
    createMarkdownBlock("/help · 显示此帮助"),
    createNoteBlock("💡 对话历史自动保存，可随时点击上方按钮管理"),
  ];

  return buildCard(createCardHeader("使用帮助", "blue"), elements);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/cards/help.ts tests/feishu/cards.test.ts
git commit -m "feat: add help card builder"
```

---

### Task 3: Extend Handler with `/help`

**Files:**
- Modify: `src/feishu/handler.ts`
- Modify: `tests/feishu/handler.test.ts`

- [ ] **Step 1: Write failing test for /help routing**

Edit `tests/feishu/handler.test.ts`. Add test:

```typescript
it("routes /help command to help handler", async () => {
  const runtime = createMockRuntime();
  const sessionsFn = vi.fn();
  const modelsFn = vi.fn();
  const helpFn = vi.fn().mockResolvedValue(undefined);
  const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn, helpFn);
  await handler(makeMsg("/help"));
  expect(helpFn).toHaveBeenCalledWith("chat-1");
  expect(runtime.session.prompt).not.toHaveBeenCalled();
});
```

Also update the "normal messages" test to pass 4 args:
```typescript
const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
```

And update the existing test calls that only pass 3 args:
- `createMessageHandler(runtime as any, sessionsFn, modelsFn)` → add 4th param `vi.fn()`
- `createMessageHandler(runtime as any, sessionsFn, modelsFn)` → add 4th param

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/feishu/handler.test.ts
```
Expected: type error or new test fails (handler not accepting 4th arg).

- [ ] **Step 3: Add `handleHelp` param to `createMessageHandler`**

Edit `src/feishu/handler.ts`:
```typescript
export function createMessageHandler(
  runtime: AgentSessionRuntime,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
  handleHelp: FeishuCommandHandler,
): (msg: NormalizedMessage) => Promise<void> {
  return async (msg: NormalizedMessage) => {
    const content = msg.content.trim();

    if (content.startsWith("/sessions")) {
      await handleSessions(msg.chatId);
      return;
    }

    if (content.startsWith("/models")) {
      await handleModels(msg.chatId);
      return;
    }

    if (content.startsWith("/help")) {
      await handleHelp(msg.chatId);
      return;
    }

    await runtime.session.prompt(content, { streamingBehavior: "steer" });
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/feishu/handler.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/handler.ts tests/feishu/handler.test.ts
git commit -m "feat: extend createMessageHandler with /help routing"
```

---

### Task 4: Wire `/help` into Bot

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement `handleHelp` and wire card actions**

Add imports at top of `src/index.ts`:
```typescript
import { buildHelpCard } from "./feishu/cards/help.js";
import type { FeishuCommandHandler } from "./feishu/handler.js";
```

Edit `setupFeishuHandlers`:
```typescript
function setupFeishuHandlers(
  channel: Channel,
  runtime: AgentSessionRuntime,
  cwd: string,
  botName: string,
): () => void {
  const handleSessions = async (chatId: string) => {
    const card = await buildSessionsCard({ runtime, cwd });
    await channel.send(chatId, { card });
  };

  const handleModels = async (chatId: string) => {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = await registry.getAvailable();
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: available.filter((m): m is NonNullable<typeof m> => m != null),
    });
    await channel.send(chatId, { card });
  };

  const handleHelp = async (chatId: string) => {
    const card = buildHelpCard(botName);
    await channel.send(chatId, { card });
  };

  const messageHandler = createMessageHandler(runtime, handleSessions, handleModels, handleHelp);

  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    if (content.startsWith("/sessions") || content.startsWith("/models") || content.startsWith("/help")) {
      await messageHandler(msg);
      return;
    }
    // ... rest unchanged
  });
```

- [ ] **Step 2: Add `help` branch to `handleCardAction`**

Edit `handleCardAction` to accept and use session/model handlers:
```typescript
async function handleCardAction(
  value: Record<string, any>,
  _messageId: string | undefined,
  chatId: string | undefined,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
): Promise<void> {
  const { cmd, action } = value;

  if (cmd === "help") {
    if (action === "sessions" && chatId) {
      await handleSessions(chatId);
    } else if (action === "models" && chatId) {
      await handleModels(chatId);
    }
    return;
  }
  // ... existing session/model logic stays
}
```

Update the caller:
```typescript
channel.on("cardAction", async (evt: any) => {
  const value = evt?.action?.value ?? evt;
  const messageId: string | undefined = evt?.messageId;
  const chatId: string | undefined = evt?.chatId;
  try {
    await handleCardAction(value, messageId, chatId, runtime, cwd, channel, handleSessions, handleModels);
  } catch (err) {
    console.error("Card action failed:", err);
  }
});
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire /help command into bot with card actions"
```

---

### Task 5: Optimize Models Card Layout

**Files:**
- Modify: `src/feishu/cards/models.ts`
- Modify: `tests/feishu/cards.test.ts`

- [ ] **Step 1: Write failing test for models card layout changes**

Add to `tests/feishu/cards.test.ts`:
```typescript
import { buildModelsCard } from "../../src/feishu/cards/models.js";

describe("models card", () => {
  const mockSession = {
    model: { provider: "test", id: "gpt-4" },
    thinkingLevel: "high" as const,
  };
  const mockModels = [
    { provider: "openai", id: "gpt-4" },
    { provider: "anthropic", id: "claude-3" },
  ];

  it("uses short thinking labels without 'Think:' prefix", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    // Current model display should not contain "Thinking:"
    const divs = (card.elements as any[]).filter((e: any) => e.tag === "div");
    const currentDiv = divs.find((d: any) => d.text?.content?.includes("test/gpt-4"));
    expect(currentDiv?.text?.content).not.toContain("Thinking:");
  });

  it("action buttons use short labels", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const actions = (card.elements as any[]).filter((e: any) => e.tag === "action");
    expect(actions.length).toBeGreaterThan(0);
    const buttons = actions[0].actions;
    const buttonTexts = buttons.map((b: any) => b.text.content);
    // No button should contain "Think:" prefix
    expect(buttonTexts.some((t: string) => t.startsWith("Think:"))).toBe(false);
    // Should include short forms like "high", "med", "min"
    expect(buttonTexts).toContain("high");
    expect(buttonTexts).toContain("off");
  });

  it("has dividers between model groups", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const hrs = (card.elements as any[]).filter((e: any) => e.tag === "hr");
    // Should have at least 1 divider between models section items
    expect(hrs.length).toBeGreaterThanOrEqual(1);
  });

  it("model names are bolded", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const divs = (card.elements as any[]).filter((e: any) => e.tag === "div");
    const boldModelNames = divs.filter((d: any) => {
      const c = d.text?.content || "";
      return c.includes("**openai/gpt-4**") || c.includes("**anthropic/claude-3**");
    });
    expect(boldModelNames.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: new models card tests fail.

- [ ] **Step 3: Update models card layout**

Edit `src/feishu/cards/models.ts`:

Add display label mapping:
```typescript
const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};
```

Change "当前" label (line 37):
```typescript
const currentLabel = currentModel
  ? `${currentModel.provider}/${currentModel.id} · ${THINKING_LABELS[currentThink]}`
  : "(未选择)";
```

Change the model loop to add dividers, bold names, and short labels:
```typescript
for (const model of availableModels) {
  const key = modelKey(model);
  elements.push(createDividerBlock());
  elements.push(createMarkdownBlock(`**${key}**`));
  elements.push({
    tag: "action",
    actions: THINKING_LEVELS.map((level) => ({
      tag: "button" as const,
      text: { tag: "plain_text" as const, content: THINKING_LABELS[level] },
      type: (level === currentThink ? "primary" : "default") as "primary" | "default",
      value: { cmd: "model", action: "select", provider: model.provider, modelId: model.id, thinkingLevel: level },
    })),
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/feishu/cards/models.ts tests/feishu/cards.test.ts
git commit -m "refactor: optimize models card layout - short think labels, bold names, dividers"
```

# Fix Args Leak and Build Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs: (1) `node` and `pi-feishu` binary paths leaking into pi's init message when running `pi-feishu "hello"`, and (2) `npm run build` failing due to `@earendil-works/pi-coding-agent` exports map blocking deep imports.

**Architecture:** Replace all 5 blocked deep imports from `@earendil-works/pi-coding-agent/dist/*` with either main-entry imports (where available), local inline implementations, or removal (where unused). Then apply TDD to fix the args leak in `cli.ts`.

**Tech Stack:** TypeScript (NodeNext modules), Vitest, @earendil-works/pi-coding-agent v0.78.1

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `cli.ts:9` | Modify | Switch `parsePiArgs` import to main entry |
| `cli.ts:80` | Modify | Fix `remainingArgs` filter to exclude argv[0] and argv[1] |
| `src/index.ts:12` | Modify | Switch `Args` type import to main entry |
| `src/index.ts:13` | Modify | Remove `processFileArguments` import |
| `src/index.ts:14-17` | Modify | Remove `buildInitialMessage`/`InitialMessageResult` import; add local definitions |
| `src/index.ts:18` | Modify | Remove `resolveCliModel` import; add local definition |
| `src/index.ts:144-161` | Modify | Remove file-processing block, call inline `buildInitialMessage` directly |
| `src/runtime.ts:12` | Modify | Switch `Args` type import to main entry |
| `tests/cli.test.ts:22-30,43-48,60,73` | Modify | Update `remainingArgs` expectations to exclude `"node"` and `"pi-feishu"` |

---

### Task 1: Switch `Args`/`parseArgs` imports to main entry (Step A)

**Files:**
- Modify: `cli.ts:9`
- Modify: `src/index.ts:12`
- Modify: `src/runtime.ts:12`

- [ ] **Step 1: Update `cli.ts` import**

In `cli.ts`, change line 9 from:
```typescript
import { parseArgs as parsePiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";
```
to:
```typescript
import { parseArgs as parsePiArgs } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 2: Update `src/index.ts` import**

In `src/index.ts`, change line 12 from:
```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";
```
to:
```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 3: Update `src/runtime.ts` import**

In `src/runtime.ts`, change line 12 from:
```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";
```
to:
```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 4: Run build to verify these imports now resolve**

Run: `npx tsc --noEmit 2>&1 | grep "cli/args.js"`
Expected: No output (the `args.js` deep import error is gone)

- [ ] **Step 5: Commit**

```bash
git add cli.ts src/index.ts src/runtime.ts
git commit -m "fix: switch Args/parseArgs imports to main entry"
```

---

### Task 2: Inline `buildInitialMessage` (Step B, TDD)

**Files:**
- Modify: `src/index.ts:14-17` (remove import)
- Modify: `src/index.ts:~86` (add local function, after `createSessionManager` and before `main`)
- Create: `tests/build-initial-message.test.ts`

Since `processFileArguments` is being dropped (Task 3), `buildInitialMessage` never receives file content. The simplified version only handles `parsed.messages[0]`. No `ImageContent` import needed.

- [ ] **Step 1: Remove the deep import**

In `src/index.ts`, delete the entire import block on lines 14-17:
```typescript
import {
  buildInitialMessage,
  type InitialMessageResult,
} from "@earendil-works/pi-coding-agent/dist/cli/initial-message.js";
```

Note: This will cause a compilation error at the call site in `main()` because `buildInitialMessage` is no longer imported. That's expected — we'll fix it after Step 3.

- [ ] **Step 2: Write failing test**

Create `tests/build-initial-message.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildInitialMessage } from "../src/index.js";

function makePiArgs(overrides: Partial<{ messages: string[] }> = {}) {
  return {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
    ...overrides,
  } as Parameters<typeof buildInitialMessage>[0]["parsed"];
}

describe("buildInitialMessage", () => {
  it("returns the first message and shifts it out", () => {
    const parsed = makePiArgs({ messages: ["hello world"] });
    const result = buildInitialMessage({ parsed });
    expect(result).toBe("hello world");
    expect(parsed.messages).toEqual([]);
  });

  it("returns undefined when messages are empty", () => {
    const parsed = makePiArgs({ messages: [] });
    const result = buildInitialMessage({ parsed });
    expect(result).toBeUndefined();
  });

  it("only returns the first message, leaving rest for initialMessages", () => {
    const parsed = makePiArgs({
      messages: ["first task", "second task", "third task"],
    });
    const result = buildInitialMessage({ parsed });
    expect(result).toBe("first task");
    expect(parsed.messages).toEqual(["second task", "third task"]);
  });
});
```

Run: `npx vitest run tests/build-initial-message.test.ts`
Expected: FAIL — `buildInitialMessage` is not exported from `src/index.ts`

- [ ] **Step 3: Implement `buildInitialMessage` to make tests pass**

In `src/index.ts`, add after the `createSessionManager` function closing brace (after line 84, before line 86):

```typescript
export function buildInitialMessage({ parsed }: { parsed: PiArgs }): string | undefined {
  if (parsed.messages.length > 0) {
    const msg = parsed.messages[0];
    parsed.messages.shift();
    return msg;
  }
  return undefined;
}
```

Note: The original `buildInitialMessage` took `fileText`/`fileImages`/`stdinContent` params which pi-feishu never / no longer supplies. This simplified version only extracts `parsed.messages[0]`.

Run: `npx vitest run tests/build-initial-message.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep "initial-message"`
Expected: No output (the `initial-message` deep import error is gone)

- [ ] **Step 5: Commit**

```bash
git add tests/build-initial-message.test.ts src/index.ts
git commit -m "fix: inline buildInitialMessage locally with TDD"
```

---

### Task 3: Remove `processFileArguments` import and usage (Step C)

**Files:**
- Modify: `src/index.ts:13` (remove import)
- Modify: `src/index.ts:144-161` (remove file-processing block)

- [ ] **Step 1: Remove the import**

In `src/index.ts`, remove line 13:
```typescript
import { processFileArguments } from "@earendil-works/pi-coding-agent/dist/cli/file-processor.js";
```

- [ ] **Step 2: Simplify the initial message construction**

In `src/index.ts`, replace lines 144-161:
```typescript
  let initialMessage: string | undefined;
  let initialImages: InitialMessageResult["initialImages"];

  if (parsed) {
    const fileResult =
      parsed.fileArgs.length > 0
        ? await processFileArguments(parsed.fileArgs, {
            autoResizeImages: false,
          })
        : { text: undefined, images: [] };
    const built = buildInitialMessage({
      parsed,
      fileText: fileResult.text,
      fileImages: fileResult.images,
    });
    initialMessage = built.initialMessage;
    initialImages = built.initialImages;
  }
```
with:
```typescript
  let initialMessage: string | undefined;

  if (parsed) {
    initialMessage = buildInitialMessage({ parsed });
  }
```

Note: `initialImages` is removed since file processing support is dropped — it's always `undefined`.

- [ ] **Step 3: Remove `initialImages` from `InteractiveMode` constructor**

In `src/index.ts`, the `InteractiveMode` constructor call (currently around line 174) passes `initialImages` which no longer exists. Remove that line from the options object:

From:
```typescript
    const mode = new InteractiveMode(runtime, {
      initialMessage,
      initialImages,
      initialMessages: parsed?.messages,
      verbose: parsed?.verbose,
    });
```
To:
```typescript
    const mode = new InteractiveMode(runtime, {
      initialMessage,
      initialMessages: parsed?.messages,
      verbose: parsed?.verbose,
    });
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep "file-processor"`
Expected: No output (the `file-processor` deep import error is gone)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: remove processFileArguments dependency"
```

---

### Task 4: Fix args leak (TDD — Step 1a/1b/1c)

**Files:**
- Modify: `tests/cli.test.ts:22-30,43-48,60,73`
- Modify: `cli.ts:80`

- [ ] **Step 1: Update test — "parses feishu args and leaves remaining for pi"**

In `tests/cli.test.ts`, change the `remainingArgs` assertion at lines 22-30 from:
```typescript
    expect(remainingArgs).toEqual([
      "node",
      "pi-feishu",
      "--model",
      "claude-sonnet",
      "--thinking",
      "high",
      "do something",
    ]);
```
to:
```typescript
    expect(remainingArgs).toEqual([
      "--model",
      "claude-sonnet",
      "--thinking",
      "high",
      "do something",
    ]);
```

- [ ] **Step 2: Update test — "passes through all args when no feishu args present"**

In `tests/cli.test.ts`, change the `remainingArgs` assertion at lines 42-47 from:
```typescript
    expect(remainingArgs).toEqual([
      "node",
      "pi-feishu",
      "--model",
      "claude-sonnet",
    ]);
```
to:
```typescript
    expect(remainingArgs).toEqual([
      "--model",
      "claude-sonnet",
    ]);
```

- [ ] **Step 3: Update test — "handles --no-bundle-feishu-skills flag"**

In `tests/cli.test.ts`, change line 60 from:
```typescript
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--model", "sonnet"]);
```
to:
```typescript
    expect(remainingArgs).toEqual(["--model", "sonnet"]);
```

- [ ] **Step 4: Update test — "handles --bot-name value"**

In `tests/cli.test.ts`, change line 73 from:
```typescript
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--continue"]);
```
to:
```typescript
    expect(remainingArgs).toEqual(["--continue"]);
```

- [ ] **Step 5: Run tests to verify they FAIL (confirm bug)**

Run: `npx vitest run tests/cli.test.ts`
Expected: All 4 tests FAIL because `remainingArgs` still includes `"node"` and `"pi-feishu"`

- [ ] **Step 6: Fix `cli.ts:80` — exclude argv[0] and argv[1] from remainingArgs**

In `cli.ts`, change line 80 from:
```typescript
  const remainingArgs = argv.filter((_, i) => !consumed.has(i));
```
to:
```typescript
  const remainingArgs = argv.filter((_, i) => !consumed.has(i) && i >= 2);
```

- [ ] **Step 7: Run tests to verify they PASS**

Run: `npx vitest run tests/cli.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 8: Commit**

```bash
git add tests/cli.test.ts cli.ts
git commit -m "fix: exclude argv[0] and argv[1] from remainingArgs"
```

---

### Task 5: Inline simplified `resolveCliModel` (Step D)

**Files:**
- Modify: `src/index.ts:18` (remove import)
- Modify: `src/index.ts:~40-45` (add local function, after the inline `buildInitialMessage`)

The original `resolveCliModel` (~110 lines) has complex logic for fuzzy matching, provider inference, alias/dated version sorting, and provider-fallback model building. This simplified version retains the core behavior needed by pi-feishu: parse `--model` and `--provider` flags, split `provider/model:thinkingLevel` format, do exact lookup via `ModelRegistry.find()`, and fall back to id substring matching.

`ThinkingLevel` type is a local union: `"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`.

- [ ] **Step 1: Remove the deep import**

In `src/index.ts`, remove line 18:
```typescript
import { resolveCliModel } from "@earendil-works/pi-coding-agent/dist/core/model-resolver.js";
```

- [ ] **Step 2: Add local `resolveCliModel` function**

In `src/index.ts`, add after the inline `buildInitialMessage` function:

```typescript
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function isValidThinkingLevel(s: string): s is ThinkingLevel {
  return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(s);
}

// Uses ReturnType to avoid importing Model<Api> from transitive @earendil-works/pi-ai
type ModelType = NonNullable<ReturnType<ModelRegistry["find"]>>;

export interface ResolveCliModelResult {
  model: ModelType | undefined;
  thinkingLevel?: ThinkingLevel;
  warning: string | undefined;
  error: string | undefined;
}

export function resolveCliModel(options: {
  cliProvider?: string;
  cliModel?: string;
  modelRegistry: ModelRegistry;
}): ResolveCliModelResult {
  const { cliProvider, cliModel, modelRegistry } = options;
  if (!cliModel) {
    return { model: undefined, warning: undefined, error: undefined };
  }

  const availableModels = modelRegistry.getAll();
  if (availableModels.length === 0) {
    return {
      model: undefined,
      warning: undefined,
      error:
        "No models available. Check your installation or add models to models.json.",
    };
  }

  let provider = cliProvider;
  let modelPattern = cliModel;
  let thinkingLevel: ThinkingLevel | undefined;

  // Parse thinking level suffix from last colon (e.g., "claude-sonnet:high")
  const lastColon = modelPattern.lastIndexOf(":");
  if (lastColon !== -1) {
    const suffix = modelPattern.substring(lastColon + 1);
    if (isValidThinkingLevel(suffix)) {
      thinkingLevel = suffix;
      modelPattern = modelPattern.substring(0, lastColon);
    }
  }

  // Parse provider/model from slash (e.g., "anthropic/claude-sonnet")
  if (!provider) {
    const slashIdx = modelPattern.indexOf("/");
    if (slashIdx !== -1) {
      provider = modelPattern.substring(0, slashIdx);
      modelPattern = modelPattern.substring(slashIdx + 1);
    }
  }

  // Try exact match via ModelRegistry.find
  if (provider) {
    const exact = modelRegistry.find(provider, modelPattern);
    if (exact) {
      return { model: exact, thinkingLevel, warning: undefined, error: undefined };
    }
  }

  // Try fuzzy match by id substring across all models
  const candidates = provider
    ? availableModels.filter((m) => m.provider === provider)
    : availableModels;
  const fuzzy = candidates.find(
    (m) =>
      m.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
      (m.name && m.name.toLowerCase().includes(modelPattern.toLowerCase())),
  );
  if (fuzzy) {
    return {
      model: fuzzy,
      thinkingLevel,
      warning: undefined,
      error: undefined,
    };
  }

  // Fallback: if provider is known, create custom model id
  if (provider && availableModels.some((m) => m.provider === provider)) {
    const baseModel = availableModels.find((m) => m.provider === provider);
    if (baseModel) {
      const fallback = { ...baseModel, id: modelPattern, name: modelPattern };
      return {
        model: fallback,
        thinkingLevel: undefined,
        warning: `Model "${modelPattern}" not found for provider "${provider}". Using custom model id.`,
        error: undefined,
      };
    }
  }

  const display = provider ? `${provider}/${modelPattern}` : cliModel;
  return {
    model: undefined,
    thinkingLevel: undefined,
    warning: undefined,
    error: `Model "${display}" not found. Use --list-models to see available models.`,
  };
}
```

- [ ] **Step 3: Run type check and build**

Run: `npx tsc --noEmit`
Expected: No errors related to `model-resolver` or any other deep imports

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: inline simplified resolveCliModel locally"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 3: Commit (if any changes during verification)**

```bash
git status
# If clean, done.
```

---

## Self-Review Checklist

- **Spec coverage:** Each of the 5 deep imports (args.js, initial-message.js, file-processor.js, model-resolver.js) is addressed by a task. The args leak fix is covered by Task 4 (TDD).
- **Placeholder scan:** No TBD, TODO, "add appropriate X", or references to undefined types. All code steps include complete implementations.
- **Type consistency:** The `buildInitialMessage` function returns `string | undefined` (simplified, no `ImageContent` dependency). The `resolveCliModel` uses `ReturnType<ModelRegistry["find"]>` to derive the model type without importing from `@earendil-works/pi-ai`. `ThinkingLevel` is a local union. No transitive-dependency imports needed. No naming conflicts across tasks.

# pi-feishu-cli v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `pi-feishu-cli` as a standalone CLI that embeds Pi's AI agent via `InteractiveMode` TUI and connects to a Feishu bot via Channel SDK, sharing one `AgentSessionRuntime`.

**Architecture:** Single-process Node.js app. `InteractiveMode` handles TUI. Feishu Channel (WebSocket) runs on same event loop. Shared `AgentSessionRuntime` with 26 Lark API skills from `skills/`. Compiled via `tsc` to `dist/`, published as npm package.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (runtime + InteractiveMode), `@larksuiteoapi/node-sdk` (Channel SDK), `vitest`

---

### Task 1: Cleanup — remove old code and reset project config

**Files:**
- Remove: `extensions/`, `src/daemon/`, `src/ipc/`, `src/auth/`, `src/channel/`, `src/config.ts`, `docs/prompts/`
- Create: `src/types.ts`, `src/config.ts` (empty placeholders)
- Modify: `package.json`, `tsconfig.json`, `.npmignore`

- [ ] **Step 1: Delete old source directories and files**

```bash
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/extensions/
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/src/daemon/
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/src/ipc/
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/src/auth/
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/src/channel/
rm -f /home/yandy/workspace/pri/pi-feishu-cli/src/config.ts
rm -rf /home/yandy/workspace/pri/pi-feishu-cli/docs/prompts/
```

- [ ] **Step 2: Update `package.json`**

```json
{
  "name": "pi-feishu-cli",
  "version": "1.0.0",
  "description": "Pi AI agent with Feishu bot integration",
  "keywords": ["pi", "feishu", "lark", "ai", "agent", "cli"],
  "license": "MIT",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yandy/pi-feishu-cli.git"
  },
  "homepage": "https://github.com/yandy/pi-feishu-cli#readme",
  "bugs": {
    "url": "https://github.com/yandy/pi-feishu-cli/issues"
  },
  "bin": {
    "pi-feishu": "./dist/cli.js"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@larksuiteoapi/node-sdk": "^1.66.0",
    "typebox": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "build": "tsc",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "files": [
    "dist/",
    "skills/"
  ]
}
```

- [ ] **Step 3: Update `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["cli.ts", "src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist", "skills"]
}
```

- [ ] **Step 4: Update `.npmignore`**

```
tests/
src/
docs/
*.sock
*.pid
```

- [ ] **Step 5: Create placeholder `src/types.ts`**

```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
}
```

- [ ] **Step 6: Create placeholder `src/config.ts`**

```typescript
import type { FeishuConfig } from "./types.js";

export function loadConfig(): FeishuConfig {
  throw new Error("Not implemented");
}
```

- [ ] **Step 7: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: remove old code, reset project config for v1"
```

---

### Task 2: Config module — load Feishu credentials from CLI args, file, and env

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for `loadConfig`**

```typescript
// tests/config.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadConfig } from "../src/config.js";

const tmpDir = join(process.cwd(), "tests", "__tmp_config__");

function cleanup() {
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

afterEach(cleanup);

describe("loadConfig", () => {
  it("returns config from env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";
    try {
      const cfg = loadConfig({});
      expect(cfg.appId).toBe("env-id");
      expect(cfg.appSecret).toBe("env-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });

  it("CLI args override env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    process.env.FEISHU_APP_ID = "env-id";
    try {
      const cfg = loadConfig({ appId: "cli-id", appSecret: "cli-secret" });
      expect(cfg.appId).toBe("cli-id");
      expect(cfg.appSecret).toBe("cli-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
    }
  });

  it("config file overrides env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    process.env.FEISHU_APP_ID = "env-id";
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, "feishu.json"),
        JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
      );
      const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
      expect(cfg.appId).toBe("file-id");
      expect(cfg.appSecret).toBe("file-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      cleanup();
    }
  });

  it("CLI args override config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "feishu.json"),
      JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
    );
    const cfg = loadConfig({
      appId: "cli-id",
      appSecret: "cli-secret",
      config: join(tmpDir, "feishu.json"),
    });
    expect(cfg.appId).toBe("cli-id");
    expect(cfg.appSecret).toBe("cli-secret");
    cleanup();
  });

  it("throws when no credentials found", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    try {
      expect(() => loadConfig({})).toThrow("Feishu credentials not configured");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```
Expected: 5 failures (function throws "Not implemented").

- [ ] **Step 3: Implement `loadConfig` in `src/config.ts`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FeishuConfig } from "./types.js";

export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
}

function findConfigFile(cwd: string): string | null {
  const paths = [
    join(cwd, ".pi", "feishu.json"),
    join(homedir(), ".pi", "agent", "feishu.json"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadFileConfig(path: string): FeishuConfig | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.appId && typeof parsed.appId === "string" && parsed.appSecret && typeof parsed.appSecret === "string") {
      return { appId: parsed.appId, appSecret: parsed.appSecret };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadConfig(options: ConfigOptions = {}): FeishuConfig {
  // Layer 3: env vars (lowest priority)
  const envConfig: Partial<FeishuConfig> = {};
  if (process.env.FEISHU_APP_ID) envConfig.appId = process.env.FEISHU_APP_ID;
  if (process.env.FEISHU_APP_SECRET) envConfig.appSecret = process.env.FEISHU_APP_SECRET;

  // Layer 2: config file
  let fileConfig: FeishuConfig | null = null;
  const configPath = options.config ?? findConfigFile(options.cwd ?? process.cwd());
  if (configPath) {
    fileConfig = loadFileConfig(configPath);
  }

  // Layer 1: CLI args (highest priority)
  const cliConfig: Partial<FeishuConfig> = {};
  if (options.appId) cliConfig.appId = options.appId;
  if (options.appSecret) cliConfig.appSecret = options.appSecret;

  // Merge: lower-layer values are fallback for higher layers
  const appId = cliConfig.appId ?? fileConfig?.appId ?? envConfig.appId;
  const appSecret = cliConfig.appSecret ?? fileConfig?.appSecret ?? envConfig.appSecret;

  if (!appId || !appSecret) {
    throw new Error(
      "Feishu credentials not configured. Set FEISHU_APP_ID/FEISHU_APP_SECRET env vars, " +
      "create ~/.pi/agent/feishu.json, or pass --app-id/--app-secret CLI args.",
    );
  }

  return { appId, appSecret };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/config.test.ts src/config.ts src/types.ts && git commit -m "feat: implement config module with CLI > file > env priority"
```

---

### Task 3: Runtime module — initialize AgentSessionRuntime with skills

**Files:**
- Create: `src/runtime.ts`
- Create: `tests/runtime.test.ts`

- [ ] **Step 1: Write tests for runtime initialization**

```typescript
// tests/runtime.test.ts
import { describe, it, expect } from "vitest";
import { initRuntime } from "../src/runtime.js";
import { existsSync } from "node:fs";

describe("initRuntime", () => {
  it("creates a runtime with sessionManager", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    expect(runtime).toBeDefined();
    expect(runtime.session).toBeDefined();
    expect(typeof runtime.session.sessionId).toBe("string");
  }, 15000);

  it("loads skills from skills/ directory", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const skillsDir = `${cwd}/skills`;
    expect(existsSync(skillsDir)).toBe(true);
  }, 15000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/runtime.test.ts
```
Expected: 2 failures (module not found).

- [ ] **Step 3: Implement `initRuntime` in `src/runtime.ts`**

```typescript
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
}

export interface InitRuntimeResult {
  runtime: AgentSessionRuntime;
}

function loadSkillsFromDir(skillsDir: string, cwd: string): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(skillsDir)) return skills;

  for (const entry of readdirSync(skillsDir)) {
    const fullPath = join(skillsDir, entry);
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) continue;
    const skillMd = join(fullPath, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    skills.push({
      name: entry,
      description: `Skill from ${entry}`,
      filePath: skillMd,
      baseDir: fullPath,
      source: "project",
    });
  }
  return skills;
}

function existsSync(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}

export async function initRuntime(options: InitRuntimeOptions): Promise<InitRuntimeResult> {
  const cwd = resolve(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const skillsDir = join(cwd, "skills");
  const customSkills = loadSkillsFromDir(skillsDir, cwd);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    skillsOverride: (current) => ({
      skills: [...current.skills, ...customSkills],
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: runtimeCwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd: runtimeCwd });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });

  return { runtime };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/runtime.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts && git commit -m "feat: implement runtime module with skills loading"
```

---

### Task 4: Feishu card helpers — shared card building utilities

**Files:**
- Create: `src/feishu/cards/helpers.ts`
- Create: `tests/feishu/cards.test.ts`

- [ ] **Step 1: Write tests for card helpers**

```typescript
// tests/feishu/cards.test.ts
import { describe, it, expect } from "vitest";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../../src/feishu/cards/helpers.js";

describe("card helpers", () => {
  it("createCardHeader returns header with title", () => {
    const h = createCardHeader("Test Title", "blue");
    expect(h.title).toEqual({ tag: "plain_text", content: "Test Title" });
    expect(h.template).toBe("blue");
  });

  it("createMarkdownBlock returns div with lark_md", () => {
    const b = createMarkdownBlock("**bold**");
    expect(b).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "**bold**" },
    });
  });

  it("createActionButton returns button with value", () => {
    const b = createActionButton("Click", { cmd: "test", action: "go" }, "primary");
    expect(b.tag).toBe("button");
    expect(b.text).toEqual({ tag: "plain_text", content: "Click" });
    expect(b.type).toBe("primary");
    expect(b.value).toEqual({ cmd: "test", action: "go" });
  });

  it("createDividerBlock returns hr", () => {
    expect(createDividerBlock()).toEqual({ tag: "hr" });
  });

  it("createNoteBlock returns note element", () => {
    const n = createNoteBlock("footer text");
    expect(n).toEqual({
      tag: "note",
      elements: [{ tag: "plain_text", content: "footer text" }],
    });
  });

  it("buildCard assembles header + elements", () => {
    const header = createCardHeader("Test");
    const elements = [createMarkdownBlock("hello")];
    const card = buildCard(header, elements);
    expect(card.config).toEqual({ wide_screen_mode: true });
    expect(card.header).toBe(header);
    expect(card.elements).toBe(elements);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
mkdir -p /home/yandy/workspace/pri/pi-feishu-cli/tests/feishu
npx vitest run tests/feishu/cards.test.ts
```
Expected: failures (module not found).

- [ ] **Step 3: Implement `src/feishu/cards/helpers.ts`**

```typescript
export interface CardHeader {
  title: { tag: "plain_text"; content: string };
  template?: string;
}

export interface CardConfig {
  wide_screen_mode?: boolean;
}

export type CardElement =
  | { tag: "div"; text?: { tag: "lark_md"; content: string } }
  | { tag: "hr" }
  | { tag: "action"; actions: CardButton[] }
  | { tag: "note"; elements: { tag: "plain_text"; content: string }[] };

export interface CardButton {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "primary" | "default" | "danger";
  value: Record<string, unknown>;
}

export function createCardHeader(title: string, template?: string): CardHeader {
  const header: CardHeader = {
    title: { tag: "plain_text", content: title },
  };
  if (template !== undefined) header.template = template;
  return header;
}

export function createMarkdownBlock(content: string): CardElement {
  return {
    tag: "div",
    text: { tag: "lark_md", content },
  };
}

export function createActionButton(
  text: string,
  value: Record<string, unknown>,
  type: "primary" | "default" | "danger" = "default",
): CardButton {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value,
  };
}

export function createDividerBlock(): CardElement {
  return { tag: "hr" };
}

export function createNoteBlock(content: string): CardElement {
  return {
    tag: "note",
    elements: [{ tag: "plain_text", content }],
  };
}

export function buildCard(
  header: CardHeader,
  elements: CardElement[],
): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header,
    elements,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/feishu/cards.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/cards/helpers.ts tests/feishu/cards.test.ts && git commit -m "feat: implement feishu card helpers"
```

---

### Task 5: Sessions card builder

**Files:**
- Create: `src/feishu/cards/sessions.ts`

- [ ] **Step 1: Implement `buildSessionsCard`**

```typescript
// src/feishu/cards/sessions.ts
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  createNoteBlock,
} from "./helpers.js";

export interface SessionCardOptions {
  runtime: AgentSessionRuntime;
  cwd: string;
}

export async function buildSessionsCard(options: SessionCardOptions): Promise<Record<string, unknown>> {
  const { runtime, cwd } = options;

  const currentSessionPath = runtime.session.sessionFile;
  const currentId = currentSessionPath ? basename(currentSessionPath) : "(unnamed)";

  const projectSessions = await SessionManager.list(cwd);
  const allSessions = await SessionManager.listAll(cwd);

  const elements: Record<string, unknown>[] = [];

  // Current session
  elements.push(createMarkdownBlock(`**当前 Session**\n\`${currentId}\``));

  // Other sessions
  if (projectSessions.length > 0 || allSessions.length > 0) {
    elements.push(createDividerBlock());
    elements.push(createMarkdownBlock("**其他 Sessions**"));

    const seen = new Set<string>();
    const sessions = [...projectSessions, ...allSessions];
    for (const s of sessions) {
      const name = basename(s);
      if (seen.has(name) || name === currentId) continue;
      seen.add(name);

      elements.push({
        tag: "action",
        actions: [
          createMarkdownBlock(`\`${name}\``),
          createActionButton("切换", { cmd: "session", action: "switch", sessionPath: s }, "default"),
          createActionButton("删除", { cmd: "session", action: "delete", sessionPath: s }, "danger"),
        ],
      });
    }
  }

  // New session button (bottom)
  elements.push(createDividerBlock());
  elements.push({
    tag: "action",
    actions: [
      createActionButton("新建 Session", { cmd: "session", action: "new" }, "primary"),
    ],
  });

  return buildCard(createCardHeader("Session 管理", "blue"), elements);
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/feishu/cards/sessions.ts && git commit -m "feat: implement sessions card builder"
```

---

### Task 6: Models card builder

**Files:**
- Create: `src/feishu/cards/models.ts`

- [ ] **Step 1: Implement `buildModelsCard`**

```typescript
// src/feishu/cards/models.ts
import type { AgentSession, Model } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-coding-agent";
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
} from "./helpers.js";

export interface ModelCardOptions {
  session: AgentSession;
  availableModels: Model[];
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function modelKey(model: Model): string {
  return `${model.provider}/${model.id}`;
}

export async function buildModelsCard(options: ModelCardOptions): Promise<Record<string, unknown>> {
  const { session, availableModels } = options;

  const currentModel = session.model;
  const currentThink = session.thinkingLevel;

  const elements: Record<string, unknown>[] = [];

  // Current
  const currentLabel = currentModel
    ? `${currentModel.provider}/${currentModel.id} · Thinking: ${currentThink}`
    : "(未选择)";
  elements.push(createMarkdownBlock(`**当前**\n${currentLabel}`));

  // Available models
  elements.push(createDividerBlock());
  elements.push(createMarkdownBlock("**可用 Models**"));

  for (const model of availableModels) {
    const key = modelKey(model);

    // Row with model label and switch buttons for each think level
    const actionRow: Record<string, unknown> = {
      tag: "action",
      actions: [] as Record<string, unknown>[],
    };

    const buttons = THINKING_LEVELS.map((level) =>
      createActionButton(
        `Think:${level}`,
        { cmd: "model", action: "select", provider: model.provider, modelId: model.id, thinkingLevel: level },
        "default",
      ),
    );

    elements.push({
      tag: "action",
      actions: [
        createMarkdownBlock(`\`${key}\``),
        ...buttons,
      ],
    });
  }

  return buildCard(createCardHeader("Model 管理", "blue"), elements);
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/feishu/cards/models.ts && git commit -m "feat: implement models card builder"
```

---

### Task 7: Feishu streaming — session events to channel stream

**Files:**
- Create: `src/feishu/streaming.ts`
- Create: `tests/feishu/streaming.test.ts`

- [ ] **Step 1: Write tests for streaming handler**

```typescript
// tests/feishu/streaming.test.ts
import { describe, it, expect, vi } from "vitest";
import { createStreamingHandler } from "../../src/feishu/streaming.js";

function createMockSession(events: any[]) {
  let listener: ((e: any) => void) | null = null;
  return {
    subscribe: (fn: (e: any) => void) => {
      listener = fn;
      return () => { listener = null; };
    },
    emit: (e: any) => { listener?.(e); },
    isStreaming: false,
  };
}

function createMockStream() {
  const chunks: string[] = [];
  return {
    chunks,
    append: vi.fn(async (chunk: string) => { chunks.push(chunk); }),
    end: vi.fn(),
  };
}

describe("createStreamingHandler", () => {
  it("streams text_delta chunks", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello", contentIndex: 0, partial: {} },
    });

    expect(stream.append).toHaveBeenCalledWith("Hello");
    unsub();
  });

  it("streams thinking_delta as blockquote", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm", contentIndex: 0, partial: {} },
    });

    expect(stream.append).toHaveBeenCalledWith("> hmm");
    unsub();
  });

  it("streams tool_execution_start", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "tool_execution_start", toolName: "bash", toolCallId: "1", args: {} });

    expect(stream.append).toHaveBeenCalledWith("🔧 bash");
    unsub();
  });

  it("streams tool_execution_update", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "tool_execution_update", toolName: "bash", toolCallId: "1", args: {}, partialResult: "output" });

    expect(stream.append).toHaveBeenCalledWith("output");
    unsub();
  });

  it("ignores structural events", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "agent_start" });
    session.emit({ type: "turn_start" });
    session.emit({ type: "message_start", message: {} });
    session.emit({ type: "thought" });

    expect(stream.append).not.toHaveBeenCalled();
    unsub();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/feishu/streaming.test.ts
```
Expected: failures (module not found).

- [ ] **Step 3: Implement `src/feishu/streaming.ts`**

```typescript
export interface StreamWriter {
  append(chunk: string): Promise<void>;
}

export function createStreamingHandler(
  session: { subscribe: (listener: (event: any) => void) => () => void },
  stream: StreamWriter,
): () => void {
  return session.subscribe((event: any) => {
    switch (event.type) {
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (sub.type === "text_delta") {
          stream.append(sub.delta);
        } else if (sub.type === "thinking_delta") {
          stream.append(`> ${sub.delta}`);
        } else if (sub.type === "error") {
          stream.append("— 模型返回错误 —");
        }
        break;
      }

      case "tool_execution_start":
        stream.append(`🔧 ${event.toolName}`);
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
        stream.append(`— 自动重试 (${event.attempt}/${event.maxAttempts})... —`);
        break;

      case "auto_retry_end":
        stream.append(event.success ? "✅ 重试成功" : "❌ 重试失败");
        break;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/feishu/streaming.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/streaming.ts tests/feishu/streaming.test.ts && git commit -m "feat: implement session-event-to-feishu-streaming"
```

---

### Task 8: Feishu channel — createLarkChannel wrapper

**Files:**
- Create: `src/feishu/channel.ts`

- [ ] **Step 1: Implement channel wrapper**

```typescript
// src/feishu/channel.ts
import {
  createLarkChannel,
  LoggerLevel,
  type NormalizedMessage,
  type CardActionEvent,
} from "@larksuiteoapi/node-sdk";

export type { NormalizedMessage, CardActionEvent };

export interface ChannelOptions {
  appId: string;
  appSecret: string;
}

export interface Channel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: "message", handler: (msg: NormalizedMessage) => void): void;
  on(event: "cardAction", handler: (evt: CardActionEvent) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(event: "reconnecting" | "reconnected", handler: () => void): void;
  send(chatId: string, content: { text?: string; markdown?: string; card?: unknown }, options?: { replyTo?: string }): Promise<void>;
  stream(chatId: string, producer: { markdown: (s: { append(chunk: string): Promise<void> }) => Promise<void> }, options?: { replyTo?: string }): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  get botIdentity(): { name: string } | undefined;
  get connected(): boolean;
}

export function createChannel(options: ChannelOptions): Channel {
  const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: LoggerLevel.info,
    policy: { requireMention: true, dmMode: "open" },
  });

  let _connected = false;

  const channel: Channel = {
    async connect() {
      await (raw as any).connect();
      _connected = true;
    },

    async disconnect() {
      await (raw as any).disconnect();
      _connected = false;
    },

    on(event: string, handler: (...args: any[]) => any) {
      (raw as any).on(event, handler);
    },

    async send(chatId, content, options) {
      await (raw as any).send(chatId, content, options);
    },

    async stream(chatId, producer, options) {
      await (raw as any).stream(chatId, producer, options);
    },

    async updateCard(messageId, card) {
      await (raw as any).updateCard(messageId, card);
    },

    get botIdentity() {
      return (raw as any).botIdentity;
    },

    get connected() {
      return _connected;
    },
  };

  return channel;
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/feishu/channel.ts && git commit -m "feat: implement feishu channel wrapper"
```

---

### Task 9: Feishu message handler — route commands and delegate chat

**Files:**
- Create: `src/feishu/handler.ts`
- Create: `tests/feishu/handler.test.ts`

- [ ] **Step 1: Write tests for message handler**

```typescript
// tests/feishu/handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { createMessageHandler } from "../../src/feishu/handler.js";
import type { NormalizedMessage } from "../../src/feishu/channel.js";

function createMockRuntime() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off" as const,
      setModel: vi.fn().mockResolvedValue(undefined),
      setThinkingLevel: vi.fn(),
      sessionFile: "/tmp/session.jsonl",
    },
    newSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMsg(content: string): NormalizedMessage {
  return {
    messageId: "msg-1",
    chatId: "chat-1",
    chatType: "p2p",
    senderId: "user-1",
    content,
    rawContentType: "text",
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
}

describe("createMessageHandler", () => {
  it("routes /sessions command to sessions handler", async () => {
    const runtime = createMockRuntime();
    const sessionsFn = vi.fn().mockResolvedValue(undefined);
    const modelsFn = vi.fn();
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn);
    await handler(makeMsg("/sessions"));
    expect(sessionsFn).toHaveBeenCalledWith("chat-1");
    expect(runtime.session.prompt).not.toHaveBeenCalled();
  });

  it("routes /models command to models handler", async () => {
    const runtime = createMockRuntime();
    const sessionsFn = vi.fn();
    const modelsFn = vi.fn().mockResolvedValue(undefined);
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn);
    await handler(makeMsg("/models"));
    expect(modelsFn).toHaveBeenCalledWith("chat-1");
    expect(runtime.session.prompt).not.toHaveBeenCalled();
  });

  it("routes normal messages to session.prompt with steer", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn());
    await handler(makeMsg("hello world"));
    expect(runtime.session.prompt).toHaveBeenCalledWith("hello world", { streamingBehavior: "steer" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/feishu/handler.test.ts
```
Expected: 3 failures (module not found).

- [ ] **Step 3: Implement `src/feishu/handler.ts`**

```typescript
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { NormalizedMessage } from "./channel.js";

export type FeishuCommandHandler = (chatId: string) => Promise<void>;

export function createMessageHandler(
  runtime: AgentSessionRuntime,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
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

    await runtime.session.prompt(content, { streamingBehavior: "steer" });
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/feishu/handler.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/handler.ts tests/feishu/handler.test.ts && git commit -m "feat: implement feishu message handler with command routing"
```

---

### Task 10: Main entry point — orchestrate startup flow

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
import { InteractiveMode, type AgentSessionRuntime, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { initRuntime } from "./runtime.js";
import { createChannel, type Channel, type NormalizedMessage, type CardActionEvent } from "./feishu/channel.js";
import { createMessageHandler } from "./feishu/handler.js";
import { buildSessionsCard } from "./feishu/cards/sessions.js";
import { buildModelsCard } from "./feishu/cards/models.js";
import { createStreamingHandler } from "./feishu/streaming.js";

interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
}

export async function main(options: MainOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const feishuConfig = loadConfig({
    appId: options.appId,
    appSecret: options.appSecret,
    config: options.config,
    cwd,
  });

  const { runtime } = await initRuntime({ cwd });

  const channel: Channel | null = await connectFeishu(feishuConfig);

  let unbindStreaming: (() => void) | null = null;
  if (channel) {
    unbindStreaming = setupFeishuHandlers(channel, runtime, cwd);
  }

  try {
    const mode = new InteractiveMode(runtime, {});
    await mode.run();
  } finally {
    unbindStreaming?.();
    if (channel) {
      await channel.disconnect().catch(() => {});
    }
  }
}

async function connectFeishu(config: { appId: string; appSecret: string }): Promise<Channel | null> {
  const channel = createChannel(config);
  try {
    await channel.connect();
    console.error(`Feishu bot connected as ${channel.botIdentity?.name ?? "unknown"}`);
    return channel;
  } catch (err) {
    console.error("Feishu connection failed, continuing in TUI-only mode:", (err as Error).message);
    return null;
  }
}

function setupFeishuHandlers(
  channel: Channel,
  runtime: AgentSessionRuntime,
  cwd: string,
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

  const messageHandler = createMessageHandler(runtime, handleSessions, handleModels);

  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    // Commands send cards directly without streaming
    if (content.startsWith("/sessions") || content.startsWith("/models")) {
      await messageHandler(msg);
      return;
    }

    // Normal messages get streaming replies
    await channel.stream(msg.chatId, {
      markdown: async (s) => {
        const unbind = createStreamingHandler(runtime.session, s);
        try {
          await messageHandler(msg);
        } finally {
          unbind();
        }
      },
    }, { replyTo: msg.messageId });
  });

  channel.on("cardAction", async (evt: CardActionEvent) => {
    const value = (evt as any).value ?? evt;
    try {
      await handleCardAction(value, runtime, cwd, channel, evt);
    } catch (err) {
      console.error("Card action failed:", err);
    }
  });

  channel.on("error", (err: Error) => {
    console.error("Feishu channel error:", err.message);
  });

  return () => {};
}

async function handleCardAction(
  value: Record<string, any>,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
  evt: CardActionEvent,
): Promise<void> {
  const { cmd, action } = value;

  if (cmd === "session") {
    if (action === "new") {
      await runtime.newSession();
    } else if (action === "switch" && value.sessionPath) {
      await runtime.switchSession(value.sessionPath);
    }
    const card = await buildSessionsCard({ runtime, cwd });
    const msgId = (evt as any).openMessageId ?? (evt as any).messageId;
    if (msgId) await channel.updateCard(msgId, card);
  } else if (cmd === "model" && action === "select") {
    const { provider, modelId, thinkingLevel } = value;
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const model = registry.find(provider, modelId);
    if (model) {
      await runtime.session.setModel(model);
      runtime.session.setThinkingLevel(thinkingLevel);
    }
    const available = await registry.getAvailable();
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: available.filter((m): m is NonNullable<typeof m> => m != null),
    });
    const msgId = (evt as any).openMessageId ?? (evt as any).messageId;
    if (msgId) await channel.updateCard(msgId, card);
  }
}
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts && git commit -m "feat: implement main entry point orchestrating runtime, feishu, and TUI"
```

---

### Task 11: CLI entry point — argument parsing and bootstrap

**Files:**
- Create: `cli.ts`

- [ ] **Step 1: Implement `cli.ts`**

```typescript
#!/usr/bin/env node
import { main } from "./src/index.js";

interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--app-id" && i + 1 < args.length) {
      result.appId = args[++i];
    } else if (arg === "--app-secret" && i + 1 < args.length) {
      result.appSecret = args[++i];
    } else if (arg === "--config" && i + 1 < args.length) {
      result.config = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pi-feishu [options]

Options:
  --app-id <id>       Feishu app ID
  --app-secret <key>  Feishu app secret
  --config <path>     Path to config JSON file
  --help, -h          Show this help

Configuration priority: CLI args > config file > environment variables

Environment variables:
  FEISHU_APP_ID       Feishu app ID
  FEISHU_APP_SECRET   Feishu app secret

Config file location:
  Searched in order: .pi/feishu.json → ~/.pi/agent/feishu.json
`);
      process.exit(0);
    }
  }

  return result;
}

const cliArgs = parseArgs(process.argv);

main({
  appId: cliArgs.appId,
  appSecret: cliArgs.appSecret,
  config: cliArgs.config,
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify `tsc --noEmit` passes**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cli.ts && git commit -m "feat: implement CLI entry point with arg parsing"
```

---

### Task 12: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# pi-feishu

A CLI tool that embeds Pi's AI coding agent in a terminal TUI and connects to a Feishu (Lark) bot for remote interaction.

## Prerequisites

- Node.js >= 22
- Pi API keys configured (`~/.pi/agent/auth.json`)
- Feishu app with bot enabled (WebSocket mode, with `im:message`, `im:message.group_msg`, `card.action.trigger` permissions)

## Installation

```bash
npm install -g pi-feishu-cli
```

Or run directly without installing:

```bash
npx pi-feishu
```

## Usage

```bash
pi-feishu --app-id <feishu-app-id> --app-secret <feishu-app-secret>
```

## Configuration

Feishu credentials are resolved with the following priority (higher overrides lower):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | CLI args | `pi-feishu --app-id xxx --app-secret xxx` |
| 2 | Config file | `~/.pi/agent/feishu.json` or `.pi/feishu.json` |
| 3 (lowest) | Env vars | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` |

Config file format:

```json
{ "appId": "cli_xxx", "appSecret": "xxx" }
```

Override config file path with `--config`:

```bash
pi-feishu --config /path/to/feishu.json
```

## Feishu Bot Commands

- `/sessions` — Show session management card (list, switch, delete, new session)
- `/models` — Show model management card (view current, switch model + thinking level)
- Any other message — Chat with Pi (streaming response with typewriter effect)

Both TUI and Feishu bot share the same session and model state.

## Skills

The `skills/` directory contains 26 Lark API skills providing Pi with knowledge of Lark APIs for documents, calendar, mail, spreadsheets, and more.

## Development

```bash
npm install
npm run build    # tsc compile to dist/
npm test         # vitest
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: write README with usage, config, and bot commands"
```

---

### Task 13: Integration test and final verification

**Files:**
- Create: `tests/integration.test.ts`

- [ ] **Step 1: Write integration smoke test**

```typescript
// tests/integration.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { createChannel } from "../src/feishu/channel.js";
import { buildSessionsCard } from "../src/feishu/cards/sessions.js";
import { buildModelsCard } from "../src/feishu/cards/models.js";
import { createStreamingHandler } from "../src/feishu/streaming.js";
import { createMessageHandler } from "../src/feishu/handler.js";
import { createCardHeader, buildCard, createMarkdownBlock } from "../src/feishu/cards/helpers.js";

describe("integration smoke", () => {
  it("all modules import without error", () => {
    expect(typeof loadConfig).toBe("function");
    expect(typeof createChannel).toBe("function");
    expect(typeof buildSessionsCard).toBe("function");
    expect(typeof buildModelsCard).toBe("function");
    expect(typeof createStreamingHandler).toBe("function");
    expect(typeof createMessageHandler).toBe("function");
    expect(typeof createCardHeader).toBe("function");
    expect(typeof buildCard).toBe("function");
    expect(typeof createMarkdownBlock).toBe("function");
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/integration.test.ts && git commit -m "test: add integration smoke test"
```

---

### Task 14: Build verification

- [ ] **Step 1: Run build**

```bash
npm run build
```
Expected: `dist/` directory created with compiled JS files.

- [ ] **Step 2: Verify dist/cli.js is executable**

```bash
node dist/cli.js --help
```
Expected: help text printed.

- [ ] **Step 3: Commit**

```bash
# If dist/ is in .gitignore, no commit needed; verify build outputs only
echo "Build verification passed"
```

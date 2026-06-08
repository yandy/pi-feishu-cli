# pi-feishu CLI 参数转发 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使 `pi-feishu` 解析完飞书参数后，将剩余参数透传给 `pi` 的参数处理流程

**Architecture:** 在现有架构基础上增加参数转发层，3 个源文件改动，不改变 `src/feishu/` 下任何代码

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` v0.77.x (deep imports), vitest

---

## File Map

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `cli.ts` | Modify | 两阶段参数解析 |
| `src/runtime.ts` | Modify | 透传 piArgs 到 createAgentSessionServices |
| `src/index.ts` | Modify | session 选择、model/thinking、initialMessage |
| `tests/cli.test.ts` | **Create** | parseArgs 两阶段解析测试 |
| `tests/runtime.test.ts` | Modify | piArgs 透传测试 |
| `tests/index.test.ts` | **Create** | createSessionManager 测试 |
| `tests/feishu/builders.test.ts` | Modify | 移除 resumeMostRecentSession 测试 |

---

### Task 1: TDD — `cli.ts` 两阶段参数解析

**Files:**
- Create: `tests/cli.test.ts`
- Modify: `cli.ts`

- [ ] **Step 1: 导出 `parseArgs` 签名（不改变行为）**

在 `cli.ts` 的 `function parseArgs` 前加 `export`，返回类型改为 `{ cliArgs: CliArgs; remainingArgs: string[] }`，但内部逻辑暂不变（先让测试能 import 并能编译）：

```typescript
export function parseArgs(argv: string[]): { cliArgs: CliArgs; remainingArgs: string[] } {
  const result: CliArgs = {};
  // ... 现有逻辑 ...
  return { cliArgs: result, remainingArgs: [] };  // 先返回空数组
}
```

- [ ] **Step 2: 写测试 — 飞书参数与剩余参数分离**

`tests/cli.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli.js";

describe("parseArgs", () => {
  it("parses feishu args and leaves remaining for pi", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node",
      "pi-feishu",
      "--app-id", "my-app",
      "--app-secret", "my-secret",
      "--model", "claude-sonnet",
      "--thinking", "high",
      "do something",
    ]);

    expect(cliArgs.appId).toBe("my-app");
    expect(cliArgs.appSecret).toBe("my-secret");
    expect(remainingArgs).toEqual([
      "node",
      "pi-feishu",
      "--model", "claude-sonnet",
      "--thinking", "high",
      "do something",
    ]);
  });

  it("passes through all args when no feishu args present", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node",
      "pi-feishu",
      "--model", "claude-sonnet",
    ]);

    expect(cliArgs.appId).toBeUndefined();
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--model", "claude-sonnet"]);
  });

  it("handles --no-bundle-feishu-skills flag", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node", "pi-feishu",
      "--no-bundle-feishu-skills",
      "--model", "sonnet",
    ]);

    expect(cliArgs.noBundleFeishuSkills).toBe(true);
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--model", "sonnet"]);
  });

  it("handles --bot-name value", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node", "pi-feishu",
      "--bot-name", "MyBot",
      "--continue",
    ]);

    expect(cliArgs.botName).toBe("MyBot");
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--continue"]);
  });
});
```

- [ ] **Step 3: 运行测试，验证失败**

```bash
npx vitest run tests/cli.test.ts
```

Expected: 部分测试 FAIL，因为 `remainingArgs` 仍返回空数组。

- [ ] **Step 4: 实现两阶段解析**

修改 `cli.ts` 的 `parseArgs` 函数，用 `Set<number>` 标记已消耗索引，过滤出 `remainingArgs`：

```typescript
import { parseArgs as parsePiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";

interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
  logLevel?: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}

export function parseArgs(argv: string[]): { cliArgs: CliArgs; remainingArgs: string[] } {
  const consumed = new Set<number>();
  const result: CliArgs = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--app-id":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.appId = argv[++i];
        }
        break;
      case "--app-secret":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.appSecret = argv[++i];
        }
        break;
      case "--config":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.config = argv[++i];
        }
        break;
      case "--log-level":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.logLevel = argv[++i];
        }
        break;
      case "--bot-name":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.botName = argv[++i];
        }
        break;
      case "--no-bundle-feishu-skills":
        consumed.add(i);
        result.noBundleFeishuSkills = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  const remainingArgs = argv.filter((_, i) => !consumed.has(i));
  return { cliArgs: result, remainingArgs };
}
```

同时更新底部调用点：

```typescript
const { cliArgs, remainingArgs } = parseArgs(process.argv);
const piArgs = parsePiArgs(remainingArgs);

main({
  appId: cliArgs.appId,
  appSecret: cliArgs.appSecret,
  config: cliArgs.config,
  logLevel: cliArgs.logLevel,
  botName: cliArgs.botName,
  noBundleFeishuSkills: cliArgs.noBundleFeishuSkills,
  piArgs,
  packageRoot,
}).catch(/* ... */);
```

- [ ] **Step 5: 运行测试，验证通过**

```bash
npx vitest run tests/cli.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 6: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add tests/cli.test.ts cli.ts
git commit -m "feat: two-phase CLI arg parsing with pi args passthrough"
```

---

### Task 2: TDD — `src/runtime.ts` piArgs 透传到 services

**Files:**
- Modify: `tests/runtime.test.ts`
- Modify: `src/runtime.ts`

- [ ] **Step 1: 写测试 — piArgs.noSkills 禁用 skill 加载**

在 `tests/runtime.test.ts` 末尾添加：

```typescript
it("respects piArgs.noSkills to disable skill loading", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
  try {
    const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, SKILL_CONTENT);

    const cwd = process.cwd();
    const result = await initRuntime({
      cwd,
      packageRoot: tmpDir,
      piArgs: {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
        noSkills: true,
      },
    });

    const loaded = result.runtime.services.resourceLoader.getSkills();
    const names = loaded.skills.map((s) => s.name);
    expect(names).not.toContain("test-skill");
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}, 30000);
```

- [ ] **Step 2: 运行测试，验证失败**

```bash
npx vitest run tests/runtime.test.ts -t "noSkills"
```

Expected: FAIL，因为 `piArgs.noSkills` 尚未被应用。

- [ ] **Step 3: 实现 piArgs 透传**

修改 `src/runtime.ts`：

添加 imports：

```typescript
import { isLocalPath, resolvePath } from "@earendil-works/pi-coding-agent/dist/utils/paths.js";
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";
```

更新 `InitRuntimeOptions`：

```typescript
export interface InitRuntimeOptions {
  cwd: string;
  agentDir?: string;
  packageRoot?: string;
  noBundleFeishuSkills?: boolean;
  piArgs?: PiArgs;
  sessionManager?: SessionManager;
}
```

修改 `initRuntime` 函数体中 `createAgentSessionServices` 调用：

```typescript
export async function initRuntime(
  options: InitRuntimeOptions,
): Promise<InitRuntimeResult> {
  const cwd = resolve(options.cwd);
  const agentDir = options.agentDir ?? getAgentDir();
  const packageRoot = options.packageRoot ?? cwd;
  const noBundle = options.noBundleFeishuSkills ?? false;
  const skillsDir = join(packageRoot, "skills");
  const baseSkillPaths = noBundle ? [] : [skillsDir];
  const parsed = options.piArgs;

  function resolveCLIPaths(paths?: string[]): string[] | undefined {
    if (!paths || paths.length === 0) return undefined;
    return paths.map((p) => (isLocalPath(p) ? resolvePath(p, cwd) : p));
  }

  const additionalSkillPaths = [
    ...baseSkillPaths,
    ...(parsed?.skills ? resolveCLIPaths(parsed.skills) ?? [] : []),
  ];

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      extensionFlagValues: parsed?.unknownFlags,
      resourceLoaderOptions: {
        additionalSkillPaths,
        additionalExtensionPaths: resolveCLIPaths(parsed?.extensions),
        additionalPromptTemplatePaths: resolveCLIPaths(parsed?.promptTemplates),
        additionalThemePaths: resolveCLIPaths(parsed?.themes),
        noExtensions: parsed?.noExtensions,
        noSkills: parsed?.noSkills,
        noPromptTemplates: parsed?.noPromptTemplates,
        noThemes: parsed?.noThemes,
        noContextFiles: parsed?.noContextFiles,
        systemPrompt: parsed?.systemPrompt,
        appendSystemPrompt: parsed?.appendSystemPrompt,
        extensionFactories: [
          /* 现有的 send_file_to_chat 工具定义，保持不变 */
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const sm = options.sessionManager ?? SessionManager.create(cwd);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sm.getCwd(),
    agentDir,
    sessionManager: sm,
  });

  return { runtime };
}
```

- [ ] **Step 4: 运行测试，验证通过**

```bash
npx vitest run tests/runtime.test.ts -t "noSkills"
```

Expected: PASS。

- [ ] **Step 5: 运行全部测试**

```bash
npm test
```

Expected: 所有已有测试继续通过（`piArgs` 为 optional）。

- [ ] **Step 6: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add tests/runtime.test.ts src/runtime.ts
git commit -m "feat: forward piArgs to createAgentSessionServices"
```

---

### Task 3: TDD — `src/index.ts` `createSessionManager`

**Files:**
- Create: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 写测试 — createSessionManager 按参数返回正确的 SessionManager**

`tests/index.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// Import the function - it will be exported from index.ts
import { createSessionManager } from "../src/index.js";

describe("createSessionManager", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) {
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  function setupCwd(): string {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    return tmpCwd;
  }

  it("returns SessionManager.create when parsed is undefined", () => {
    const cwd = setupCwd();
    const sm = createSessionManager(undefined, cwd);
    expect(sm).toBeDefined();
    expect(sm.getCwd()).toBe(cwd);
  });

  it("returns SessionManager.create when no session flags present", () => {
    const cwd = setupCwd();
    const sm = createSessionManager({
      messages: [],
      fileArgs: [],
      unknownFlags: new Map(),
      diagnostics: [],
      model: "sonnet",
    }, cwd);
    expect(sm).toBeDefined();
  });

  it("returns SessionManager.continueRecent when --continue is set", () => {
    const cwd = setupCwd();
    const sm = createSessionManager({
      messages: [],
      fileArgs: [],
      unknownFlags: new Map(),
      diagnostics: [],
      continue: true,
    }, cwd);
    expect(sm).toBeDefined();
    expect(sm.isPersisted()).toBe(true);
  });

  it("returns SessionManager.inMemory when --no-session is set", () => {
    const cwd = setupCwd();
    const sm = createSessionManager({
      messages: [],
      fileArgs: [],
      unknownFlags: new Map(),
      diagnostics: [],
      noSession: true,
    }, cwd);
    expect(sm).toBeDefined();
    expect(sm.getSessionFile()).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，验证失败**

```bash
npx vitest run tests/index.test.ts
```

Expected: FAIL，`createSessionManager` 尚未导出。

- [ ] **Step 3: 实现 createSessionManager 并导出**

在 `src/index.ts` 中添加并 export：

```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";

export function createSessionManager(
  parsed: PiArgs | undefined,
  cwd: string,
): SessionManager {
  if (!parsed) return SessionManager.create(cwd);
  if (parsed.fork) {
    return SessionManager.forkFrom(parsed.fork, cwd);
  }
  if (parsed.session) {
    return SessionManager.open(parsed.session);
  }
  if (parsed.sessionId) {
    return SessionManager.create(cwd, undefined, { id: parsed.sessionId });
  }
  if (parsed.continue) {
    return SessionManager.continueRecent(cwd);
  }
  if (parsed.noSession) {
    return SessionManager.inMemory(cwd);
  }
  return SessionManager.create(cwd);
}
```

更新 `MainOptions`：

```typescript
export interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  logLevel?: string;
  packageRoot?: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
  piArgs?: PiArgs;
}
```

- [ ] **Step 4: 运行测试，验证通过**

```bash
npx vitest run tests/index.test.ts
```

Expected: PASS。

- [ ] **Step 5: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add tests/index.test.ts src/index.ts
git commit -m "feat: add createSessionManager based on pi args"
```

---

### Task 4: TDD — `src/index.ts` piArgs 集成到 `main()` 流程

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 补充测试 — model/thinking 从 piArgs 设置**

在 `tests/index.test.ts` 中添加（需要能访问 runtime 来验证 model 被设置）。由于 `main()` 是集成点且依赖外部飞书服务，我们对 `createSessionManager` 的验证已覆盖 session 逻辑，model/thinking 的集成通过冒烟测试覆盖。

目前 Task 3 的测试已通过，Task 4 主要是实现代码。加入类型检查作为验证。

- [ ] **Step 2: 实现 — 在 main() 中集成 piArgs**

修改 `src/index.ts` 的 `main()` 函数。在 `loadConfig` 和 `initRuntime` 之间插入 piArgs 处理逻辑。

找到现有代码：

```typescript
  const { runtime } = await initRuntime({
    cwd,
    packageRoot: options.packageRoot,
    noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills,
  });

  await resumeMostRecentSession(runtime, cwd);
```

替换为：

```typescript
  const parsed = options.piArgs;

  const sessionManager = createSessionManager(parsed, cwd);

  const { runtime } = await initRuntime({
    cwd,
    packageRoot: options.packageRoot,
    noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills,
    piArgs: parsed,
    sessionManager,
  });

  if (parsed?.model || parsed?.provider) {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      modelRegistry: registry,
    });
    if (resolved.warning) {
      console.error(`Warning: ${resolved.warning}`);
    }
    if (resolved.model) {
      await runtime.session.setModel(resolved.model);
    }
    if (resolved.thinkingLevel) {
      runtime.session.setThinkingLevel(resolved.thinkingLevel);
    }
  }

  if (parsed?.thinking) {
    runtime.session.setThinkingLevel(parsed.thinking);
  }
```

在 `const channel: Channel | null = await connectFeishu(...)` 之前插入 initialMessage 构建：

```typescript
  let initialMessage: string | undefined;
  let initialImages: unknown[] | undefined;

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

更新 `InteractiveMode` 构造：

```typescript
    const mode = new InteractiveMode(runtime, {
      initialMessage,
      initialImages,
      initialMessages: parsed?.messages,
      verbose: parsed?.verbose,
    });
```

添加顶部的 imports：

```typescript
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent/dist/cli/args.js";
import { buildInitialMessage } from "@earendil-works/pi-coding-agent/dist/cli/initial-message.js";
import { processFileArguments } from "@earendil-works/pi-coding-agent/dist/cli/file-processor.js";
import { resolveCliModel } from "@earendil-works/pi-coding-agent/dist/core/model-resolver.js";
```

- [ ] **Step 3: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 4: 运行全部测试**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: apply piArgs to session, model, thinking, and InteractiveMode"
```

---

### Task 5: 清理 — 移除 `resumeMostRecentSession` 测试

**Files:**
- Modify: `tests/feishu/builders.test.ts`

- [ ] **Step 1: 移除相关测试用例和 import**

在 `tests/feishu/builders.test.ts` 中：

1. 移除第 10 行 `import { resumeMostRecentSession } from "../../src/index.js";`
2. 移除第 121-151 行（`"resumeMostRecentSession loads persisted session from previous run"`）
3. 移除第 194-204 行（`"resumeMostRecentSession returns false when no pre-existing sessions"`）
4. 检查 `SessionManager` import 是否仍被使用（第 141 行用到），保留它

- [ ] **Step 2: 运行测试**

```bash
npm test
```

Expected: 所有剩余测试通过。

- [ ] **Step 3: Commit**

```bash
git add tests/feishu/builders.test.ts
git commit -m "test: remove resumeMostRecentSession tests"
```

---

### Task 6: 集成验证

- [ ] **Step 1: 运行完整测试套件**

```bash
npm test
```

- [ ] **Step 2: 运行 lint**

```bash
npm run lint
```

- [ ] **Step 3: 构建**

```bash
npm run build
```

- [ ] **Step 4: 冒烟 — 帮助信息**

```bash
node dist/cli.js --help
```

Expected: 显示 pi-feishu 帮助。

- [ ] **Step 5: 冒烟 — 参数不报错**

```bash
node dist/cli.js --app-id x --app-secret x --model unknown --no-bundle-feishu-skills 2>&1 || true
```

Expected: 提示凭证无效但参数解析正常。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: integration verification passed"
```

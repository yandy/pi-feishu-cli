# pi 文件发送到飞书聊天 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 pi 通过 `send_file_to_chat` 工具将生成的文件直接发送到飞书聊天窗口。

**Architecture:** 新增 `FeishuContext` 模块管理当前对话上下文；在 `runtime.ts` 中注册 `send_file_to_chat` 自定义工具（含 `promptGuidelines`）；`Channel` 接口新增 `sendFile`/`sendImage` 方法（委托 SDK 内建文件上传能力）；附带将 `skillsOverride` 简化为 `additionalSkillPaths`。

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-coding-agent`, `@larksuiteoapi/node-sdk`

---

### Task 1: FeishuContext 模块（新文件，TDD）

**Files:**
- Create: `src/feishu/context.ts`
- Create: `tests/feishu/context.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, expect, it } from "vitest";
import { getFeishuContext, setFeishuContext } from "../../src/feishu/context.js";

describe("FeishuContext", () => {
  it("returns null before any set", () => {
    expect(getFeishuContext()).toBeNull();
  });

  it("returns the value after set", () => {
    const fakeChannel = {} as any;
    setFeishuContext({ chatId: "chat-1", channel: fakeChannel });
    expect(getFeishuContext()).toEqual({ chatId: "chat-1", channel: fakeChannel });
  });

  it("returns null after set-to-null", () => {
    const fakeChannel = {} as any;
    setFeishuContext({ chatId: "chat-1", channel: fakeChannel });
    setFeishuContext(null);
    expect(getFeishuContext()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/context.test.ts`
Expected: FAIL — module not found `../../src/feishu/context.js`

- [ ] **Step 3: 编写最小实现**

```typescript
import type { Channel } from "./channel.js";

export interface FeishuContextValue {
  chatId: string;
  channel: Channel;
}

let current: FeishuContextValue | null = null;

export function setFeishuContext(ctx: FeishuContextValue | null): void {
  current = ctx;
}

export function getFeishuContext(): FeishuContextValue | null {
  return current;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/context.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/context.ts tests/feishu/context.test.ts
git commit -m "feat: add FeishuContext module for tracking current chat context"
```

---

### Task 2: Channel sendFile / sendImage + allowedFileDirs（TDD）

**Files:**
- Modify: `src/feishu/channel.ts`
- Create: `tests/feishu/channel-send-file.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLarkChannel } from "@larksuiteoapi/node-sdk";
import { createChannel } from "../../src/feishu/channel.js";

const mockSend = vi.fn();
const mockRawChannel = {
  on: vi.fn(),
  botIdentity: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: mockSend,
  stream: vi.fn(),
  updateCard: vi.fn(),
  get connected() {
    return false;
  },
  dispatcher: { register: vi.fn().mockReturnThis() },
  rawClient: {
    request: vi.fn(),
    im: { v1: { messageResource: { get: vi.fn() } } },
  },
};

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: vi.fn(() => mockRawChannel),
  LoggerLevel: { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 },
}));

afterEach(() => {
  mockSend.mockClear();
  (createLarkChannel as any).mockClear();
});

describe("sendFile", () => {
  it("calls raw.send with file source and custom name", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    await channel.sendFile("chat-1", __filename, "report.ts");

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      file: { source: __filename, fileName: "report.ts" },
    });
  });

  it("derives fileName from path when not provided", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    const baseName = __filename.split("/").pop();
    await channel.sendFile("chat-1", __filename);

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      file: { source: __filename, fileName: baseName },
    });
  });
});

describe("sendImage", () => {
  it("calls raw.send with image source", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    await channel.sendImage("chat-1", __filename);

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      image: { source: __filename },
    });
  });
});

describe("allowedFileDirs", () => {
  it("passes outbound.allowedFileDirs when cwd is provided", () => {
    createChannel({ appId: "test", appSecret: "secret", cwd: "/home/user/project" });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        outbound: { allowedFileDirs: ["/home/user/project"] },
      }),
    );
  });

  it("omits outbound when cwd is not provided", () => {
    createChannel({ appId: "test", appSecret: "secret" });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.not.objectContaining({ outbound: expect.anything() }),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/channel-send-file.test.ts`
Expected: FAIL — `Property 'sendFile' does not exist on type 'Channel'` / `'sendImage'` / `allowedFileDirs` check returns false

- [ ] **Step 3: 实现 ChannelOptions.cwd、allowedFileDirs 配置、sendFile/sendImage 方法**

`ChannelOptions` 接口加 `cwd` 字段（`channel.ts:21-25`）：

```typescript
export interface ChannelOptions {
  appId: string;
  appSecret: string;
  logLevel?: string;
  cwd?: string;
}
```

`createLarkChannel` 调用加 `outbound.allowedFileDirs`（`channel.ts` `createChannel` 函数中）：

```typescript
const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: true, dmMode: "open" },
    includeRawEvent: true,
    ...(options.cwd ? { outbound: { allowedFileDirs: [options.cwd] } } : {}),
}) as unknown as RawLarkChannel;
```

`Channel` 接口加方法签名（在 `send` 附近）：

```typescript
sendFile(chatId: string, filePath: string, fileName?: string): Promise<void>;
sendImage(chatId: string, imagePath: string): Promise<void>;
```

返回的 `channel` 对象中实现（`updateCardByToken` 之后）：

```typescript
async sendFile(chatId: string, filePath: string, fileName?: string) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const stat = await fs.stat(filePath);
    const name = fileName ?? path.basename(filePath);

    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
            `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，飞书文件消息上限为 20MB`,
        );
    }

    await raw.send(chatId, {
        file: { source: filePath, fileName: name },
    });
},

async sendImage(chatId: string, imagePath: string) {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(imagePath);

    const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
    if (stat.size > MAX_IMAGE_SIZE) {
        throw new Error(
            `图片过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，飞书图片消息上限为 10MB`,
        );
    }

    await raw.send(chatId, {
        image: { source: imagePath },
    });
},
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/channel-send-file.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: 确认已有测试未破坏**

Run: `npx vitest run tests/feishu/channel.test.ts`
Expected: existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add src/feishu/channel.ts tests/feishu/channel-send-file.test.ts
git commit -m "feat: add sendFile/sendImage to Channel with size check and allowedFileDirs config"
```

---

### Task 3: Runtime — skills 改为 additionalSkillPaths（TDD）

**Files:**
- Modify: `src/runtime.ts`
- Modify: `tests/runtime.test.ts`

> 先改测试以匹配新行为，再改实现。

- [ ] **Step 1: 更新已有测试，使其匹配 `additionalSkillPaths` 追加行为**

当前 `tests/runtime.test.ts` 第 60-81 行的测试 "loads bundled skills from packageRoot, not from cwd" 依赖 `skillsOverride` 的**完全替换**行为来断言 `lark-im` 不在列表中。改为 `additionalSkillPaths` 后这是追加行为，断言需调整——改为断言 `test-skill` 在列表中（来自 `additionalSkillPaths`），不关心 `lark-im` 是否存在（可能来自其他来源）：

```typescript
// 第 60-81 行的测试，将最后两句断言改为：
const names = loaded.skills.map((s) => s.name);
expect(names).toContain("test-skill");
// 不再断言 notContain("lark-im")，因为 additionalSkillPaths 是追加
```

- [ ] **Step 2: 运行测试确认失败（当前 skillsOverride 仍导致 lark-im 不在列表中，但测试已不再断言）**

Run: `npx vitest run tests/runtime.test.ts`
Expected: 4 tests PASS（仅改了断言，旧实现仍兼容新断言）

- [ ] **Step 3: 实现 `additionalSkillPaths` 替换 `skillsOverride`**

在 `src/runtime.ts` 中：

删除的 import（第 1 行）：
```typescript
// 删除以下 import
import { readdirSync, statSync } from "node:fs";
```

从 `@earendil-works/pi-coding-agent` import 中删除未使用的：
```typescript
// 删除: createSyntheticSourceInfo, type ResourceDiagnostic, type Skill
```

删除 `loadSkillsFromDir` 函数（第 27-60 行全部）。

替换 `customSkills` + `skillsOverride` 变量（第 69-79 行）为：
```typescript
const skillsDir = join(packageRoot, "skills");
const additionalSkillPaths = noBundle ? [] : [skillsDir];
```

替换 `resourceLoaderOptions: { skillsOverride }` 为：
```typescript
resourceLoaderOptions: { additionalSkillPaths },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/runtime.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/runtime.test.ts
git commit -m "refactor: replace skillsOverride with additionalSkillPaths for append behavior"
```

---

### Task 4: Runtime — 注册 send_file_to_chat 工具（TDD）

**Files:**
- Modify: `src/runtime.ts`
- Create: `tests/feishu/send-file-tool.test.ts`

- [ ] **Step 1: 编写工具注册测试**

```typescript
import { describe, expect, it } from "vitest";
import { initRuntime } from "../../src/runtime.js";

describe("send_file_to_chat tool registration", () => {
  it("initRuntime registers send_file_to_chat tool via extension", async () => {
    const { runtime } = await initRuntime({ cwd: process.cwd() });

    const extResult = runtime.services.resourceLoader.getExtensions();
    const allTools = extResult.extensions.flatMap(
      (ext: any) => ext.tools?.map((t: any) => t.name) ?? [],
    );
    expect(allTools).toContain("send_file_to_chat");
  }, 30000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/send-file-tool.test.ts`
Expected: FAIL — `send_file_to_chat` not found in tool list

- [ ] **Step 3: 在 `runtime.ts` 中注册工具**

增加 import（第 1-13 行区域）：
```typescript
import {
  // ... 已有 imports ...
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getFeishuContext } from "./feishu/context.js";
```

在 `resourceLoaderOptions` 中追加 `extensionFactories`（替换 `resourceLoaderOptions: { additionalSkillPaths }` 为）：

```typescript
resourceLoaderOptions: {
  additionalSkillPaths,
  extensionFactories: [
    (pi: ExtensionAPI) => {
      pi.registerTool({
        name: "send_file_to_chat",
        label: "发送文件到飞书聊天",
        description:
          "发送本地文件到当前的飞书聊天窗口。仅当处于飞书对话环境中时才可使用。",
        promptGuidelines: [
          "当你生成了需要交付给用户的文件时（如 Word文档 .docx、图片 .png/.jpg、PDF .pdf、Excel表格 .xlsx 等），请主动调用 send_file_to_chat 工具将文件发送到聊天窗口。",
          "此工具只能发送位于当前工作目录（或子目录）中的文件。如果文件在 /tmp 等其他位置，先用 bash 工具将其复制或移动到当前目录下。",
          "发送前确认文件已成功创建且路径正确。",
          "文件名应能清楚表达文件内容。",
        ],
        parameters: Type.Object({
          filePath: Type.String({ description: "要发送的本地文件路径" }),
          fileName: Type.Optional(
            Type.String({
              description: "显示给用户的文件名，不传则用文件路径中的文件名",
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const ctx = getFeishuContext();
          if (!ctx) {
            return {
              content: [
                {
                  type: "text",
                  text: "当前不在飞书对话中，无法发送文件。请在飞书聊天中直接请求发送。如果需要在 TUI 终端中查看文件，请直接告知文件路径。",
                },
              ],
              details: {},
            };
          }
          try {
            await ctx.channel.sendFile(
              ctx.chatId,
              params.filePath,
              params.fileName,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `文件 "${params.fileName ?? params.filePath}" 已发送到飞书聊天窗口。`,
                },
              ],
              details: {},
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `文件发送失败: ${(err as Error).message}`,
                },
              ],
              details: {},
            };
          }
        },
      });
    },
  ],
},
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/send-file-tool.test.ts`
Expected: 1 test PASS

- [ ] **Step 5: 确认已有测试未破坏**

Run: `npx vitest run tests/runtime.test.ts`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/runtime.ts tests/feishu/send-file-tool.test.ts
git commit -m "feat: register send_file_to_chat custom tool for sending files to Feishu chat"
```

---

### Task 5: index.ts 接入 FeishuContext + steer 注释（TDD）

**Files:**
- Modify: `src/index.ts`
- Modify: `src/feishu/handler.ts`
- Create 或 Modify 相关测试

`setFeishuContext` 的调用是副作用，没有返回值。用集成测试验证：模拟飞书消息到达后 context 已设置。但 `index.ts` 的 `setupFeishuHandlers` 构造了完整的事件处理器，难以单元测试。这里改为**先实现、用已有集成测试 + 类型检查验证**。

- [ ] **Step 1: 增加 import**

`src/index.ts` 增加：
```typescript
import { setFeishuContext } from "./feishu/context.js";
```

- [ ] **Step 2: 在消息 handler 中调用 `setFeishuContext`**

在 `setupFeishuHandlers` 函数中，`channel.on("message", ...)` 回调内。定位到第 162-189 行，命令判断 (`if content.startsWith(...)`) 后面、`let attachments` 前面，插入：

```typescript
// 为非命令消息设置飞书上下文
setFeishuContext({ chatId: msg.chatId, channel });
```

完整的位置应为（约第 170 行，"return;" 之后，"let attachments" 之前）：

- [ ] **Step 3: 在 handler.ts 加 steer 注释**

`src/feishu/handler.ts` 第 43-49 行，`streamingBehavior: "steer"` 上方加入注释块：

```typescript
await runtime.session.prompt(fullText, {
    // 注意：此处 streamingBehavior 使用 "steer"，
    // 但由于 channel.stream() 内部阻塞在 markdown producer 上，
    // 而 producer 又阻塞在 session.prompt() 上，消息 handler 会被全程阻塞。
    // 因此实际效果是串行处理，steer 不会真正触发。
    // 保留 "steer" 作为未来正确实现流式中断时的占位参数。
    streamingBehavior: "steer",
    // ...
});
```

- [ ] **Step 4: 类型检查**

Run: `npm run check`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/feishu/handler.ts
git commit -m "feat: wire FeishuContext into message handler; add steer blocking note"
```

---

### Task 6: 最终验证

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors（biome 自动修复后 clean）

- [ ] **Step 2: 全部测试**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 3: Commit（如有 lint 自动修复）**

```bash
git add -A
git commit -m "chore: final type check, lint, and test verification"
```

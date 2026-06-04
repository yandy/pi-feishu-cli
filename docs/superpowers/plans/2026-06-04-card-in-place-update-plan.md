# 卡片交互原位更新（延时更新）实施方案 (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卡片交互从"回复新卡片"改为"延时 API 原位更新"，使用 `POST /open-apis/interactive/v1/card/update` + token。

**Architecture:** `channel.ts` 新增 `updateCardByToken(token, card)` 方法 + `includeRawEvent: true`；`index.ts` 重写 `handleCardAction` 签名，从 `CardActionEvent.raw` 提取 token 调用延时更新。SDK 未封装 `POST /open-apis/interactive/v1/card/update`，通过 `rawClient.request()` 直接调用。

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk` v1.66, vitest

---

### File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/feishu/channel.ts` | Channel 接口 + 延时更新方法 | 新增 `updateCardByToken`、`RawLarkChannel.rawClient` 类型扩展、`includeRawEvent: true`、JSDoc 场景说明 |
| `src/index.ts` | cardAction 事件处理 + handleCardAction | 重写签名、提取 token、调用 `updateCardByToken`、清理旧逻辑；export `handleCardAction` |
| `tests/feishu/channel.test.ts` | updateCardByToken 单元测试 | 新增 `rawClient.request` mock + 测试用例 |
| `tests/feishu/wiring.test.ts` | handleCardAction TDD 测试 | 新增 cardAction 分支测试 |

---

### Task 1: RED — `channel.test.ts` 添加 `updateCardByToken` 测试

**Files:**
- Modify: `tests/feishu/channel.test.ts`

- [ ] **Step 1: 在 mockRawChannel.rawClient 中加 `request` mock**

在 `mockRawChannel` 对象（约第 21-23 行）中，给 `rawClient` 添加 `request` 属性：

```typescript
rawClient: {
    request: vi.fn().mockResolvedValue({ code: 0, msg: "ok" }), // 新增
    im: { v1: { messageResource: { get: vi.fn() } } },
},
```

- [ ] **Step 2: 添加 RED 测试 — `updateCardByToken` 尚未实现，预期找不到方法**

```typescript
describe("updateCardByToken", () => {
    it("calls rawClient.request with correct params for delayed card update", async () => {
        const channel = createChannel({ appId: "test", appSecret: "secret" });
        mockRawChannel.rawClient.request.mockClear();

        const card = { schema: "2.0", header: { title: { tag: "plain_text", content: "test" } }, body: { elements: [] } };
        await channel.updateCardByToken("c-token-abc", card);

        expect(mockRawChannel.rawClient.request).toHaveBeenCalledWith({
            url: "/open-apis/interactive/v1/card/update",
            method: "POST",
            data: { token: "c-token-abc", card },
        });
    });
});
```

- [ ] **Step 3: 运行测试，预期 FAIL（方法未定义）**

```bash
uv run npx vitest run tests/feishu/channel.test.ts -t "updateCardByToken"
```

预期：TypeScript 编译错误或运行时 `channel.updateCardByToken is not a function`

- [ ] **Step 4: Commit**

```bash
git add tests/feishu/channel.test.ts
git commit -m "test: add RED test for channel.updateCardByToken"
```

---

### Task 2: GREEN — `channel.ts` 实现 `updateCardByToken`

**Files:**
- Modify: `src/feishu/channel.ts`

- [ ] **Step 1: 扩展 `RawLarkChannel.rawClient` 类型，添加 `request` 方法签名（约第 46-59 行）**

```typescript
readonly rawClient: {
    request(opts: {
        url: string;
        method: string;
        data?: unknown;
    }): Promise<Record<string, unknown>>;
    im: {
        v1: {
            messageResource: {
                get(params: {
                    path: Record<string, string>;
                    params: Record<string, string>;
                }): Promise<{
                    getReadableStream(): AsyncIterable<Buffer | string>;
                }>;
            };
        };
    };
};
```

- [ ] **Step 2: `Channel` 接口添加带 JSDoc 的 `updateCard` 和 `updateCardByToken`（约第 88 行处）**

```typescript
/** 主动更新卡片（无需用户交互），通过 message_id 直接替换卡片内容。 */
updateCard(messageId: string, card: unknown): Promise<void>;
/** 延时更新卡片（需用户交互触发），通过回调中的 token 替换卡片内容。token 有效期 30 分钟。 */
updateCardByToken(token: string, card: unknown): Promise<void>;
```

- [ ] **Step 3: `createChannel` 中 `createLarkChannel` 加 `includeRawEvent: true`（约第 96 行）**

将：
```typescript
const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: true, dmMode: "open" },
  }) as unknown as RawLarkChannel;
```

改为：
```typescript
const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: true, dmMode: "open" },
    includeRawEvent: true,
  }) as unknown as RawLarkChannel;
```

- [ ] **Step 4: `createChannel` 中实现 `updateCardByToken`（约第 154 行 `updateCard` 实现之后）**

```typescript
async updateCard(messageId: string, card: unknown) {
    await raw.updateCard(messageId, card);
},

async updateCardByToken(token: string, card: unknown) {
    await raw.rawClient.request({
        url: '/open-apis/interactive/v1/card/update',
        method: 'POST',
        data: { token, card },
    });
},
```

- [ ] **Step 5: 运行测试，预期 PASS**

```bash
uv run npx vitest run tests/feishu/channel.test.ts -t "updateCardByToken"
```

预期：PASS

- [ ] **Step 6: 运行全部测试，确认无回归**

```bash
uv run npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/feishu/channel.ts
git commit -m "feat: add channel.updateCardByToken for delayed card update"
```

---

### Task 3: RED — `wiring.test.ts` 添加 `handleCardAction` TDD 测试

**Files:**
- Modify: `tests/feishu/wiring.test.ts`
- Modify: `src/index.ts`（导出 `handleCardAction`，供测试引用）

- [ ] **Step 1: 导出 `handleCardAction` 和导入类型（`index.ts`）**

在 `setupFeishuHandlers` 之前，将 `handleCardAction` 声明为 `export`：

```typescript
export async function handleCardAction(
  evt: CardActionEvent,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
): Promise<void> {
```

（当前签名不同，但为让测试先 FAIL，先改签名让 TS 编译通过即可。函数体暂时不动，稍后 Task 4 会完整重写。）

实际上，为了让 RED 测试能编译通过（先测试接口契约，再实现），先在 `index.ts` 中把**旧函数重命名**为 `handleCardAction_old`，然后**新增一个桩函数**：

```typescript
// 桩函数 — 将在 Task 4 实现
export async function handleCardAction(
  _evt: CardActionEvent,
  _runtime: AgentSessionRuntime,
  _cwd: string,
  _channel: Channel,
): Promise<void> {
  // 暂未实现
}
```

同时保留旧函数供现有 cardAction handler 继续工作：

```typescript
async function handleCardActionOld(
  value: Record<string, any>,
  messageId: string | undefined,
  chatId: string | undefined,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
): Promise<void> {
  // ... 旧逻辑（不变，从原 handleCardAction 改名）...
}
```

并将 cardAction 回调中的调用改为 `handleCardActionOld`。

- [ ] **Step 2: 更新 `createMockChannel` 添加 `updateCardByToken`**

在 `tests/feishu/wiring.test.ts` 的 `createMockChannel()` 中（约第 28-45 行），添加：

```typescript
updateCardByToken: vi.fn(),  // 新增，放在 updateCard 之后
```

- [ ] **Step 3: 添加 RED 测试 — `handleCardAction` session 分支**

```typescript
import { handleCardAction } from "../../src/index.js";

describe("handleCardAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates card by token on session switch", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    const evt = {
      messageId: "msg-1",
      chatId: "chat-1",
      operator: { openId: "ou-1" },
      action: {
        value: { cmd: "session", action: "switch", sessionPath: "/tmp/s.json" },
        tag: "button",
      },
      raw: { token: "c-token-abc" },
    };

    await handleCardAction(evt as any, runtime as any, "/tmp/cwd", channel as any);

    expect(runtime.switchSession).toHaveBeenCalledWith("/tmp/s.json");
    expect(channel.updateCardByToken).toHaveBeenCalledWith(
      "c-token-abc",
      expect.objectContaining({ schema: "2.0" }),
    );
  });

  it("updates card by token on model select", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    const evt = {
      messageId: "msg-2",
      chatId: "chat-1",
      operator: { openId: "ou-1" },
      action: {
        value: { cmd: "model", action: "select", provider: "openai", modelId: "gpt-4", thinkingLevel: "high" },
        tag: "button",
      },
      raw: { event: { token: "c-token-def" } },  // token 在 event.token 路径
    };

    await handleCardAction(evt as any, runtime as any, "/tmp/cwd", channel as any);

    expect(channel.updateCardByToken).toHaveBeenCalledWith(
      "c-token-def",
      expect.objectContaining({ schema: "2.0" }),
    );
  });

  it("updates card by token on help → sessions", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    const evt = {
      messageId: "msg-3",
      chatId: "chat-1",
      operator: { openId: "ou-1" },
      action: {
        value: { cmd: "help", action: "sessions" },
        tag: "button",
      },
      raw: { token: "c-token-ghi" },
    };

    await handleCardAction(evt as any, runtime as any, "/tmp/cwd", channel as any);

    expect(channel.updateCardByToken).toHaveBeenCalledWith(
      "c-token-ghi",
      expect.objectContaining({ schema: "2.0" }),
    );
  });

  it("does not fail when token is missing", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    const evt = {
      messageId: "msg-4",
      chatId: "chat-1",
      operator: { openId: "ou-1" },
      action: {
        value: { cmd: "session", action: "switch", sessionPath: "/tmp/s.json" },
        tag: "button",
      },
      raw: {},  // no token
    };

    await handleCardAction(evt as any, runtime as any, "/tmp/cwd", channel as any);

    expect(runtime.switchSession).toHaveBeenCalledWith("/tmp/s.json");
    expect(channel.updateCardByToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 运行测试，预期 FAIL（桩函数不执行业务逻辑）**

```bash
uv run npx vitest run tests/feishu/wiring.test.ts -t "handleCardAction"
```

预期：FAIL — 桩函数未执行业务逻辑，`switchSession` 和 `updateCardByToken` 未被调用。

- [ ] **Step 5: Commit**

```bash
git add tests/feishu/wiring.test.ts src/index.ts
git commit -m "test: add RED tests for handleCardAction, export stub"
```

---

### Task 4: GREEN — `index.ts` 实现 `handleCardAction` 并完成清理

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 用完整实现替换 `handleCardAction` 桩函数**

```typescript
export async function handleCardAction(
  evt: CardActionEvent,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
): Promise<void> {
  const value = (evt?.action?.value ?? {}) as Record<string, any>;
  const raw = evt?.raw as Record<string, any> | undefined;
  const token: string | undefined = raw?.event?.token ?? raw?.token;
  const { cmd, action } = value;

  if (cmd === "help") {
    if (action === "sessions") {
      const card = await buildSessionsCard({ runtime, cwd });
      if (token) await channel.updateCardByToken(token, card);
    } else if (action === "models") {
      const authStorage = AuthStorage.create();
      const registry = ModelRegistry.create(authStorage);
      const available = await registry.getAvailable();
      const card = await buildModelsCard({
        session: runtime.session,
        availableModels: available.filter(
          (m): m is NonNullable<typeof m> => m != null,
        ),
      });
      if (token) await channel.updateCardByToken(token, card);
    }
    return;
  }

  if (cmd === "session") {
    if (action === "new") {
      await runtime.newSession();
    } else if (action === "switch" && value.sessionPath) {
      await runtime.switchSession(value.sessionPath);
    } else if (action === "delete" && value.sessionPath) {
      if (value.sessionPath !== runtime.session.sessionFile) {
        await unlink(value.sessionPath);
      }
    }
    const card = await buildSessionsCard({ runtime, cwd });
    if (token) await channel.updateCardByToken(token, card);
    return;
  }

  if (cmd === "model" && action === "select") {
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
      availableModels: available.filter(
        (m): m is NonNullable<typeof m> => m != null,
      ),
    });
    if (token) await channel.updateCardByToken(token, card);
    return;
  }
}
```

- [ ] **Step 2: 将 cardAction 回调改为使用新的 `handleCardAction`（原行 210-228）**

```typescript
channel.on("cardAction", async (evt: CardActionEvent) => {
    try {
      await handleCardAction(evt, runtime, cwd, channel);
    } catch (err) {
      console.error("Card action failed:", err);
    }
  });
```

- [ ] **Step 3: 删除 `handleCardActionOld` 函数和 `FeishuCommandHandler` import**

- 删除 `handleCardActionOld` 函数体
- 将 `import type { FeishuCommandHandler } from "./feishu/handler.js";` 整行删除（`FeishuCommandHandler` 不再被引用）

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
uv run npx vitest run tests/feishu/wiring.test.ts -t "handleCardAction"
```

预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: rewrite handleCardAction to use channel.updateCardByToken"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 2: 运行全部测试**

```bash
uv run npx vitest run
```

- [ ] **Step 3: Lint 检查**

```bash
uv run npx biome check src/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: verify typecheck, all tests pass, lint clean"
```

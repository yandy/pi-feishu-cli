# 卡片交互原位更新（延时更新）实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卡片交互从"回复新卡片"改为"延时 API 原位更新"，使用 `POST /open-apis/interactive/v1/card/update` + token。

**Architecture:** `channel.ts` 新增 `updateCardByToken(token, card)` 方法 + `includeRawEvent: true`；`index.ts` 重写 `handleCardAction` 签名，从 `CardActionEvent.raw` 提取 token 调用延时更新。

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk` v1.66, vitest

---

### File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/feishu/channel.ts` | Channel 接口 + 延时更新方法 | 新增 `updateCardByToken`、`RawLarkChannel.rawClient` 扩展、`includeRawEvent: true` |
| `src/index.ts` | cardAction 事件处理 + handleCardAction | 重写签名、提取 token、调用 `updateCardByToken`、清理旧逻辑 |

---

### Task 1: `channel.ts` — 新增 `updateCardByToken` 方法

**Files:**
- Modify: `src/feishu/channel.ts`

- [ ] **Step 1: 扩展 `RawLarkChannel.rawClient` 类型，添加 `request` 方法**

在 `interface RawLarkChannel` 的 `rawClient` 属性中添加 `request` 签名（约第 46-59 行）：

```typescript
interface RawLarkChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  send(chatId: string, content: unknown, options?: unknown): Promise<void>;
  stream(chatId: string, producer: unknown, options?: unknown): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  readonly botIdentity: { name: string } | undefined;
  readonly dispatcher: {
    register(config: Record<string, (...args: unknown[]) => void>): void;
  };
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
}
```

- [ ] **Step 2: `Channel` 接口添加 `updateCardByToken` 方法（约第 88 行后）**

```typescript
export interface Channel {
  // ... 现有方法保持不变 ...
  updateCard(messageId: string, card: unknown): Promise<void>;
  updateCardByToken(token: string, card: unknown): Promise<void>;  // 新增
  get botIdentity(): { name: string } | undefined;
  get connected(): boolean;
}
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

- [ ] **Step 4: `createChannel` 中实现 `updateCardByToken`（约第 154 行后）**

在 `async updateCard(messageId: string, card: unknown) { ... }` 之后添加：

```typescript
async updateCardByToken(token: string, card: unknown) {
    await raw.rawClient.request({
        url: '/open-apis/interactive/v1/card/update',
        method: 'POST',
        data: { token, card },
    });
},
```

- [ ] **Step 5: 运行类型检查和测试**

```bash
uv run npx tsc --noEmit
uv run npx vitest run
```

---

### Task 2: `index.ts` — 重写 `handleCardAction`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 重写 `handleCardAction` 签名和逻辑（替换行 247-309）**

将旧的 `handleCardAction` 函数体替换为：

```typescript
async function handleCardAction(
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

注：需在 `index.ts` 顶部补充 `CardActionEvent` 的 import（目前已有 `type Channel` 从 `"./feishu/channel.js"` 导入，需确认 `CardActionEvent` 也在该模块中导出）。

- [ ] **Step 2: 修改 cardAction 回调中 `handleCardAction` 的调用（行 210-228）**

将：
```typescript
channel.on("cardAction", async (evt: any) => {
    const value = evt?.action?.value ?? evt;
    const messageId: string | undefined = evt?.messageId;
    const chatId: string | undefined = evt?.chatId;
    try {
      await handleCardAction(
        value,
        messageId,
        chatId,
        runtime,
        cwd,
        channel,
        handleSessions,
        handleModels,
      );
    } catch (err) {
      console.error("Card action failed:", err);
    }
  });
```

改为：
```typescript
channel.on("cardAction", async (evt: CardActionEvent) => {
    try {
      await handleCardAction(evt, runtime, cwd, channel);
    } catch (err) {
      console.error("Card action failed:", err);
    }
  });
```

- [ ] **Step 3: 确认 `CardActionEvent` 类型导入**

检查 `src/index.ts` 顶部是否有 `CardActionEvent` 导入。若没有，从 `"./feishu/channel.js"` 导入：

```typescript
import {
  type CardActionEvent,
  type Channel,
  createChannel,
  type NormalizedMessage,
} from "./feishu/channel.js";
```

---

### Task 3: 清理不再使用的代码

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 移除 `FeishuCommandHandler` import（原行 25）**

将：
```typescript
import type { FeishuCommandHandler } from "./feishu/handler.js";
import { createMessageHandler } from "./feishu/handler.js";
```

改为：
```typescript
import { createMessageHandler } from "./feishu/handler.js";
```

- [ ] **Step 2: 确认 `handleSessions` / `handleModels` 不再传给 `handleCardAction` 后无其他问题**

验证 `handleSessions` 和 `handleModels` 仍被 `messageHandler` 使用（用于 `/sessions`、`/models` 命令），不受影响。

---

### Task 4: 全量验证

- [ ] **Step 1: 类型检查**

```bash
uv run npx tsc --noEmit
```

- [ ] **Step 2: 运行所有测试**

```bash
uv run npx vitest run
```

- [ ] **Step 3: Lint 检查**

```bash
uv run npx biome check src/
```

- [ ] **Step 4: Commit**

```bash
git add src/feishu/channel.ts src/index.ts
git commit -m "feat: card in-place update via delayed update API with token"
```

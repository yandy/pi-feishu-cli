# 飞书附件透传 Pi 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持飞书用户发送带附件的消息，附件经 Pi 传给 LLM

**Architecture:** 在 Channel 接口新增下载方法，新建 attachments 模块做附件分类/转换，handler 接收处理后数据后通过 `session.prompt` 传入

**Tech Stack:** TypeScript, Vitest, @earendil-works/pi-coding-agent, @larksuiteoapi/node-sdk

---

## 文件结构

| 文件 | 职责 | 变更 |
|------|------|------|
| `src/feishu/channel.ts` | Channel 接口 + Lark SDK 封装 | 修改：新增 `downloadMessageResource` 方法 |
| `tests/feishu/channel.test.ts` | Channel 测试 | 修改：新增下载方法测试 |
| `src/feishu/attachments.ts` | 附件下载/分类/转换 | 新建 |
| `tests/feishu/attachments.test.ts` | 附件模块单元测试 | 新建 |
| `src/feishu/handler.ts` | 消息处理 | 修改：接收 `ProcessedAttachments` |
| `tests/feishu/handler.test.ts` | handler 测试 | 修改：适配新参数和附件逻辑 |
| `src/index.ts` | 主入口组装 | 修改：消息回调中调用附件处理，导出 setupFeishuHandlers |
| `tests/feishu/wiring.test.ts` | 组装逻辑集成测试 | 新建 |

---

### Task 1: Channel 接口新增 downloadMessageResource

**Files:**
- Modify: `src/feishu/channel.ts:35-48` (接口声明)
- Modify: `src/feishu/channel.ts:61-84` (createChannel 实现)
- Modify: `tests/feishu/channel.test.ts`

- [ ] **Step 1: 编写 Channel 下载方法测试**

在 `tests/feishu/channel.test.ts` 的 `describe("createChannel")` block 内新增测试。mock 需要增加 `rawClient` 属性：

更新第 4 行的 mock 对象，在 `dispatcher: mockDispatcher` 之后追加 `rawClient`：

```typescript
const mockRawChannel = {
  on: vi.fn(),
  botIdentity: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  stream: vi.fn(),
  updateCard: vi.fn(),
  get connected() { return false; },
  dispatcher: mockDispatcher,
  rawClient: {
    im: { v1: { messageResource: { get: vi.fn() } } },
  },
};
```

在 `describe("createChannel")` block 末尾（最后一个 `it` 之后，`})` 之前）新增测试用例：

```typescript
  describe("downloadMessageResource", () => {
    it("calls messageResource.get and returns Buffer from stream", async () => {
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const mockStream = async function*() {
        yield Buffer.from("hello");
        yield Buffer.from("world");
      }();
      mockRawChannel.rawClient.im.v1.messageResource.get.mockResolvedValue({
        getReadableStream: () => mockStream,
      });

      const result = await channel.downloadMessageResource("msg-1", "file-1", "image");
      expect(mockRawChannel.rawClient.im.v1.messageResource.get).toHaveBeenCalledWith({
        path: { message_id: "msg-1", file_key: "file-1" },
        params: { type: "image" },
      });
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe("helloworld");
    });

    it("handles non-Buffer chunks from stream", async () => {
      // 需在 each { beforeEach } 中重置 mock，但 vitest 的 `vi.clearAllMocks()` 已在 beforeEach 中
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const mockStream = async function*() {
        yield "string-chunk";
      }();
      mockRawChannel.rawClient.im.v1.messageResource.get.mockResolvedValue({
        getReadableStream: () => mockStream,
      });

      const result = await channel.downloadMessageResource("msg-2", "file-2", "file");
      expect(result.toString()).toBe("string-chunk");
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/channel.test.ts`
Expected: 新增的 `downloadMessageResource` 测试 FAIL（方法未声明/未实现）

- [ ] **Step 3: 在 Channel 接口中声明并实现新方法**

在 `Channel` 接口中（约第 43 行，`send(...)` 之前）插入：

```typescript
  downloadMessageResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
```

在 `createChannel` 函数中，`send` 方法实现之后插入实现：

```typescript
    async downloadMessageResource(messageId: string, fileKey: string, type: string) {
      const res = await (raw as any).rawClient.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of res.getReadableStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
```

注意：`raw` 当前类型为 `any`（由 `createLarkChannel` 推断为 `LarkChannel`），`rawClient` 在 `LarkChannel` 上是 `public readonly`，通过 `(raw as any).rawClient` 安全访问。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/channel.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/channel.ts tests/feishu/channel.test.ts
git commit -m "feat: add downloadMessageResource to Channel interface"
```

---

### Task 2: 新建 attachments 模块

**Files:**
- Create: `src/feishu/attachments.ts`
- Create: `tests/feishu/attachments.test.ts`

- [ ] **Step 1: 编写关键测试用例**

```typescript
// tests/feishu/attachments.test.ts
import { describe, it, expect, vi } from "vitest";
import { processAttachments } from "../../src/feishu/attachments.js";
import type { NormalizedMessage } from "../../src/feishu/channel.js";

function testMsg(resources: any[]): NormalizedMessage {
  return {
    messageId: "msg-1",
    chatId: "chat-1",
    chatType: "p2p",
    senderId: "user-1",
    content: "look at this",
    rawContentType: "text",
    resources,
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
}

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

function inferMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "image/png";
}

describe("processAttachments", () => {
  it("returns empty result when msg has no resources", async () => {
    const channel = { downloadMessageResource: vi.fn() };
    const result = await processAttachments(channel as any, testMsg([]), "/tmp/test");
    expect(result.images).toEqual([]);
    expect(result.text).toBe("");
  });

  it("downloads image and returns base64 ImageContent", async () => {
    const pngBuffer = Buffer.from("fake-png-data");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(pngBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "photo.png" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(channel.downloadMessageResource).toHaveBeenCalledWith("msg-1", "img-1", "image");
    expect(result.images).toHaveLength(1);
    expect(result.images[0].type).toBe("image");
    expect(result.images[0].mimeType).toBe("image/png");
    expect(result.images[0].data).toBe(pngBuffer.toString("base64"));
    expect(result.text).toBe("");
  });

  it("infer mimeType from fileName extension", async () => {
    const cases = [
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["photo.gif", "image/gif"],
      ["photo.webp", "image/webp"],
      ["photo.bmp", "image/bmp"],
      ["unknown.xyz", "image/png"],
      ["noextension", "image/png"],
    ];

    for (const [fileName, expectedMime] of cases) {
      const channel = {
        downloadMessageResource: vi.fn().mockResolvedValue(Buffer.from("x")),
      };
      const msg = testMsg([
        { type: "image", fileKey: "k", fileName },
      ]);
      const result = await processAttachments(channel as any, msg, "/tmp/test");
      expect(result.images[0].mimeType).toBe(expectedMime, `Failed for ${fileName}`);
    }
  });

  it("reads small text file and includes content in text", async () => {
    const textContent = 'const x = 1;\nconsole.log(x);';
    const buffer = Buffer.from(textContent, "utf-8");
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(buffer),
    };

    const msg = testMsg([
      { type: "file", fileKey: "file-1", fileName: "code.js" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件内容: code.js]");
    expect(result.text).toContain(textContent);
    expect(result.images).toEqual([]);
  });

  it("saves large or binary files and includes path in text", async () => {
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(Buffer.alloc(40000)),
    };

    const msg = testMsg([
      { type: "file", fileKey: "file-1", fileName: "data.bin" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件: data.bin");
    expect(result.text).toContain("/tmp/test/data.bin");
    expect(result.images).toEqual([]);
  });

  it("handles multiple resources of mixed types", async () => {
    const pngBuffer = Buffer.from("png");
    const textBuffer = Buffer.from("hello", "utf-8");
    const channel = {
      downloadMessageResource: vi.fn()
        .mockResolvedValueOnce(pngBuffer)
        .mockResolvedValueOnce(textBuffer),
    };

    const msg = testMsg([
      { type: "image", fileKey: "img-1", fileName: "a.png" },
      { type: "file", fileKey: "file-1", fileName: "readme.txt" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.images).toHaveLength(1);
    expect(result.text).toContain("[文件内容: readme.txt]");
    expect(result.text).toContain("hello");
  });

  it("handles download errors gracefully", async () => {
    const channel = {
      downloadMessageResource: vi.fn().mockRejectedValue(new Error("download failed")),
    };

    const msg = testMsg([
      { type: "file", fileKey: "bad", fileName: "missing.pdf" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("下载失败");
    expect(result.text).toContain("missing.pdf");
  });

  it("detects binary files by null bytes in first 4096 bytes", async () => {
    const binaryBuffer = Buffer.concat([Buffer.from("text"), Buffer.from([0x00]), Buffer.from("binary")]);
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(binaryBuffer),
    };

    const msg = testMsg([
      { type: "file", fileKey: "f", fileName: "binary.pdf" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[文件: binary.pdf");
    expect(result.text).toContain("/tmp/test/binary.pdf");
    expect(result.text).not.toContain("[文件内容: binary.pdf]");
  });

  it("falls back to fileKey.bin when fileName is missing", async () => {
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(Buffer.from("text", "utf-8")),
    };

    const msg = testMsg([
      { type: "file", fileKey: "file-1" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    // file <= 32KB and text, so it should be inline
    expect(result.text).toContain("[文件内容: file-1.bin]");
  });

  it("handles audio/video by saving and including path", async () => {
    const channel = {
      downloadMessageResource: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    };

    const msg = testMsg([
      { type: "audio", fileKey: "aud-1", fileName: "recording.mp3" },
      { type: "video", fileKey: "vid-1", fileName: "clip.mp4" },
    ]);
    const result = await processAttachments(channel as any, msg, "/tmp/test");

    expect(result.text).toContain("[音频: recording.mp3");
    expect(result.text).toContain("[视频: clip.mp4");
  });

  it("ignores sticker resources", async () => {
    const channel = { downloadMessageResource: vi.fn() };

    const msg = testMsg([
      { type: "sticker", fileKey: "stick-1" },
      { type: "image", fileKey: "img-1", fileName: "a.png" },
    ]);
    await processAttachments(channel as any, msg, "/tmp/test");

    // sticker should be ignored, only image triggers download
    expect(channel.downloadMessageResource).toHaveBeenCalledTimes(1);
    expect(channel.downloadMessageResource).toHaveBeenCalledWith("msg-1", "img-1", "image");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/attachments.test.ts`
Expected: All tests FAIL (module not created yet)

- [ ] **Step 3: 实现 attachments 模块**

```typescript
// src/feishu/attachments.ts
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { Channel, NormalizedMessage } from "./channel.js";

export interface ProcessedAttachments {
  images: ImageContent[];
  text: string;
}

const TEXT_SIZE_LIMIT = 32 * 1024; // 32KB

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

function inferMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "image/png";
}

function resolveFileName(res: { fileKey: string; fileName?: string }): string {
  return res.fileName ?? `${res.fileKey}.bin`;
}

function isTextBuffer(buf: Buffer): boolean {
  return !buf.subarray(0, 4096).includes(0x00);
}

export async function processAttachments(
  channel: Pick<Channel, "downloadMessageResource">,
  msg: NormalizedMessage,
  downloadDir: string,
): Promise<ProcessedAttachments> {
  const images: ImageContent[] = [];
  const textParts: string[] = [];

  await mkdir(downloadDir, { recursive: true });

  for (const res of msg.resources) {
    const fileName = resolveFileName(res);

    if (res.type === "sticker") {
      continue;
    }

    if (res.type === "image") {
      try {
        const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);
        images.push({
          type: "image",
          data: buf.toString("base64"),
          mimeType: inferMime(fileName),
        });
      } catch (err) {
        textParts.push(`[图片: ${fileName} 下载失败: ${(err as Error).message}]`);
      }
      continue;
    }

    const isAudioVideo = res.type === "audio" || res.type === "video";

    try {
      const buf = await channel.downloadMessageResource(msg.messageId, res.fileKey, res.type);

      if (!isAudioVideo && buf.length <= TEXT_SIZE_LIMIT && isTextBuffer(buf)) {
        const content = buf.toString("utf-8");
        textParts.push(`[文件内容: ${fileName}]\n${content}`);
      } else {
        const filePath = join(downloadDir, fileName);
        await writeFile(filePath, buf);
        const label = isAudioVideo
          ? (res.type === "audio" ? "音频" : "视频")
          : "文件";
        textParts.push(`[${label}: ${fileName} 已保存到 ${filePath}]`);
      }
    } catch (err) {
      const label = isAudioVideo
        ? (res.type === "audio" ? "音频" : "视频")
        : "文件";
      textParts.push(`[${label}: ${fileName} 下载失败: ${(err as Error).message}]`);
    }
  }

  return {
    images,
    text: textParts.join("\n"),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/attachments.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/attachments.ts tests/feishu/attachments.test.ts
git commit -m "feat: add attachment processing module"
```

---

### Task 3: Handler 支持附件参数

**Files:**
- Modify: `src/feishu/handler.ts`
- Modify: `tests/feishu/handler.test.ts`

- [ ] **Step 1: 编写 handler 附件参数测试（先写测试）**

`tests/feishu/handler.test.ts` 完整替换为：

```typescript
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
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn, vi.fn());
    await handler(makeMsg("/sessions"));
    expect(sessionsFn).toHaveBeenCalledWith("chat-1");
    expect(runtime.session.prompt).not.toHaveBeenCalled();
  });

  it("routes /models command to models handler", async () => {
    const runtime = createMockRuntime();
    const sessionsFn = vi.fn();
    const modelsFn = vi.fn().mockResolvedValue(undefined);
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn, vi.fn());
    await handler(makeMsg("/models"));
    expect(modelsFn).toHaveBeenCalledWith("chat-1");
    expect(runtime.session.prompt).not.toHaveBeenCalled();
  });

  it("routes normal messages to session.prompt with steer (no attachments)", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    await handler(makeMsg("hello world"));
    expect(runtime.session.prompt).toHaveBeenCalledWith("hello world", {
      streamingBehavior: "steer",
      images: undefined,
    });
  });

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

  it("appends attachment text to prompt content", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    await handler(makeMsg("hello"), { images: [], text: "[文件内容: code.js]\nconst x = 1;" });
    expect(runtime.session.prompt).toHaveBeenCalledWith(
      "hello\n\n[文件内容: code.js]\nconst x = 1;",
      { streamingBehavior: "steer", images: undefined },
    );
  });

  it("passes images to prompt when attachments include images", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    const images = [{ type: "image" as const, data: "base64data", mimeType: "image/png" }];
    await handler(makeMsg("check this"), { images, text: "" });
    expect(runtime.session.prompt).toHaveBeenCalledWith("check this", {
      streamingBehavior: "steer",
      images,
    });
  });

  it("skips images option when images array is empty", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    await handler(makeMsg("hello"), { images: [], text: "" });
    expect(runtime.session.prompt).toHaveBeenCalledWith("hello", {
      streamingBehavior: "steer",
      images: undefined,
    });
  });

  it("only uses user text when attachments has no text", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    await handler(makeMsg("plain text"), { images: [], text: "" });
    expect(runtime.session.prompt).toHaveBeenCalledWith("plain text", {
      streamingBehavior: "steer",
      images: undefined,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu/handler.test.ts`
Expected: 新增的附件相关测试 FAIL（`createMessageHandler` 当前不接受 attachments 参数），旧测试中的 `images: undefined` 断言可能也 FAIL（当前 prompt 调用不含 images 参数）

- [ ] **Step 3: 更新 handler 实现使测试通过**

修改 `src/feishu/handler.ts`：

```typescript
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { NormalizedMessage } from "./channel.js";
import type { ProcessedAttachments } from "./attachments.js";

export type FeishuCommandHandler = (chatId: string) => Promise<void>;

export function createMessageHandler(
  runtime: AgentSessionRuntime,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
  handleHelp: FeishuCommandHandler,
): (msg: NormalizedMessage, attachments?: ProcessedAttachments) => Promise<void> {
  return async (msg: NormalizedMessage, attachments?: ProcessedAttachments) => {
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

    const textParts = [content];
    if (attachments?.text) {
      textParts.push(attachments.text);
    }
    const fullText = textParts.join("\n\n");

    await runtime.session.prompt(fullText, {
      streamingBehavior: "steer",
      images: attachments?.images && attachments.images.length > 0 ? attachments.images : undefined,
    });
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu/handler.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishu/handler.ts tests/feishu/handler.test.ts
git commit -m "feat: add attachment support to message handler"
```

---

### Task 4: index.ts 组装附件处理逻辑

**Files:**
- Create: `tests/feishu/wiring.test.ts` (集成测试)
- Modify: `src/index.ts`

- [ ] **Step 1: 编写组装逻辑的集成测试**

创建 `tests/feishu/wiring.test.ts`。用 vi.mock 劫持 `processAttachments`，模拟 channel/runtime/feishu handler，触发 message 事件，验证附件处理流程已正确接入：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProcessAttachments = vi.fn().mockResolvedValue({
  images: [{ type: "image" as const, data: "base64", mimeType: "image/png" }],
  text: "[文件: test.txt 已保存到 /tmp/pi-feishu/test/test.txt]",
});

const mockCreateStreamingHandler = vi.fn(() => vi.fn());

vi.mock("../../src/feishu/attachments.js", () => ({
  processAttachments: mockProcessAttachments,
}));

vi.mock("../../src/feishu/streaming.js", () => ({
  createStreamingHandler: mockCreateStreamingHandler,
}));

const mockChannelStream = vi.fn();
const mockChannelSend = vi.fn();
const mockSessionPrompt = vi.fn().mockResolvedValue(undefined);

function createMockChannel() {
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (event === "message") (createMockChannel as any)._messageHandler = handler;
    }),
    send: mockChannelSend,
    stream: mockChannelStream.mockImplementation(async (_chatId, _producer, _opts) => {}),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onRawEvent: vi.fn(),
    updateCard: vi.fn(),
    botIdentity: { name: "test-bot" },
    connected: true,
    downloadMessageResource: vi.fn(),
  };
}

function createMockRuntime() {
  return {
    session: {
      prompt: mockSessionPrompt,
      subscribe: vi.fn(() => vi.fn()),
      sessionId: "session-test-123",
    },
    newSession: vi.fn(),
    switchSession: vi.fn(),
  };
}

import { setupFeishuHandlers } from "../../src/index.js";

// setupFeishuHandlers 不是导出的函数，需要确认导出。
// 如果未导出，需要先在 index.ts 中导出该函数。
// 此处假定 Task 4 的 Step 3 会同时导出 setupFeishuHandlers（或提取消息处理逻辑为可测试函数）。

describe("attachment wiring in message handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (createMockChannel as any)._messageHandler;
  });

  it("processes attachments when message has resources", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setupFeishuHandlers(channel as any, runtime as any, "/tmp/cwd", "test-bot");

    const handler = (createMockChannel as any)._messageHandler;
    expect(handler).toBeDefined();

    const msg = {
      messageId: "msg-1",
      chatId: "chat-1",
      content: "check my files",
      rawContentType: "text",
      resources: [
        { type: "image", fileKey: "img-1", fileName: "photo.png" },
      ],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    expect(mockProcessAttachments).toHaveBeenCalledWith(
      channel,
      msg,
      expect.stringContaining("pi-feishu"),
    );
    expect(mockChannelStream).toHaveBeenCalled();
  });

  it("skips attachments for command messages", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setupFeishuHandlers(channel as any, runtime as any, "/tmp/cwd", "test-bot");

    const handler = (createMockChannel as any)._messageHandler;
    const msg = {
      messageId: "msg-2",
      chatId: "chat-1",
      content: "/help",
      rawContentType: "text",
      resources: [{ type: "image", fileKey: "img-1", fileName: "photo.png" }],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    expect(mockProcessAttachments).not.toHaveBeenCalled();
  });

  it("does not call processAttachments when msg has no resources", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setupFeishuHandlers(channel as any, runtime as any, "/tmp/cwd", "test-bot");

    const handler = (createMockChannel as any)._messageHandler;
    const msg = {
      messageId: "msg-3",
      chatId: "chat-1",
      content: "hello",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    expect(mockProcessAttachments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行集成测试确认失败**

Run: `npx vitest run tests/feishu/wiring.test.ts`
Expected: FAIL（index.ts 尚未导入 processAttachments，或 setupFeishuHandlers 未导出）

- [ ] **Step 3: 更新 index.ts 使测试通过**

3a. 在 `src/index.ts` 顶部新增 import：

```typescript
import { processAttachments, type ProcessedAttachments } from "./feishu/attachments.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
```

3b. 将 `function setupFeishuHandlers` 改为 `export function setupFeishuHandlers`（测试需要直接调用它）

3c. 修改 `setupFeishuHandlers` 中的消息回调（第 120-138 行区域）：

将原代码块替换为：

```typescript
  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    if (content.startsWith("/sessions") || content.startsWith("/models") || content.startsWith("/help")) {
      await messageHandler(msg);
      return;
    }

    let attachments: ProcessedAttachments | undefined;
    let downloadDir: string | undefined;

    if (msg.resources.length > 0) {
      downloadDir = join(tmpdir(), "pi-feishu", runtime.session.sessionId ?? "unknown");
      attachments = await processAttachments(channel, msg, downloadDir);
    }

    await channel.stream(msg.chatId, {
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
    }, { replyTo: msg.messageId });
  });
```

3d. 在 `setupFeishuHandlers` 函数末尾（`return () => {};` 之前）注册 exit 兜底清理：

```typescript
  const exitDir = join(tmpdir(), "pi-feishu");
  process.on("exit", () => {
    const { rmSync } = require("node:fs");
    try { rmSync(exitDir, { recursive: true, force: true }); } catch {}
  });
```

- [ ] **Step 4: 运行测试 + 类型检查确认通过**

Run: `npx vitest run tests/feishu/wiring.test.ts`
Expected: All tests PASS

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: 运行全部已有测试确保不破坏**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/feishu/wiring.test.ts
git commit -m "feat: wire attachment processing into main message loop"
```

---

### Task 5: 集成测试验证

**Files:**
- Modify: `tests/integration.test.ts` (or append test)

- [ ] **Step 1: 查看现有集成测试结构**

Run: `npx vitest run tests/integration.test.ts`
Expected: Understand existing integration test patterns

- [ ] **Step 2: 运行完整测试套件**

Run: `npx vitest run`
Expected: All tests PASS, including new attachment tests

- [ ] **Step 3: Commit (if integration tests added)**

```bash
git add tests/
git commit -m "test: add integration test for attachment flow"
```

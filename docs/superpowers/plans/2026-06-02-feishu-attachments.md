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
| `src/feishu/attachments.ts` | 附件下载/分类/转换 | 新建 |
| `tests/feishu/attachments.test.ts` | 附件模块单元测试 | 新建 |
| `src/feishu/handler.ts` | 消息处理 | 修改：接收 `ProcessedAttachments` |
| `tests/feishu/handler.test.ts` | handler 测试 | 修改：适配新参数和附件逻辑 |
| `src/index.ts` | 主入口组装 | 修改：消息回调中调用附件处理 |

---

### Task 1: Channel 接口新增 downloadMessageResource

**Files:**
- Modify: `src/feishu/channel.ts:35-48`
- Modify: `src/feishu/channel.ts:61-84`

- [ ] **Step 1: 在 Channel 接口声明新方法**

```typescript
// 在 Channel 接口中新增（downloadResource 方法声明区）
downloadMessageResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
```

在 `src/feishu/channel.ts` 第 43 行 `send(...)` 之前插入：

```typescript
  downloadMessageResource(messageId: string, fileKey: string, type: string): Promise<Buffer>;
```

- [ ] **Step 2: 在 createChannel 中实现新方法**

在 `createChannel` 函数中，`send` 方法实现之后（约第 80 行 `async send` 之后）插入 `downloadMessageResource` 的转发实现。实现需构造 `rawClient.im.v1.messageResource.get` 调用并攒流：

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

注意：`raw` 当前类型为 `any`（由 `createLarkChannel` 推断为 `LarkChannel` 但未声明类型标注），`rawClient` 在 `LarkChannel` 上是 `public readonly` 属性，通过 `(raw as any).rawClient` 安全访问。

- [ ] **Step 3: 运行现有测试确保不破坏**

Run: `npx vitest run tests/feishu/channel.test.ts`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/feishu/channel.ts
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

- [ ] **Step 1: 更新 handler 实现**

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

- [ ] **Step 2: 更新 handler 测试用例**

`tests/feishu/handler.test.ts` 需要更新以匹配新签名。首先更新测试的 import：

```typescript
import { describe, it, expect, vi } from "vitest";
import { createMessageHandler } from "../../src/feishu/handler.js";
import type { NormalizedMessage } from "../../src/feishu/channel.js";
```

更新 prompt 相关的测试用例，增加对 `images` 参数的断言：

重写第 57-62 行的 normal message 测试：

```typescript
  it("routes normal messages to session.prompt with steer (no attachments)", async () => {
    const runtime = createMockRuntime();
    const handler = createMessageHandler(runtime as any, vi.fn(), vi.fn(), vi.fn());
    await handler(makeMsg("hello world"));
    expect(runtime.session.prompt).toHaveBeenCalledWith("hello world", {
      streamingBehavior: "steer",
      images: undefined,
    });
  });
```

在 `describe("createMessageHandler")` block 内，最后一个 `it` 之后新增附件的测试：

```typescript
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
```

- [ ] **Step 3: 运行 handler 测试确认通过**

Run: `npx vitest run tests/feishu/handler.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/feishu/handler.ts tests/feishu/handler.test.ts
git commit -m "feat: add attachment support to message handler"
```

---

### Task 4: index.ts 组装附件处理逻辑

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 更新 index.ts 的 import 和消息回调**

在 `src/index.ts` 顶部新增 import：

```typescript
import { processAttachments, type ProcessedAttachments } from "./feishu/attachments.js";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
```

修改 `setupFeishuHandlers` 中的消息回调（第 120-138 行区域）。将原代码块：

```typescript
  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    // Commands send cards directly without streaming
    if (content.startsWith("/sessions") || content.startsWith("/models") || content.startsWith("/help")) {
      await messageHandler(msg);
      return;
    }

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
```

替换为：

```typescript
  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    // Commands send cards directly without streaming, ignore attachments
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

- [ ] **Step 2: 注册 process.on("exit") 兜底清理**

在 `setupFeishuHandlers` 函数末尾（`return () => {};` 之前），注册 exit 清理回调：

```typescript
  const exitDir = join(tmpdir(), "pi-feishu");
  process.on("exit", () => {
    // sync fallback: best-effort cleanup
    const { rmSync } = require("node:fs");
    try { rmSync(exitDir, { recursive: true, force: true }); } catch {}
  });
```

- [ ] **Step 3: 运行所有测试确认不破坏**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 4: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
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

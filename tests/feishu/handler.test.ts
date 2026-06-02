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
    const helpFn = vi.fn().mockResolvedValue(undefined);
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn, helpFn);
    await handler(makeMsg("/sessions"));
    expect(sessionsFn).toHaveBeenCalledWith("chat-1");
    expect(runtime.session.prompt).not.toHaveBeenCalled();
  });

  it("routes /models command to models handler", async () => {
    const runtime = createMockRuntime();
    const sessionsFn = vi.fn();
    const modelsFn = vi.fn().mockResolvedValue(undefined);
    const helpFn = vi.fn().mockResolvedValue(undefined);
    const handler = createMessageHandler(runtime as any, sessionsFn, modelsFn, helpFn);
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

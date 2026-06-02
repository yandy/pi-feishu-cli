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

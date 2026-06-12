import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessAttachments, mockCreateStreamingHandler } = vi.hoisted(
  () => ({
    mockProcessAttachments: vi.fn().mockResolvedValue({
      images: [
        { type: "image" as const, data: "base64", mimeType: "image/png" },
      ],
      text: "[文件: test.txt 已保存到 /tmp/pi-feishu/test/test.txt]",
    }),
    mockCreateStreamingHandler: vi.fn(() => vi.fn()),
  }),
);

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
      if (event === "message")
        (createMockChannel as any)._messageHandler = handler;
    }),
    send: mockChannelSend,
    stream: mockChannelStream.mockImplementation(
      async (_chatId, _producer, _opts) => {},
    ),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onRawEvent: vi.fn(),
    updateCard: vi.fn(),
    updateCardByToken: vi.fn(),
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
      sessionFile: "/tmp/sessions/default.json",
      model: undefined,
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      extensionRunner: { setUIContext: vi.fn() },
    },
    newSession: vi.fn(),
    switchSession: vi.fn(),
  };
}

import { handleCardAction, setupFeishuHandlers } from "../../src/index.js";

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
      resources: [{ type: "image", fileKey: "img-1", fileName: "photo.png" }],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    expect(mockProcessAttachments).toHaveBeenCalledWith(
      channel,
      msg,
      expect.stringContaining("pi-feishu"),
      undefined,
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

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

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
        value: {
          cmd: "model",
          action: "select",
          provider: "openai",
          modelId: "gpt-4",
          thinkingLevel: "high",
        },
        tag: "button",
      },
      raw: { event: { token: "c-token-def" } },
    };

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

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

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

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
      raw: {},
    };

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

    expect(runtime.switchSession).toHaveBeenCalledWith("/tmp/s.json");
    expect(channel.updateCardByToken).not.toHaveBeenCalled();
  });
});

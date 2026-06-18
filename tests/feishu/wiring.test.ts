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

vi.mock("../../src/feishu/context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/feishu/context.js")>();
  return {
    ...actual,
    setFeishuContext: vi.fn((ctx: unknown) =>
      actual.setFeishuContext(ctx as any),
    ),
  };
});

const mockChannelStream = vi.fn();
const mockChannelSend = vi.fn().mockResolvedValue({ messageId: "msg_mock1" });
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
    updateCard: vi.fn().mockResolvedValue(undefined),
    updateCardByToken: vi.fn().mockResolvedValue(undefined),
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
      extensionRunner: {
        setUIContext: vi.fn(),
        getUIContext: vi.fn(() => ({ __tuiContext: true })),
      },
    },
    newSession: vi.fn(),
    switchSession: vi.fn(),
  };
}

import { setFeishuContext } from "../../src/feishu/context.js";
import { createFeishuUIContext } from "../../src/feishu/feishu-ui.js";
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

  it("restores UIContext and clears Feishu context after non-command message", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();
    const prevUIContext = runtime.session.extensionRunner.getUIContext();

    setupFeishuHandlers(channel as any, runtime as any, "/tmp/cwd", "test-bot");

    const handler = (createMockChannel as any)._messageHandler;
    const msg = {
      messageId: "msg-4",
      chatId: "chat-1",
      content: "hello world",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    const setUIContextMock = runtime.session.extensionRunner
      .setUIContext as any;
    const calls = setUIContextMock.mock.calls;
    const lastCall = calls[calls.length - 1];

    // Last setUIContext call should restore the previous (TUI) UIContext
    expect(lastCall[0]).toEqual(prevUIContext);
    // And with "tui" mode
    expect(lastCall[1]).toBe("tui");

    // setFeishuContext should have been called with null (clear)
    expect(setFeishuContext).toHaveBeenCalledWith(null);
  });

  it("does not touch UIContext or Feishu context for command messages", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setupFeishuHandlers(channel as any, runtime as any, "/tmp/cwd", "test-bot");

    const setUIContextMock = runtime.session.extensionRunner
      .setUIContext as any;
    const setUIContextCallsBefore = setUIContextMock.mock.calls.length;

    const handler = (createMockChannel as any)._messageHandler;
    const msg = {
      messageId: "msg-5",
      chatId: "chat-1",
      content: "/help",
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: false,
    };

    await handler(msg);

    // No additional setUIContext calls for commands
    expect(setUIContextMock.mock.calls.length).toBe(setUIContextCallsBefore);
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

  it("updates card by token on feishu_dialog with selected choice", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setFeishuContext({ chatId: "chat-dialog", channel } as any);

    const ui = createFeishuUIContext();

    ui.select("测试标题", ["是", "否"]);
    const sentCard = (mockChannelSend.mock.lastCall as any)[1]?.card as any;
    const button = sentCard.body.elements.find((e: any) => e.tag === "button");
    const dialogId = button.behaviors[0].value.dialog_id;

    mockChannelSend.mockClear();
    (channel.updateCardByToken as any).mockClear();

    const evt = {
      action: {
        value: {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: "是",
        },
        tag: "button",
      },
      raw: { token: "t-dialog-refresh" },
    };

    await handleCardAction(
      evt as any,
      runtime as any,
      "/tmp/cwd",
      channel as any,
    );

    expect(channel.updateCardByToken).toHaveBeenCalledWith(
      "t-dialog-refresh",
      expect.objectContaining({ schema: "2.0" }),
    );

    const updatedCard = (channel.updateCardByToken as any).mock
      .calls[0][1] as any;
    expect(updatedCard.header.title.content).toBe("测试标题");
    expect(updatedCard.header.template).toBe("red");
    const md = updatedCard.body.elements[0];
    expect(md.tag).toBe("markdown");
    expect(md.content).toContain("已选择: **是**");

    setFeishuContext(null);
  });

  it("does not update card on feishu_dialog when token is missing", async () => {
    const channel = createMockChannel();
    const runtime = createMockRuntime();

    setFeishuContext({ chatId: "chat-d2", channel } as any);
    const ui = createFeishuUIContext();
    ui.select("标题", ["是"]);

    const sentCard = (mockChannelSend.mock.lastCall as any)[1]?.card as any;
    const button = sentCard.body.elements.find((e: any) => e.tag === "button");
    const dialogId = button.behaviors[0].value.dialog_id;

    mockChannelSend.mockClear();
    (channel.updateCardByToken as any).mockClear();

    const evt = {
      action: {
        value: {
          cmd: "feishu_dialog",
          dialog_id: dialogId,
          dialog_choice: "是",
        },
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

    expect(channel.updateCardByToken).not.toHaveBeenCalled();

    setFeishuContext(null);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock messaging.ts (external I/O — lark-cli calls)
vi.mock("../src/im/messaging.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  setTypingStatus: vi.fn().mockResolvedValue(true),
}));

// Mock logger.ts (file I/O)
vi.mock("../src/im/logger.js", () => ({
  log: vi.fn(),
}));

// Mock pi-coding-agent (external dependency — avoid calling real services)
vi.mock("@earendil-works/pi-coding-agent", () => {
  let lineHandler: ((line: string) => void) | null = null;
  return {
    createAgentSessionFromServices: vi.fn().mockResolvedValue({
      session: {
        subscribe: vi.fn((handler: (e: unknown) => void) => {
          lineHandler = (line: string) => handler({
            type: "agent_end",
            messages: [{ role: "assistant", content: [{ type: "text", text: line }] }],
          });
        }),
        prompt: vi.fn().mockImplementation(async () => {
          if (lineHandler) lineHandler("hello from test");
        }),
        dispose: vi.fn(),
      },
    }),
    SessionManager: {
      open: vi.fn().mockReturnValue({}),
      inMemory: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock("@earendil-works/pi-ai", () => ({}));

describe("processItem — command type", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("handles /new command and creates session", async () => {
    const { processItem } = await import("../src/im/processor.js");
    const { sendMessage } = await import("../src/im/messaging.js");

    const tmpdir = await import("node:os").then(o => o.tmpdir());
    const { SessionRegistry } = await import("../src/im/session-registry.js");
    const registry = new SessionRegistry(tmpdir);

    const queuedItem = {
      event: {
        type: "im.message.receive_v1",
        chat_id: "oc_test",
        chat_type: "p2p",
        content: "/new 测试会话",
        message_id: "om_123",
        message_type: "text",
        sender_id: "ou_user",
        create_time: "1700000000",
        event_id: "ev_1",
        timestamp: "1700000001",
        raw: {},
      },
      route: {
        type: "command" as const,
        command: "new",
        args: "测试会话",
        chatId: "oc_test",
      },
    };

    await processItem(
      queuedItem,
      { services: {} },
      registry,
      "/tmp/agent",
      "anthropic/claude-sonnet-4-20250514"
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const call = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("测试会话");
    expect(call[1]).toBe("oc_test");
  });

  it("handles /sessions command and sends card", async () => {
    const { processItem } = await import("../src/im/processor.js");
    const { sendMessage } = await import("../src/im/messaging.js");

    const tmpdir = await import("node:os").then(o => o.tmpdir());
    const { SessionRegistry } = await import("../src/im/session-registry.js");
    const registry = new SessionRegistry(tmpdir);
    registry.createSession("oc_test", "sess1");

    const queuedItem = {
      event: {
        type: "im.message.receive_v1",
        chat_id: "oc_test",
        chat_type: "p2p",
        content: "/sessions",
        message_id: "om_124",
        message_type: "text",
        sender_id: "ou_user",
        create_time: "1700000000",
        event_id: "ev_2",
        timestamp: "1700000001",
        raw: {},
      },
      route: {
        type: "command" as const,
        command: "sessions",
        args: "",
        chatId: "oc_test",
      },
    };

    await processItem(queuedItem, { services: {} }, registry, "/tmp/agent", "claude-sonnet");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe("interactive");
  });
});

describe("processItem — message type", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("handles message and calls setTypingStatus then sendMessage", async () => {
    const { processItem } = await import("../src/im/processor.js");
    const { setTypingStatus, sendMessage } = await import("../src/im/messaging.js");

    const tmpdir = await import("node:os").then(o => o.tmpdir());
    const { SessionRegistry } = await import("../src/im/session-registry.js");
    const registry = new SessionRegistry(tmpdir);

    const queuedItem = {
      event: {
        type: "im.message.receive_v1",
        chat_id: "oc_test",
        chat_type: "p2p",
        content: "你好",
        message_id: "om_125",
        message_type: "text",
        sender_id: "ou_user",
        create_time: "1700000000",
        event_id: "ev_3",
        timestamp: "1700000001",
        raw: {},
      },
      route: {
        type: "message" as const,
        text: "你好",
        chatId: "oc_test",
      },
    };

    await processItem(queuedItem, { services: {} }, registry, "/tmp/agent", "claude-sonnet");

    expect(setTypingStatus).toHaveBeenCalledWith("om_125", true);
    expect(sendMessage).toHaveBeenCalled();
    expect((sendMessage as ReturnType<typeof vi.fn>).mock.calls.some(
      (call: unknown[]) => call[1] === "oc_test"
    )).toBe(true);
  });
});

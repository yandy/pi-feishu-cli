import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/im/messaging.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  setTypingStatus: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/im/logger.js", () => ({
  log: vi.fn(),
}));

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

  it("handles message and calls setTypingStatus before and after", async () => {
    const { processItem } = await import("../src/im/processor.js");
    const { setTypingStatus } = await import("../src/im/messaging.js");

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

    expect(setTypingStatus).toHaveBeenCalled();
  });
});

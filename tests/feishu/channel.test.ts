import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChannel,
  LOG_LEVEL_MAP,
  LoggerLevel,
} from "../../src/feishu/channel.js";

const mockDispatcher = { register: vi.fn().mockReturnThis() };
const mockRawChannel = {
  on: vi.fn(),
  botIdentity: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  stream: vi.fn(),
  updateCard: vi.fn(),
  get connected() {
    return false;
  },
  dispatcher: mockDispatcher,
  rawClient: {
    request: vi.fn(),
    im: { v1: { messageResource: { get: vi.fn() } } },
  },
};

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: vi.fn(() => mockRawChannel),
  LoggerLevel: { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 },
}));

describe("log level mapping", () => {
  it("maps valid level names to LoggerLevel values", () => {
    expect(LOG_LEVEL_MAP.fatal).toBe(LoggerLevel.fatal);
    expect(LOG_LEVEL_MAP.error).toBe(LoggerLevel.error);
    expect(LOG_LEVEL_MAP.warn).toBe(LoggerLevel.warn);
    expect(LOG_LEVEL_MAP.info).toBe(LoggerLevel.info);
    expect(LOG_LEVEL_MAP.debug).toBe(LoggerLevel.debug);
    expect(LOG_LEVEL_MAP.trace).toBe(LoggerLevel.trace);
  });

  it("defaults to warn when level is not provided", () => {
    const loggerLevel = LOG_LEVEL_MAP[""] ?? LoggerLevel.warn;
    expect(loggerLevel).toBe(LoggerLevel.warn);
  });

  it("defaults to warn for unknown level strings", () => {
    const loggerLevel = LOG_LEVEL_MAP.invalid ?? LoggerLevel.warn;
    expect(loggerLevel).toBe(LoggerLevel.warn);
  });
});

describe("createChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("onRawEvent", () => {
    it("registers a handler on the underlying event dispatcher", () => {
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const handler = () => {};

      channel.onRawEvent("im.message.message_read_v1", handler);

      expect(mockDispatcher.register).toHaveBeenCalledWith({
        "im.message.message_read_v1": handler,
      });
    });
  });

  it("registers a no-op handler for im.message.message_read_v1 on creation", () => {
    createChannel({ appId: "test", appSecret: "secret" });

    expect(mockDispatcher.register).toHaveBeenCalledWith({
      "im.message.message_read_v1": expect.any(Function),
    });
  });

  describe("downloadMessageResource", () => {
    it("calls messageResource.get and returns Buffer from stream", async () => {
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const mockStream = (async function* () {
        yield Buffer.from("hello");
        yield Buffer.from("world");
      })();
      mockRawChannel.rawClient.im.v1.messageResource.get.mockResolvedValue({
        getReadableStream: () => mockStream,
      });

      const result = await channel.downloadMessageResource(
        "msg-1",
        "file-1",
        "image",
      );
      expect(
        mockRawChannel.rawClient.im.v1.messageResource.get,
      ).toHaveBeenCalledWith({
        path: { message_id: "msg-1", file_key: "file-1" },
        params: { type: "image" },
      });
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe("helloworld");
    });

    it("handles non-Buffer chunks from stream", async () => {
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const mockStream = (async function* () {
        yield "string-chunk";
      })();
      mockRawChannel.rawClient.im.v1.messageResource.get.mockResolvedValue({
        getReadableStream: () => mockStream,
      });

      const result = await channel.downloadMessageResource(
        "msg-2",
        "file-2",
        "file",
      );
      expect(result.toString()).toBe("string-chunk");
    });
  });

  describe("updateCardByToken", () => {
    it("calls rawClient.request with correct params for delayed card update", async () => {
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      mockRawChannel.rawClient.request.mockClear();

      const card = {
        schema: "2.0",
        header: { title: { tag: "plain_text", content: "test" } },
        body: { elements: [] },
      };
      await channel.updateCardByToken("c-token-abc", card);

      expect(mockRawChannel.rawClient.request).toHaveBeenCalledWith({
        url: "/open-apis/interactive/v1/card/update",
        method: "POST",
        data: { token: "c-token-abc", card },
      });
    });
  });

  describe("send returns message_id", () => {
    it("returns message_id from raw.send", async () => {
      mockRawChannel.send.mockResolvedValue("msg_abc123");
      const channel = createChannel({ appId: "test", appSecret: "secret" });
      const result = await channel.send("chat_1", { text: "hello" });
      expect(result).toBe("msg_abc123");
      expect(mockRawChannel.send).toHaveBeenCalledWith(
        "chat_1",
        { text: "hello" },
        undefined,
      );
    });
  });
});

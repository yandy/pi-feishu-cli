import { describe, it, expect, vi, beforeEach } from "vitest";
import { LOG_LEVEL_MAP, LoggerLevel, createChannel } from "../../src/feishu/channel.js";

const mockDispatcher = { register: vi.fn().mockReturnThis() };
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
    const loggerLevel = LOG_LEVEL_MAP["invalid"] ?? LoggerLevel.warn;
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

    expect(mockDispatcher.register).toHaveBeenCalledWith(
      { "im.message.message_read_v1": expect.any(Function) },
    );
  });
});

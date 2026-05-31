import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeishuChannel } from "../../src/channel/index.js";

const { createLarkChannel } = vi.hoisted(() => ({
  createLarkChannel: vi.fn((opts: any) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    get botIdentity() { return { name: "test" }; },
    send: vi.fn(),
    stream: vi.fn(),
    updateCard: vi.fn(),
  })),
}));

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel,
  LoggerLevel: { info: "info" },
}));

beforeEach(() => {
  createLarkChannel.mockClear();
});

describe("Channel outbound config", () => {
  it("should pass outbound.streamInitialText to createLarkChannel", () => {
    createFeishuChannel({
      appId: "a",
      appSecret: "s",
      outbound: { streamInitialText: "🤔 Testing..." },
    });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        outbound: { streamInitialText: "🤔 Testing..." },
      })
    );
  });

  it("should not pass outbound when undefined", () => {
    createFeishuChannel({ appId: "a", appSecret: "s" });

    const callOpts = createLarkChannel.mock.calls[0][0];
    expect(callOpts).not.toHaveProperty("outbound");
  });
});

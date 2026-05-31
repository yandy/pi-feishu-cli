import { describe, it, expect, vi } from "vitest";
import { createFeishuChannel, type Channel } from "../../src/channel/index.js";

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: vi.fn((opts: any) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    get botIdentity() { return { name: "test" }; },
    send: vi.fn(),
    stream: vi.fn(),
    updateCard: vi.fn(),
  })),
  LoggerLevel: { info: "info" },
}));

describe("Channel outbound config", () => {
  it("should pass outbound.streamInitialText to createLarkChannel", async () => {
    const { createLarkChannel } = await import("@larksuiteoapi/node-sdk");

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

  it("should not pass outbound when undefined", async () => {
    const { createLarkChannel } = await import("@larksuiteoapi/node-sdk");
    vi.mocked(createLarkChannel).mockClear();

    createFeishuChannel({ appId: "a", appSecret: "s" });

    const callOpts = vi.mocked(createLarkChannel).mock.calls[0][0];
    expect(callOpts).not.toHaveProperty("outbound");
  });
});

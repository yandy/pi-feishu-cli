import { afterEach, describe, expect, it, vi } from "vitest";
import { createLarkChannel } from "@larksuiteoapi/node-sdk";
import { createChannel } from "../../src/feishu/channel.js";

const mockSend = vi.fn();
const mockRawChannel = {
  on: vi.fn(),
  botIdentity: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: mockSend,
  stream: vi.fn(),
  updateCard: vi.fn(),
  get connected() {
    return false;
  },
  dispatcher: { register: vi.fn().mockReturnThis() },
  rawClient: {
    request: vi.fn(),
    im: { v1: { messageResource: { get: vi.fn() } } },
  },
};

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: vi.fn(() => mockRawChannel),
  LoggerLevel: { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 },
}));

afterEach(() => {
  mockSend.mockClear();
  (createLarkChannel as any).mockClear();
});

describe("sendFile", () => {
  it("calls raw.send with file source and custom name", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    await channel.sendFile("chat-1", __filename, "report.ts");

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      file: { source: __filename, fileName: "report.ts" },
    });
  });

  it("derives fileName from path when not provided", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    const baseName = __filename.split("/").pop();
    await channel.sendFile("chat-1", __filename);

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      file: { source: __filename, fileName: baseName },
    });
  });
});

describe("sendImage", () => {
  it("calls raw.send with image source", async () => {
    const channel = createChannel({ appId: "test", appSecret: "secret" });
    mockSend.mockResolvedValue(undefined);

    await channel.sendImage("chat-1", __filename);

    expect(mockSend).toHaveBeenCalledWith("chat-1", {
      image: { source: __filename },
    });
  });
});

describe("allowedFileDirs", () => {
  it("passes outbound.allowedFileDirs when cwd is provided", () => {
    createChannel({ appId: "test", appSecret: "secret", cwd: "/home/user/project" });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        outbound: { allowedFileDirs: ["/home/user/project"] },
      }),
    );
  });

  it("omits outbound when cwd is not provided", () => {
    createChannel({ appId: "test", appSecret: "secret" });

    expect(createLarkChannel).toHaveBeenCalledWith(
      expect.not.objectContaining({ outbound: expect.anything() }),
    );
  });
});

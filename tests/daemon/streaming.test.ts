import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as net from "node:net";
import { mkdirSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stringifyMessage } from "../../src/ipc/protocol.js";

const { SOCK, TEST_DIR } = vi.hoisted(() => {
  return {
    SOCK: "/tmp/test-pi-feishu-streaming.sock",
    TEST_DIR: "/tmp/test-pi-feishu-daemon-streaming",
  };
});

const { messageHandlers } = vi.hoisted(() => {
  const handlers: Array<(msg: any) => Promise<void> | void> = [];
  return { messageHandlers: handlers };
});

const mockAppend = vi.fn().mockResolvedValue(undefined);
let streamInvoked = false;

vi.mock("../../src/channel/index.js", () => ({
  createFeishuChannel: vi.fn(() => ({
    on: (event: string, handler: any) => {
      if (event === "message") messageHandlers.push(handler);
    },
    connected: true,
    botIdentity: { name: "test-bot" },
    send: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    stream: vi.fn(async (_to: string, input: any) => {
      streamInvoked = true;
      if (input.markdown) {
        await input.markdown({ append: mockAppend, messageId: "mock_msg_1" });
      }
    }),
    updateCard: vi.fn(),
  })),
}));

vi.mock("../../src/config.js", () => ({
  FEISHU_IM_DIR: "/tmp/test-pi-feishu-daemon-streaming",
  AUTH_FILE: "/tmp/test-pi-feishu-daemon-streaming/auth.json",
  SOCKET_PATH: "/tmp/test-pi-feishu-streaming.sock",
  PID_FILE: "/tmp/test-pi-feishu-daemon-streaming/daemon.pid",
  DAEMON_LOG: "/tmp/test-pi-feishu-daemon-streaming/daemon.log",
}));

import { main } from "../../src/daemon/index.js";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectClient(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(SOCK, () => resolve(s));
    s.on("error", reject);
  });
}

describe("Incremental streaming", () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, "auth.json"), JSON.stringify({
      appId: "test-app", appSecret: "test-secret",
    }));
    await main();
  });

  afterAll(() => {
    try { unlinkSync(SOCK); } catch {}
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    messageHandlers.length = 0;
    streamInvoked = false;
    mockAppend.mockClear();
  });

  it("should call channel.stream immediately on first stream IPC message", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "stream", chatId: "chat_001", content: "Hello",
    }));
    await delay(200);

    expect(streamInvoked).toBe(true);
    client.destroy();
    await delay(50);
  });

  it("should append each chunk to the active stream as it arrives", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "stream", chatId: "chat_002", content: "Hello",
    }));
    await delay(100);
    client.write(stringifyMessage({
      type: "stream", chatId: "chat_002", content: "Hello world",
    }));
    await delay(100);
    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_002",
    }));
    await delay(200);

    expect(mockAppend).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenNthCalledWith(1, "Hello");
    expect(mockAppend).toHaveBeenNthCalledWith(2, "Hello world");

    client.destroy();
    await delay(50);
  });

  it("should queue chunks arriving before first append resolves", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "stream", chatId: "chat_003", content: "First",
    }));
    client.write(stringifyMessage({
      type: "stream", chatId: "chat_003", content: "Second",
    }));
    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_003",
    }));
    await delay(300);

    expect(mockAppend).toHaveBeenCalledTimes(2);
    expect(mockAppend).toHaveBeenNthCalledWith(1, "First");
    expect(mockAppend).toHaveBeenNthCalledWith(2, "Second");

    client.destroy();
    await delay(50);
  });

  it("should handle streamEnd without preceding stream (noop)", async () => {
    const client = await connectClient();
    await delay(50);

    client.write(stringifyMessage({
      type: "streamEnd", chatId: "chat_nonexistent",
    }));
    await delay(100);

    // Just verifying no crash
    client.destroy();
    await delay(50);
  });
});

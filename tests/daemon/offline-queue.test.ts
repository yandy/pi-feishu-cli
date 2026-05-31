import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import * as net from "node:net";
import { rmSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringifyMessage } from "../../src/ipc/protocol.js";

const { SOCK, TEST_DIR } = vi.hoisted(() => {
  return {
    SOCK: "/tmp/test-pi-feishu-offline-queue.sock",
    TEST_DIR: "/tmp/test-pi-feishu-daemon-offline",
  };
});

const { messageHandlers, cardActionHandlers } = vi.hoisted(() => {
  const msgHandlers: Array<(msg: any) => Promise<void> | void> = [];
  const cardHandlers: Array<(evt: any) => Promise<void> | void> = [];
  return { messageHandlers: msgHandlers, cardActionHandlers: cardHandlers };
});

vi.mock("../../src/channel/index.js", () => ({
  createFeishuChannel: vi.fn(() => ({
    on: (event: string, handler: any) => {
      if (event === "message") messageHandlers.push(handler);
      if (event === "cardAction") cardActionHandlers.push(handler);
    },
    connected: true,
    botIdentity: { name: "test-bot" },
    send: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    stream: vi.fn(),
    updateCard: vi.fn(),
  })),
}));

vi.mock("../../src/config.js", () => ({
  FEISHU_IM_DIR: "/tmp/test-pi-feishu-daemon-offline",
  AUTH_FILE: "/tmp/test-pi-feishu-daemon-offline/auth.json",
  SOCKET_PATH: "/tmp/test-pi-feishu-offline-queue.sock",
  PID_FILE: "/tmp/test-pi-feishu-daemon-offline.pid",
  DAEMON_LOG: "/tmp/test-pi-feishu-daemon-offline.log",
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

function readMessagesFromData(data: string): any[] {
  return data.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("Daemon offline message buffering", () => {
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

  afterEach(() => {
    messageHandlers.length = 0;
    cardActionHandlers.length = 0;
  });

  it("should buffer 3 messages when no client connected and flush all on reconnect", async () => {
    const clientA = await connectClient();
    const aData = await new Promise<string>((resolve) => {
      clientA.once("data", (d) => resolve(d.toString()));
    });
    const aMsgs = readMessagesFromData(aData);
    expect(aMsgs.length).toBe(1);
    expect(aMsgs[0].type).toBe("ready");

    clientA.destroy();
    await delay(150);

    const fakeMsgs = [1, 2, 3].map((i) => ({
      messageId: `msg_00${i}`,
      chatId: "chat_001",
      chatType: "p2p" as const,
      senderId: "user_001",
      senderName: "Alice",
      content: '{"text":"hello"}',
      rawContentType: "text",
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: true,
      createTime: Date.now(),
    }));
    for (const msg of fakeMsgs) {
      await messageHandlers[0](msg);
    }

    const clientB = await connectClient();
    const bData = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 4) {
          clientB.off("data", onData);
          resolve(buffer);
        }
      };
      clientB.on("data", onData);
      setTimeout(() => {
        clientB.off("data", onData);
        resolve(buffer);
      }, 1000);
    });
    const bMsgs = readMessagesFromData(bData);
    expect(bMsgs.length).toBe(4);
    expect(bMsgs[0].type).toBe("ready");
    expect(bMsgs[1].type).toBe("message");
    expect(bMsgs[1].messageId).toBe("msg_001");
    expect(bMsgs[2].type).toBe("message");
    expect(bMsgs[2].messageId).toBe("msg_002");
    expect(bMsgs[3].type).toBe("message");
    expect(bMsgs[3].messageId).toBe("msg_003");

    clientB.destroy();
    await delay(100);
  });

  it("empty flush is a no-op when no pending messages", async () => {
    const client = await connectClient();
    const data = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 1) {
          client.off("data", onData);
        }
        // Wait a bit to see if there's a second message
        setTimeout(() => {
          client.off("data", onData);
          resolve(buffer);
        }, 300);
      };
      client.on("data", onData);
    });
    const msgs = readMessagesFromData(data);
    expect(msgs.length).toBe(1);
    expect(msgs[0].type).toBe("ready");
    client.destroy();
    await delay(100);
  });

  it("should buffer cardAction events when no client connected and flush on reconnect", async () => {
    // Re-auth to get a fresh channel with cardAction handler
    const clientA = await connectClient();
    clientA.write(stringifyMessage({
      type: "auth", appId: "app2", appSecret: "secret2",
    }));
    const aData = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 1) {
          clientA.off("data", onData);
          resolve(buffer);
        }
      };
      clientA.on("data", onData);
      setTimeout(() => {
        clientA.off("data", onData);
        resolve(buffer);
      }, 1000);
    });
    const aMsgs = readMessagesFromData(aData);
    // First msg is ready (from connect), second could be ready (from auth)
    // Collect until we see ready
    expect(aMsgs.some((m: any) => m.type === "ready")).toBe(true);

    clientA.destroy();
    await delay(150);

    // Emit cardAction while offline
    const fakeCardAction = {
      messageId: "card_001",
      chatId: "chat_001",
      openId: "open_001",
      action: { value: "click_ok" },
    };
    await cardActionHandlers[0](fakeCardAction);

    // Connect and verify flush
    const clientB = await connectClient();
    const bData = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 2) {
          clientB.off("data", onData);
          resolve(buffer);
        }
      };
      clientB.on("data", onData);
      setTimeout(() => {
        clientB.off("data", onData);
        resolve(buffer);
      }, 1000);
    });
    const bMsgs = readMessagesFromData(bData);
    expect(bMsgs.length).toBe(2);
    expect(bMsgs[0].type).toBe("ready");
    expect(bMsgs[1].type).toBe("cardAction");
    expect(bMsgs[1].messageId).toBe("card_001");

    clientB.destroy();
    await delay(100);
  });

  it("should buffer multiple cardAction events and flush all on reconnect", async () => {
    const clientA = await connectClient();
    clientA.write(stringifyMessage({
      type: "auth", appId: "app3", appSecret: "secret3",
    }));
    const aData = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 1) {
          clientA.off("data", onData);
          resolve(buffer);
        }
      };
      clientA.on("data", onData);
      setTimeout(() => {
        clientA.off("data", onData);
        resolve(buffer);
      }, 1000);
    });
    const aMsgs = readMessagesFromData(aData);
    expect(aMsgs.some((m: any) => m.type === "ready")).toBe(true);

    clientA.destroy();
    await delay(150);

    const fakeCardActions = [1, 2, 3].map((i) => ({
      messageId: `card_00${i}`,
      chatId: "chat_001",
      openId: "open_001",
      action: { value: `click_${i}` },
    }));
    for (const action of fakeCardActions) {
      await cardActionHandlers[0](action);
    }

    const clientB = await connectClient();
    const bData = await new Promise<string>((resolve) => {
      let buffer = "";
      const onData = (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.trim().split("\n").filter(Boolean);
        if (lines.length >= 4) {
          clientB.off("data", onData);
          resolve(buffer);
        }
      };
      clientB.on("data", onData);
      setTimeout(() => {
        clientB.off("data", onData);
        resolve(buffer);
      }, 1000);
    });
    const bMsgs = readMessagesFromData(bData);
    expect(bMsgs.length).toBe(4);
    expect(bMsgs[0].type).toBe("ready");
    expect(bMsgs[1].type).toBe("cardAction");
    expect(bMsgs[1].messageId).toBe("card_001");
    expect(bMsgs[2].type).toBe("cardAction");
    expect(bMsgs[2].messageId).toBe("card_002");
    expect(bMsgs[3].type).toBe("cardAction");
    expect(bMsgs[3].messageId).toBe("card_003");

    clientB.destroy();
    await delay(100);
  });
});

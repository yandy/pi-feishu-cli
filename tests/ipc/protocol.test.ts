import { describe, it, expect } from "vitest";
import {
  isDaemonMessage,
  isExtensionMessage,
  createDaemonMessage,
  createExtensionMessage,
  parseMessage,
  stringifyMessage,
  type DaemonMessage,
  type ExtensionMessage,
  type MessageMessage,
} from "../../src/ipc/protocol.js";

describe("IPC Protocol", () => {
  describe("parseMessage / stringifyMessage", () => {
    it("round-trips a DaemonMessage", () => {
      const msg: DaemonMessage = { type: "ready", botIdentity: { name: "test" } };
      const json = stringifyMessage(msg);
      expect(json).toBe('{"type":"ready","botIdentity":{"name":"test"}}\n');
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips an ExtensionMessage", () => {
      const msg: ExtensionMessage = { type: "send", chatId: "oc_xxx", content: { text: "hello" } };
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("parseMessage throws on invalid JSON", () => {
      expect(() => parseMessage("not json")).toThrow();
    });

    it("parseMessage strips trailing newline", () => {
      const msg: DaemonMessage = { type: "ready", botIdentity: { name: "bot" } };
      const parsed = parseMessage('{"type":"ready","botIdentity":{"name":"bot"}}\n');
      expect(parsed).toEqual(msg);
    });
  });

  describe("createDaemonMessage / isDaemonMessage", () => {
    it("creates ready message", () => {
      const raw = createDaemonMessage("ready", { botIdentity: { name: "b" } });
      expect(raw.type).toBe("ready");
      expect(isDaemonMessage(raw)).toBe(true);
    });

    it("creates message message", () => {
      const raw = createDaemonMessage("message", {
        messageId: "m1",
        chatId: "c1",
        chatType: "p2p",
        senderId: "s1",
        content: "hi",
        rawContentType: "text",
        resources: [],
        mentions: [],
        mentionAll: false,
        mentionedBot: false,
        createTime: 1000,
      });
      expect(raw.type).toBe("message");
      const msg = raw as MessageMessage;
      expect(msg.chatId).toBe("c1");
    });

    it("isDaemonMessage rejects non-messages", () => {
      expect(isDaemonMessage({})).toBe(false);
      expect(isDaemonMessage(null)).toBe(false);
      expect(isDaemonMessage({ type: "unknown" })).toBe(false);
    });
  });

  describe("createExtensionMessage / isExtensionMessage", () => {
    it("creates send message", () => {
      const raw = createExtensionMessage("send", { chatId: "c1", content: { text: "hi" } });
      expect(raw.type).toBe("send");
      expect(isExtensionMessage(raw)).toBe(true);
    });

    it("creates shutdown message", () => {
      const raw = createExtensionMessage("shutdown", {});
      expect(raw.type).toBe("shutdown");
      expect(isExtensionMessage(raw)).toBe(true);
    });

    it("isExtensionMessage rejects non-messages", () => {
      expect(isExtensionMessage({})).toBe(false);
      expect(isExtensionMessage(null)).toBe(false);
    });
  });

  describe("Daemon round-trip tests", () => {
    it("round-trips bye", () => {
      const msg = createDaemonMessage("bye", { reason: "process exiting" });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips cardAction", () => {
      const msg = createDaemonMessage("cardAction", {
        messageId: "m1",
        chatId: "c1",
        openId: "o1",
        action: { key: "value" },
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips error", () => {
      const msg = createDaemonMessage("error", {
        message: "something went wrong",
        code: "E001",
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips needAuth", () => {
      const msg = createDaemonMessage("needAuth", {
        message: "authentication required",
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips status", () => {
      const msg = createDaemonMessage("status", {
        pid: 1234,
        uptime: 3600,
        wsConnected: true,
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips reaction", () => {
      const msg = createDaemonMessage("reaction", {
        messageId: "m1",
        chatId: "c1",
        userId: "u1",
        emoji: "👍",
        added: true,
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });
  });

  describe("Extension round-trip tests", () => {
    it("round-trips stream", () => {
      const msg = createExtensionMessage("stream", {
        chatId: "c1",
        content: "streaming...",
        replyTo: "m1",
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips streamEnd", () => {
      const msg = createExtensionMessage("streamEnd", {
        chatId: "c1",
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips updateCard", () => {
      const msg = createExtensionMessage("updateCard", {
        messageId: "m1",
        card: { title: "hello" },
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips auth", () => {
      const msg = createExtensionMessage("auth", {
        appId: "app-123",
        appSecret: "secret-abc",
      });
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });

    it("round-trips status", () => {
      const msg = createExtensionMessage("status", {});
      const json = stringifyMessage(msg);
      const parsed = parseMessage(json);
      expect(parsed).toEqual(msg);
    });
  });
});

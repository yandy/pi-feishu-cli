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
});

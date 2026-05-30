import { describe, it, expect, beforeEach } from "vitest";
import { Bot } from "../src/im/bot.js";
import { SessionRegistry } from "../src/im/session-registry.js";
import type { FeishuEvent } from "../src/im/types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

function makeMsgEvent(
  chatId: string,
  text: string,
  chatType: "p2p" | "group" = "group",
  senderId = "ou_test"
): FeishuEvent {
  return {
    type: "im.message.receive_v1",
    chat_id: chatId,
    chat_type: chatType,
    content: text,
    message_id: "om_" + Math.random().toString(36).slice(2),
    message_type: "text",
    sender_id: senderId,
    create_time: String(Date.now()),
    event_id: "ev_" + Math.random().toString(36).slice(2),
    timestamp: String(Date.now()),
    raw: { type: "im.message.receive_v1" },
  };
}

describe("Bot routing", () => {
  let tmpDir: string;
  let registry: SessionRegistry;
  let bot: Bot;

  beforeEach(() => {
    tmpDir = join(tmpdir(), "pi-feishu-cli-test-bot-" + Date.now());
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    registry = new SessionRegistry(tmpDir);
    bot = new Bot(registry, "mention", "MyBot");
  });

  it("detects /new command", () => {
    const event = makeMsgEvent("oc_chat1", "/new 我的新会话");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("new");
    }
  });

  it("detects /sessions command", () => {
    const event = makeMsgEvent("oc_chat1", "/sessions");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("sessions");
    }
  });

  it("detects /switch command", () => {
    const event = makeMsgEvent("oc_chat1", "/switch sess_123");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("switch");
    }
  });

  it("detects /rm command", () => {
    const event = makeMsgEvent("oc_chat1", "/rm sess_123");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("rm");
    }
  });

  it("detects /model command", () => {
    const event = makeMsgEvent("oc_chat1", "/model");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("model");
    }
  });

  it("routes p2p text as message in mention mode", () => {
    const event = makeMsgEvent("oc_chat1", "你好", "p2p");
    const result = bot.route(event);
    expect(result.type).toBe("message");
  });

  it("skips group text without @mention in mention mode", () => {
    const event = makeMsgEvent("oc_chat1", "你好", "group");
    const result = bot.route(event);
    expect(result.type).toBe("skip");
  });

  it("routes group text with @mention in mention mode", () => {
    const event = makeMsgEvent("oc_chat1", "@MyBot 你好", "group");
    const result = bot.route(event);
    expect(result.type).toBe("message");
  });

  it("routes all messages in open mode", () => {
    const openBot = new Bot(registry, "open");
    const event = makeMsgEvent("oc_chat1", "你好", "group");
    const result = openBot.route(event);
    expect(result.type).toBe("message");
  });

  it("routes command in group with mention strategy even without @", () => {
    const event = makeMsgEvent("oc_chat1", "/new test", "group");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("new");
    }
  });

  it("skips empty content events", () => {
    const event = { ...makeMsgEvent("oc_chat1", "", "p2p"), content: "", message_type: "image" };
    const result = bot.route(event);
    expect(result.type).toBe("skip");
  });

  it("skips bot sender messages", () => {
    const event = makeMsgEvent("oc_chat1", "hello", "p2p", "bot_12345");
    const result = bot.route(event);
    expect(result.type).toBe("skip");
  });

  it("parses JSON-encoded text content (Feishu API format)", () => {
    const event = makeMsgEvent("oc_chat1", JSON.stringify({ text: "/new json-test" }));
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("new");
    }
  });

  it("parses /model with model id argument", () => {
    const event = makeMsgEvent("oc_chat1", "/model anthropic/claude-opus-4-5");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("model");
      expect(result.args).toBe("anthropic/claude-opus-4-5");
    }
  });

  it("parses /model without args still works", () => {
    const event = makeMsgEvent("oc_chat1", "/model");
    const result = bot.route(event);
    expect(result.type).toBe("command");
    if (result.type === "command") {
      expect(result.command).toBe("model");
      expect(result.args).toBe("");
    }
  });
});

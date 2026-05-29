import { describe, it, expect, beforeEach } from "vitest";
import { Bot } from "../src/bot.js";
import { SessionRegistry } from "../src/session-registry.js";
import type { FeishuEvent } from "../src/poller.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

function makeMsgEvent(
  chatId: string,
  text: string,
  mentions?: Array<{ key: string; name: string }>,
  threadId?: string
): FeishuEvent {
  return {
    type: "im.message.receive_v1",
    event: {
      message: {
        chat_id: chatId,
        message_id: "om_" + Math.random().toString(36).slice(2),
        parent_id: threadId,
        message_type: "text",
        content: JSON.stringify({ text }),
        mentions,
      },
      sender: {
        sender_id: { open_id: "ou_test" },
        sender_type: "user",
      },
    },
    raw: {},
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
    bot = new Bot(registry, "mention");
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

  it("routes regular text as message in mention mode", () => {
    const event = makeMsgEvent("oc_chat1", "你好");
    const result = bot.route(event);
    expect(result.type).toBe("message");
  });

  it("routes all messages in open mode", () => {
    const openBot = new Bot(registry, "open");
    const event = makeMsgEvent("oc_chat1", "你好");
    const result = openBot.route(event);
    expect(result.type).toBe("message");
  });
});

import { describe, it, expect } from "vitest";
import type { FeishuImConfig, FeishuEvent, SessionInfo, ChatSessions, Registry, DaemonStatus } from "../../src/im/types.js";

describe("type definitions", () => {
  it("FeishuImConfig has correct shape", () => {
    const config: FeishuImConfig = { strategy: "mention" };
    expect(config.strategy).toBe("mention");
    expect(config.model).toBeUndefined();
    expect(config.botName).toBeUndefined();
  });

  it("FeishuEvent has all fields", () => {
    const event: FeishuEvent = {
      type: "im.message.receive_v1",
      chat_id: "oc_xxx",
      chat_type: "p2p",
      content: "hello",
      message_id: "om_xxx",
      message_type: "text",
      sender_id: "ou_xxx",
      create_time: "1700000000",
      event_id: "ev_xxx",
      timestamp: "1700000001",
      raw: {},
    };
    expect(event.chat_id).toBe("oc_xxx");
    expect(event.content).toBe("hello");
  });

  it("SessionInfo has createdAt as number", () => {
    const info: SessionInfo = { id: "abc", name: "test", createdAt: 123 };
    expect(info.createdAt).toBe(123);
  });

  it("ChatSessions active can be null", () => {
    const cs: ChatSessions = { sessions: [], active: null };
    expect(cs.active).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import type { Registry, FeishuImConfig, SessionInfo, ChatSessions } from "../src/types.js";

describe("type definitions", () => {
  it("Registry shape", () => {
    const registry: Registry = {
      "oc_xxx": {
        sessions: [
          { id: "sess_1", name: "修 bug", createdAt: 1700000000 },
        ],
        active: "sess_1",
      },
    };
    expect(registry["oc_xxx"].sessions).toHaveLength(1);
    expect(registry["oc_xxx"].active).toBe("sess_1");
  });

  it("FeishuImConfig defaults", () => {
    const config: FeishuImConfig = { strategy: "mention", pollInterval: 5 };
    expect(config.strategy).toBe("mention");
    expect(config.autoStart).toBeUndefined();
  });

  it("SessionInfo fields", () => {
    const info: SessionInfo = { id: "abc", name: "test", createdAt: 123 };
    expect(info.id).toBe("abc");
    expect(info.name).toBe("test");
    expect(info.createdAt).toBe(123);
  });

  it("ChatSessions active can be null", () => {
    const cs: ChatSessions = { sessions: [], active: null };
    expect(cs.active).toBeNull();
  });
});

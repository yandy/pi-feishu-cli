import { describe, expect, it } from "vitest";
import { getFeishuContext, setFeishuContext } from "../../src/feishu/context.js";

describe("FeishuContext", () => {
  it("returns null before any set", () => {
    expect(getFeishuContext()).toBeNull();
  });

  it("returns the value after set", () => {
    const fakeChannel = {} as any;
    setFeishuContext({ chatId: "chat-1", channel: fakeChannel });
    expect(getFeishuContext()).toEqual({ chatId: "chat-1", channel: fakeChannel });
  });

  it("returns null after set-to-null", () => {
    const fakeChannel = {} as any;
    setFeishuContext({ chatId: "chat-1", channel: fakeChannel });
    setFeishuContext(null);
    expect(getFeishuContext()).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeishuUIContext, resolvePermissionCardAction } from "../../src/feishu/permission-ui.js";

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockChannel = { send: mockSend } as any;

vi.mock("../../src/feishu/context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/feishu/context.js")>();
  return {
    ...actual,
  };
});

import { getFeishuContext, setFeishuContext } from "../../src/feishu/context.js";

function setMockContext() {
  setFeishuContext({ chatId: "test-chat", channel: mockChannel } as any);
}

function clearMockContext() {
  setFeishuContext(null);
}

describe("createFeishuUIContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMockContext();
  });

  describe("confirm()", () => {
    it("sends a card and resolves true on '是'", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("确认标题", "确认信息");
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      const sentCard = (mockSend.mock.calls[0] as any)[1]?.card as any;
      expect(sentCard.header.title.content).toBe("权限确认");

      const buttons = sentCard.body.elements.filter((e: any) => e.tag === "button");
      const yesButton = buttons.find((b: any) => b.text.content === "是");
      const value = yesButton.behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      const result = await promise;
      expect(result).toBe(true);
    });

    it("resolves false on '否'", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("确认", "message");
      await vi.runAllTicks();

      const sentCard = (mockSend.mock.calls[0] as any)[1]?.card as any;
      const buttons = sentCard.body.elements.filter((e: any) => e.tag === "button");
      const noButton = buttons.find((b: any) => b.text.content === "否");
      const value = noButton.behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      expect(await promise).toBe(false);
    });

    it("returns true when no Feishu context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      const result = await ui.confirm("title", "msg");
      expect(result).toBe(true);
    });

    it("resolves false on timeout", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.confirm("title", "msg", { timeout: 5000 });
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(5001);

      expect(await promise).toBe(false);
    });
  });

  describe("select()", () => {
    it("sends a card with one button per option", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.select("选择标题", ["选项A", "选项B", "选项C"]);
      await vi.runAllTicks();

      const sentCard = (mockSend.mock.calls[0] as any)[1]?.card as any;
      const buttons = sentCard.body.elements.filter((e: any) => e.tag === "button");
      expect(buttons).toHaveLength(3);
      expect(buttons[0].text.content).toBe("选项A");
      expect(buttons[1].text.content).toBe("选项B");
      expect(buttons[2].text.content).toBe("选项C");

      const value = buttons[1].behaviors[0].value;
      resolvePermissionCardAction(value as Record<string, unknown>);

      expect(await promise).toBe("选项B");
    });

    it("truncates long button text", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const longOption = "A".repeat(50);
      void ui.select("title", [longOption]);
      await vi.runAllTicks();

      const sentCard = (mockSend.mock.calls[0] as any)[1]?.card as any;
      const buttons = sentCard.body.elements.filter((e: any) => e.tag === "button");
      expect(buttons[0].text.content.length).toBeLessThan(50);
    });

    it("returns first option when no context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      const result = await ui.select("title", ["A", "B"]);
      expect(result).toBe("A");
    });

    it("handles AbortSignal", async () => {
      setMockContext();
      const ui = createFeishuUIContext();
      const controller = new AbortController();

      const promise = ui.select("title", ["A"], { signal: controller.signal });
      await vi.runAllTicks();

      controller.abort();
      expect(await promise).toBeUndefined();
    });
  });

  describe("notify()", () => {
    it("sends text message with prefix", () => {
      setMockContext();
      const ui = createFeishuUIContext();
      ui.notify("test message", "warning");
      expect(mockSend).toHaveBeenCalledWith("test-chat", { text: "⚠️ test message" });
    });

    it("does nothing when no context", () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      ui.notify("msg");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("input()", () => {
    it("sends a card and resolves on timeout", async () => {
      setMockContext();
      const ui = createFeishuUIContext();

      const promise = ui.input("输入标题", "占位符", { timeout: 3000 });
      await vi.runAllTicks();

      expect(mockSend).toHaveBeenCalledOnce();
      const sentCard = (mockSend.mock.calls[0] as any)[1]?.card as any;
      expect(sentCard.header.title.content).toBe("输入请求");

      vi.advanceTimersByTime(3001);
      expect(await promise).toBeUndefined();
    });

    it("returns undefined when no context", async () => {
      clearMockContext();
      const ui = createFeishuUIContext();
      expect(await ui.input("title")).toBeUndefined();
    });
  });
});

describe("resolvePermissionCardAction", () => {
  it("is a no-op for unknown dialog ids", () => {
    resolvePermissionCardAction({ perm_dialog_id: "nonexistent", perm_choice: "x" });
  });
});

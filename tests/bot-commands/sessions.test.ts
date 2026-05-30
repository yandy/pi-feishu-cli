import { describe, it, expect, vi } from "vitest";
import { rmSync } from "node:fs";
import type { SessionsAction } from "../../extensions/bot-commands/sessions.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: vi.fn(actual.rmSync),
  };
});
import {
  buildSessionsCard,
  handleSessionsAction,
} from "../../extensions/bot-commands/sessions.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockGetSessionName = vi.fn().mockReturnValue("Test Session");
  const mockGetEntries = vi.fn().mockReturnValue([
    { id: "1" },
    { id: "2" },
    { id: "3" },
  ]);
  const mockOpen = vi.fn().mockReturnValue({
    getSessionName: mockGetSessionName,
    getEntries: mockGetEntries,
  });
  return { SessionManager: { open: mockOpen } };
});

describe("buildSessionsCard", () => {
  it("returns empty state card when registry is empty", () => {
    const card = buildSessionsCard({}, "/tmp/curr.json");
    const json = JSON.stringify(card);
    expect(json).toContain("暂无绑定的会话");
    expect(json).toContain("发送任意消息即可自动创建并绑定一个新会话");
  });

  it("builds card with session rows from non-empty registry", () => {
    const registry = { chat1: "/tmp/session1.json", chat2: "/tmp/session2.json" };
    const card = buildSessionsCard(registry, "/tmp/curr.json");
    const json = JSON.stringify(card);

    expect(json).toContain("session1");
    expect(json).toContain("session2");
    expect(json).toContain("切换");
    expect(json).toContain("解绑");
    expect(json).toContain("删除");
    expect(json).toContain("新建会话");
  });

  it("marks current session with indicator and hides switch button", () => {
    const registry = { chat1: "/tmp/current.json", chat2: "/tmp/other.json" };
    const card = buildSessionsCard(registry, "/tmp/current.json");
    const json = JSON.stringify(card);

    expect(json).toContain("当前");
    expect(json).toContain("other");
  });

  it("serializes SessionsAction values in buttons", () => {
    const registry = { chat1: "/tmp/session.json" };
    const card = buildSessionsCard(registry, "/tmp/other.json");
    const json = JSON.stringify(card);

    const switchAction: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/session.json",
    };
    expect(json).toContain(JSON.stringify(switchAction));

    const deleteAction: SessionsAction = {
      cmd: "sessions",
      action: "delete",
      sessionPath: "/tmp/session.json",
    };
    expect(json).toContain(JSON.stringify(deleteAction));
  });
});

describe("SessionsAction JSON value", () => {
  it("serializes correctly", () => {
    const action: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/session.json",
    };
    expect(JSON.parse(JSON.stringify(action))).toEqual({
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/session.json",
    });
  });
});

describe("handleSessionsAction", () => {
  it("switch updates registry and calls ctx.switchSession", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined);
    const newSession = vi.fn();
    const getSessionFile = vi.fn();
    const ctx = { switchSession, newSession, getSessionFile };
    const registry: Record<string, string> = { chat1: "/tmp/old.json" };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/new.json",
    };

    await handleSessionsAction(action, ctx, registry, "chat1");

    expect(switchSession).toHaveBeenCalledWith("/tmp/new.json");
    expect(registry).toEqual({ chat1: "/tmp/new.json" });
  });

  it("unbind removes chat from registry", async () => {
    const ctx = {
      switchSession: vi.fn(),
      newSession: vi.fn(),
      getSessionFile: vi.fn(),
    };
    const registry: Record<string, string> = { chat1: "/tmp/session.json" };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "unbind",
      sessionPath: "/tmp/session.json",
    };

    await handleSessionsAction(action, ctx, registry, "chat1");
    expect(registry).toEqual({});
  });

  it("delete removes chat from registry and deletes session file", async () => {
    const ctx = {
      switchSession: vi.fn(),
      newSession: vi.fn(),
      getSessionFile: vi.fn(),
    };
    const registry: Record<string, string> = { chat1: "/tmp/session.json" };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "delete",
      sessionPath: "/tmp/session.json",
    };

    await handleSessionsAction(action, ctx, registry, "chat1");
    expect(rmSync).toHaveBeenCalledWith("/tmp/session.json", { force: true });
    expect(registry).not.toHaveProperty("chat1");
  });

  it("new creates session and updates registry", async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const getSessionFile = vi.fn().mockReturnValue("/tmp/new_session.json");
    const ctx = {
      switchSession: vi.fn(),
      newSession,
      getSessionFile,
    };
    const registry: Record<string, string> = {};

    const action: SessionsAction = {
      cmd: "sessions",
      action: "new",
      sessionPath: "",
    };

    await handleSessionsAction(action, ctx, registry, "chat1");
    expect(newSession).toHaveBeenCalled();
    expect(getSessionFile).toHaveBeenCalled();
    expect(registry).toEqual({ chat1: "/tmp/new_session.json" });
  });
});

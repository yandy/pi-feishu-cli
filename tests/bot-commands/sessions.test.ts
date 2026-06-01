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
  it("returns empty state card when sessions is empty", () => {
    const card = buildSessionsCard([], "/tmp/curr.json");
    const json = JSON.stringify(card);
    expect(json).toContain("暂无会话");
    expect(json).toContain("发送任意消息即可自动创建会话");
  });

  it("builds card with session rows from non-empty sessions array", () => {
    const sessions = ["/tmp/session1.json", "/tmp/session2.json"];
    const card = buildSessionsCard(sessions, "/tmp/curr.json");
    const json = JSON.stringify(card);

    expect(json).toContain("session1");
    expect(json).toContain("session2");
    expect(json).toContain("切换");
    expect(json).toContain("删除");
    expect(json).toContain("新建会话");
  });

  it("marks current session with indicator and hides switch and delete buttons", () => {
    const sessions = ["/tmp/current.json", "/tmp/other.json"];
    const card = buildSessionsCard(sessions, "/tmp/current.json");
    const json = JSON.stringify(card);

    expect(json).toContain("当前");
    expect(json).toContain("other");
    // Use divider as session boundary for robust slicing
    const firstHr = json.indexOf('"tag":"hr"');
    const currentSection = json.slice(0, firstHr);
    expect(currentSection).not.toContain("\"切换\"");
    expect(currentSection).not.toContain("\"删除\"");
    const otherSection = json.slice(firstHr);
    expect(otherSection).toContain("\"切换\"");
    expect(otherSection).toContain("\"删除\"");
  });

  it("serializes SessionsAction values in buttons", () => {
    const sessions = ["/tmp/session.json"];
    const card = buildSessionsCard(sessions, "/tmp/other.json");
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
  it("switch updates registry.current and calls ctx.switchSession", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined);
    const newSession = vi.fn();
    const getSessionFile = vi.fn();
    const ctx = { switchSession, newSession, getSessionFile };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/old.json"], current: "/tmp/old.json" };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/new.json",
    };

    await handleSessionsAction(action, ctx, registry);

    expect(switchSession).toHaveBeenCalledWith("/tmp/new.json");
    expect(registry.current).toBe("/tmp/new.json");
  });

  it("delete removes session from registry and deletes session file", async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const getSessionFile = vi.fn();
    const ctx = {
      switchSession: vi.fn(),
      newSession,
      getSessionFile,
    };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/session.json"], current: "/tmp/session.json" };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "delete",
      sessionPath: "/tmp/session.json",
    };

    await handleSessionsAction(action, ctx, registry);
    expect(rmSync).toHaveBeenCalledWith("/tmp/session.json", { force: true });
    expect(registry.sessions).not.toContain("/tmp/session.json");
  });

  it("new creates session and updates registry", async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const getSessionFile = vi.fn().mockReturnValue("/tmp/new_session.json");
    const ctx = {
      switchSession: vi.fn(),
      newSession,
      getSessionFile,
    };
    const registry: { sessions: string[]; current?: string } = { sessions: [] };

    const action: SessionsAction = {
      cmd: "sessions",
      action: "new",
      sessionPath: "",
    };

    await handleSessionsAction(action, ctx, registry);
    expect(newSession).toHaveBeenCalled();
    expect(getSessionFile).toHaveBeenCalled();
    expect(registry.sessions).toContain("/tmp/new_session.json");
    expect(registry.current).toBe("/tmp/new_session.json");
  });
});

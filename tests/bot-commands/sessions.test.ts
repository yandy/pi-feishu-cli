import { describe, it, expect, vi, beforeEach } from "vitest";
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
  beforeEach(() => { vi.clearAllMocks(); });
  it("switch calls ctx.switchSession and updates registry via onUpdate", async () => {
    const switchSession = vi.fn().mockImplementation(async (_path: string, opts?: { withSession?: (newCtx: any) => Promise<void> }) => {
      await opts?.withSession?.({});
    });
    const newSession = vi.fn();
    const ctx = { switchSession, newSession };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/old.json"], current: "/tmp/old.json" };
    const onUpdate = vi.fn();

    const action: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/new.json",
    };

    await handleSessionsAction(action, ctx, registry, onUpdate);

    expect(switchSession).toHaveBeenCalledWith("/tmp/new.json", expect.objectContaining({ withSession: expect.any(Function) }));
    expect(registry.current).toBe("/tmp/new.json");
    expect(onUpdate).toHaveBeenCalledWith(registry);
  });

  it("switch is no-op when target is current session", async () => {
    const switchSession = vi.fn();
    const newSession = vi.fn();
    const ctx = { switchSession, newSession };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/curr.json"], current: "/tmp/curr.json" };
    const onUpdate = vi.fn();

    const action: SessionsAction = {
      cmd: "sessions",
      action: "switch",
      sessionPath: "/tmp/curr.json",
    };

    await handleSessionsAction(action, ctx, registry, onUpdate);

    expect(switchSession).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("delete removes non-current session from registry and deletes file (no Pi API)", async () => {
    const switchSession = vi.fn();
    const newSession = vi.fn();
    const ctx = { switchSession, newSession };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/other.json", "/tmp/curr.json"], current: "/tmp/curr.json" };
    const onUpdate = vi.fn();

    const action: SessionsAction = {
      cmd: "sessions",
      action: "delete",
      sessionPath: "/tmp/other.json",
    };

    await handleSessionsAction(action, ctx, registry, onUpdate);

    expect(rmSync).toHaveBeenCalledWith("/tmp/other.json", { force: true });
    expect(registry.sessions).not.toContain("/tmp/other.json");
    expect(registry.sessions).toContain("/tmp/curr.json");
    expect(switchSession).not.toHaveBeenCalled();
    expect(newSession).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(registry);
  });

  it("delete is no-op when target is current session", async () => {
    const switchSession = vi.fn();
    const newSession = vi.fn();
    const ctx = { switchSession, newSession };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/tmp/curr.json"], current: "/tmp/curr.json" };
    const onUpdate = vi.fn();

    const action: SessionsAction = {
      cmd: "sessions",
      action: "delete",
      sessionPath: "/tmp/curr.json",
    };

    await handleSessionsAction(action, ctx, registry, onUpdate);

    expect(rmSync).not.toHaveBeenCalled();
    expect(switchSession).not.toHaveBeenCalled();
    expect(newSession).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("new creates session and calls onUpdate via withSession", async () => {
    const switchSession = vi.fn();
    const newSession = vi.fn().mockImplementation(async (opts?: { withSession?: (newCtx: any) => Promise<void> }) => {
      await opts?.withSession?.({
        sessionManager: { getSessionFile: () => "/tmp/new_session.json" },
      });
    });
    const ctx = { switchSession, newSession };
    const registry: { sessions: string[]; current?: string } = { sessions: [] };
    const onUpdate = vi.fn();

    const action: SessionsAction = {
      cmd: "sessions",
      action: "new",
      sessionPath: "",
    };

    await handleSessionsAction(action, ctx, registry, onUpdate);

    expect(newSession).toHaveBeenCalledWith(expect.objectContaining({ withSession: expect.any(Function) }));
    expect(registry.sessions).toContain("/tmp/new_session.json");
    expect(registry.current).toBe("/tmp/new_session.json");
    expect(onUpdate).toHaveBeenCalledWith(registry);
  });
});

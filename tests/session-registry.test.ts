import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionRegistry } from "../src/im/session-registry.js";

describe("SessionRegistry", () => {
  const tmpDir = join(tmpdir(), "pi-feishu-cli-test-registry");
  const registryDir = join(tmpDir, "feishu-im");

  beforeEach(() => {
    if (!existsSync(registryDir)) mkdirSync(registryDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(join(registryDir, "registry.json")); } catch {}
    try { rmdirSync(registryDir); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  });

  it("creates a new session for a new chat", () => {
    const reg = new SessionRegistry(registryDir);
    const session = reg.ensureSession("oc_chat1");
    expect(session.name).toBe("默认会话");
    expect(session.id).toBeDefined();
    const data = reg.getChatSessions("oc_chat1")!;
    expect(data.sessions).toHaveLength(1);
    expect(data.active).toBe(session.id);
  });

  it("reuses active session on subsequent calls", () => {
    const reg = new SessionRegistry(registryDir);
    const s1 = reg.ensureSession("oc_chat1");
    const s2 = reg.ensureSession("oc_chat1");
    expect(s2.id).toBe(s1.id);
    const data = reg.getChatSessions("oc_chat1")!;
    expect(data.sessions).toHaveLength(1);
  });

  it("creates a new session via command", () => {
    const reg = new SessionRegistry(registryDir);
    reg.ensureSession("oc_chat1");
    const s2 = reg.createSession("oc_chat1", "新功能开发");
    expect(s2.name).toBe("新功能开发");
    const data = reg.getChatSessions("oc_chat1")!;
    expect(data.sessions).toHaveLength(2);
    expect(data.active).toBe(s2.id);
  });

  it("switches active session", () => {
    const reg = new SessionRegistry(registryDir);
    const s1 = reg.ensureSession("oc_chat1");
    const s2 = reg.createSession("oc_chat1", "test2");
    expect(reg.getActiveSessionId("oc_chat1")).toBe(s2.id);
    reg.switchSession("oc_chat1", s1.id);
    expect(reg.getActiveSessionId("oc_chat1")).toBe(s1.id);
  });

  it("deletes a session", () => {
    const reg = new SessionRegistry(registryDir);
    const s1 = reg.ensureSession("oc_chat1");
    const s2 = reg.createSession("oc_chat1", "to-delete");
    reg.deleteSession("oc_chat1", s2.id);
    const data = reg.getChatSessions("oc_chat1")!;
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe(s1.id);
  });

  it("deleting active session switches to another", () => {
    const reg = new SessionRegistry(registryDir);
    const s1 = reg.ensureSession("oc_chat1");
    reg.createSession("oc_chat1", "test2");
    reg.deleteSession("oc_chat1", reg.getActiveSessionId("oc_chat1")!);
    expect(reg.getActiveSessionId("oc_chat1")).toBe(s1.id);
  });

  it("persists and loads registry", () => {
    const reg1 = new SessionRegistry(registryDir);
    const s1 = reg1.ensureSession("oc_chat1");
    reg1.createSession("oc_chat1", "second");
    reg1.flush();

    const reg2 = new SessionRegistry(registryDir);
    const data = reg2.getChatSessions("oc_chat1")!;
    expect(data.sessions).toHaveLength(2);
    expect(data.active).toBeDefined();
  });

  it("returns null for unknown chat", () => {
    const reg = new SessionRegistry(registryDir);
    expect(reg.getChatSessions("nonexistent")).toBeNull();
    expect(reg.getActiveSessionId("nonexistent")).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { FEISHU_IM_DIR, PID_FILE, REGISTRY_FILE } from "../../src/config.js";

// ---- Mock IPC client so getClient() doesn't need a real daemon ----

let mockIPC: MockIPCClient | null = null;

class MockIPCClient extends EventEmitter {
  connected = true;
  connect = vi.fn<() => Promise<true>>().mockResolvedValue(true);
  send = vi.fn();
  disconnect = vi.fn();
}

vi.mock("../../src/ipc/client.js", () => ({
  createIPCClient: vi.fn(() => {
    mockIPC = new MockIPCClient();
    return mockIPC;
  }),
}));

function createFreshSessionCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionManager: {
      getSessionFile: vi.fn(() => "/tmp/test-session.json"),
    },
    modelRegistry: {
      getAvailable: vi.fn(() => []),
      find: vi.fn(() => null),
    },
    model: undefined,
    ui: { notify: vi.fn(), input: vi.fn() },
    sendUserMessage: vi.fn(),
    ...overrides,
  };
}

function createStaleAwareCtx() {
  let stale = false;
  const freshCtx = createFreshSessionCtx();

  const assertNotStale = (target: string) => {
    if (stale) throw new Error(`stale ctx: ${target}`);
  };

  return {
    _freshCtx: freshCtx,
    newSession: vi.fn(async (opts?: { withSession?: (ctx: any) => Promise<void> }) => {
      stale = true;
      if (opts?.withSession) await opts.withSession(freshCtx);
    }),
    switchSession: vi.fn(async (_path: string, opts?: { withSession?: (ctx: any) => Promise<void> }) => {
      stale = true;
      if (opts?.withSession) await opts.withSession(freshCtx);
    }),
    sessionManager: {
      getSessionFile: vi.fn(() => {
        assertNotStale("sessionManager.getSessionFile");
        return undefined;
      }),
    },
    modelRegistry: {
      getAvailable: vi.fn(() => {
        assertNotStale("modelRegistry.getAvailable");
        return [];
      }),
      find: vi.fn(() => null),
    },
    model: undefined,
    ui: { notify: vi.fn(), input: vi.fn() },
  };
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(moduleDir, "../..");

function createMockAPI() {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, (...args: unknown[]) => void>();

  const api: ExtensionAPI = {
    registerCommand: vi.fn((name: string, opts: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
      commands.set(name, { name, sourceInfo: { path: "test" }, ...opts } as RegisteredCommand);
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
  } as unknown as ExtensionAPI;

  function dispatch(userInput: string): RegisteredCommand | undefined {
    if (!userInput.startsWith("/")) return undefined;
    const spaceIndex = userInput.indexOf(" ");
    const commandName = spaceIndex === -1 ? userInput.slice(1) : userInput.slice(1, spaceIndex);
    for (const cmd of commands.values()) {
      if (cmd.name === commandName) return cmd;
    }
    return undefined;
  }

  return { api, commands, dispatch, handlers };
}

describe("extension command registration", () => {
  it("registers /feishu-im commands so dispatch can find them", async () => {
    const { api, dispatch } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const found = dispatch("/feishu-im start");
    expect(found).toBeDefined();
    expect(found!.name).toBe("feishu-im");
  });

  it("dispatches all subcommands correctly", async () => {
    const { api, commands, dispatch } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const commandsList = Array.from(commands.keys());
    expect(commandsList).toEqual(["feishu-im"]);
    expect(commandsList.length).toBe(1);

    for (const input of ["/feishu-im start", "/feishu-im stop", "/feishu-im restart", "/feishu-im status"]) {
      const found = dispatch(input);
      expect(found).toBeDefined();
      expect(found!.name).toBe("feishu-im");
    }
  });
});

describe("daemon spawn integration", () => {
  const SOCKET_PATH = "/tmp/pi-feishu-im.sock";
  const DAEMON_DIR = join(process.env["HOME"] || "/tmp", ".pi", "agent", "feishu-im");

  it("daemon starts successfully when spawned from package directory", async () => {
    // Clean up from previous runs
    const { rmSync, existsSync } = await import("node:fs");
    try { rmSync(SOCKET_PATH); } catch {}
    try { rmSync(join(DAEMON_DIR, "daemon.pid")); } catch {}

    const daemonPath = join(packageDir, "src", "daemon", "index.ts");

    // VITEST must not be inherited by the daemon child process
    const { VITEST: _vitest, ...childEnv } = process.env;
    const child = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: {
        ...childEnv,
        DAEMON_START_TIME: String(Date.now()),
      },
      stdio: "pipe",
    });

    const logChunks: string[] = [];
    child.stderr?.on("data", (d: Buffer) => logChunks.push(d.toString()));

    // Wait for socket to appear
    const deadline = Date.now() + 5000;
    let socketReady = false;
    while (Date.now() < deadline) {
      if (existsSync(SOCKET_PATH)) {
        socketReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(socketReady).toBe(true);

    // Clean up
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
  }, 10000);
});

describe("stale ctx prevention after newSession / switchSession", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
  });

  afterAll(() => {
    try { unlinkSync(PID_FILE); } catch {}
  });

  beforeEach(() => {
    mockIPC = null;
    try { unlinkSync(REGISTRY_FILE); } catch {}
  });

  afterEach(async () => {
    mockIPC = null;
    // Drain pending rejections from async handlers that crashed
    await new Promise((r) => setTimeout(r, 30));
  });

  function setupExtension() {
    const { api, commands } = createMockAPI();
    (api as any).sendUserMessage = vi.fn();
    (api as any).setModel = vi.fn(async () => true);
    return { api, commands };
  }

  it("calls newSession WITH a withSession callback for bot command on new chat", async () => {
    // Write registry BEFORE init so loadRegistry() picks it up
    writeFileSync(REGISTRY_FILE, JSON.stringify({}));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = createStaleAwareCtx();
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "test-chat-new",
      content: "/sessions",
    });

    await vi.waitFor(() => {
      expect(ctx.newSession).toHaveBeenCalled();
    });

    const firstCallArg = ctx.newSession.mock.calls[0][0];
    // RED: with current code, newSession() is called WITHOUT withSession
    // This assertion will FAIL — which is what TDD expects
    expect(firstCallArg).toBeDefined();
    expect(firstCallArg!.withSession).toBeDefined();
    expect(ctx._freshCtx.sessionManager.getSessionFile).toHaveBeenCalled();
    // The stale ctx's getSessionFile must NOT have been called
    expect(ctx.sessionManager.getSessionFile).not.toHaveBeenCalled();
  });

  it("calls newSession WITH a withSession callback for /sessions bot command (registry redesign)", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: ["/tmp/.pi/test-session.json"], current: "/tmp/.pi/test-session.json" }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = createStaleAwareCtx();
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "test-chat-ex",
      content: "/sessions",
    });

    await vi.waitFor(() => {
      expect(ctx.newSession).toHaveBeenCalled();
    });

    const firstCallArg = ctx.newSession.mock.calls[0][0];
    expect(firstCallArg).toBeDefined();
    expect(firstCallArg!.withSession).toBeDefined();
    expect(ctx._freshCtx.sessionManager.getSessionFile).toHaveBeenCalled();
    expect(ctx.sessionManager.getSessionFile).not.toHaveBeenCalled();
  });

  it("sends user message directly via pi.sendUserMessage (simplified forwarding)", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: ["/tmp/.pi/msg-session.json"], current: "/tmp/.pi/msg-session.json" }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = createStaleAwareCtx();
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "test-chat-msg",
      content: "hello world",
    });

    await vi.waitFor(() => {
      expect((api as any).sendUserMessage).toHaveBeenCalledWith("hello world");
    });

    expect(ctx.newSession).not.toHaveBeenCalled();
    expect(ctx.switchSession).not.toHaveBeenCalled();
  });

  it("uses withSession when cardAction triggers session switch", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: ["/tmp/.pi/card-session.json"], current: "/tmp/.pi/card-session.json" }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = createStaleAwareCtx();
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "cardAction",
      chatId: "test-chat-card",
      messageId: "msg-1",
      action: { tag: "button", value: { cmd: "sessions", action: "switch", sessionPath: "/tmp/.pi/other.json" } },
    });

    await vi.waitFor(() => {
      expect(ctx.switchSession).toHaveBeenCalled();
    });

    const firstCallArg = ctx.switchSession.mock.calls[0][1];
    expect(firstCallArg).toBeDefined();
    expect(firstCallArg!.withSession).toBeDefined();
  });

  it("calls setModel BEFORE switchSession on cardAction model switch and avoids stale getAvailable", async () => {
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions: ["/tmp/.pi/model-session.json"], current: "/tmp/.pi/model-session.json" }));
    const { api, commands } = setupExtension();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = createStaleAwareCtx();
    ctx.modelRegistry.find = vi.fn(() => ({ provider: "openai", id: "gpt-4" })) as any;
    await cmd.handler!("start", ctx as any);

    const callOrder: string[] = [];
    (api as any).setModel = vi.fn(async () => { callOrder.push("setModel"); return true; });
    ctx.switchSession = vi.fn(async (_path: string, opts?: { withSession?: (newCtx: any) => Promise<void> }) => {
      callOrder.push("switchSession");
      await opts?.withSession?.({ modelRegistry: ctx.modelRegistry, model: ctx.model, ui: ctx.ui });
    });

    mockIPC!.emit("message", {
      type: "cardAction",
      chatId: "test-chat-model",
      messageId: "msg-model",
      action: { tag: "select_static", option: JSON.stringify({ cmd: "model", action: "select", modelProvider: "openai", modelId: "gpt-4" }) },
    });

    await vi.waitFor(() => {
      expect(callOrder.length).toBe(2);
    });

    // switchSession called first to enter session context, then setModel inside withSession
    expect(callOrder[0]).toBe("switchSession");
    expect(callOrder[1]).toBe("setModel");
    // The stale ctx's getAvailable must NOT have been called
    expect(ctx.modelRegistry.getAvailable).not.toHaveBeenCalled();
  });

});

describe("pi event hook registration", () => {
  it("does NOT register before_agent_start hook (TUI sync removed)", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const calls = (api.on as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "before_agent_start"
    );
    expect(calls.length).toBe(0);
  });

  it("does NOT register session_shutdown hook (pendingInjects removed)", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const calls = (api.on as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "session_shutdown"
    );
    expect(calls.length).toBe(0);
  });

  it("message_update handler still forwards for feishu-triggered sessions", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const handler = (api.on as any).mock.calls.find(
      (call: [string, any]) => call[0] === "message_update"
    );
    expect(handler).toBeDefined();
  });

  it("message_end handler still forwards for feishu-triggered sessions", async () => {
    const { api } = createMockAPI();
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const handler = (api.on as any).mock.calls.find(
      (call: [string, any]) => call[0] === "message_end"
    );
    expect(handler).toBeDefined();
  });
});

describe("activeChatId forwarding", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
  });

  afterAll(() => {
    try { unlinkSync(PID_FILE); } catch {}
  });

  beforeEach(() => {
    mockIPC = null;
  });

  afterEach(async () => {
    mockIPC = null;
    await new Promise((r) => setTimeout(r, 30));
  });

  function setupExtension() {
    const { api, commands } = createMockAPI();
    (api as any).sendUserMessage = vi.fn();
    return { api, commands };
  }

  it("message_update forwards stream using activeChatId", async () => {
    const { api, commands } = setupExtension();
    // Keep sendUserMessage pending so activeChatId stays set during event dispatch
    let resolveSend: () => void = () => {};
    (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-test-forward",
      content: "hello",
    });

    await vi.waitFor(() => {
      expect((api as any).sendUserMessage).toHaveBeenCalled();
    });

    const messageUpdateHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[0] === "message_update"
    )?.[1];

    await messageUpdateHandler(
      { message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
      { sessionManager: { getSessionFile: () => "/tmp/test-session.json" } },
    );

    const streamCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: any[]) => call[0]?.type === "stream"
    );
    expect(streamCalls.length).toBeGreaterThan(0);
    expect(streamCalls[0]![0]).toMatchObject({
      type: "stream",
      chatId: "oc-test-forward",
      content: "reply",
    });

    resolveSend();
  });

  it("message_end sends streamEnd for the active chat", async () => {
    const { api, commands } = setupExtension();
    let resolveSend: () => void = () => {};
    (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-test-end",
      content: "hello",
    });

    await vi.waitFor(() => {
      expect((api as any).sendUserMessage).toHaveBeenCalled();
    });

    const messageEndHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[0] === "message_end"
    )?.[1];

    await messageEndHandler(
      { message: { role: "assistant", content: [{ type: "text", text: "final" }] } },
      { sessionManager: { getSessionFile: () => "/tmp/test-session.json" } },
    );

    const streamEndCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: any[]) => call[0]?.type === "streamEnd"
    );
    expect(streamEndCalls.length).toBeGreaterThan(0);
    expect(streamEndCalls[0]![0]).toMatchObject({
      type: "streamEnd",
      chatId: "oc-test-end",
      content: "final",
    });

    resolveSend();
  });

  it("handles stale pi.sendUserMessage gracefully without crashing", async () => {
    const { api, commands } = setupExtension();
    (api as any).sendUserMessage = vi.fn().mockRejectedValue(new Error("stale ctx"));
    const ext = await import("../../extensions/index.js");
    ext.default(api);

    const cmd = commands.get("feishu-im")!;
    const ctx = {
      sessionManager: { getSessionFile: vi.fn(() => "/tmp/test-session.json") },
      ui: { notify: vi.fn(), input: vi.fn() },
      modelRegistry: { getAvailable: vi.fn(() => []) },
      model: undefined,
    };
    await cmd.handler!("start", ctx as any);

    mockIPC!.emit("message", {
      type: "message",
      chatId: "oc-stale",
      content: "hello",
    });

    // Should not throw — catch should send error message to daemon
    await vi.waitFor(() => {
      const sendCalls = (mockIPC!.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any[]) => call[0]?.type === "send" && (call[0] as any)?.content?.text?.includes("restart")
      );
      expect(sendCalls.length).toBeGreaterThan(0);
    });
  });
});

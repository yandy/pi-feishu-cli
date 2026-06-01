import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { FEISHU_IM_DIR, PID_FILE } from "../../src/config.js";

// ---- Mock IPC client so getClient() doesn't need a real daemon ----

class MockIPCClient extends EventEmitter {
    connected = true;
    connect = vi.fn<() => Promise<true>>().mockResolvedValue(true);
    send = vi.fn();
    disconnect = vi.fn();
}

/** Shared singleton — createIPCClient always returns this, so ipcClient at
 *  module scope (extensions/index.ts) is always the same mock object.
 *  Tests must call mockIPC.clear() in beforeEach to reset call history. */
const mockIPC = new MockIPCClient();

vi.mock("../../src/ipc/client.js", () => ({
    createIPCClient: vi.fn(() => mockIPC),
}));

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

        for (const input of ["/feishu-im start", "/feishu-im stop", "/feishu-im status"]) {
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
        try { rmSync(SOCKET_PATH); } catch { }
        try { rmSync(join(DAEMON_DIR, "daemon.pid")); } catch { }

        const daemonPath = join(packageDir, "src", "daemon", "index.ts");

        // VITEST must not be inherited by the daemon child process
        const { VITEST: _vitest, ...childEnv } = process.env;
        const child: ChildProcess = spawn("node", ["--import", "jiti/register", daemonPath], {
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

        // Clean up: send SIGTERM, wait up to 3s for exit, force SIGKILL if needed
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
            const exited = await Promise.race([
                new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
            ]);
            if (!exited) {
                child.kill("SIGKILL");
                await new Promise((r) => setTimeout(r, 200));
            }
        }
    }, 10000);
});

describe("pi event hook registration", () => {
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
        try { writeFileSync(PID_FILE, String(process.pid)); } catch { }
    });

    afterAll(() => {
        try { unlinkSync(PID_FILE); } catch { }
    });

    beforeEach(() => {
        mockIPC.send.mockClear();
        mockIPC.removeAllListeners();
    });

    afterEach(async () => {
        mockIPC.send.mockClear();
        mockIPC.removeAllListeners();
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
        let resolveSend: () => void = () => { };
        (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
        const ext = await import("../../extensions/index.js");
        ext.default(api);

        const cmd = commands.get("feishu-im")!;
        const ctx = {
            ui: { notify: vi.fn(), input: vi.fn() },
            modelRegistry: { getAvailable: vi.fn(() => []) },
            model: undefined,
        };
        await cmd.handler!("start", ctx as any);

        mockIPC.emit("message", {
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
            {},
        );

        const streamCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
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
        let resolveSend: () => void = () => { };
        (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
        const ext = await import("../../extensions/index.js");
        ext.default(api);

        const cmd = commands.get("feishu-im")!;
        const ctx = {
            ui: { notify: vi.fn(), input: vi.fn() },
            modelRegistry: { getAvailable: vi.fn(() => []) },
            model: undefined,
        };
        await cmd.handler!("start", ctx as any);

        mockIPC.emit("message", {
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
            {},
        );

        const streamEndCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
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
            ui: { notify: vi.fn(), input: vi.fn() },
            modelRegistry: { getAvailable: vi.fn(() => []) },
            model: undefined,
        };
        await cmd.handler!("start", ctx as any);

        mockIPC.emit("message", {
            type: "message",
            chatId: "oc-stale",
            content: "hello",
        });

        // Should not throw — catch should send error message to daemon
        await vi.waitFor(() => {
            const sendCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
                (call: any[]) => call[0]?.type === "send" && (call[0] as any)?.content?.text?.includes("start")
            );
            expect(sendCalls.length).toBeGreaterThan(0);
        });
    });

    it("registers agent_end event handler", async () => {
        const { api } = createMockAPI();
        const ext = await import("../../extensions/index.js");
        ext.default(api);

        const agentEndCalls = (api.on as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: any[]) => call[0] === "agent_end"
        );
        expect(agentEndCalls.length).toBe(1);
    });

    it("agent_end handler sends streamEnd with end: true and clears activeChatId", async () => {
        const { api, commands } = setupExtension();
        let resolveSend: () => void = () => { };
        (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
        const ext = await import("../../extensions/index.js");
        ext.default(api);

        const cmd = commands.get("feishu-im")!;
        const ctx = {
            ui: { notify: vi.fn(), input: vi.fn() },
            modelRegistry: { getAvailable: vi.fn(() => []) },
            model: undefined,
        };
        await cmd.handler!("start", ctx as any);

        mockIPC.emit("message", {
            type: "message",
            chatId: "oc-agent-end",
            content: "hello",
        });

        await vi.waitFor(() => {
            expect((api as any).sendUserMessage).toHaveBeenCalled();
        });

        // Fire agent_end — the entire conversation is done
        const agentEndHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
            (call: any[]) => call[0] === "agent_end"
        )?.[1];
        expect(agentEndHandler).toBeDefined();

        (mockIPC.send as ReturnType<typeof vi.fn>).mockClear();

        await agentEndHandler?.({ messages: [] }, {});

        const streamEndCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: any[]) => call[0]?.type === "streamEnd"
        );
        // After agent_end, streamEnd should be sent with end: true
        expect(streamEndCalls.length).toBeGreaterThan(0);
        expect(streamEndCalls[0]![0]).toMatchObject({
            type: "streamEnd",
            chatId: "oc-agent-end",
            end: true,
        });

        // After agent_end, message_update should NOT forward (activeChatId cleared)
        const messageUpdateHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
            (call: any[]) => call[0] === "message_update"
        )?.[1];

        (mockIPC.send as ReturnType<typeof vi.fn>).mockClear();

        await messageUpdateHandler?.(
            { message: { role: "assistant", content: [{ type: "text", text: "late reply" }] } },
            {},
        );

        const streamCallsAfterEnd = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: any[]) => call[0]?.type === "stream"
        );
        expect(streamCallsAfterEnd.length).toBe(0);

        resolveSend();
    });

    it("message_end does NOT clear activeChatId (multi-message conversation)", async () => {
        const { api, commands } = setupExtension();
        let resolveSend: () => void = () => { };
        (api as any).sendUserMessage = vi.fn(() => new Promise<void>(r => { resolveSend = r; }));
        const ext = await import("../../extensions/index.js");
        ext.default(api);

        const cmd = commands.get("feishu-im")!;
        const ctx = {
            ui: { notify: vi.fn(), input: vi.fn() },
            modelRegistry: { getAvailable: vi.fn(() => []) },
            model: undefined,
        };
        await cmd.handler!("start", ctx as any);

        mockIPC.emit("message", {
            type: "message",
            chatId: "oc-multi-msg",
            content: "hello",
        });

        await vi.waitFor(() => {
            expect((api as any).sendUserMessage).toHaveBeenCalled();
        });

        const messageEndHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
            (call: any[]) => call[0] === "message_end"
        )?.[1];
        const messageUpdateHandler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
            (call: any[]) => call[0] === "message_update"
        )?.[1];

        // First assistant message ends (with text)
        await messageEndHandler?.(
            { message: { role: "assistant", content: [{ type: "text", text: "first reply" }] } },
            {},
        );

        // Check that the streamEnd sent with end=false (not end=true)
        const streamEndCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: any[]) => call[0]?.type === "streamEnd"
        );
        expect(streamEndCalls.length).toBe(1);
        expect(streamEndCalls[0]![0]).toMatchObject({
            type: "streamEnd",
            chatId: "oc-multi-msg",
            end: false,
        });

        (mockIPC.send as ReturnType<typeof vi.fn>).mockClear();

        // Second assistant message arrives (e.g., after tool call)
        // activeChatId should still be set, so message_update should forward
        await messageUpdateHandler?.(
            { message: { role: "assistant", content: [{ type: "text", text: "second reply" }] } },
            {},
        );

        const streamCalls = (mockIPC.send as ReturnType<typeof vi.fn>).mock.calls.filter(
            (call: any[]) => call[0]?.type === "stream"
        );
        // Bug: with current code, this would be 0 because activeChatId was cleared
        expect(streamCalls.length).toBeGreaterThan(0);
        expect(streamCalls[0]![0]).toMatchObject({
            type: "stream",
            chatId: "oc-multi-msg",
            content: "second reply",
        });

        resolveSend();
    });
});

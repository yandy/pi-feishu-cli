import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

    const child = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: {
        ...process.env,
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

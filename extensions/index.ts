import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createIPCClient, type IPCClient } from "../src/ipc/client.js";
import { FEISHU_IM_DIR, PID_FILE, SOCKET_PATH, REGISTRY_FILE } from "../src/config.js";
import type { DaemonMessage, ExtensionMessage } from "../src/ipc/protocol.js";

interface SessionRegistry {
  [chatId: string]: string;
}

function loadRegistry(): SessionRegistry {
  try {
    if (!existsSync(REGISTRY_FILE)) return {};
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveRegistry(reg: SessionRegistry): void {
  mkdirSync(FEISHU_IM_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

function isDaemonRunning(): boolean {
  try {
    if (!existsSync(PID_FILE)) return false;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnDaemon(): void {
  mkdirSync(FEISHU_IM_DIR, { recursive: true });

  // Resolve the daemon entry point relative to this extension file
  const daemonPath = new URL("../src/daemon/index.ts", import.meta.url).pathname;

  const child = spawn("node", ["--import", "jiti/register", daemonPath], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: {
      ...process.env,
      DAEMON_START_TIME: String(Date.now()),
    },
  });

  child.unref();
}

async function waitForSocket(timeoutMs: number = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(SOCKET_PATH)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

export default function (pi: ExtensionAPI) {
  const registry = loadRegistry();
  let ipcClient: IPCClient | null = null;
  const pendingInjects = new Set<string>();
  let injectSequence = 0;

  async function getClient(ctx: { ui: { notify: (msg: string, level: string) => void } }): Promise<IPCClient | null> {
    if (ipcClient?.connected) return ipcClient;

    if (!isDaemonRunning()) {
      spawnDaemon();
      ctx.ui.notify("Daemon spawned, waiting for socket...", "info");
      if (!(await waitForSocket())) {
        ctx.ui.notify("Daemon failed to start", "error");
        return null;
      }
    }

    ipcClient = createIPCClient(SOCKET_PATH);
    try {
      await ipcClient.connect();
    } catch (err) {
      ctx.ui.notify(`Failed to connect: ${(err as Error).message}`, "error");
      ipcClient = null;
      return null;
    }

    ipcClient.on("disconnect", () => {
      ipcClient = null;
    });

    return ipcClient;
  }

  function sendToDaemon(msg: ExtensionMessage): void {
    if (!ipcClient?.connected) return;
    ipcClient.send(msg);
  }

  // ---- Commands ----

  pi.registerCommand("feishu-im start", {
    description: "Start Feishu IM communication",
    handler: async (_args, ctx) => {
      const client = await getClient(ctx);
      if (!client) return;

      ctx.ui.notify("Connected to daemon", "info");

      client.on("message", async (msg: DaemonMessage) => {
        switch (msg.type) {
          case "ready": {
            ctx.ui.notify(`Feishu bot online: ${msg.botIdentity.name}`, "info");
            break;
          }

          case "needAuth": {
            ctx.ui.notify(msg.message, "warning");
            const appId = await ctx.ui.input("Enter Feishu App ID");
            if (!appId) return;
            const appSecret = await ctx.ui.input("Enter Feishu App Secret");
            if (!appSecret) return;
            sendToDaemon({ type: "auth", appId, appSecret });
            break;
          }

          case "message": {
            const tag = `[feishu:#${++injectSequence}]`;
            pendingInjects.add(tag);

            let prompt = tag + " " + msg.content;
            if (msg.resources?.length) {
              prompt += "\n\nAttachments: " + msg.resources
                .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                .join(", ");
            }

            const sessionFile = registry[msg.chatId];
            if (sessionFile) {
              try { await ctx.switchSession(sessionFile); } catch {}
            } else {
              // New chat: create session mapping later when session is created
            }

            await pi.sendUserMessage(prompt);

            // After sending the message, capture the new session path
            const newSessionFile = ctx.sessionManager.getSessionFile();
            if (newSessionFile && !registry[msg.chatId]) {
              registry[msg.chatId] = newSessionFile;
              saveRegistry(registry);
            }
            break;
          }

          case "cardAction": {
            ctx.ui.notify("Card action received", "info");
            break;
          }

          case "error": {
            ctx.ui.notify(`Feishu error: ${msg.message}`, "error");
            break;
          }

          case "status": {
            ctx.ui.notify(
              `PID: ${msg.pid}, Uptime: ${Math.round(msg.uptime / 1000)}s, WS: ${msg.wsConnected ? "connected" : "disconnected"}`,
              "info",
            );
            break;
          }
        }
      });

      client.send({ type: "status" });
    },
  });

  pi.registerCommand("feishu-im stop", {
    description: "Stop Feishu IM communication",
    handler: async (_args, ctx) => {
      if (!existsSync(SOCKET_PATH)) {
        ctx.ui.notify("Daemon is not running", "info");
        return;
      }

      try {
        const client = createIPCClient(SOCKET_PATH);
        await client.connect();
        client.send({ type: "shutdown" });
        client.disconnect();
        ctx.ui.notify("Shutdown sent, daemon will stop", "info");
      } catch {
        ctx.ui.notify("Failed to connect to daemon", "error");
      }

      ipcClient?.disconnect();
      ipcClient = null;
    },
  });

  pi.registerCommand("feishu-im restart", {
    description: "Restart Feishu IM communication",
    handler: async (_args, ctx) => {
      if (existsSync(SOCKET_PATH)) {
        try {
          const client = createIPCClient(SOCKET_PATH);
          await client.connect();
          client.send({ type: "shutdown" });
          client.disconnect();
          await new Promise((r) => setTimeout(r, 500));
        } catch {}
      }

      try { rmSync(SOCKET_PATH); } catch {}
      try { rmSync(PID_FILE); } catch {}
      ipcClient?.disconnect();
      ipcClient = null;

      const client = await getClient(ctx);
      if (client) {
        client.send({ type: "status" });
      }
    },
  });

  pi.registerCommand("feishu-im status", {
    description: "View Feishu IM communication status",
    handler: async (_args, ctx) => {
      if (!isDaemonRunning()) {
        ctx.ui.notify("Daemon is not running", "info");
        return;
      }

      if (!existsSync(SOCKET_PATH)) {
        ctx.ui.notify("Daemon PID found but socket not ready", "info");
        return;
      }

      const client = createIPCClient(SOCKET_PATH);
      try {
        await client.connect();
        client.on("message", (msg) => {
          if (msg.type === "status") {
            ctx.ui.notify(
              `PID: ${msg.pid}, Uptime: ${Math.round(msg.uptime / 1000)}s, WS: ${msg.wsConnected ? "connected" : "disconnected"}`,
              "info",
            );
            client.disconnect();
          }
        });
        client.send({ type: "status" });
      } catch {
        ctx.ui.notify("Cannot query daemon status", "warning");
      }
    },
  });

  // ---- Pi → Feishu forwarding ----

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!ipcClient?.connected) return;

    if (pendingInjects.size > 0) {
      for (const tag of pendingInjects) {
        if (event.prompt?.startsWith(tag)) {
          pendingInjects.delete(tag);
          return;
        }
      }
    }

    const sessionFile = _ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
    if (!chatId) return;

    sendToDaemon({ type: "send", chatId, content: { text: event.prompt } });
  });

  pi.on("message_update", async (event, _ctx) => {
    if (!ipcClient?.connected) return;
    if (event.message.role !== "assistant") return;

    const sessionFile = _ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
    if (!chatId) return;

    const textContent = event.message.content?.find(
      (c: { type: string }) => c.type === "text"
    ) as { text?: string } | undefined;
    if (textContent?.text) {
      sendToDaemon({ type: "stream", chatId, content: textContent.text });
    }
  });

  pi.on("message_end", async (event, _ctx) => {
    if (!ipcClient?.connected) return;
    if (event.message.role !== "assistant") return;

    const sessionFile = _ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
    if (!chatId) return;

    sendToDaemon({ type: "streamEnd", chatId });
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    pendingInjects.clear();
  });
}

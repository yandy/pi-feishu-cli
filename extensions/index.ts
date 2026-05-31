import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { createIPCClient, type IPCClient } from "../src/ipc/client.js";
import { FEISHU_IM_DIR, PID_FILE, SOCKET_PATH, REGISTRY_FILE } from "../src/config.js";
import type { DaemonMessage, ExtensionMessage } from "../src/ipc/protocol.js";
import { parseBotCommand } from "./bot-commands/router.js";
import { buildHelpCard } from "./bot-commands/help.js";
import { buildSessionsCard, handleSessionsAction } from "./bot-commands/sessions.js";
import { buildModelCard, handleModelAction } from "./bot-commands/model.js";

// Package root directory — used as cwd when spawning the daemon so that jiti
// resolves from the package's own node_modules regardless of process.cwd().
const PACKAGE_DIR = new URL("..", import.meta.url).pathname;

export interface SessionRegistry {
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

  const daemonPath = new URL("../src/daemon/index.ts", import.meta.url).pathname;

  const child = spawn("node", ["--import", "jiti/register", daemonPath], {
    detached: true,
    stdio: "ignore",
    cwd: PACKAGE_DIR,
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

export default function(pi: ExtensionAPI) {
    const registry = loadRegistry();
    let ipcClient: IPCClient | null = null;
    const forwardingSessions = new Set<string>();

    type NotifyFn = (msg: string, level?: "error" | "info" | "warning") => void;
    type OnMessageFn = (msg: DaemonMessage) => void;
    async function getClient(
        ctx: { ui: { notify: NotifyFn } },
        onMessage?: OnMessageFn,
    ): Promise<IPCClient | null> {
        if (ipcClient?.connected) {
            if (onMessage) ipcClient.on("message", onMessage);
            return ipcClient;
        }

        if (!isDaemonRunning()) {
            spawnDaemon();
            ctx.ui.notify("Daemon spawned, waiting for socket...", "info");
            if (!(await waitForSocket())) {
                let detail = "socket not created within timeout";
                const logPath = `${FEISHU_IM_DIR}/daemon.log`;
                try {
                    if (existsSync(logPath)) {
                        const logContent = readFileSync(logPath, "utf-8");
                        const lastLines = logContent.trim().split("\n").slice(-5).join("\n");
                        detail += `\nDaemon log (last 5 lines):\n${lastLines}`;
                    } else {
                        detail += "\nNo daemon log found - daemon may have failed to start";
                    }
                } catch { }
                ctx.ui.notify(`Daemon failed to start: ${detail}`, "error");
                return null;
            }
        }

        ipcClient = createIPCClient(SOCKET_PATH);

        if (onMessage) {
            ipcClient.on("message", onMessage);
        }

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

    pi.registerCommand("feishu-im", {
        description: "Feishu IM integration commands. Subcommands: start, stop, restart, status",
        handler: async (args, ctx) => {
            const subcommand = args.trim().split(/\s+/)[0];

            switch (subcommand) {
                case "start": {
                    const client = await getClient(ctx, async (msg) => {
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
                                const botCmd = parseBotCommand(msg.content);

                                if (botCmd) {
                                    if (botCmd !== "help") {
                                        const sessionFile = registry[msg.chatId];
                                        if (!sessionFile) {
                                            await ctx.newSession({ withSession: async (newCtx) => {
                                                const sf = newCtx.sessionManager.getSessionFile();
                                                if (sf) {
                                                    registry[msg.chatId] = sf;
                                                    saveRegistry(registry);
                                                }
                                                let card: unknown;
                                                if (botCmd === "sessions") {
                                                    card = buildSessionsCard(registry, newCtx.sessionManager.getSessionFile() || "");
                                                } else if (botCmd === "model") {
                                                    const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                                    card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                                                }
                                                sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                            }});
                                        } else {
                                            try {
                                                await ctx.switchSession(sessionFile, { withSession: async (newCtx) => {
                                                    let card: unknown;
                                                    if (botCmd === "sessions") {
                                                        card = buildSessionsCard(registry, newCtx.sessionManager.getSessionFile() || "");
                                                    } else if (botCmd === "model") {
                                                        const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                                        card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                                                    }
                                                    sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                                }});
                                            } catch { }
                                        }
                                        return;
                                    }

                                    const card = buildHelpCard();
                                    sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                    return;
                                }

                                const prompt = msg.content + (msg.resources?.length
                                    ? "\n\nAttachments: " + msg.resources
                                        .map((r) => `${r.type}${r.fileName ? ` ${r.fileName}` : ""}`)
                                        .join(", ")
                                    : "");

                                const sessionFile = registry[msg.chatId];
                                if (sessionFile) {
                                    try {
                                        forwardingSessions.add(sessionFile);
                                        await ctx.switchSession(sessionFile, { withSession: async (newCtx) => {
                                            try {
                                                await newCtx.sendUserMessage(prompt);
                                            } finally {
                                                forwardingSessions.delete(sessionFile);
                                            }
                                            const newSessionFile = newCtx.sessionManager.getSessionFile();
                                            if (newSessionFile && !registry[msg.chatId]) {
                                                registry[msg.chatId] = newSessionFile;
                                                saveRegistry(registry);
                                            }
                                        }});
                                    } catch {
                                        forwardingSessions.delete(sessionFile);
                                    }
                                } else {
                                    const currentSession = ctx.sessionManager.getSessionFile();
                                    if (currentSession) forwardingSessions.add(currentSession);
                                    try {
                                        await pi.sendUserMessage(prompt);
                                    } finally {
                                        if (currentSession) forwardingSessions.delete(currentSession);
                                    }
                                    const newSessionFile = ctx.sessionManager.getSessionFile();
                                    if (newSessionFile && !registry[msg.chatId]) {
                                        registry[msg.chatId] = newSessionFile;
                                        saveRegistry(registry);
                                    }
                                }
                                break;
                            }

                            case "cardAction": {
                                const rawAction = msg.action as Record<string, unknown> | undefined;
                                if (!rawAction) return;

                                let parsed: Record<string, string> | null = null;
                                if (rawAction.tag === "button") {
                                    parsed = rawAction.value as Record<string, string>;
                                } else if (rawAction.tag === "select_static") {
                                    try {
                                        parsed = JSON.parse(rawAction.option as string);
                                    } catch {}
                                }
                                if (!parsed) return;

                                if (parsed.cmd === "sessions") {
                                    const sessionsAction = parsed as unknown as import("./bot-commands/sessions.js").SessionsAction;
                                    let afterSessionFile: string | undefined;
                                    await handleSessionsAction(
                                        sessionsAction,
                                        {
                                            switchSession: async (p: string) => {
                                                await ctx.switchSession(p, { withSession: async (newCtx) => {
                                                    afterSessionFile = newCtx.sessionManager.getSessionFile();
                                                }});
                                            },
                                            newSession: async () => {
                                                await ctx.newSession({ withSession: async (newCtx) => {
                                                    afterSessionFile = newCtx.sessionManager.getSessionFile();
                                                }});
                                            },
                                            getSessionFile: () => afterSessionFile ?? ctx.sessionManager.getSessionFile(),
                                        },
                                        registry,
                                        msg.chatId,
                                    );
                                    saveRegistry(registry);
                                    const card = buildSessionsCard(registry, afterSessionFile ?? ctx.sessionManager.getSessionFile() ?? "");
                                    sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                } else if (parsed.cmd === "model") {
                                    const modelAction = parsed as unknown as import("./bot-commands/model.js").ModelAction;
                                    const modelSet = await handleModelAction(
                                        modelAction,
                                        {
                                            switchSession: ctx.switchSession,
                                            newSession: ctx.newSession,
                                            modelRegistry: ctx.modelRegistry,
                                        },
                                        registry,
                                        msg.chatId,
                                        (m) => pi.setModel(m as any),
                                    );
                                    saveRegistry(registry);
                                    const sessionPath = registry[msg.chatId];
                                    if (sessionPath) {
                                        await ctx.switchSession(sessionPath, { withSession: async (newCtx: any) => {
                                            const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                            const card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                                            sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                            if (modelSet) newCtx.ui.notify("模型切换成功", "info");
                                        }});
                                    }
                                }
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

                            case "bye": {
                                ctx.ui.notify("Connection rejected: daemon already has an active client", "warning");
                                break;
                            }

                            case "reaction": {
                                ctx.ui.notify(
                                    `用户 ${msg.userId} ${msg.added ? "添加" : "移除"}了表情 ${msg.emoji}`,
                                    "info",
                                );
                                break;
                            }
                        }
                    });
                    if (!client) return;

                    ctx.ui.notify("Connected to daemon", "info");
                    client.send({ type: "status" });
                    break;
                }

                case "stop": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "shutdown" });
                        ipcClient.disconnect();
                        ipcClient = null;
                        ctx.ui.notify("Shutdown sent, daemon will stop", "info");
                        return;
                    }

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
                    break;
                }

                case "restart": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "shutdown" });
                        ipcClient.disconnect();
                        ipcClient = null;
                        await new Promise((r) => setTimeout(r, 500));
                    } else if (existsSync(SOCKET_PATH)) {
                        try {
                            const client = createIPCClient(SOCKET_PATH);
                            await client.connect();
                            client.send({ type: "shutdown" });
                            client.disconnect();
                            await new Promise((r) => setTimeout(r, 500));
                        } catch { }
                    }

                    try { unlinkSync(SOCKET_PATH); } catch { }
                    try { rmSync(PID_FILE); } catch { }

                    const client = await getClient(ctx);
                    if (client) {
                        client.send({ type: "status" });
                    }
                    break;
                }

                case "status": {
                    if (ipcClient?.connected) {
                        ipcClient.send({ type: "status" });
                        return;
                    }

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
                    break;
                }

                default: {
                    ctx.ui.notify(
                        "Unknown subcommand. Usage: /feishu-im <start|stop|restart|status>",
                        "warning",
                    );
                }
            }
        },
    });

    // ---- Pi → Feishu forwarding ----

    pi.on("message_update", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;

        const sessionFile = _ctx.sessionManager.getSessionFile();
        if (!sessionFile) return;
        if (!forwardingSessions.has(sessionFile)) return;
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
        if (!forwardingSessions.has(sessionFile)) return;
        const chatId = Object.keys(registry).find((k) => registry[k] === sessionFile);
        if (!chatId) return;

        forwardingSessions.delete(sessionFile);
        sendToDaemon({ type: "streamEnd", chatId });
    });
}

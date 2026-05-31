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

export interface Registry {
    sessions: string[];
    current?: string;
}

function loadRegistry(): Registry {
    try {
        if (!existsSync(REGISTRY_FILE)) return { sessions: [] };
        const data = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
        return { sessions: data.sessions || [], current: data.current };
    } catch {
        return { sessions: [] };
    }
}

function saveRegistry(reg: Registry): void {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    const sessions = [...new Set(reg.sessions)];
    writeFileSync(REGISTRY_FILE, JSON.stringify({ sessions, current: reg.current }, null, 2), "utf-8");
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

  const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
  const child = spawn("node", ["--import", "jiti/register", daemonPath], {
    detached: true,
    stdio: "ignore",
    cwd: PACKAGE_DIR,
    env: {
      ...childEnv,
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
    let activeChatId: string | null = null;
    let forwardingCount = 0;

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
                                    if (botCmd === "sessions") {
                                        try {
                                            await ctx.newSession({ withSession: async (newCtx) => {
                                                const sf = newCtx.sessionManager.getSessionFile();
                                                if (sf) {
                                                    const sessions = [...new Set([...registry.sessions, sf])];
                                                    registry.sessions = sessions;
                                                    registry.current = sf;
                                                    saveRegistry(registry);
                                                }
                                                const card = buildSessionsCard(registry.sessions, registry.current || "");
                                                sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                            }});
                                        } catch {
                                            const card = buildSessionsCard(registry.sessions, registry.current || "");
                                            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                        }
                                        return;
                                    }

                                    if (botCmd === "model") {
                                        try {
                                            await ctx.newSession({ withSession: async (newCtx) => {
                                                const sf = newCtx.sessionManager.getSessionFile();
                                                if (sf) {
                                                    const sessions = [...new Set([...registry.sessions, sf])];
                                                    registry.sessions = sessions;
                                                    registry.current = sf;
                                                    saveRegistry(registry);
                                                }
                                                const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                                const card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                                                sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
                                            }});
                                        } catch {
                                            const card = buildModelCard([], undefined);
                                            sendToDaemon({ type: "send", chatId: msg.chatId, content: { card } });
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

                                activeChatId = msg.chatId;
                                forwardingCount++;
                                // Ensure current session is registered
                                try {
                                    const currentSession = ctx.sessionManager.getSessionFile();
                                    if (currentSession && !registry.sessions.includes(currentSession)) {
                                        registry.sessions = [...new Set([...registry.sessions, currentSession])];
                                        registry.current = currentSession;
                                        saveRegistry(registry);
                                    }
                                } catch {}
                                try {
                                    await pi.sendUserMessage(prompt);
                                } catch {
                                    sendToDaemon({ type: "send", chatId: msg.chatId, content: { text: "Pi 会话已失效，请执行 /feishu-im restart" } });
                                    activeChatId = null;
                                    forwardingCount = 0;
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
                                    try {
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
                                                getSessionFile: () => afterSessionFile,
                                            },
                                            registry,
                                        );
                                        if (afterSessionFile) {
                                            registry.current = afterSessionFile;
                                            registry.sessions = [...new Set([...registry.sessions, afterSessionFile])];
                                        }
                                        saveRegistry(registry);
                                        const card = buildSessionsCard(registry.sessions, registry.current || "");
                                        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                    } catch {
                                        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildSessionsCard([], "") });
                                    }
                                } else if (parsed.cmd === "model") {
                                    try {
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
                                        try {
                                            await ctx.newSession({ withSession: async (newCtx: any) => {
                                                const models = newCtx.modelRegistry.getAvailable() as Array<{ provider: string; id: string; name: string }>;
                                                const card = buildModelCard(models, newCtx.model ? { provider: newCtx.model.provider, id: newCtx.model.id } : undefined);
                                                sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
                                            }});
                                        } catch {
                                            sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
                                        }
                                    } catch {
                                        sendToDaemon({ type: "updateCard", messageId: msg.messageId, card: buildModelCard([], undefined) });
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
                    } else if (existsSync(SOCKET_PATH)) {
                        try {
                            const client = createIPCClient(SOCKET_PATH);
                            await client.connect();
                            client.send({ type: "shutdown" });
                            client.disconnect();
                        } catch { }
                    }

                    // Wait for old daemon to actually exit (PID file gone)
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline && isDaemonRunning()) {
                        await new Promise((r) => setTimeout(r, 100));
                    }
                    // Force clean stale files
                    try { unlinkSync(SOCKET_PATH); } catch {}
                    try { rmSync(PID_FILE); } catch {}

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
        if (!activeChatId) return;

        try {
            const textContent = event.message.content?.find(
                (c: { type: string }) => c.type === "text"
            ) as { text?: string } | undefined;
            if (textContent?.text) {
                sendToDaemon({ type: "stream", chatId: activeChatId, content: textContent.text });
            }
        } catch (e) {
            // message_update event structure may differ by model
        }
    });

    pi.on("message_end", async (event, _ctx) => {
        if (!ipcClient?.connected) return;
        if (event.message.role !== "assistant") return;
        if (!activeChatId) return;

        const chatId = activeChatId;
        if (--forwardingCount <= 0) {
            forwardingCount = 0;
            activeChatId = null;
        }

        // Extract final content as fallback in case message_update never fired
        let finalContent: string | undefined;
        try {
            const textContent = event.message.content?.find(
                (c: { type: string }) => c.type === "text"
            ) as { text?: string } | undefined;
            finalContent = textContent?.text;
        } catch {}

        sendToDaemon({ type: "streamEnd", chatId, content: finalContent });
    });
}

import { writeFileSync, readFileSync, mkdirSync, existsSync, createWriteStream, rmSync, unlinkSync } from "node:fs";
import * as net from "node:net";
import { createIPCServer } from "../ipc/server.js";
import { createFeishuChannel, type Channel } from "../channel/index.js";
import { loadAuth, saveAuth } from "../auth/index.js";
import { FEISHU_IM_DIR, SOCKET_PATH, PID_FILE, DAEMON_LOG } from "../config.js";
import type { DaemonMessage, ExtensionMessage } from "../ipc/protocol.js";

export async function main() {
  mkdirSync(FEISHU_IM_DIR, { recursive: true });

  // PID file exclusive lock (wx flag + PID alive check)
  try {
    writeFileSync(PID_FILE, String(process.pid), { flag: "wx", encoding: "utf-8" });
  } catch (e: any) {
    if (e.code === "EEXIST") {
      try {
        const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        process.kill(oldPid, 0);
        // Old process is alive — another daemon running
        process.exit(0);
      } catch {
        // Old process is dead — clean up stale PID
        try { rmSync(PID_FILE); } catch {}
        try {
          writeFileSync(PID_FILE, String(process.pid), { flag: "wx", encoding: "utf-8" });
        } catch {
          process.exit(1);
        }
      }
    } else {
      throw e;
    }
  }

  const logStream = createWriteStream(DAEMON_LOG, { flags: "a" });
  const log = (level: string, msg: string) => {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    logStream.write(line);
  };

  log("info", `Daemon started (pid=${process.pid})`);

  const cleanup = async () => {
    log("info", "Daemon shutting down");
    try { await channel?.disconnect(); } catch {}
    await ipcServer.close().catch(() => {});
    try { unlinkSync(SOCKET_PATH); } catch {}
    try { rmSync(PID_FILE); } catch {}
    logStream.end();
    process.exit(0);
  };

  process.on("SIGINT", () => { void cleanup(); });
  process.on("SIGTERM", () => { void cleanup(); });

  const ipcServer = createIPCServer(SOCKET_PATH);
  await ipcServer.listen();
  log("info", `IPC server listening on ${SOCKET_PATH}`);

  let creds = loadAuth(FEISHU_IM_DIR);
  let channel: Channel | null = null;

  const connectChannel = async (appId: string, appSecret: string): Promise<void> => {
    if (channel?.connected) {
      await channel.disconnect();
    }
    channel = createFeishuChannel({
      appId,
      appSecret,
      outbound: {
        streamInitialText: "🤔 Pi 思考中...",
      },
    });

    channel.on("message", async (msg) => {
      log("info", `Received message from ${msg.chatId}`);
      const daemonMsg: DaemonMessage = {
        type: "message",
        messageId: msg.messageId,
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        rawContentType: msg.rawContentType,
        resources: msg.resources as unknown as any[],
        mentions: msg.mentions as unknown as any[],
        mentionAll: msg.mentionAll,
        mentionedBot: msg.mentionedBot,
        rootId: msg.rootId as string | undefined,
        threadId: msg.threadId as string | undefined,
        replyToMessageId: msg.replyToMessageId as string | undefined,
        createTime: msg.createTime,
      };
      const sent = ipcServer.sendToClient(daemonMsg);
      if (!sent) {
        pendingMessages.push(daemonMsg);
        if (channel?.connected) {
          try {
            await channel.send(msg.chatId, {
              text: "Pi 暂时离线，请稍后再试。",
            }, { replyTo: msg.messageId });
          } catch {}
        }
      }
    });

    channel.on("cardAction", async (evt) => {
      log("info", `Card action from ${(evt as any).chatId}`);
      const daemonMsg: DaemonMessage = {
        type: "cardAction",
        messageId: (evt as any).messageId ?? "",
        chatId: (evt as any).chatId ?? "",
        openId: (evt as any).openId ?? "",
        action: (evt as any).action ?? {},
      };
      const sent = ipcServer.sendToClient(daemonMsg);
      if (!sent) {
        pendingMessages.push(daemonMsg);
      }
    });

    channel.on("reaction", async (evt) => {
      log("info", `Reaction from ${(evt as any).chatId}: ${(evt as any).emoji} ${(evt as any).added ? 'added' : 'removed'}`);
      ipcServer.sendToClient({
        type: "reaction",
        messageId: (evt as any).messageId ?? "",
        chatId: (evt as any).chatId ?? "",
        userId: (evt as any).userId ?? "",
        emoji: (evt as any).emoji ?? "",
        added: (evt as any).added ?? true,
      });
    });

    channel.on("error", (err: Error) => {
      log("error", `Channel error: ${err.message}`);
      ipcServer.sendToClient({ type: "error", message: err.message });
    });

    channel.on("reconnecting", () => log("info", "WebSocket reconnecting"));
    channel.on("reconnected", () => log("info", "WebSocket reconnected"));

    await channel.connect();
    log("info", "Feishu channel connected");
  };

  interface StreamSession {
    replyTo?: string;
    pendingChunks: string[];
    ended: boolean;
    notify: () => void;
  }
  const activeStreams = new Map<string, StreamSession>();

  const pendingMessages: DaemonMessage[] = [];
  const flushPending = (socket: net.Socket) => {
    for (const msg of pendingMessages) ipcServer.send(socket, msg);
    pendingMessages.length = 0;
  };

  ipcServer.on("message", async (msg: ExtensionMessage, socket) => {
    log("info", `IPC message: ${msg.type}`);

    switch (msg.type) {
      case "auth": {
        try {
          await connectChannel(msg.appId, msg.appSecret);
          saveAuth(FEISHU_IM_DIR, msg.appId, msg.appSecret);
          creds = { appId: msg.appId, appSecret: msg.appSecret };
          ipcServer.send(socket, {
            type: "ready",
            botIdentity: { name: channel?.botIdentity?.name ?? "bot" },
          });
        } catch (err) {
          log("error", `Auth failed: ${(err as Error).message}`);
          ipcServer.send(socket, {
            type: "needAuth",
            message: `认证失败: ${(err as Error).message}`,
          });
        }
        break;
      }

      case "send": {
        if (!channel?.connected) {
          ipcServer.send(socket, { type: "error", message: "Channel not connected" });
          return;
        }
        try {
          await channel.send(msg.chatId, msg.content as any, {
            replyTo: msg.replyTo,
            replyInThread: msg.replyInThread,
          });
        } catch (err) {
          log("error", `Send failed: ${(err as Error).message}`);
        }
        break;
      }

      case "stream": {
        if (!channel?.connected) return;
        let session = activeStreams.get(msg.chatId);
        if (!session) {
          session = {
            replyTo: msg.replyTo,
            pendingChunks: [msg.content],
            ended: false,
            notify: () => {},
          };
          activeStreams.set(msg.chatId, session);

          channel.stream(msg.chatId, {
            markdown: async (controller) => {
              while (!session!.ended || session!.pendingChunks.length > 0) {
                if (session!.pendingChunks.length > 0) {
                  await controller.append(session!.pendingChunks.shift()!);
                } else {
                  await new Promise<void>((resolve) => {
                    session!.notify = resolve;
                  });
                }
              }
            },
          }, { replyTo: msg.replyTo }).catch((err) => {
            log("error", `Stream failed: ${(err as Error).message}`);
          }).finally(() => {
            activeStreams.delete(msg.chatId);
          });
        } else {
          session.pendingChunks.push(msg.content);
          session.notify();
        }
        break;
      }

      case "streamEnd": {
        if (!channel?.connected) return;
        const session = activeStreams.get(msg.chatId);
        if (session) {
          session.ended = true;
          session.notify();
        }
        break;
      }

      case "updateCard": {
        if (!channel?.connected) return;
        try {
          await channel.updateCard(msg.messageId, msg.card);
        } catch (err) {
          log("error", `UpdateCard failed: ${(err as Error).message}`);
        }
        break;
      }

      case "status": {
        const startTime = parseInt(process.env["DAEMON_START_TIME"] ?? "0", 10);
        ipcServer.send(socket, {
          type: "status",
          pid: process.pid,
          uptime: startTime ? Date.now() - startTime : 0,
          wsConnected: channel?.connected ?? false,
        });
        break;
      }

      case "shutdown": {
        log("info", "Shutdown requested via IPC");
        try { await channel?.disconnect(); } catch {}
        await cleanup();
        break;
      }
    }
  });

  ipcServer.on("connect", (socket) => {
    log("info", "Extension connected");
    if (creds) {
      if (channel?.connected) {
        ipcServer.send(socket, {
          type: "ready",
          botIdentity: { name: channel.botIdentity?.name ?? "bot" },
        });
        flushPending(socket);
      } else {
        connectChannel(creds.appId, creds.appSecret)
          .then(() => {
            ipcServer.send(socket, {
              type: "ready",
              botIdentity: { name: channel?.botIdentity?.name ?? "bot" },
            });
            flushPending(socket);
          })
          .catch((err: Error) => {
            log("error", `Auto-connect failed: ${err.message}`);
            ipcServer.send(socket, {
              type: "needAuth",
              message: `自动连接失败: ${err.message}`,
            });
            flushPending(socket);
          });
      }
    } else {
      ipcServer.send(socket, {
        type: "needAuth",
        message: "请配置飞书应用凭据: App ID 和 App Secret",
      });
      flushPending(socket);
    }
  });

  ipcServer.on("disconnect", () => {
    log("info", "Extension disconnected");
  });

  ipcServer.on("reject", () => {
    log("info", "Rejected new connection - already connected");
  });
}

if (!process.env["VITEST"]) {
  main().catch((err) => {
    console.error("Daemon fatal error:", err);
    process.exit(1);
  });
}

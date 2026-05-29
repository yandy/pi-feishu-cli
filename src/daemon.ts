#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import {
  AuthStorage,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Bot } from "./bot.js";
import { pollEvents, sendMessage, larkCliAvailable, larkCliConfigured } from "./poller.js";
import { buildSessionListCard, buildModelSelectCard } from "./cards.js";
import type { FeishuImConfig } from "./types.js";

const FEISHU_IM_DIR = join(homedir(), ".pi", "agent", "feishu-im");
const PID_FILE = join(FEISHU_IM_DIR, "daemon.pid");

function getAvailableModels(): Array<{ id: string; name: string }> {
  return [
    { id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5" },
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-haiku-3-5", name: "Claude Haiku 3.5" },
  ];
}

async function handleCommand(
  registry: SessionRegistry,
  command: string,
  args: string,
  chatId: string,
  currentModel: string
): Promise<void> {
  switch (command) {
    case "new": {
      const session = registry.createSession(chatId, args || "未命名会话");
      await sendMessage(
        JSON.stringify({ text: `已创建会话: **${session.name}** (\`${session.id}\`)` }),
        chatId
      );
      return;
    }
    case "sessions": {
      const chat = registry.getChatSessions(chatId);
      if (!chat) {
        await sendMessage(JSON.stringify({ text: "暂无会话" }), chatId);
        return;
      }
      const card = buildSessionListCard(chatId, chat.sessions, chat.active);
      await sendMessage(card, chatId, "interactive");
      return;
    }
    case "switch": {
      const switched = registry.switchSession(chatId, args);
      if (switched) {
        const session = registry
          .getChatSessions(chatId)
          ?.sessions.find((s) => s.id === args);
        await sendMessage(
          JSON.stringify({ text: `已切换到: **${session?.name ?? args}**` }),
          chatId
        );
      } else {
        await sendMessage(
          JSON.stringify({ text: `未找到会话: \`${args}\`` }),
          chatId
        );
      }
      return;
    }
    case "rm": {
      const deleted = registry.deleteSession(chatId, args);
      if (deleted) {
        await sendMessage(
          JSON.stringify({ text: `已删除会话: \`${args}\`` }),
          chatId
        );
      } else {
        await sendMessage(
          JSON.stringify({ text: `删除失败，未找到会话: \`${args}\`` }),
          chatId
        );
      }
      return;
    }
    case "model": {
      const models = getAvailableModels();
      const card = buildModelSelectCard(chatId, models, currentModel);
      await sendMessage(card, chatId, "interactive");
      return;
    }
  }
}

async function runDaemon() {
  if (!(await larkCliAvailable())) {
    console.error("lark-cli 未安装。运行: npm i -g lark-cli");
    process.exit(1);
  }
  if (!(await larkCliConfigured())) {
    console.error("lark-cli 未配置。运行: lark-cli config init");
    process.exit(1);
  }

  const config: FeishuImConfig = loadConfig(FEISHU_IM_DIR);
  const registry = new SessionRegistry(FEISHU_IM_DIR);
  const bot = new Bot(registry, config.strategy);

  writeFileSync(PID_FILE, String(process.pid));

  const cwd = process.cwd();
  const agentDir = getAgentDir();

  const runtime = await createAgentSessionRuntime(
    async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(cwd),
    }
  );

  console.log("[feishu-im] Daemon started, PID:", process.pid);
  console.log("[feishu-im] Strategy:", config.strategy);

  const pollIntervalMs = config.pollInterval * 1000;

  while (true) {
    try {
      const result = await pollEvents();

      if (result.error) {
        console.error("[feishu-im] Poll error:", result.error);
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      for (const event of result.events) {
        const route = bot.route(event);
        if (route.type === "skip") continue;

        if (route.type === "command") {
          await handleCommand(
            registry,
            route.command,
            route.args,
            route.chatId,
            config.model ?? "claude-sonnet"
          );
          continue;
        }

        const sessionInfo = registry.ensureSession(route.chatId);
        const sessionPath = join(agentDir, "sessions", `${sessionInfo.id}.jsonl`);

        try {
          const sessionManager = SessionManager.open(sessionPath);

          const { session: agentSession } = await createAgentSessionFromServices({
            services: runtime.services,
            sessionManager,
            sessionStartEvent: undefined,
          });

          agentSession.subscribe((agentEvent) => {
            if (
              agentEvent.type === "message_update" &&
              agentEvent.assistantMessageEvent.type === "text_delta"
            ) {
              // Streaming response handling — placeholder for future enhancement
            }
          });

          await agentSession.prompt(route.text);
          agentSession.dispose();
        } catch (err) {
          console.error(
            "[feishu-im] Agent error:",
            err instanceof Error ? err.message : String(err)
          );
          await sendMessage(
            JSON.stringify({ text: "处理消息时出错，请重试。" }),
            route.chatId
          );
        }
      }
    } catch (err) {
      console.error("[feishu-im] Loop error:", err);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

runDaemon().catch((err) => {
  console.error("[feishu-im] Fatal error:", err);
  process.exit(1);
});

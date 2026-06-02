import { InteractiveMode, type AgentSessionRuntime, AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { unlink } from "node:fs/promises";
import { loadConfig, promptAndSaveCredentials, type ConfigOptions } from "./config.js";
import { initRuntime } from "./runtime.js";
import type { FeishuConfig } from "./types.js";
import { createChannel, type Channel, type NormalizedMessage } from "./feishu/channel.js";
import { createMessageHandler } from "./feishu/handler.js";
import { buildSessionsCard } from "./feishu/cards/sessions.js";
import { buildModelsCard, type ModelCardOptions } from "./feishu/cards/models.js";
import { buildHelpCard } from "./feishu/cards/help.js";
import type { FeishuCommandHandler } from "./feishu/handler.js";
import { createStreamingHandler } from "./feishu/streaming.js";

export async function resumeMostRecentSession(runtime: AgentSessionRuntime, cwd: string): Promise<boolean> {
  const sessions = await SessionManager.list(cwd);
  const activePath = runtime.session.sessionFile;
  const target = sessions.find(s => s.path !== activePath);
  if (!target) return false;
  await runtime.switchSession(target.path, { cwdOverride: cwd });
  return true;
}

export interface MainOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  logLevel?: string;
  packageRoot?: string;
  botName?: string;
}

export async function main(options: MainOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  let feishuConfig: FeishuConfig;
  try {
    feishuConfig = loadConfig({
      appId: options.appId,
      appSecret: options.appSecret,
      config: options.config,
      cwd,
    });
  } catch {
    console.error("未找到飞书凭证，请输入：");
    feishuConfig = await promptAndSaveCredentials();
  }

  const botName = options.botName ?? feishuConfig.botName ?? process.env.FEISHU_BOT_NAME ?? "PI Agent";

  const { runtime } = await initRuntime({ cwd, packageRoot: options.packageRoot });

  await resumeMostRecentSession(runtime, cwd);

  const channel: Channel | null = await connectFeishu(feishuConfig, options.logLevel);

  let cleanup: (() => void) | null = null;
  if (channel) {
    cleanup = setupFeishuHandlers(channel, runtime, cwd, botName);
  }

  try {
    const mode = new InteractiveMode(runtime, {});
    await mode.run();
  } finally {
    cleanup?.();
    if (channel) {
      await channel.disconnect().catch(() => {});
    }
  }
}

async function connectFeishu(config: { appId: string; appSecret: string }, logLevel?: string): Promise<Channel | null> {
  const channel = createChannel({ ...config, logLevel });
  try {
    await channel.connect();
    console.error(`Feishu bot connected as ${channel.botIdentity?.name ?? "unknown"}`);
    return channel;
  } catch (err) {
    console.error("Feishu connection failed, continuing in TUI-only mode:", (err as Error).message);
    return null;
  }
}

function setupFeishuHandlers(
  channel: Channel,
  runtime: AgentSessionRuntime,
  cwd: string,
  botName: string,
): () => void {
  const handleSessions = async (chatId: string) => {
    const card = await buildSessionsCard({ runtime, cwd });
    await channel.send(chatId, { card });
  };

  const handleModels = async (chatId: string) => {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const available = await registry.getAvailable();
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: available.filter((m): m is NonNullable<typeof m> => m != null),
    });
    await channel.send(chatId, { card });
  };

  const handleHelp = async (chatId: string) => {
    const card = buildHelpCard(botName);
    await channel.send(chatId, { card });
  };

  const messageHandler = createMessageHandler(runtime, handleSessions, handleModels, handleHelp);

  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    // Commands send cards directly without streaming
    if (content.startsWith("/sessions") || content.startsWith("/models") || content.startsWith("/help")) {
      await messageHandler(msg);
      return;
    }

    await channel.stream(msg.chatId, {
      markdown: async (s) => {
        const unbind = createStreamingHandler(runtime.session, s);
        try {
          await messageHandler(msg);
        } finally {
          unbind();
        }
      },
    }, { replyTo: msg.messageId });
  });

  channel.on("cardAction", async (evt: any) => {
    const value = evt?.action?.value ?? evt;
    const messageId: string | undefined = evt?.messageId;
    const chatId: string | undefined = evt?.chatId;
    try {
      await handleCardAction(value, messageId, chatId, runtime, cwd, channel, handleSessions, handleModels);
    } catch (err) {
      console.error("Card action failed:", err);
    }
  });

  channel.on("error", (err: Error) => {
    console.error("Feishu channel error:", err.message);
  });

  return () => {};
}

async function handleCardAction(
  value: Record<string, any>,
  _messageId: string | undefined,
  chatId: string | undefined,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
): Promise<void> {
  const { cmd, action } = value;

  if (cmd === "help") {
    if (action === "sessions" && chatId) {
      await handleSessions(chatId);
    } else if (action === "models" && chatId) {
      await handleModels(chatId);
    }
    return;
  }

  if (cmd === "session") {
    if (action === "new") {
      await runtime.newSession();
    } else if (action === "switch" && value.sessionPath) {
      await runtime.switchSession(value.sessionPath);
    } else if (action === "delete" && value.sessionPath) {
      if (value.sessionPath !== runtime.session.sessionFile) {
        await unlink(value.sessionPath);
      }
    }
    const card = await buildSessionsCard({ runtime, cwd });
    if (chatId) {
      await channel.send(chatId, { card }, { replyTo: _messageId });
    }
  } else if (cmd === "model" && action === "select") {
    const { provider, modelId, thinkingLevel } = value;
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const model = registry.find(provider, modelId);
    if (model) {
      await runtime.session.setModel(model);
      runtime.session.setThinkingLevel(thinkingLevel);
    }
    const available = await registry.getAvailable();
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: available.filter((m): m is NonNullable<typeof m> => m != null),
    });
    if (chatId) {
      await channel.send(chatId, { card }, { replyTo: _messageId });
    }
  }
}

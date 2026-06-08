import { rmSync } from "node:fs";
import { rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSessionRuntime,
  AuthStorage,
  InteractiveMode,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Args as PiArgs } from "@earendil-works/pi-coding-agent";
import { resolveCliModel } from "@earendil-works/pi-coding-agent/dist/core/model-resolver.js";
import { loadConfig, promptAndSaveCredentials } from "./config.js";
import {
  type ProcessedAttachments,
  processAttachments,
} from "./feishu/attachments.js";
import { buildHelpCard } from "./feishu/cards/help.js";
import { buildModelsCard } from "./feishu/cards/models.js";
import { buildSessionsCard } from "./feishu/cards/sessions.js";
import {
  type CardActionEvent,
  type Channel,
  createChannel,
  type NormalizedMessage,
} from "./feishu/channel.js";
import { setFeishuContext } from "./feishu/context.js";
import { createMessageHandler } from "./feishu/handler.js";
import { createStreamingHandler } from "./feishu/streaming.js";
import { initRuntime } from "./runtime.js";
import type { FeishuConfig } from "./types.js";

export async function resumeMostRecentSession(
  runtime: AgentSessionRuntime,
  cwd: string,
): Promise<boolean> {
  const sessions = await SessionManager.list(cwd);
  const activePath = runtime.session.sessionFile;
  const target = sessions.find((s) => s.path !== activePath);
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
  noBundleFeishuSkills?: boolean;
  piArgs?: PiArgs;
}

export function createSessionManager(
  parsed: PiArgs | undefined,
  cwd: string,
): SessionManager {
  if (!parsed) return SessionManager.create(cwd);
  if (parsed.fork) {
    return SessionManager.forkFrom(parsed.fork, cwd);
  }
  if (parsed.session) {
    return SessionManager.open(parsed.session);
  }
  if (parsed.sessionId) {
    return SessionManager.create(cwd, undefined, { id: parsed.sessionId });
  }
  if (parsed.continue) {
    return SessionManager.continueRecent(cwd);
  }
  if (parsed.noSession) {
    return SessionManager.inMemory(cwd);
  }
  return SessionManager.create(cwd);
}

export function buildInitialMessage({ parsed }: { parsed: PiArgs }): string | undefined {
  if (parsed.messages.length > 0) {
    const msg = parsed.messages[0];
    parsed.messages.shift();
    return msg;
  }
  return undefined;
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
      noBundleFeishuSkills: options.noBundleFeishuSkills,
    });
  } catch {
    console.error("未找到飞书凭证，请输入：");
    feishuConfig = await promptAndSaveCredentials();
  }

  const botName =
    options.botName ??
    feishuConfig.botName ??
    process.env.FEISHU_BOT_NAME ??
    "PI Agent";

  const parsed = options.piArgs;

  const sessionManager = createSessionManager(parsed, cwd);

  const { runtime } = await initRuntime({
    cwd,
    packageRoot: options.packageRoot,
    noBundleFeishuSkills: feishuConfig.noBundleFeishuSkills,
    piArgs: parsed,
    sessionManager,
  });

  if (parsed?.model || parsed?.provider) {
    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      modelRegistry: registry,
    });
    if (resolved.warning) {
      console.error(`Warning: ${resolved.warning}`);
    }
    if (resolved.model) {
      await runtime.session.setModel(resolved.model);
    }
    if (resolved.thinkingLevel) {
      runtime.session.setThinkingLevel(resolved.thinkingLevel);
    }
  }

  if (parsed?.thinking) {
    runtime.session.setThinkingLevel(parsed.thinking);
  }

  let initialMessage: string | undefined;

  if (parsed) {
    initialMessage = buildInitialMessage({ parsed });
  }

  const channel: Channel | null = await connectFeishu(
    feishuConfig,
    options.logLevel,
  );

  let cleanup: (() => void) | null = null;
  if (channel) {
    cleanup = setupFeishuHandlers(channel, runtime, cwd, botName);
  }

  try {
    const mode = new InteractiveMode(runtime, {
      initialMessage,
      initialImages: [],
      initialMessages: parsed?.messages,
      verbose: parsed?.verbose,
    });
    await mode.run();
  } finally {
    cleanup?.();
    if (channel) {
      await channel.disconnect().catch(() => {});
    }
  }
}

async function connectFeishu(
  config: { appId: string; appSecret: string },
  logLevel?: string,
): Promise<Channel | null> {
  const channel = createChannel({ ...config, logLevel });
  try {
    await channel.connect();
    console.error(
      `Feishu bot connected as ${channel.botIdentity?.name ?? "unknown"}`,
    );
    return channel;
  } catch (err) {
    console.error(
      "Feishu connection failed, continuing in TUI-only mode:",
      (err as Error).message,
    );
    return null;
  }
}

export function setupFeishuHandlers(
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
      availableModels: available.filter(
        (m): m is NonNullable<typeof m> => m != null,
      ),
    });
    await channel.send(chatId, { card });
  };

  const handleHelp = async (chatId: string) => {
    const card = buildHelpCard(botName);
    await channel.send(chatId, { card });
  };

  const messageHandler = createMessageHandler(
    runtime,
    handleSessions,
    handleModels,
    handleHelp,
  );

  channel.on("message", async (msg: NormalizedMessage) => {
    const content = msg.content.trim();
    // Commands send cards directly without streaming
    if (
      content.startsWith("/sessions") ||
      content.startsWith("/models") ||
      content.startsWith("/help")
    ) {
      await messageHandler(msg);
      return;
    }

    setFeishuContext({ chatId: msg.chatId, channel });

    let attachments: ProcessedAttachments | undefined;
    let downloadDir: string | undefined;

    if (msg.resources.length > 0) {
      downloadDir = join(
        tmpdir(),
        "pi-feishu",
        runtime.session.sessionId ?? "unknown",
      );
      attachments = await processAttachments(
        channel,
        msg,
        downloadDir,
        runtime.session.model?.input,
      );
    }

    await channel.stream(
      msg.chatId,
      {
        markdown: async (s) => {
          const unbind = createStreamingHandler(runtime.session, s);
          try {
            await messageHandler(msg, attachments);
          } finally {
            unbind();
            if (downloadDir) {
              rm(downloadDir, { recursive: true, force: true }).catch(() => {});
            }
          }
        },
      },
      { replyTo: msg.messageId },
    );
  });

  channel.on("cardAction", (evt: CardActionEvent) => {
    setTimeout(() => {
      handleCardAction(evt, runtime, cwd, channel).catch((err) =>
        console.error("Card action failed:", err),
      );
    }, 0);
  });

  channel.on("error", (err: Error) => {
    console.error("Feishu channel error:", err.message);
  });

  const exitDir = join(tmpdir(), "pi-feishu");
  const exitCleanup = () => {
    try {
      rmSync(exitDir, { recursive: true, force: true });
    } catch {}
  };
  process.on("exit", exitCleanup);

  return () => {
    process.off("exit", exitCleanup);
  };
}

export async function handleCardAction(
  evt: CardActionEvent,
  runtime: AgentSessionRuntime,
  cwd: string,
  channel: Channel,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: SDK type is unknown, destructuring requires any
  const value = (evt?.action?.value ?? {}) as Record<string, any>;
  const raw = evt?.raw as
    | { event?: { token?: string }; token?: string }
    | undefined;
  const token: string | undefined = raw?.event?.token ?? raw?.token;
  const { cmd, action } = value;

  if (cmd === "help") {
    if (action === "sessions") {
      const card = await buildSessionsCard({ runtime, cwd });
      if (token) await channel.updateCardByToken(token, card);
    } else if (action === "models") {
      const authStorage = AuthStorage.create();
      const registry = ModelRegistry.create(authStorage);
      const available = await registry.getAvailable();
      const card = await buildModelsCard({
        session: runtime.session,
        availableModels: available.filter(
          (m): m is NonNullable<typeof m> => m != null,
        ),
      });
      if (token) await channel.updateCardByToken(token, card);
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
    if (token) await channel.updateCardByToken(token, card);
    return;
  }

  if (cmd === "model" && action === "select") {
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
      availableModels: available.filter(
        (m): m is NonNullable<typeof m> => m != null,
      ),
    });
    if (token) await channel.updateCardByToken(token, card);
    return;
  }
}

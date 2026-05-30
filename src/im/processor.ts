import { join } from "node:path";
import {
  createAgentSessionFromServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, TextContent, ThinkingContent } from "@earendil-works/pi-ai";
import { SessionRegistry } from "./session-registry.js";
import { sendMessage, setTypingStatus } from "./messaging.js";
import { buildSessionListText, buildModelListText } from "./cards.js";
import { saveModel } from "./config.js";
import { log } from "./logger.js";
import type { FeishuEvent } from "./types.js";

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
        `已创建会话: **${session.name}** (\`${session.id}\`)`,
        chatId
      );
      return;
    }
    case "sessions": {
      const chat = registry.getChatSessions(chatId);
      if (!chat) {
        await sendMessage("暂无会话", chatId);
        return;
      }
      const text = buildSessionListText(chat.sessions, chat.active);
      await sendMessage(text, chatId, "markdown");
      return;
    }
    case "switch": {
      const switched = registry.switchSession(chatId, args);
      if (switched) {
        const session = registry
          .getChatSessions(chatId)
          ?.sessions.find((s) => s.id === args);
        await sendMessage(
          `已切换到: **${session?.name ?? args}**`,
          chatId
        );
      } else {
        await sendMessage(
          `未找到会话: \`${args}\``,
          chatId
        );
      }
      return;
    }
    case "rm": {
      const deleted = registry.deleteSession(chatId, args);
      if (deleted) {
        await sendMessage(
          `已删除会话: \`${args}\``,
          chatId
        );
      } else {
        await sendMessage(
          `删除失败，未找到会话: \`${args}\``,
          chatId
        );
      }
      return;
    }
    case "model": {
      const models = getAvailableModels();
      if (args) {
        const target = models.find((m) => m.id === args);
        if (!target) {
          await sendMessage(
            `未找到模型: \`${args}\`\n可用模型: ${models.map((m) => `\`${m.id}\``).join(", ")}`,
            chatId,
          );
          return;
        }
        saveModel(target.id);
        await sendMessage(`已切换到模型: **${target.name}**`, chatId);
        return;
      }
      const text = buildModelListText(models, currentModel);
      await sendMessage(text, chatId, "markdown");
      return;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RuntimeLike {
  services: any;
}

export interface QueuedItem {
  event: FeishuEvent;
  route: { type: "message"; text: string; chatId: string } | { type: "command"; command: string; args: string; chatId: string };
}

export async function processItem(
  item: QueuedItem,
  runtime: RuntimeLike,
  registry: SessionRegistry,
  agentDir: string,
  currentModel: string
): Promise<void> {
  const route = item.route;

  if (route.type === "command") {
    await handleCommand(registry, route.command, route.args, route.chatId, currentModel);
    return;
  }

  log("Message route: text='" + route.text.slice(0, 100) + "' chatId=" + route.chatId);

  const messageId = item.event.message_id;
  setTypingStatus(messageId, true).then((ok) => {
    log("Typing on: " + ok);
  });

  const sessionInfo = registry.ensureSession(route.chatId);
  const sessionPath = join(agentDir, "sessions", sessionInfo.id + ".jsonl");

  try {
    const sessionManager = SessionManager.open(sessionPath);

    const { session: agentSession } = await createAgentSessionFromServices({
      services: runtime.services,
      sessionManager,
      sessionStartEvent: undefined,
    });

    agentSession.subscribe((agentEvent) => {
      if (agentEvent.type === "agent_end") {
        log("agent_end: messages.length=" + agentEvent.messages.length);
        const lastAssistant = [...agentEvent.messages]
          .reverse()
          .find(
            (m): m is AssistantMessage =>
              "role" in m && (m as AssistantMessage).role === "assistant"
          );
        if (lastAssistant) {
          const parts: string[] = [];
          for (const c of lastAssistant.content) {
            if (c.type === "thinking") {
              const tc = c as ThinkingContent;
              if (!tc.redacted && tc.thinking.trim()) {
                parts.push("```思考\n" + tc.thinking + "\n```");
              }
            } else if (c.type === "text") {
              parts.push((c as TextContent).text);
            }
          }
          const responseText = parts.join("\n");
          log("Response text length: " + responseText.length);
          if (responseText.trim()) {
            setTypingStatus(messageId, false).then((ok) => {
              log("Typing off: " + ok);
            });
            sendMessage(
              responseText,
              route.chatId,
              "markdown"
            ).then((ok) => log("sendMessage result: " + ok));
          }
        }
      }
    });

    log("Calling agentSession.prompt...");
    await agentSession.prompt(route.text);
    log("agentSession.prompt completed");
    agentSession.dispose();
  } catch (err) {
    log("Agent error: " + (err instanceof Error ? err.message : String(err)));
    setTypingStatus(messageId, false);
    await sendMessage(
      "处理消息时出错，请重试。",
      route.chatId
    );
  }
}

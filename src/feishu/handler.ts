import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { ProcessedAttachments } from "./attachments.js";
import type { NormalizedMessage } from "./channel.js";

export type FeishuCommandHandler = (chatId: string) => Promise<void>;

export function createMessageHandler(
  runtime: AgentSessionRuntime,
  handleSessions: FeishuCommandHandler,
  handleModels: FeishuCommandHandler,
  handleHelp: FeishuCommandHandler,
): (
  msg: NormalizedMessage,
  attachments?: ProcessedAttachments,
) => Promise<void> {
  return async (msg: NormalizedMessage, attachments?: ProcessedAttachments) => {
    const content = msg.content.trim();

    if (content.startsWith("/sessions")) {
      await handleSessions(msg.chatId);
      return;
    }

    if (content.startsWith("/models")) {
      await handleModels(msg.chatId);
      return;
    }

    if (content.startsWith("/help")) {
      await handleHelp(msg.chatId);
      return;
    }

    const textParts: string[] = [];
    if (content) {
      textParts.push(content);
    }
    if (attachments?.text) {
      textParts.push(attachments.text);
    }
    const fullText = textParts.join("\n\n");

    await runtime.session.prompt(fullText, {
      streamingBehavior: "steer",
      images:
        attachments?.images && attachments.images.length > 0
          ? attachments.images
          : undefined,
    });
  };
}

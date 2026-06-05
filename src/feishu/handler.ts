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

    // 注意：此处 streamingBehavior 使用 "steer"，
    // 但由于 channel.stream() 内部阻塞在 markdown producer 上，
    // 而 producer 又阻塞在 session.prompt() 上，消息 handler 会被全程阻塞。
    // 因此实际效果是串行处理，steer 不会真正触发。
    // 保留 "steer" 作为未来正确实现流式中断时的占位参数。
    await runtime.session.prompt(fullText, {
      streamingBehavior: "steer",
      images:
        attachments?.images && attachments.images.length > 0
          ? attachments.images
          : undefined,
    });
  };
}

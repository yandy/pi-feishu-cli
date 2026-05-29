import { SessionRegistry } from "./session-registry.js";
import type { FeishuEvent } from "./poller.js";
import type { FeishuImConfig } from "./types.js";

export interface RouteResultCommand {
  type: "command";
  command: string;
  args: string;
  chatId: string;
  threadId?: string;
}

export interface RouteResultMessage {
  type: "message";
  text: string;
  chatId: string;
  threadId?: string;
}

export interface RouteResultSkip {
  type: "skip";
}

export type RouteResult = RouteResultCommand | RouteResultMessage | RouteResultSkip;

const BOT_OPEN_ID = "__bot_open_id__";

export class Bot {
  constructor(
    private registry: SessionRegistry,
    private strategy: FeishuImConfig["strategy"]
  ) {}

  route(event: FeishuEvent): RouteResult {
    const msg = event.event?.message;
    if (!msg) return { type: "skip" };

    const chatId = msg.chat_id;
    const text = this.extractText(msg.content, msg.message_type);

    if (!text) return { type: "skip" };

    const mentions = msg.mentions ?? [];
    const hasMentions = mentions.length > 0;
    const isMentioned = mentions.some((m) => m.key === BOT_OPEN_ID);

    if (this.strategy === "mention" && hasMentions && !isMentioned) {
      if (!this.isCommand(text)) return { type: "skip" };
    }

    const commandResult = this.parseCommand(text);
    if (commandResult) {
      return {
        type: "command",
        command: commandResult.command,
        args: commandResult.args,
        chatId,
        threadId: msg.parent_id,
      };
    }

    return {
      type: "message",
      text,
      chatId,
      threadId: msg.parent_id,
    };
  }

  private isCommand(text: string): boolean {
    return ["/new", "/sessions", "/switch", "/rm", "/model"].some((cmd) =>
      text.trim().startsWith(cmd)
    );
  }

  private parseCommand(
    text: string
  ): { command: string; args: string } | null {
    const trimmed = text.trim();
    if (trimmed === "/sessions" || trimmed === "/model") {
      return { command: trimmed.slice(1), args: "" };
    }
    if (trimmed.startsWith("/new ")) {
      return { command: "new", args: trimmed.slice(5).trim() || "默认会话" };
    }
    if (trimmed === "/new") {
      return { command: "new", args: "默认会话" };
    }
    if (trimmed.startsWith("/switch ")) {
      return { command: "switch", args: trimmed.slice(8).trim() };
    }
    if (trimmed.startsWith("/rm ")) {
      return { command: "rm", args: trimmed.slice(4).trim() };
    }
    return null;
  }

  private extractText(content: string, msgType: string): string {
    if (msgType === "text") {
      try {
        const parsed = JSON.parse(content);
        return parsed.text ?? "";
      } catch {
        return content;
      }
    }
    return "";
  }
}

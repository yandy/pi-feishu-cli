import { SessionRegistry } from "./session-registry.js";
import type { FeishuEvent, FeishuImConfig } from "./types.js";

export interface RouteResultCommand {
  type: "command";
  command: string;
  args: string;
  chatId: string;
}

export interface RouteResultMessage {
  type: "message";
  text: string;
  chatId: string;
}

export interface RouteResultSkip {
  type: "skip";
}

export type RouteResult = RouteResultCommand | RouteResultMessage | RouteResultSkip;

export class Bot {
  constructor(
    private registry: SessionRegistry,
    private strategy: FeishuImConfig["strategy"],
    private botName?: string,
  ) {}

  route(event: FeishuEvent): RouteResult {
    const chatId = event.chat_id;
    const text = this.extractText(event);

    if (!text) return { type: "skip" };

    if (event.sender_id && this.isBotSender(event.sender_id)) {
      return { type: "skip" };
    }

    if (this.strategy === "mention" && event.chat_type === "group") {
      if (!this.isCommand(text)) {
        const mentioned = this.isMentioned(text);
        if (!mentioned) return { type: "skip" };
      }
    }

    const commandResult = this.parseCommand(text);
    if (commandResult) {
      return {
        type: "command",
        command: commandResult.command,
        args: commandResult.args,
        chatId,
      };
    }

    return {
      type: "message",
      text,
      chatId,
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
    if (trimmed === "/sessions") {
      return { command: "sessions", args: "" };
    }
    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
      return {
        command: "model",
        args: trimmed === "/model" ? "" : trimmed.slice(7).trim(),
      };
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

  private extractText(event: FeishuEvent): string {
    const msgType = event.message_type;
    const content = event.content ?? "";
    if (!content) return "";

    if (msgType === "text") {
      try {
        const parsed = JSON.parse(content);
        return parsed.text ?? "";
      } catch {
        return content;
      }
    }

    if (msgType === "post") {
      try {
        const parsed = JSON.parse(content);
        const locale = Object.keys(parsed).find((k) => k.includes("-"));
        const post = locale ? parsed[locale] : parsed;
        const blocks: unknown[] = post?.content ?? [];
        const texts: string[] = [];
        for (const row of blocks) {
          for (const block of (row as { tag?: string; text?: string }[]) ?? []) {
            if (block?.tag === "text" && block.text) {
              texts.push(block.text);
            }
          }
        }
        return texts.join("\n") || content;
      } catch {
        return content;
      }
    }

    return "";
  }

  private isMentioned(text: string): boolean {
    if (this.botName && text.includes(`@${this.botName}`)) return true;
    return /@\S/.test(text);
  }

  private isBotSender(senderId: string): boolean {
    return senderId.startsWith("bot_");
  }
}

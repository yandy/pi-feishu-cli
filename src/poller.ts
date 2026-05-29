import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FeishuEvent {
  type: string;
  event?: {
    message?: {
      chat_id: string;
      message_id: string;
      parent_id?: string;
      message_type: string;
      content: string;
      mentions?: Array<{ key: string; name: string }>;
    };
    sender?: {
      sender_id: {
        open_id: string;
        user_id?: string;
      };
      sender_type: string;
    };
  };
  raw: unknown;
}

export interface PollResult {
  events: FeishuEvent[];
  error: string | null;
}

export async function pollEvents(): Promise<PollResult> {
  try {
    const { stdout } = await execFileAsync("lark-cli", [
      "im",
      "+events-poll",
      "--as",
      "bot",
    ], { timeout: 30_000 });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const events: FeishuEvent[] = [];

    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        events.push({
          type: raw.type ?? "unknown",
          event: raw.event,
          raw,
        });
      } catch {
        // skip unparseable lines
      }
    }

    return { events, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { events: [], error: message };
  }
}

export async function larkCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("lark-cli", ["--help"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function larkCliConfigured(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("lark-cli", [
      "config",
      "show",
    ], { timeout: 5000 });
    const config = JSON.parse(stdout);
    return !!(config.appId && config.appSecret);
  } catch {
    return false;
  }
}

export async function sendMessage(
  content: string,
  chatId: string,
  msgType: "text" | "interactive" = "text"
): Promise<boolean> {
  try {
    const body = JSON.stringify({
      receive_id: chatId,
      msg_type: msgType,
      content,
    });

    await execFileAsync("lark-cli", [
      "im",
      "messages",
      "create",
      "--data",
      body,
      "--as",
      "bot",
    ], { timeout: 10_000 });

    return true;
  } catch {
    return false;
  }
}

export async function downloadResource(
  messageId: string,
  fileKey: string,
  fileType: string,
  outputPath: string
): Promise<boolean> {
  try {
    await execFileAsync("lark-cli", [
      "im",
      "+messages-resources-download",
      "--message-id", messageId,
      "--file-key", fileKey,
      "--file-type", fileType,
      "--output", outputPath,
      "--as", "bot",
    ], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

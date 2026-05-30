import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
      "config", "show",
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
  msgType: "text" | "markdown" | "interactive" = "text"
): Promise<boolean> {
  try {
    const args = [
      "im", "+messages-send",
      "--chat-id", chatId,
      "--as", "bot",
    ];

    if (msgType === "interactive") {
      args.push("--msg-type", "interactive", "--content", content);
    } else if (msgType === "markdown") {
      args.push("--markdown", content);
    } else {
      args.push("--text", content);
    }

    await execFileAsync("lark-cli", args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function setTypingStatus(
  messageId: string,
  typing: boolean
): Promise<boolean> {
  try {
    if (typing) {
      const { stdout } = await execFileAsync("lark-cli", [
        "im", "reactions", "create",
        "--params", JSON.stringify({ message_id: messageId }),
        "--data", JSON.stringify({ reaction_type: { emoji_type: "Typing" } }),
        "--as", "bot",
      ], { timeout: 10_000 });
      const resp = JSON.parse(stdout);
      return !!resp?.data?.reaction_id;
    } else {
      const { stdout } = await execFileAsync("lark-cli", [
        "im", "reactions", "list",
        "--params", JSON.stringify({ message_id: messageId }),
        "--as", "bot",
      ], { timeout: 10_000 });
      const resp = JSON.parse(stdout);
      const items = resp?.data?.items ?? [];
      const typingReaction = items.find(
        (r: { reaction_type?: { emoji_type?: string }; reaction_id?: string }) =>
          r.reaction_type?.emoji_type === "Typing"
      );
      if (typingReaction?.reaction_id) {
        await execFileAsync("lark-cli", [
          "im", "reactions", "delete",
          "--params", JSON.stringify({
            message_id: messageId,
            reaction_id: typingReaction.reaction_id,
          }),
          "--as", "bot",
        ], { timeout: 10_000 });
      }
      return true;
    }
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

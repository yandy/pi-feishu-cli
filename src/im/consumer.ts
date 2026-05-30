import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { FeishuEvent } from "./types.js";

export function startEventConsumer(
  onEvent: (event: FeishuEvent) => void,
  onError: (err: Error) => void
): () => void {
  let stopped = false;
  let currentChild: ChildProcess | null = null;

  function spawnConsumer(): void {
    const child = spawn("lark-cli", [
      "event", "consume",
      "im.message.receive_v1",
      "--as", "bot",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    currentChild = child;

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    rl.on("line", (line: string) => {
      try {
        const raw = JSON.parse(line);
        const event: FeishuEvent = {
          type: raw.type ?? "im.message.receive_v1",
          chat_id: raw.chat_id ?? "",
          chat_type: raw.chat_type ?? "",
          content: raw.content ?? "",
          message_id: raw.message_id ?? raw.id ?? "",
          message_type: raw.message_type ?? "",
          sender_id: raw.sender_id ?? "",
          create_time: raw.create_time ?? "",
          event_id: raw.event_id ?? "",
          timestamp: raw.timestamp ?? "",
          raw,
        };
        onEvent(event);
      } catch {
        // skip unparseable lines
      }
    });

    child.on("close", () => {
      rl.close();
      currentChild = null;
      if (!stopped) {
        setTimeout(() => {
          if (!stopped) {
            spawnConsumer();
          }
        }, 2000);
      }
    });

    child.on("error", (err) => {
      onError(err);
      currentChild = null;
      if (!stopped) {
        setTimeout(() => {
          if (!stopped) {
            spawnConsumer();
          }
        }, 2000);
      }
    });
  }

  spawnConsumer();

  return () => {
    stopped = true;
    if (currentChild) {
      currentChild.kill("SIGTERM");
      currentChild = null;
    }
  };
}

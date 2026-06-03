export interface StreamWriter {
  append(chunk: string): Promise<void>;
}

interface AssistantMessageEvent {
  type: string;
  delta?: string;
  error?: unknown;
}

interface StreamEvent {
  type: string;
  assistantMessageEvent?: AssistantMessageEvent;
  toolName?: string;
  partialResult?: unknown;
  isError?: boolean;
  attempt?: number;
  maxAttempts?: number;
  success?: boolean;
}

export function createStreamingHandler(
  session: {
    subscribe: (listener: (event: StreamEvent) => void) => () => void;
  },
  stream: StreamWriter,
): () => void {
  let inThinkBlock = false;
  let needsQuotePrefix = true;
  let needLineBreak = false;

  return session.subscribe((event: StreamEvent) => {
    switch (event.type) {
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (!sub) break;
        if (sub.type === "text_delta") {
          let delta = sub.delta ?? "";
          if (inThinkBlock && !needsQuotePrefix) {
            delta = "\n" + delta;
          }
          inThinkBlock = false;
          needsQuotePrefix = true;
          stream.append(delta);
          needLineBreak = !delta.endsWith("\n");
        } else if (sub.type === "thinking_delta") {
          const delta = sub.delta ?? "";
          let out = needLineBreak ? "\n" : "";
          needLineBreak = false;
          for (let i = 0; i < delta.length; i++) {
            if (needsQuotePrefix) {
              out += "> ";
              needsQuotePrefix = false;
            }
            const ch = delta[i];
            out += ch;
            if (ch === "\n") {
              needsQuotePrefix = true;
            }
          }
          stream.append(out);
          inThinkBlock = true;
        } else if (sub.type === "error") {
          stream.append("— 模型返回错误 —");
        }
        break;
      }

      case "tool_execution_start":
        stream.append(`🔧 ${event.toolName ?? ""}`);
        break;

      case "tool_execution_update":
        stream.append(String(event.partialResult ?? ""));
        break;

      case "tool_execution_end":
        stream.append(event.isError ? "❌" : "✅");
        break;

      case "queue_update":
        stream.append("— 消息已排队 —");
        break;

      case "compaction_start":
        stream.append("— 压缩中... —");
        break;

      case "compaction_end":
        stream.append("— 压缩完成 —");
        break;

      case "auto_retry_start":
        stream.append(
          `— 自动重试 (${event.attempt}/${event.maxAttempts})... —`,
        );
        break;

      case "auto_retry_end":
        stream.append(event.success ? "✅ 重试成功" : "❌ 重试失败");
        break;
    }
  });
}

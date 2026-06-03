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

  const closeThinkBlock = (): string => {
    if (!inThinkBlock) return "";
    const prefix = needsQuotePrefix ? "\n" : "\n\n";
    inThinkBlock = false;
    needsQuotePrefix = true;
    return prefix;
  };

  return session.subscribe((event: StreamEvent) => {
    switch (event.type) {
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (!sub) break;
        if (sub.type === "text_delta") {
          const delta = sub.delta ?? "";
          stream.append(closeThinkBlock() + delta);
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
          stream.append(closeThinkBlock() + "— 模型返回错误 —");
          needLineBreak = true;
        }
        break;
      }

      case "tool_execution_start":
        stream.append(
          closeThinkBlock() + `🔧 ${event.toolName ?? ""}`,
        );
        needLineBreak = true;
        break;

      case "tool_execution_update":
        stream.append(closeThinkBlock() + String(event.partialResult ?? ""));
        needLineBreak = true;
        break;

      case "tool_execution_end":
        stream.append(
          closeThinkBlock() + (event.isError ? "❌" : "✅"),
        );
        needLineBreak = true;
        break;

      case "queue_update":
        stream.append(closeThinkBlock() + "— 消息已排队 —");
        needLineBreak = true;
        break;

      case "compaction_start":
        stream.append(closeThinkBlock() + "— 压缩中... —");
        needLineBreak = true;
        break;

      case "compaction_end":
        stream.append(closeThinkBlock() + "— 压缩完成 —");
        needLineBreak = true;
        break;

      case "auto_retry_start":
        stream.append(
          closeThinkBlock() +
            `— 自动重试 (${event.attempt}/${event.maxAttempts})... —`,
        );
        needLineBreak = true;
        break;

      case "auto_retry_end":
        stream.append(
          closeThinkBlock() + (event.success ? "✅ 重试成功" : "❌ 重试失败"),
        );
        needLineBreak = true;
        break;
    }
  });
}

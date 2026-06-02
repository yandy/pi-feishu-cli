export interface StreamWriter {
  append(chunk: string): Promise<void>;
}

export function createStreamingHandler(
  session: { subscribe: (listener: (event: any) => void) => () => void },
  stream: StreamWriter,
): () => void {
  return session.subscribe((event: any) => {
    switch (event.type) {
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (sub.type === "text_delta") {
          stream.append(sub.delta);
        } else if (sub.type === "thinking_delta") {
          stream.append(`> ${sub.delta}`);
        } else if (sub.type === "error") {
          stream.append("— 模型返回错误 —");
        }
        break;
      }

      case "tool_execution_start":
        stream.append(`🔧 ${event.toolName}`);
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
        stream.append(`— 自动重试 (${event.attempt}/${event.maxAttempts})... —`);
        break;

      case "auto_retry_end":
        stream.append(event.success ? "✅ 重试成功" : "❌ 重试失败");
        break;
    }
  });
}

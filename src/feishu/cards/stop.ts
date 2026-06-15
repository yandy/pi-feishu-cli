import { createMarkdownBlock } from "./helpers.js";

export function buildStopCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      elements: [
        createMarkdownBlock("🤖 AI 正在生成中..."),
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "停止生成" },
              type: "danger",
              behaviors: [{ type: "callback", value: { cmd: "stop" } }],
            },
          ],
        },
      ],
    },
  };
}

export function buildStopCardDone(status: string): Record<string, unknown> {
  const symbols: Record<string, string> = {
    生成完成: "✅",
    已中断: "🛑",
  };
  const symbol = symbols[status] ?? "✅";
  return {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      elements: [createMarkdownBlock(`${symbol} ${status}`)],
    },
  };
}

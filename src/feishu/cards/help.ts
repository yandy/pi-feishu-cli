import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
  createActionButton,
  createNoteBlock,
  type CardElement,
} from "./helpers.js";

export function buildHelpCard(botName: string): Record<string, unknown> {
  const elements: CardElement[] = [
    createMarkdownBlock(`你好！我是 ${botName}，你可以直接发送消息与我对话。`),
    createDividerBlock(),
    createMarkdownBlock(
      "**如何使用**\n" +
      "· 发送文字、图片、文件等附件，我会理解并回复\n" +
      "· 回复会实时流式输出\n" +
      "· 支持多轮对话，上下文保留",
    ),
    createDividerBlock(),
    createMarkdownBlock("**可用命令**"),
    {
      tag: "action",
      actions: [
        createActionButton("管理会话", { cmd: "help", action: "sessions" }, "primary"),
      ],
    },
    {
      tag: "action",
      actions: [
        createActionButton("选择模型", { cmd: "help", action: "models" }, "primary"),
      ],
    },
    createMarkdownBlock("/help · 显示此帮助"),
    createNoteBlock("💡 对话历史自动保存，可随时点击上方按钮管理"),
  ];

  return buildCard(createCardHeader("使用帮助", "blue"), elements);
}

import {
  createCardHeader,
  createMarkdownBlock,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../feishu-card.js";

export function buildHelpCard(): Record<string, unknown> {
  return buildCard(
    createCardHeader("欢迎使用 Pi 助手", "blue"),
    [
      createMarkdownBlock("我是 Pi AI 编码助手，可以帮你写代码、调试、管理项目。在群聊中 @我 可直接对话。\n\n**可用命令：**"),
      createMarkdownBlock("**/help** — 显示此帮助信息\n**/sessions** — 管理会话（查看、切换、解绑、删除、新建）\n**/model** — 切换 AI 模型"),
      createDividerBlock(),
      createNoteBlock("提示：直接发送消息即可与 Pi 对话，无需加斜杠命令。"),
    ],
    { wide_screen_mode: true },
  );
}

import type { SessionInfo } from "./types.js";

export function buildSessionListCard(
  chatId: string,
  sessions: SessionInfo[],
  activeId: string | null
): string {
  const header = {
    title: { tag: "plain_text", content: "Pi 会话管理" },
    template: "blue" as const,
  };

  const elements: unknown[] = [];

  if (sessions.length === 0) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: "暂无会话" },
    });
  } else {
    for (const sess of sessions) {
      const isActive = sess.id === activeId;
      const prefix = isActive ? "▶ " : "";
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `${prefix}**${sess.name}**  \n\`${sess.id}\``,
        },
      });
      elements.push({ tag: "hr" });
    }
    elements.pop();
  }

  elements.push({
    tag: "action",
    actions: [
      {
        tag: "button",
        text: { tag: "plain_text", content: "➕ 新建会话" },
        type: "primary",
        value: JSON.stringify({ action: "new_session", chat_id: chatId }),
      },
      {
        tag: "button",
        text: { tag: "plain_text", content: "🔄 切换模型" },
        value: JSON.stringify({ action: "model_select", chat_id: chatId }),
      },
    ],
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header,
    elements,
  });
}

export function buildModelSelectCard(
  chatId: string,
  models: Array<{ id: string; name: string }>,
  current: string
): string {
  const header = {
    title: { tag: "plain_text", content: "选择模型" },
    template: "blue" as const,
  };

  const elements: unknown[] = [];

  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `当前: **${models.find((m) => m.id === current)?.name ?? current}**`,
    },
  });
  elements.push({ tag: "hr" });

  for (const model of models) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: model.id === current ? `▶ ${model.name}` : model.name,
          },
          type: model.id === current ? "primary" : "default",
          value: JSON.stringify({
            action: "select_model",
            chat_id: chatId,
            model_id: model.id,
          }),
        },
      ],
    });
  }

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header,
    elements,
  });
}

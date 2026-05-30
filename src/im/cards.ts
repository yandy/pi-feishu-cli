import type { SessionInfo } from "./types.js";

export function buildSessionListText(
  sessions: SessionInfo[],
  activeId: string | null
): string {
  const lines: string[] = ["**Pi 会话管理**", ""];

  if (sessions.length === 0) {
    lines.push("暂无会话");
  } else {
    for (const sess of sessions) {
      const isActive = sess.id === activeId;
      const prefix = isActive ? "▶ " : "  ";
      lines.push(`${prefix}${isActive ? "**" : ""}${sess.name}${isActive ? "**" : ""}  \n  \`${sess.id}\``);
    }
  }

  lines.push(
    "",
    "---",
    "使用以下命令管理会话：",
    "  - `/new <名称>` — 新建会话",
    "  - `/switch <id>` — 切换会话",
    "  - `/rm <id>` — 删除会话",
  );

  return lines.join("\n");
}

export function buildModelListText(
  models: Array<{ id: string; name: string }>,
  current: string
): string {
  const currentName = models.find((m) => m.id === current)?.name ?? current;
  const lines: string[] = [
    "**选择模型**",
    "",
    `当前: **${currentName}**`,
    "",
  ];

  for (const model of models) {
    const marker = model.id === current ? "▶ " : "  ";
    lines.push(`${marker}\`${model.id}\` — ${model.name}`);
  }

  lines.push(
    "",
    "---",
    "使用 \`/model <id>\` 切换模型，例如：",
    "  - \`/model anthropic/claude-opus-4-5\`",
    "  - \`/model anthropic/claude-sonnet-4-20250514\`",
  );

  return lines.join("\n");
}

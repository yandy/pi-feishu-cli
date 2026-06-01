export const BOT_COMMANDS = {
  help: "/help",
  model: "/model",
} as const;

export type BotCommand = keyof typeof BOT_COMMANDS;

const COMMAND_MAP = Object.fromEntries(
  Object.entries(BOT_COMMANDS).map(([key, value]) => [value, key])
) as Record<string, BotCommand>;

export function parseBotCommand(content: string): BotCommand | null {
  if (!content.startsWith("/")) return null;
  const spaceIndex = content.indexOf(" ");
  const cmd = spaceIndex === -1 ? content : content.slice(0, spaceIndex);
  return COMMAND_MAP[cmd] ?? null;
}

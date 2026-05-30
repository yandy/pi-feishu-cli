export const BOT_COMMANDS = {
  help: "/help",
  sessions: "/sessions",
  model: "/model",
} as const;

export type BotCommand = keyof typeof BOT_COMMANDS;

const COMMAND_MAP: Record<string, BotCommand> = {
  "/help": "help",
  "/sessions": "sessions",
  "/model": "model",
};

export function parseBotCommand(content: string): BotCommand | null {
  if (!content.startsWith("/")) return null;
  const spaceIndex = content.indexOf(" ");
  const cmd = spaceIndex === -1 ? content : content.slice(0, spaceIndex);
  return COMMAND_MAP[cmd] ?? null;
}

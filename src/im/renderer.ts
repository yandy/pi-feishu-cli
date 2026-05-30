export const MESSAGE_MAX_LENGTH = 30_000;

export interface FeishuTextMessage {
  type: "text";
  text: string;
}

export function renderText(text: string): FeishuTextMessage[] {
  const parts = splitLongMessage(text);
  return parts.map((part) => ({ type: "text", text: part }));
}

export function renderCodeBlock(
  code: string,
  lang?: string
): FeishuTextMessage[] {
  const header = lang ? `\`\`\`${lang}\n` : "```\n";
  const text = header + code + "\n```";
  return renderText(text);
}

export function splitLongMessage(text: string): string[] {
  if (text.length <= MESSAGE_MAX_LENGTH) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MESSAGE_MAX_LENGTH) {
      parts.push(remaining);
      break;
    }

    let cutPoint = MESSAGE_MAX_LENGTH;
    const newlineIdx = remaining.lastIndexOf("\n", MESSAGE_MAX_LENGTH);
    if (newlineIdx > MESSAGE_MAX_LENGTH * 0.5) {
      cutPoint = newlineIdx;
    }

    parts.push(remaining.slice(0, cutPoint));
    remaining = remaining.slice(cutPoint);
  }

  return parts;
}

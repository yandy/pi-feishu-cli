import type { Channel } from "./channel.js";

export interface FeishuContextValue {
  chatId: string;
  channel: Channel;
}

let current: FeishuContextValue | null = null;

export function setFeishuContext(ctx: FeishuContextValue | null): void {
  current = ctx;
}

export function getFeishuContext(): FeishuContextValue | null {
  return current;
}

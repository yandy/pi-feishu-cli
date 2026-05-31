import { createLarkChannel, LoggerLevel, type NormalizedMessage, type CardActionEvent } from "@larksuiteoapi/node-sdk";

export type { NormalizedMessage, CardActionEvent };

export interface CreateChannelOptions {
  appId: string;
  appSecret: string;
  outbound?: {
    streamInitialText?: string;
    streamThrottleMs?: number;
    streamThrottleChars?: number;
  };
}

export interface Channel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: any[]) => any): void;
  send(chatId: string, content: { text?: string; markdown?: string; card?: unknown }, options?: {
    replyTo?: string;
    replyInThread?: boolean;
  }): Promise<void>;
  stream(chatId: string, producer: {
    markdown: (s: { append(chunk: string): Promise<void> }) => Promise<void>;
  }, options?: { replyTo?: string }): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  get botIdentity(): { name: string } | undefined;
  get connected(): boolean;
}

export function createFeishuChannel(options: CreateChannelOptions): Channel {
  const channel = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: LoggerLevel.info,
    policy: { requireMention: true, dmMode: "open" },
    ...(options.outbound ? { outbound: options.outbound } : {}),
  });

  let _connected = false;

  const wrapper: Channel = {
    async connect() {
      await channel.connect();
      _connected = true;
    },

    async disconnect() {
      await channel.disconnect();
      _connected = false;
    },

    on(event: string, handler: (...args: any[]) => any) {
      (channel as any).on(event, handler);
    },

    async send(chatId, content, options) {
      await (channel as any).send(chatId, content, options);
    },

    async stream(chatId, producer, options) {
      await (channel as any).stream(chatId, producer, options);
    },

    async updateCard(messageId, card) {
      await (channel as any).updateCard(messageId, card);
    },

    get botIdentity() {
      return (channel as any).botIdentity;
    },

    get connected() {
      return _connected;
    },
  };

  return wrapper;
}

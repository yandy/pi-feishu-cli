import {
  createLarkChannel,
  LoggerLevel,
  type NormalizedMessage as LarkNormalizedMessage,
  type CardActionEvent,
} from "@larksuiteoapi/node-sdk";

export type { CardActionEvent };
export type NormalizedMessage = LarkNormalizedMessage;
export { LoggerLevel };

export const LOG_LEVEL_MAP: Record<string, LoggerLevel | undefined> = {
  fatal: LoggerLevel.fatal,
  error: LoggerLevel.error,
  warn: LoggerLevel.warn,
  info: LoggerLevel.info,
  debug: LoggerLevel.debug,
  trace: LoggerLevel.trace,
};

export interface ChannelOptions {
  appId: string;
  appSecret: string;
  logLevel?: string;
}

export interface StreamController {
  append(chunk: string): Promise<void>;
}

export interface StreamProducer {
  markdown: (s: StreamController) => Promise<void>;
}

export interface Channel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: "message", handler: (msg: NormalizedMessage) => void): void;
  on(event: "cardAction", handler: (evt: any) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(event: "reconnecting" | "reconnected" | "botAdded", handler: () => void): void;
  onRawEvent(type: string, handler: (...args: any[]) => any): void;
  send(chatId: string, content: { text?: string; markdown?: string; card?: unknown }, options?: { replyTo?: string }): Promise<void>;
  stream(chatId: string, producer: StreamProducer, options?: { replyTo?: string }): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  get botIdentity(): { name: string } | undefined;
  get connected(): boolean;
}

export function createChannel(options: ChannelOptions): Channel {
  const loggerLevel = LOG_LEVEL_MAP[options.logLevel?.toLowerCase() ?? ""] ?? LoggerLevel.warn;
  const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: true, dmMode: "open" },
  });

  let _connected = false;

  const channel: Channel = {
    onRawEvent(type: string, handler: (...args: any[]) => any) {
      (raw as any).dispatcher.register({ [type]: handler });
    },

    async connect() {
      await (raw as any).connect();
      _connected = true;
    },

    async disconnect() {
      await (raw as any).disconnect();
      _connected = false;
    },

    on(event: string, handler: (...args: any[]) => any) {
      (raw as any).on(event, handler);
    },

    async send(chatId, content, options) {
      await (raw as any).send(chatId, content, options);
    },

    async stream(chatId, producer, options) {
      await (raw as any).stream(chatId, producer, options);
    },

    async updateCard(messageId, card) {
      await (raw as any).updateCard(messageId, card);
    },

    get botIdentity() {
      return (raw as any).botIdentity;
    },

    get connected() {
      return _connected;
    },
  };

  channel.onRawEvent("im.message.message_read_v1", () => {});

  return channel;
}

import {
  type CardActionEvent,
  createLarkChannel,
  type NormalizedMessage as LarkNormalizedMessage,
  LoggerLevel,
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
  cwd?: string;
}

export interface StreamController {
  append(chunk: string): Promise<void>;
}

export interface StreamProducer {
  markdown: (s: StreamController) => Promise<void>;
}

interface RawLarkChannel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  send(chatId: string, content: unknown, options?: unknown): Promise<void>;
  stream(chatId: string, producer: unknown, options?: unknown): Promise<void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
  readonly botIdentity: { name: string } | undefined;
  readonly dispatcher: {
    register(config: Record<string, (...args: unknown[]) => void>): void;
  };
  readonly rawClient: {
    request(opts: {
      url: string;
      method: string;
      data?: unknown;
    }): Promise<Record<string, unknown>>;
    im: {
      v1: {
        messageResource: {
          get(params: {
            path: Record<string, string>;
            params: Record<string, string>;
          }): Promise<{
            getReadableStream(): AsyncIterable<Buffer | string>;
          }>;
        };
      };
    };
  };
}

export interface Channel {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: "message", handler: (msg: NormalizedMessage) => void): void;
  on(event: "cardAction", handler: (evt: CardActionEvent) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(
    event: "reconnecting" | "reconnected" | "botAdded",
    handler: () => void,
  ): void;
  onRawEvent(type: string, handler: (...args: unknown[]) => void): void;
  send(
    chatId: string,
    content: { text?: string; markdown?: string; card?: unknown },
    options?: { replyTo?: string },
  ): Promise<void>;
  sendFile(chatId: string, filePath: string, fileName?: string): Promise<void>;
  sendImage(chatId: string, imagePath: string): Promise<void>;
  downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: string,
  ): Promise<Buffer>;
  stream(
    chatId: string,
    producer: StreamProducer,
    options?: { replyTo?: string },
  ): Promise<void>;
  /** 主动更新卡片（无需用户交互），通过 message_id 直接替换卡片内容。 */
  updateCard(messageId: string, card: unknown): Promise<void>;
  /** 延时更新卡片（需用户交互触发），通过回调中的 token 替换卡片内容。token 有效期 30 分钟。 */
  updateCardByToken(token: string, card: unknown): Promise<void>;
  get botIdentity(): { name: string } | undefined;
  get connected(): boolean;
}

export function createChannel(options: ChannelOptions): Channel {
  const loggerLevel =
    LOG_LEVEL_MAP[options.logLevel?.toLowerCase() ?? ""] ?? LoggerLevel.warn;
  const raw = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel,
    policy: { requireMention: true, dmMode: "open" },
    includeRawEvent: true,
    ...(options.cwd ? { outbound: { allowedFileDirs: [options.cwd] } } : {}),
  }) as unknown as RawLarkChannel;

  let _connected = false;

  const channel = {
    onRawEvent(type: string, handler: (...args: unknown[]) => void) {
      raw.dispatcher.register({ [type]: handler });
    },

    async connect() {
      await raw.connect();
      _connected = true;
    },

    async disconnect() {
      await raw.disconnect();
      _connected = false;
    },

    on(event: string, handler: (...args: unknown[]) => void) {
      raw.on(event, handler);
    },

    async send(chatId: string, content: unknown, options?: unknown) {
      await raw.send(chatId, content, options);
    },

    async downloadMessageResource(
      messageId: string,
      fileKey: string,
      type: string,
    ) {
      const res = await raw.rawClient.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      });
      const chunks: Buffer[] = [];
      for await (const chunk of res.getReadableStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },

    async stream(
      chatId: string,
      producer: StreamProducer,
      options?: { replyTo?: string },
    ) {
      await raw.stream(chatId, producer, options);
    },

    async updateCard(messageId: string, card: unknown) {
      await raw.updateCard(messageId, card);
    },

    async updateCardByToken(token: string, card: unknown) {
      await raw.rawClient.request({
        url: "/open-apis/interactive/v1/card/update",
        method: "POST",
        data: { token, card },
      });
    },

    async sendFile(chatId: string, filePath: string, fileName?: string) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const stat = await fs.stat(filePath);
      const name = fileName ?? path.basename(filePath);

      const MAX_FILE_SIZE = 20 * 1024 * 1024;
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
          `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，飞书文件消息上限为 20MB`,
        );
      }

      await raw.send(chatId, {
        file: { source: filePath, fileName: name },
      });
    },

    async sendImage(chatId: string, imagePath: string) {
      const fs = await import("node:fs/promises");
      const stat = await fs.stat(imagePath);

      const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
      if (stat.size > MAX_IMAGE_SIZE) {
        throw new Error(
          `图片过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，飞书图片消息上限为 10MB`,
        );
      }

      await raw.send(chatId, {
        image: { source: imagePath },
      });
    },

    get botIdentity() {
      return raw.botIdentity;
    },

    get connected() {
      return _connected;
    },
  } as Channel;

  channel.onRawEvent("im.message.message_read_v1", () => {});

  return channel;
}

export interface ResourceDescriptor {
  type: "image" | "file" | "audio" | "video" | "sticker";
  fileKey?: string;
  url?: string;
  fileName?: string;
}

export interface MentionInfo {
  isBot: boolean;
  userId: string;
  name?: string;
}

export interface ReadyPayload {
  botIdentity: { name: string };
}

export interface MessagePayload {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  senderName?: string;
  content: string;
  rawContentType: string;
  resources: ResourceDescriptor[];
  mentions: MentionInfo[];
  mentionAll: boolean;
  mentionedBot: boolean;
  rootId?: string;
  threadId?: string;
  replyToMessageId?: string;
  createTime: number;
}

export interface CardActionPayload {
  messageId: string;
  chatId: string;
  openId: string;
  action: unknown;
}

export interface ReactionPayload {
  messageId: string;
  chatId: string;
  userId: string;
  emoji: string;
  added: boolean;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

export interface NeedAuthPayload {
  message: string;
}

export interface StatusPayload {
  pid: number;
  uptime: number;
  wsConnected: boolean;
}

export type DaemonMessage =
  | { type: "ready"; botIdentity: { name: string } }
  | { type: "bye"; reason: string }
  | ({ type: "message" } & MessagePayload)
  | ({ type: "cardAction" } & CardActionPayload)
  | ({ type: "reaction" } & ReactionPayload)
  | ({ type: "error" } & ErrorPayload)
  | ({ type: "needAuth" } & NeedAuthPayload)
  | ({ type: "status" } & StatusPayload);

export type MessageMessage = Extract<DaemonMessage, { type: "message" }>;
export type ReadyMessage = Extract<DaemonMessage, { type: "ready" }>;
export type StatusMessage = Extract<DaemonMessage, { type: "status" }>;

export type SendContent =
  | { text: string }
  | { markdown: string }
  | { card: unknown };

export type ExtensionMessage =
  | { type: "send"; chatId: string; content: SendContent; replyTo?: string; replyInThread?: boolean; mentions?: MentionInfo[] }
  | { type: "stream"; chatId: string; content: string; replyTo?: string }
  | { type: "streamEnd"; chatId: string; content?: string; end?: boolean }
  | { type: "updateCard"; messageId: string; card: unknown }
  | { type: "shutdown" }
  | { type: "status" }
  | { type: "auth"; appId: string; appSecret: string };

const DAEMON_TYPES = new Set(["ready", "bye", "message", "cardAction", "reaction", "error", "needAuth", "status"]);

export function isDaemonMessage(msg: unknown): msg is DaemonMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return typeof m.type === "string" && DAEMON_TYPES.has(m.type as string);
}

const EXTENSION_TYPES = new Set(["send", "stream", "streamEnd", "updateCard", "shutdown", "status", "auth"]);

export function isExtensionMessage(msg: unknown): msg is ExtensionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return typeof m.type === "string" && EXTENSION_TYPES.has(m.type as string);
}

export function parseMessage(raw: string): DaemonMessage | ExtensionMessage {
  const msg = JSON.parse(raw.trim());
  if (isDaemonMessage(msg) || isExtensionMessage(msg)) return msg;
  throw new Error(`Unknown IPC message type: ${(msg as { type?: string }).type ?? "missing"}`);
}

export function stringifyMessage(msg: DaemonMessage | ExtensionMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function createDaemonMessage<T extends DaemonMessage["type"]>(
  type: T,
  payload: Omit<Extract<DaemonMessage, { type: T }>, "type">,
): Extract<DaemonMessage, { type: T }> {
  return { type, ...payload } as Extract<DaemonMessage, { type: T }>;
}

export function createExtensionMessage<T extends ExtensionMessage["type"]>(
  type: T,
  payload: Omit<Extract<ExtensionMessage, { type: T }>, "type">,
): Extract<ExtensionMessage, { type: T }> {
  return { type, ...payload } as Extract<ExtensionMessage, { type: T }>;
}

import { vi } from "vitest";
import type { NormalizedMessage } from "../../src/feishu/channel.js";

// ---- mock raw lark channel (the @larksuiteoapi/node-sdk shape) ----

export function createMockRawChannel(opts?: {
  send?: ReturnType<typeof vi.fn>;
  on?: ReturnType<typeof vi.fn>;
  connect?: ReturnType<typeof vi.fn>;
  disconnect?: ReturnType<typeof vi.fn>;
  stream?: ReturnType<typeof vi.fn>;
  updateCard?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
  messageResourceGet?: ReturnType<typeof vi.fn>;
}) {
  return {
    on: opts?.on ?? vi.fn(),
    botIdentity: undefined as { name: string } | undefined,
    connect: opts?.connect ?? vi.fn(),
    disconnect: opts?.disconnect ?? vi.fn(),
    send: opts?.send ?? vi.fn(),
    stream: opts?.stream ?? vi.fn(),
    updateCard: opts?.updateCard ?? vi.fn(),
    get connected() {
      return false;
    },
    dispatcher: { register: vi.fn().mockReturnThis() },
    rawClient: {
      request: opts?.request ?? vi.fn(),
      im: {
        v1: {
          messageResource: {
            get: opts?.messageResourceGet ?? vi.fn(),
          },
        },
      },
    },
  };
}

// ---- mock wrapped channel (the project's Channel interface) ----

export function createMockChannel(opts?: {
  on?: ReturnType<typeof vi.fn>;
  send?: ReturnType<typeof vi.fn>;
  stream?: ReturnType<typeof vi.fn>;
  connect?: ReturnType<typeof vi.fn>;
  disconnect?: ReturnType<typeof vi.fn>;
  onRawEvent?: ReturnType<typeof vi.fn>;
  updateCard?: ReturnType<typeof vi.fn>;
  updateCardByToken?: ReturnType<typeof vi.fn>;
  downloadMessageResource?: ReturnType<typeof vi.fn>;
  botIdentity?: { name: string } | undefined;
  connected?: boolean;
}) {
  return {
    on: opts?.on ?? vi.fn(),
    send: opts?.send ?? vi.fn().mockResolvedValue({ messageId: "msg_mock1" }),
    stream: opts?.stream ?? vi.fn(),
    connect: opts?.connect ?? vi.fn(),
    disconnect: opts?.disconnect ?? vi.fn(),
    onRawEvent: opts?.onRawEvent ?? vi.fn(),
    updateCard: opts?.updateCard ?? vi.fn().mockResolvedValue(undefined),
    updateCardByToken:
      opts?.updateCardByToken ?? vi.fn().mockResolvedValue(undefined),
    botIdentity: opts?.botIdentity ?? { name: "test-bot" },
    connected: opts?.connected ?? true,
    downloadMessageResource: opts?.downloadMessageResource ?? vi.fn(),
  };
}

// ---- mock pi runtime ----

export function createMockRuntime(opts?: {
  prompt?: ReturnType<typeof vi.fn>;
  subscribe?: ReturnType<typeof vi.fn>;
  model?: { provider: string; id: string; name?: string };
  thinkingLevel?: string;
  setModel?: ReturnType<typeof vi.fn>;
  setThinkingLevel?: ReturnType<typeof vi.fn>;
  newSession?: ReturnType<typeof vi.fn>;
  switchSession?: ReturnType<typeof vi.fn>;
  extensionRunner?: {
    setUIContext?: ReturnType<typeof vi.fn>;
    getUIContext?: ReturnType<typeof vi.fn>;
  };
}) {
  return {
    session: {
      prompt: opts?.prompt ?? vi.fn().mockResolvedValue(undefined),
      subscribe: opts?.subscribe ?? vi.fn(() => vi.fn()),
      sessionId: "session-test-123",
      sessionFile: "/tmp/sessions/default.json",
      model: opts?.model,
      thinkingLevel: opts?.thinkingLevel,
      setModel: opts?.setModel ?? vi.fn().mockResolvedValue(undefined),
      setThinkingLevel: opts?.setThinkingLevel ?? vi.fn(),
      extensionRunner: {
        setUIContext:
          opts?.extensionRunner?.setUIContext ?? vi.fn(),
        getUIContext:
          opts?.extensionRunner?.getUIContext ??
          vi.fn(() => ({ __tuiContext: true })),
      },
    },
    newSession: opts?.newSession ?? vi.fn().mockResolvedValue(undefined),
    switchSession:
      opts?.switchSession ?? vi.fn().mockResolvedValue(undefined),
  };
}

// ---- mock normalized message ----

export function createMockMessage(
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    messageId: "msg-1",
    chatId: "chat-1",
    chatType: "p2p",
    senderId: "user-1",
    content: "hello world",
    rawContentType: "text",
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides,
  };
}

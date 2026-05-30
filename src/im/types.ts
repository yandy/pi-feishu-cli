export interface FeishuImConfig {
  strategy: "open" | "mention";
  model?: string;
  botName?: string;
}

export interface FeishuEvent {
  type: string;
  chat_id: string;
  chat_type: string;
  content: string;
  message_id: string;
  message_type: string;
  sender_id: string;
  create_time: string;
  event_id: string;
  timestamp: string;
  raw: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;
}

export interface ChatSessions {
  sessions: SessionInfo[];
  active: string | null;
}

export interface Registry {
  [chatId: string]: ChatSessions;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  sessionCount: number;
  chatCount: number;
}

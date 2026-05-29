export interface FeishuImConfig {
  strategy: "open" | "mention";
  model?: string;
  pollInterval: number;
  autoStart?: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  createdAt: number; // unix ms timestamp
}

export interface ChatSessions {
  sessions: SessionInfo[];
  active: string | null; // session id, or null if none active
}

export interface Registry {
  [chatId: string]: ChatSessions;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null; // seconds
  sessionCount: number;
  chatCount: number;
}

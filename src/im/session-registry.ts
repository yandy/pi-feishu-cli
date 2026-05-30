import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Registry, ChatSessions, SessionInfo } from "./types.js";

const REGISTRY_FILE = "registry.json";

export class SessionRegistry {
  private registry: Registry;
  private registryPath: string;

  constructor(registryDir: string) {
    this.registryPath = join(registryDir, REGISTRY_FILE);
    this.registry = this.load();
  }

  private load(): Registry {
    if (!existsSync(this.registryPath)) return {};
    try {
      return JSON.parse(readFileSync(this.registryPath, "utf-8"));
    } catch {
      return {};
    }
  }

  flush(): void {
    const dir = this.registryPath.replace(/\/[^/]+$/, "");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  private getOrCreateChat(chatId: string): ChatSessions {
    if (!this.registry[chatId]) {
      this.registry[chatId] = { sessions: [], active: null };
    }
    return this.registry[chatId];
  }

  getChatSessions(chatId: string): ChatSessions | null {
    return this.registry[chatId] ?? null;
  }

  getActiveSessionId(chatId: string): string | null {
    return this.registry[chatId]?.active ?? null;
  }

  ensureSession(chatId: string): SessionInfo {
    const chat = this.getOrCreateChat(chatId);
    if (chat.active && chat.sessions.find((s) => s.id === chat.active)) {
      return chat.sessions.find((s) => s.id === chat.active)!;
    }
    return this.createSession(chatId, "默认会话");
  }

  createSession(chatId: string, name: string): SessionInfo {
    const chat = this.getOrCreateChat(chatId);
    const session: SessionInfo = {
      id: randomUUID(),
      name,
      createdAt: Date.now(),
    };
    chat.sessions.push(session);
    chat.active = session.id;
    this.flush();
    return session;
  }

  switchSession(chatId: string, sessionId: string): boolean {
    const chat = this.registry[chatId];
    if (!chat || !chat.sessions.find((s) => s.id === sessionId)) {
      return false;
    }
    chat.active = sessionId;
    this.flush();
    return true;
  }

  deleteSession(chatId: string, sessionId: string): boolean {
    const chat = this.registry[chatId];
    if (!chat) return false;
    const idx = chat.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return false;
    chat.sessions.splice(idx, 1);
    if (chat.active === sessionId) {
      chat.active = chat.sessions.length > 0 ? chat.sessions[0].id : null;
    }
    this.flush();
    return true;
  }
}

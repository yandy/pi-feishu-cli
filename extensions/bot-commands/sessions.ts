import { basename } from "node:path";
import { statSync, rmSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  buildCard,
  type FeishuCardElement,
  type FeishuButtonElement,
} from "../feishu-card.js";

export interface SessionsAction {
  cmd: "sessions";
  action: "switch" | "delete" | "new";
  sessionPath: string;
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}天前`;
}

function getSessionInfo(sessionPath: string): { name: string; messageCount: number; lastActive: string } {
  let name = basename(sessionPath);
  let messageCount = 0;
  try {
    // SessionManager.open(path, sessionDir, cwdOverride) — passing undefined
    // for sessionDir and cwdOverride to let SessionManager use defaults.
    const sm = SessionManager.open(sessionPath, undefined, undefined);
    const sessionName = sm.getSessionName();
    if (sessionName) name = sessionName;
    messageCount = sm.getEntries().length;
  } catch {
    // use defaults
  }
  let lastActive = "未知";
  try {
    const mtime = statSync(sessionPath).mtime;
    lastActive = relativeTime(mtime);
  } catch {
    // use default
  }
  return { name, messageCount, lastActive };
}

export function buildSessionsCard(
  sessions: string[],
  currentSessionFile: string,
): Record<string, unknown> {
  const elements: FeishuCardElement[] = [];

  if (sessions.length === 0) {
    elements.push(
      createMarkdownBlock("暂无会话\n发送任意消息即可自动创建会话。"),
    );
  } else {
    for (const sessionPath of sessions) {
      if (elements.length > 0) {
        elements.push(createDividerBlock());
      }

      const { name, messageCount, lastActive } = getSessionInfo(sessionPath);
      const isCurrent = sessionPath === currentSessionFile;
      const indicator = isCurrent ? "✅ *当前* " : "";
      const markdown = `${indicator}**${name}**\n消息数: ${messageCount} · ${lastActive}`;
      elements.push(createMarkdownBlock(markdown));

      const buttons: FeishuButtonElement[] = [];
      if (!isCurrent) {
        buttons.push(
          createActionButton(
            "切换",
            { cmd: "sessions", action: "switch", sessionPath } satisfies SessionsAction,
            "primary",
          ),
        );
      }
      if (!isCurrent) {
        buttons.push(
          createActionButton(
            "删除",
            { cmd: "sessions", action: "delete", sessionPath } satisfies SessionsAction,
            "danger",
          ),
        );
      }
      elements.push({ tag: "action", actions: buttons } as FeishuCardElement);
    }
  }

  elements.push(createDividerBlock());
  elements.push({
    tag: "action",
    actions: [
      createActionButton(
        "新建会话",
        { cmd: "sessions", action: "new", sessionPath: "" } satisfies SessionsAction,
        "primary",
      ),
    ],
  } as FeishuCardElement);

  return buildCard(createCardHeader("会话列表", "blue"), elements);
}

export async function handleSessionsAction(
  action: SessionsAction,
  ctx: {
    switchSession: (path: string, opts?: { withSession?: (newCtx: any) => Promise<void> }) => Promise<unknown>;
    newSession: (opts?: { withSession?: (newCtx: any) => Promise<void> }) => Promise<unknown>;
  },
  registry: { sessions: string[]; current?: string },
  onUpdate: (registry: { sessions: string[]; current?: string }) => void,
): Promise<void> {
  switch (action.action) {
    case "switch": {
      if (action.sessionPath === registry.current) return;
      await ctx.switchSession(action.sessionPath, { withSession: async (newCtx: any) => {
        registry.current = action.sessionPath;
        onUpdate(registry);
        await newCtx.reload();
      }});
      break;
    }
    case "delete": {
      if (action.sessionPath === registry.current) return;
      rmSync(action.sessionPath, { force: true });
      registry.sessions = registry.sessions.filter(s => s !== action.sessionPath);
      onUpdate(registry);
      break;
    }
    case "new": {
      await ctx.newSession({ withSession: async (newCtx: any) => {
        const sf = newCtx.sessionManager.getSessionFile();
        if (sf) {
          registry.current = sf;
          registry.sessions = [...new Set([...registry.sessions, sf])];
        }
        onUpdate(registry);
        await newCtx.reload();
      }});
      break;
    }
    default: {
      const _exhaustive: never = action.action;
      break;
    }
  }
}

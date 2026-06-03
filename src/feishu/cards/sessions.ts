import type {
  AgentSessionRuntime,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  buildCard,
  type CardElement,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
} from "./helpers.js";

export interface SessionCardOptions {
  runtime: AgentSessionRuntime;
  cwd: string;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

function sessionLabel(s: SessionInfo): string {
  const title = s.name || s.firstMessage || "(空会话)";
  const truncated = title.length > 40 ? `${title.slice(0, 37)}...` : title;
  return `${truncated}  ·  ${s.messageCount}条  ·  ${relativeTime(s.modified)}`;
}

export async function buildSessionsCard(
  options: SessionCardOptions,
): Promise<Record<string, unknown>> {
  const { runtime, cwd } = options;

  const currentSessionPath = runtime.session.sessionFile;
  const projectSessions = await SessionManager.list(cwd);
  const allSessions = await SessionManager.listAll(cwd);

  const elements: (CardElement | Record<string, unknown>)[] = [];

  const currentInfo = projectSessions.find(
    (s) => s.path === currentSessionPath,
  );
  const currentLabel = currentInfo
    ? sessionLabel(currentInfo)
    : runtime.session.sessionName || runtime.session.sessionId || "(未命名)";
  elements.push(createMarkdownBlock("**当前 Session**"));
  elements.push(createMarkdownBlock(currentLabel));

  if (projectSessions.length > 0 || allSessions.length > 0) {
    elements.push(createDividerBlock());
    elements.push(createMarkdownBlock("**其他 Sessions**"));

    const seen = new Set<string>();
    const sessions = [...projectSessions, ...allSessions];
    for (const s of sessions) {
      if (seen.has(s.path) || s.path === currentSessionPath) continue;
      seen.add(s.path);

      elements.push(createMarkdownBlock(sessionLabel(s)));
      elements.push({
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "切换" },
            type: "default",
            value: { cmd: "session", action: "switch", sessionPath: s.path },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "删除" },
            type: "danger",
            value: { cmd: "session", action: "delete", sessionPath: s.path },
          },
        ],
      });
    }
  }

  elements.push(createDividerBlock());
  elements.push({
    tag: "action",
    actions: [
      {
        tag: "button",
        text: { tag: "plain_text", content: "新建 Session" },
        type: "primary",
        value: { cmd: "session", action: "new" },
      },
    ],
  });

  return buildCard(
    createCardHeader("Session 管理", "blue"),
    elements as CardElement[],
  );
}

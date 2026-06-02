import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  type CardElement,
} from "./helpers.js";

export interface SessionCardOptions {
  runtime: AgentSessionRuntime;
  cwd: string;
}

export async function buildSessionsCard(options: SessionCardOptions): Promise<Record<string, unknown>> {
  const { runtime, cwd } = options;

  const currentSessionPath = runtime.session.sessionFile;
  const currentId = currentSessionPath ? basename(currentSessionPath) : "(unnamed)";

  const projectSessions = await SessionManager.list(cwd);
  const allSessions = await SessionManager.listAll(cwd);

  const elements: Record<string, unknown>[] = [];

  elements.push(createMarkdownBlock(`**当前 Session**\n\`${currentId}\``));

  if (projectSessions.length > 0 || allSessions.length > 0) {
    elements.push(createDividerBlock());
    elements.push(createMarkdownBlock("**其他 Sessions**"));

    const seen = new Set<string>();
    const sessions = [...projectSessions, ...allSessions];
    for (const s of sessions) {
      const name = basename(s.path);
      if (seen.has(name) || name === currentId) continue;
      seen.add(name);

      elements.push({
        tag: "action" as const,
        actions: [
          createMarkdownBlock(`\`${name}\``) as any,
          createActionButton("切换", { cmd: "session", action: "switch", sessionPath: s.path }, "default"),
          createActionButton("删除", { cmd: "session", action: "delete", sessionPath: s.path }, "danger"),
        ],
      });
    }
  }

  elements.push(createDividerBlock());
  elements.push({
    tag: "action" as const,
    actions: [
      createActionButton("新建 Session", { cmd: "session", action: "new" }, "primary"),
    ],
  });

  return buildCard(createCardHeader("Session 管理", "blue"), elements as CardElement[]);
}

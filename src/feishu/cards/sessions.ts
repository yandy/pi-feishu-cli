import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import {
  buildCard,
  createCardHeader,
  createMarkdownBlock,
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

  const elements: (CardElement | Record<string, unknown>)[] = [];

  elements.push(createMarkdownBlock("**当前 Session**"));
  elements.push(createMarkdownBlock(currentId));

  if (projectSessions.length > 0 || allSessions.length > 0) {
    elements.push(createDividerBlock());
    elements.push(createMarkdownBlock("**其他 Sessions**"));

    const seen = new Set<string>();
    const sessions = [...projectSessions, ...allSessions];
    for (const s of sessions) {
      const name = basename(s.path);
      if (seen.has(name) || name === currentId) continue;
      seen.add(name);

      elements.push(createMarkdownBlock(name));
      elements.push({
        tag: "action",
        actions: [
          { tag: "button", text: { tag: "plain_text", content: "切换" }, type: "default", value: { cmd: "session", action: "switch", sessionPath: s.path } },
          { tag: "button", text: { tag: "plain_text", content: "删除" }, type: "danger", value: { cmd: "session", action: "delete", sessionPath: s.path } },
        ],
      });
    }
  }

  elements.push(createDividerBlock());
  elements.push({
    tag: "action",
    actions: [
      { tag: "button", text: { tag: "plain_text", content: "新建 Session" }, type: "primary", value: { cmd: "session", action: "new" } },
    ],
  });

  return buildCard(createCardHeader("Session 管理", "blue"), elements as CardElement[]);
}

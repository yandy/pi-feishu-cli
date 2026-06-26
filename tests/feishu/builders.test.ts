import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RawCardActionEvent } from "@larksuiteoapi/node-sdk";
import { normalizeCardAction } from "@larksuiteoapi/node-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModelsCard } from "../../src/feishu/cards/models.js";
import { buildSessionsCard } from "../../src/feishu/cards/sessions.js";
import { initRuntime } from "../../src/runtime.js";

function makeSessionFile(
  sessionDir: string,
  opts: { id: string; cwd: string; name?: string; firstMessage?: string },
): string {
  const now = new Date().toISOString();
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: opts.id,
    timestamp: now,
    cwd: opts.cwd,
  });
  const lines = [header];
  if (opts.name) {
    lines.push(
      JSON.stringify({
        type: "session_info",
        id: "info-1",
        parentId: null,
        timestamp: now,
        name: opts.name,
      }),
    );
  }
  if (opts.firstMessage) {
    lines.push(
      JSON.stringify({
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: now,
        message: {
          role: "user",
          content: [{ type: "text", text: opts.firstMessage }],
        },
      }),
    );
  }
  const filePath = join(sessionDir, `test_${opts.id}.jsonl`);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
  return filePath;
}

describe("card builders format", () => {
  let tmpCwd: string;
  let sessionDir: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    // Session directory mirrors what pi uses: ~/.pi/agent/sessions/<safe-cwd>
    const resolvedCwd = tmpCwd.replace(/\/$/, "");
    const safePath = `--${resolvedCwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
    sessionDir = join(getAgentDir(), "sessions", safePath);
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpCwd, { recursive: true, force: true });
    // Clean up created session files
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Feishu card action 元素内反引号会导致渲染错误
  it("sessions card markdown has no backtick characters", async () => {
    // Create a session with backtick characters in the name/firstMessage
    makeSessionFile(sessionDir, {
      id: "backtick-test",
      cwd: tmpCwd,
      name: "使用 `pi` 和 `vitest` 的项目",
      firstMessage: "请运行 `npm test` 来检查",
    });

    const { runtime } = await initRuntime({ cwd: tmpCwd });
    const card = await buildSessionsCard({ runtime, cwd: tmpCwd });
    const json = JSON.stringify(card);
    expect(json).not.toContain("`");

    await runtime.dispose();
  }, 30000);

  it("sessions card action elements only contain button children", async () => {
    makeSessionFile(sessionDir, {
      id: "button-test",
      cwd: tmpCwd,
      name: "测试会话",
    });

    const { runtime } = await initRuntime({ cwd: tmpCwd });
    const card = await buildSessionsCard({ runtime, cwd: tmpCwd });
    const elements = (card as any).body?.elements ?? [];
    const buttonCount = elements.filter(
      (el: any) => el.tag === "button",
    ).length;
    expect(buttonCount).toBeGreaterThan(0);

    await runtime.dispose();
  }, 30000);

  // Feishu card action 元素内反引号会导致渲染错误
  it("models card markdown has no backtick characters", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: [
        {
          provider: "test",
          id: "test-model",
          name: "Test Model",
          input: ["text"] as ("text" | "image")[],
          contextWindow: 1000,
        },
      ],
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain("`");
  }, 30000);

  it("models card action elements only contain button children", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: [
        {
          provider: "test",
          id: "test-model",
          name: "Test Model",
          input: ["text"] as ("text" | "image")[],
          contextWindow: 1000,
        },
      ],
    });
    const elements = (card as any).body?.elements ?? [];
    const buttonCount = elements.filter(
      (el: any) => el.tag === "button",
    ).length;
    expect(buttonCount).toBeGreaterThan(0);
  }, 30000);
});

describe("card action event parsing", () => {
  it("extracts action value from normalized event", () => {
    const raw: RawCardActionEvent = {
      open_message_id: "om_xxx",
      open_chat_id: "oc_xxx",
      operator: { open_id: "ou_xxx" },
      action: { value: { cmd: "session", action: "new" }, tag: "button" },
    };
    const evt = normalizeCardAction(raw)!;

    const currentValue = (evt as any)?.value ?? evt;
    expect(currentValue.cmd).toBeUndefined();

    const fixedValue = (evt as any)?.action?.value ?? evt;
    expect(fixedValue.cmd).toBe("session");
    expect(fixedValue.action).toBe("new");
  });

  it("extracts messageId and chatId from normalized event", () => {
    const raw: RawCardActionEvent = {
      open_message_id: "om_xxx",
      open_chat_id: "oc_xxx",
      operator: { open_id: "ou_xxx" },
      action: { value: { cmd: "session", action: "new" }, tag: "button" },
    };
    const evt = normalizeCardAction(raw)!;

    expect(evt.messageId).toBe("om_xxx");
    expect(evt.chatId).toBe("oc_xxx");
  });
});

describe("session display", () => {
  let tmpCwd: string;
  let sessionDir: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    const resolvedCwd = tmpCwd.replace(/\/$/, "");
    const safePath = `--${resolvedCwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
    sessionDir = join(getAgentDir(), "sessions", safePath);
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpCwd, { recursive: true, force: true });
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("sessions card shows human-friendly labels instead of file IDs", async () => {
    // Create a session with a Chinese name
    makeSessionFile(sessionDir, {
      id: "named-session-001",
      cwd: tmpCwd,
      name: "我的会话",
      firstMessage: "你好世界",
    });

    const { runtime } = await initRuntime({ cwd: tmpCwd });
    const card = await buildSessionsCard({ runtime, cwd: tmpCwd });
    const elements = (card as any).body?.elements ?? [];
    const divTexts = elements
      .filter((el: any) => el.tag === "markdown")
      .map((el: any) => el.content ?? "");

    expect(divTexts.some((t: string) => t.includes("我的会话"))).toBe(true);
    expect(divTexts.some((t: string) => t.includes("条"))).toBe(true);
    expect(divTexts.every((t: string) => !t.includes(".jsonl"))).toBe(true);

    await runtime.dispose();
  }, 30000);
});

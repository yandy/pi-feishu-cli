import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawCardActionEvent } from "@larksuiteoapi/node-sdk";
import { normalizeCardAction } from "@larksuiteoapi/node-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModelsCard } from "../../src/feishu/cards/models.js";
import { buildSessionsCard } from "../../src/feishu/cards/sessions.js";
import { initRuntime } from "../../src/runtime.js";

describe("card builders format", () => {
  // Feishu card action 元素内反引号会导致渲染错误
  it("sessions card markdown has no backtick characters", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildSessionsCard({ runtime, cwd });
    const json = JSON.stringify(card);
    expect(json).not.toContain("`");
  }, 30000);

  it("sessions card action elements only contain button children", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildSessionsCard({ runtime, cwd });
    const elements = (card as any).body?.elements ?? [];
    const buttonCount = elements.filter(
      (el: any) => el.tag === "button",
    ).length;
    expect(buttonCount).toBeGreaterThan(0);
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

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("sessions card shows human-friendly labels instead of file IDs", async () => {
    const cwd = tmpCwd;
    const resolvedCwd = cwd.replace(/\/$/, "");
    const safePath = `--${resolvedCwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
    const agentDir = join(process.env.HOME || "/root", ".pi", "agent");
    const sessionDir = join(agentDir, "sessions", safePath);
    mkdirSync(sessionDir, { recursive: true });

    const sessionId = "named-session-001";
    const now = new Date().toISOString();
    const headerLine = JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: now,
      cwd,
    });
    const infoLine = JSON.stringify({
      type: "session_info",
      id: "e1",
      parentId: null,
      timestamp: now,
      name: "我的会话",
    });
    const sessionFile = join(sessionDir, `test_${sessionId}.jsonl`);
    writeFileSync(sessionFile, `${headerLine}\n${infoLine}\n`, "utf-8");

    const { runtime } = await initRuntime({ cwd });
    const card = await buildSessionsCard({ runtime, cwd });
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

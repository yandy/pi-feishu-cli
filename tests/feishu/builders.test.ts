import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { buildSessionsCard } from "../../src/feishu/cards/sessions.js";
import { buildModelsCard } from "../../src/feishu/cards/models.js";
import { initRuntime } from "../../src/runtime.js";
import { resumeMostRecentSession } from "../../src/index.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { normalizeCardAction } from "@larksuiteoapi/node-sdk";
import type { RawCardActionEvent } from "@larksuiteoapi/node-sdk";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("card builders format", () => {
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
    const elements = (card as any).elements ?? [];
    let actionCount = 0;
    for (const el of elements) {
      if (el.tag === "action") {
        actionCount++;
        for (const action of el.actions ?? []) {
          expect(action.tag).toBe("button");
        }
      }
    }
    expect(actionCount).toBeGreaterThan(0);
  }, 30000);

  it("models card markdown has no backtick characters", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: [{ provider: "test", id: "test-model" }],
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain("`");
  }, 30000);

  it("models card action elements only contain button children", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });
    const card = await buildModelsCard({
      session: runtime.session,
      availableModels: [{ provider: "test", id: "test-model" }],
    });
    const elements = (card as any).elements ?? [];
    let actionCount = 0;
    for (const el of elements) {
      if (el.tag === "action") {
        actionCount++;
        for (const action of el.actions ?? []) {
          expect(action.tag).toBe("button");
        }
      }
    }
    expect(actionCount).toBeGreaterThan(0);
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

describe("startup session resume", () => {
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("resumeMostRecentSession loads persisted session from previous run", async () => {
    const cwd = tmpCwd;
    const resolvedCwd = cwd.replace(/\/$/, "");
    const safePath = `--${resolvedCwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
    const agentDir = join(process.env.HOME || "/root", ".pi", "agent");
    const sessionDir = join(agentDir, "sessions", safePath);
    mkdirSync(sessionDir, { recursive: true });

    const sessionId = "test-session-001";
    const headerLine = JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd,
    });
    const sessionFile = join(sessionDir, `test_${sessionId}.jsonl`);
    writeFileSync(sessionFile, headerLine + "\n", "utf-8");

    const found = await SessionManager.list(cwd);
    expect(found.some(s => s.path === sessionFile)).toBe(true);

    const { runtime } = await initRuntime({ cwd });
    const freshPath = runtime.session.sessionFile!;

    const resumed = await resumeMostRecentSession(runtime, cwd);
    expect(resumed).toBe(true);
    expect(runtime.session.sessionFile).toBe(sessionFile);

    await runtime.dispose();
  }, 30000);

  it("sessions card shows human-friendly labels instead of file IDs", async () => {
    const cwd = tmpCwd;
    const resolvedCwd = cwd.replace(/\/$/, "");
    const safePath = `--${resolvedCwd.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
    const agentDir = join(process.env.HOME || "/root", ".pi", "agent");
    const sessionDir = join(agentDir, "sessions", safePath);
    mkdirSync(sessionDir, { recursive: true });

    const sessionId = "named-session-001";
    const now = new Date().toISOString();
    const headerLine = JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: now, cwd });
    const infoLine = JSON.stringify({ type: "session_info", id: "e1", parentId: null, timestamp: now, name: "我的会话" });
    const sessionFile = join(sessionDir, `test_${sessionId}.jsonl`);
    writeFileSync(sessionFile, headerLine + "\n" + infoLine + "\n", "utf-8");

    const { runtime } = await initRuntime({ cwd });
    const card = await buildSessionsCard({ runtime, cwd });
    const elements = (card as any).elements ?? [];
    const divTexts = elements
      .filter((el: any) => el.tag === "div")
      .map((el: any) => el.text?.content ?? "");

    expect(divTexts.some((t: string) => t.includes("我的会话"))).toBe(true);
    expect(divTexts.some((t: string) => t.includes("条"))).toBe(true);
    expect(divTexts.every((t: string) => !t.includes(".jsonl"))).toBe(true);

    await runtime.dispose();
  }, 30000);

  it("resumeMostRecentSession returns false when no pre-existing sessions", async () => {
    const cwd = tmpCwd;
    const { runtime } = await initRuntime({ cwd });
    const currentPath = runtime.session.sessionFile!;

    const resumed = await resumeMostRecentSession(runtime, cwd);
    expect(resumed).toBe(false);
    expect(runtime.session.sessionFile).toBe(currentPath);

    await runtime.dispose();
  }, 30000);
});

// Diagnostic: does buildSessionsCard change after newSession?
describe("diagnostic: session card after newSession", () => {
  it("sessionFile changes after newSession", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });

    const file1 = runtime.session.sessionFile;
    await runtime.newSession();
    const file2 = runtime.session.sessionFile;

    expect(file1).toBeDefined();
    expect(file2).toBeDefined();
    expect(file2).not.toBe(file1);
  }, 30000);

  it("buildSessionsCard content changes after newSession", async () => {
    const cwd = process.cwd();
    const { runtime } = await initRuntime({ cwd });

    const card1 = await buildSessionsCard({ runtime, cwd });
    const json1 = JSON.stringify(card1);
    await runtime.newSession();

    const card2 = await buildSessionsCard({ runtime, cwd });
    const json2 = JSON.stringify(card2);

    expect(json2).not.toBe(json1);
  }, 30000);
});

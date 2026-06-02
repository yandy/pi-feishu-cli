import { describe, it, expect } from "vitest";
import { buildSessionsCard } from "../../src/feishu/cards/sessions.js";
import { buildModelsCard } from "../../src/feishu/cards/models.js";
import { initRuntime } from "../../src/runtime.js";
import { normalizeCardAction } from "@larksuiteoapi/node-sdk";
import type { RawCardActionEvent } from "@larksuiteoapi/node-sdk";

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

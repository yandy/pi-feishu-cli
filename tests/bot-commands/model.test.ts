import { describe, it, expect, vi } from "vitest";
import type { ModelInfo, ModelAction } from "../../extensions/bot-commands/model.js";
import {
  buildModelCard,
  handleModelAction,
} from "../../extensions/bot-commands/model.js";

describe("buildModelCard", () => {
  const models: ModelInfo[] = [
    { provider: "openai", id: "gpt-4", name: "GPT-4" },
    { provider: "anthropic", id: "claude-3", name: "Claude 3" },
  ];

  it("returns card with select_static menu containing all model names", () => {
    const card = buildModelCard(models, undefined);
    const json = JSON.stringify(card);

    expect(json).toContain("GPT-4 (openai)");
    expect(json).toContain("Claude 3 (anthropic)");
    expect(json).toContain("select_static");
  });

  it("sets initial_option for current model", () => {
    const currentModel = { provider: "openai", id: "gpt-4" };
    const card = buildModelCard(models, currentModel);
    const json = JSON.stringify(card);

    const expectedAction: ModelAction = {
      cmd: "model",
      action: "select",
      modelProvider: "openai",
      modelId: "gpt-4",
    };
    const valueString = JSON.stringify(expectedAction);
    expect(json).toContain(valueString.replace(/"/g, '\\"'));
  });

  it("shows empty state when no models", () => {
    const card = buildModelCard([], undefined);
    const json = JSON.stringify(card);

    expect(json).toContain("暂无可用模型");
  });

  it('shows "未设置" when currentModel is undefined', () => {
    const card = buildModelCard(models, undefined);
    const json = JSON.stringify(card);

    expect(json).toContain("未设置");
  });
});

describe("ModelAction JSON", () => {
  it("serializes and deserializes correctly", () => {
    const action: ModelAction = {
      cmd: "model",
      action: "select",
      modelProvider: "openai",
      modelId: "gpt-4",
    };
    const parsed = JSON.parse(JSON.stringify(action));
    expect(parsed).toEqual(action);
  });
});

describe("handleModelAction", () => {
  it("switches session and calls onUpdate with fresh model data", async () => {
    const freshModels: ModelInfo[] = [{ provider: "openai", id: "gpt-4", name: "GPT-4" }];
    const switchSession = vi.fn().mockImplementation(async (_path: string, opts?: { withSession?: (newCtx: any) => Promise<void> }) => {
      await opts?.withSession?.({
        modelRegistry: { getAvailable: () => freshModels },
        model: { provider: "openai", id: "gpt-4" },
      });
    });
    const newSession = vi.fn();
    const modelRegistry = { find: vi.fn().mockReturnValue({ name: "GPT-4" }) };
    const ctx = { switchSession, newSession, modelRegistry };
    const registry: { sessions: string[]; current?: string } = { sessions: ["/sessions/test.json"], current: "/sessions/test.json" };
    const setModel = vi.fn().mockResolvedValue(true);
    const onUpdate = vi.fn();

    const action: ModelAction = {
      cmd: "model",
      action: "select",
      modelProvider: "openai",
      modelId: "gpt-4",
    };

    const result = await handleModelAction(action, ctx, registry, setModel, onUpdate);

    expect(switchSession).toHaveBeenCalledWith("/sessions/test.json", expect.objectContaining({ withSession: expect.any(Function) }));
    expect(modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4");
    expect(setModel).toHaveBeenCalledWith({ name: "GPT-4" });
    expect(onUpdate).toHaveBeenCalledWith(freshModels, { provider: "openai", id: "gpt-4" });
    expect(result).toBe(true);
  });

  it("creates new session and calls onUpdate with fresh model data and updates registry", async () => {
    const freshModels: ModelInfo[] = [{ provider: "openai", id: "gpt-4", name: "GPT-4" }];
    const switchSession = vi.fn();
    const newSession = vi.fn().mockImplementation(async (opts?: { withSession?: (newCtx: any) => Promise<void> }) => {
      await opts?.withSession?.({
        sessionManager: { getSessionFile: () => "/sessions/new.json" },
        modelRegistry: { getAvailable: () => freshModels },
        model: { provider: "openai", id: "gpt-4" },
      });
    });
    const modelRegistry = { find: vi.fn().mockReturnValue({ name: "GPT-4" }) };
    const ctx = { switchSession, newSession, modelRegistry };
    const registry: { sessions: string[]; current?: string } = { sessions: [] };
    const setModel = vi.fn().mockResolvedValue(true);
    const onUpdate = vi.fn();

    const action: ModelAction = {
      cmd: "model",
      action: "select",
      modelProvider: "openai",
      modelId: "gpt-4",
    };

    const result = await handleModelAction(action, ctx, registry, setModel, onUpdate);

    expect(newSession).toHaveBeenCalledWith(expect.objectContaining({ withSession: expect.any(Function) }));
    expect(setModel).toHaveBeenCalledWith({ name: "GPT-4" });
    expect(registry.current).toBe("/sessions/new.json");
    expect(registry.sessions).toContain("/sessions/new.json");
    expect(onUpdate).toHaveBeenCalledWith(freshModels, { provider: "openai", id: "gpt-4" });
    expect(result).toBe(true);
  });

  it("returns false and does not call onUpdate when model not found", async () => {
    const switchSession = vi.fn();
    const newSession = vi.fn();
    const modelRegistry = { find: vi.fn().mockReturnValue(undefined) };
    const ctx = { switchSession, newSession, modelRegistry };
    const registry: { sessions: string[]; current?: string } = { sessions: [] };
    const setModel = vi.fn();
    const onUpdate = vi.fn();

    const action: ModelAction = {
      cmd: "model",
      action: "select",
      modelProvider: "unknown",
      modelId: "nonexistent",
    };

    const result = await handleModelAction(action, ctx, registry, setModel, onUpdate);

    expect(switchSession).not.toHaveBeenCalled();
    expect(newSession).not.toHaveBeenCalled();
    expect(setModel).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

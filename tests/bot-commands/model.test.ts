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
  it("calls setModel and returns true when model found", async () => {
    const modelRegistry = { find: vi.fn().mockReturnValue({ name: "GPT-4" }) };
    const setModel = vi.fn().mockResolvedValue(true);
    const action: ModelAction = { cmd: "model", action: "select", modelProvider: "openai", modelId: "gpt-4" };
    const result = await handleModelAction(action, modelRegistry, setModel);
    expect(modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4");
    expect(setModel).toHaveBeenCalledWith({ name: "GPT-4" });
    expect(result).toBe(true);
  });

  it("returns false and does not call setModel when model not found", async () => {
    const modelRegistry = { find: vi.fn().mockReturnValue(undefined) };
    const setModel = vi.fn();
    const action: ModelAction = { cmd: "model", action: "select", modelProvider: "unknown", modelId: "nonexistent" };
    const result = await handleModelAction(action, modelRegistry, setModel);
    expect(setModel).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

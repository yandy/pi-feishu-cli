import { describe, expect, it } from "vitest";
import { buildHelpCard } from "../../src/feishu/cards/help.js";
import {
  buildCard,
  type CardButton,
  createActionButton,
  createCardHeader,
  createDividerBlock,
  createMarkdownBlock,
  createNoteBlock,
} from "../../src/feishu/cards/helpers.js";

describe("card helpers", () => {
  it("createCardHeader returns header with title", () => {
    const h = createCardHeader("Test Title", "blue");
    expect(h.title).toEqual({ tag: "plain_text", content: "Test Title" });
    expect(h.template).toBe("blue");
  });

  it("createMarkdownBlock returns markdown block", () => {
    const b = createMarkdownBlock("**bold**");
    expect(b).toEqual({ tag: "markdown", content: "**bold**" });
  });

  it("createActionButton returns button with value", () => {
    const b = createActionButton(
      "Click",
      { cmd: "test", action: "go" },
      "primary",
    ) as CardButton;
    expect(b.tag).toBe("button");
    expect(b.text).toEqual({ tag: "plain_text", content: "Click" });
    expect(b.type).toBe("primary");
    expect(b.behaviors).toEqual([
      { type: "callback", value: { cmd: "test", action: "go" } },
    ]);
  });

  it("createDividerBlock returns hr", () => {
    expect(createDividerBlock()).toEqual({ tag: "hr" });
  });

  it("createNoteBlock returns markdown element", () => {
    const n = createNoteBlock("footer text");
    expect(n).toEqual({ tag: "markdown", content: "footer text" });
  });

  it("buildCard assembles header + elements", () => {
    const header = createCardHeader("Test");
    const elements = [createMarkdownBlock("hello")];
    const card = buildCard(header, elements);
    expect(card.config).toEqual({ update_multi: true, width_mode: "fill" });
    expect(card.header).toBe(header);
    expect((card as any).body.elements).toBe(elements);
    expect(card).toMatchObject({ schema: "2.0" });
  });
});

describe("help card", () => {
  it("buildHelpCard returns card with bot name in content", () => {
    const card = buildHelpCard("TestBot");
    expect(card.header).toBeDefined();
    expect((card as any).body.elements).toBeDefined();
    expect((card.header as any).title.content).toBe("使用帮助");
    const markdownBlocks = ((card as any).body.elements as any[]).filter(
      (e: any) => e.tag === "markdown",
    );
    expect(
      markdownBlocks.some((b: any) => b.content.includes("TestBot")),
    ).toBe(true);
  });

  it("help card has session and model action buttons", () => {
    const card = buildHelpCard("Bot");
    const buttons = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "button",
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(buttons[0].behaviors[0].value).toMatchObject({
      cmd: "help",
      action: "sessions",
    });
    expect(buttons[1].behaviors[0].value).toMatchObject({
      cmd: "help",
      action: "models",
    });
  });
});

import { buildModelsCard } from "../../src/feishu/cards/models.js";

describe("models card", () => {
  const mockSession = {
    model: {
      provider: "test",
      id: "gpt-4",
      name: "GPT-4",
      input: ["text", "image"] as ("text" | "image")[],
      contextWindow: 128000,
    },
    thinkingLevel: "high" as const,
  };
  const mockModels = [
    {
      provider: "openai",
      id: "gpt-4",
      name: "GPT-4",
      input: ["text", "image"] as ("text" | "image")[],
      contextWindow: 128000,
    },
    {
      provider: "anthropic",
      id: "claude-3",
      name: "Claude 3",
      input: ["text", "image"] as ("text" | "image")[],
      contextWindow: 200000,
    },
  ];

  it("current model line shows name, provider, level, input, context", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const markdowns = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "markdown",
    );
    const currentDiv = markdowns.find((d: any) =>
      d.content?.includes("**当前**"),
    );
    expect(currentDiv).toBeDefined();
    expect(currentDiv.content).toContain("GPT-4");
    expect(currentDiv.content).toContain("test");
    expect(currentDiv.content).toContain("high");
    expect(currentDiv.content).toContain("text+image");
    expect(currentDiv.content).toContain("128K");
  });

  it("action buttons use short thinking labels", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const buttons = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "button",
    );
    expect(buttons.length).toBeGreaterThan(0);
    const buttonTexts = buttons.map((b: any) => b.text.content);
    expect(buttonTexts.some((t: string) => t.startsWith("Think:"))).toBe(false);
    expect(buttonTexts).toContain("high");
    expect(buttonTexts).toContain("off");
    expect(buttonTexts).toContain("med");
  });

  it("divides sections with hr elements", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const hrs = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "hr",
    );
    expect(hrs.length).toBeGreaterThanOrEqual(2);
  });

  it("model names are bolded in markdown", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const markdowns = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "markdown",
    );
    const boldNames = markdowns.filter((d: any) => {
      const c = d.content || "";
      return c.includes("**GPT-4**") || c.includes("**Claude 3**");
    });
    expect(boldNames.length).toBe(2);
  });

  it("current model has no [选取] button, other models do", async () => {
    const currentProvider = mockSession.model.provider;
    const currentId = mockSession.model.id;
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: [
        { provider: currentProvider, id: currentId, name: "M1", input: ["text"] as ("text" | "image")[], contextWindow: 1000 },
        { provider: "other", id: "m2", name: "M2", input: ["text"] as ("text" | "image")[], contextWindow: 1000 },
      ],
    });
    const buttons = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "button",
    );
    const selectButtons = buttons.filter((b: any) => b.text.content === "选取");
    expect(selectButtons.length).toBe(1);
  });

  it("thinking level buttons carry current model in callback", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const buttons = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "button",
    );
    const levelButtons = buttons.filter(
      (b: any) =>
        b.behaviors?.[0]?.value?.cmd === "model" &&
        b.behaviors?.[0]?.value?.action === "select" &&
        b.behaviors?.[0]?.value?.thinkingLevel,
    );
    for (const btn of levelButtons) {
      const v = btn.behaviors[0].value;
      expect(v.provider).toBe(mockSession.model.provider);
      expect(v.modelId).toBe(mockSession.model.id);
    }
  });

  it("groups models by provider section headers", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const markdowns = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "markdown",
    );
    const headers = markdowns.filter((d: any) =>
      d.content?.match(/\*\*── .+ ──\*\*/),
    );
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect } from "vitest";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../../src/feishu/cards/helpers.js";
import { buildHelpCard } from "../../src/feishu/cards/help.js";

describe("card helpers", () => {
  it("createCardHeader returns header with title", () => {
    const h = createCardHeader("Test Title", "blue");
    expect(h.title).toEqual({ tag: "plain_text", content: "Test Title" });
    expect(h.template).toBe("blue");
  });

  it("createMarkdownBlock returns div with lark_md", () => {
    const b = createMarkdownBlock("**bold**");
    expect(b).toEqual({
      tag: "div",
      text: { tag: "lark_md", content: "**bold**" },
    });
  });

  it("createActionButton returns button with value", () => {
    const b = createActionButton("Click", { cmd: "test", action: "go" }, "primary");
    expect(b.tag).toBe("button");
    expect(b.text).toEqual({ tag: "plain_text", content: "Click" });
    expect(b.type).toBe("primary");
    expect(b.value).toEqual({ cmd: "test", action: "go" });
  });

  it("createDividerBlock returns hr", () => {
    expect(createDividerBlock()).toEqual({ tag: "hr" });
  });

  it("createNoteBlock returns note element", () => {
    const n = createNoteBlock("footer text");
    expect(n).toEqual({
      tag: "note",
      elements: [{ tag: "plain_text", content: "footer text" }],
    });
  });

  it("buildCard assembles header + elements", () => {
    const header = createCardHeader("Test");
    const elements = [createMarkdownBlock("hello")];
    const card = buildCard(header, elements);
    expect(card.config).toEqual({ wide_screen_mode: true, update_multi: true });
    expect(card.header).toBe(header);
    expect(card.elements).toBe(elements);
  });
});

describe("help card", () => {
  it("buildHelpCard returns card with bot name in content", () => {
    const card = buildHelpCard("TestBot");
    expect(card.header).toBeDefined();
    expect(card.elements).toBeDefined();
    expect((card.header as any).title.content).toBe("使用帮助");
    const markdownBlocks = (card.elements as any[]).filter(
      (e: any) => e.tag === "div" && e.text?.tag === "lark_md",
    );
    expect(markdownBlocks.some((b: any) => b.text.content.includes("TestBot"))).toBe(true);
  });

  it("help card has session and model action buttons", () => {
    const card = buildHelpCard("Bot");
    const actionBlocks = (card.elements as any[]).filter(
      (e: any) => e.tag === "action",
    );
    expect(actionBlocks.length).toBeGreaterThanOrEqual(2);
    expect(actionBlocks[0].actions[0].value).toMatchObject({ cmd: "help", action: "sessions" });
    expect(actionBlocks[1].actions[0].value).toMatchObject({ cmd: "help", action: "models" });
  });
});

import { buildModelsCard } from "../../src/feishu/cards/models.js";

describe("models card", () => {
  const mockSession = {
    model: { provider: "test", id: "gpt-4" },
    thinkingLevel: "high" as const,
  };
  const mockModels = [
    { provider: "openai", id: "gpt-4" },
    { provider: "anthropic", id: "claude-3" },
  ];

  it("uses short thinking labels without 'Think:' prefix", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const divs = (card.elements as any[]).filter((e: any) => e.tag === "div");
    const currentDiv = divs.find((d: any) => d.text?.content?.includes("test/gpt-4"));
    expect(currentDiv?.text?.content).not.toContain("Thinking:");
  });

  it("action buttons use short labels", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const actions = (card.elements as any[]).filter((e: any) => e.tag === "action");
    expect(actions.length).toBeGreaterThan(0);
    const buttons = actions[0].actions;
    const buttonTexts = buttons.map((b: any) => b.text.content);
    expect(buttonTexts.some((t: string) => t.startsWith("Think:"))).toBe(false);
    expect(buttonTexts).toContain("high");
    expect(buttonTexts).toContain("off");
    expect(buttonTexts).toContain("min");
    expect(buttonTexts).toContain("med");
  });

  it("has dividers between model groups", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const hrs = (card.elements as any[]).filter((e: any) => e.tag === "hr");
    expect(hrs.length).toBeGreaterThanOrEqual(1);
  });

  it("model names are bolded", async () => {
    const card = await buildModelsCard({ session: mockSession as any, availableModels: mockModels });
    const divs = (card.elements as any[]).filter((e: any) => e.tag === "div");
    const boldModelNames = divs.filter((d: any) => {
      const c = d.text?.content || "";
      return c.includes("**openai/gpt-4**") || c.includes("**anthropic/claude-3**");
    });
    expect(boldModelNames.length).toBe(2);
  });
});

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

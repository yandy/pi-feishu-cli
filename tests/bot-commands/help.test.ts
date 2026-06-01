import { describe, it, expect } from "vitest";
import { buildHelpCard } from "../../extensions/bot-commands/help.js";

describe("buildHelpCard", () => {
  it("returns a card with header, elements array, and config", () => {
    const card = buildHelpCard();
    expect(card).toHaveProperty("header");
    expect(card).toHaveProperty("elements");
    expect(Array.isArray(card.elements)).toBe(true);
    expect(card).toHaveProperty("config");
  });

  it("header title contains Pi (welcome text)", () => {
    const card = buildHelpCard();
    const header = card.header as { title: { content: string } };
    expect(header.title.content).toContain("Pi");
  });

  it("card JSON contains /help and /model but NOT /sessions", () => {
    const card = buildHelpCard();
    const json = JSON.stringify(card);
    expect(json).toContain("/help");
    expect(json).toContain("/model");
    expect(json).not.toContain("/sessions");
  });

  it("first element contains Pi in its markdown content", () => {
    const card = buildHelpCard();
    const elements = card.elements as { tag: string; text?: { content: string } }[];
    const first = elements[0];
    expect(first.tag).toBe("div");
    expect(first.text?.content).toContain("Pi");
  });
});

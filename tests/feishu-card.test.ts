import { describe, it, expect } from "vitest";
import type { FeishuCardElement } from "../extensions/feishu-card.js";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createSelectMenu,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../extensions/feishu-card.js";

describe("Feishu Card Builder", () => {
  describe("createCardHeader", () => {
    it("creates a header with plain_text title", () => {
      const header = createCardHeader("Test Title");
      expect(header).toEqual({
        title: { tag: "plain_text", content: "Test Title" },
      });
    });

    it("includes optional template", () => {
      const header = createCardHeader("Warn", "red");
      expect(header).toEqual({
        title: { tag: "plain_text", content: "Warn" },
        template: "red",
      });
    });
  });

  describe("createMarkdownBlock", () => {
    it("creates a div with lark_md content", () => {
      const block = createMarkdownBlock("Hello **world**");
      expect(block).toEqual({
        tag: "div",
        text: { tag: "lark_md", content: "Hello **world**" },
      });
    });
  });

  describe("createActionButton", () => {
    it("creates a button with default type", () => {
      const btn = createActionButton("Click", { action: "submit" });
      expect(btn).toEqual({
        tag: "button",
        text: { tag: "plain_text", content: "Click" },
        type: "default",
        value: { action: "submit" },
      });
    });

    it("creates a button with specified type", () => {
      const btn = createActionButton("Delete", { id: "1" }, "danger");
      expect(btn).toEqual({
        tag: "button",
        text: { tag: "plain_text", content: "Delete" },
        type: "danger",
        value: { id: "1" },
      });
    });
  });

  describe("createSelectMenu", () => {
    it("creates a select_static with placeholder and options", () => {
      const options = [
        { text: { tag: "plain_text" as const, content: "Option A" }, value: "a" },
        { text: { tag: "plain_text" as const, content: "Option B" }, value: "b" },
      ];
      const menu = createSelectMenu("Choose...", options);
      expect(menu).toEqual({
        tag: "select_static",
        placeholder: { tag: "plain_text", content: "Choose..." },
        options,
      });
    });

    it("includes optional initial_option", () => {
      const options = [
        { text: { tag: "plain_text" as const, content: "Yes" }, value: "yes" },
        { text: { tag: "plain_text" as const, content: "No" }, value: "no" },
      ];
      const menu = createSelectMenu("Select", options, "yes");
      expect(menu).toEqual({
        tag: "select_static",
        placeholder: { tag: "plain_text", content: "Select" },
        options,
        initial_option: "yes",
      });
    });
  });

  describe("createDividerBlock", () => {
    it("creates an hr element", () => {
      const divider = createDividerBlock();
      expect(divider).toEqual({ tag: "hr" });
    });
  });

  describe("createNoteBlock", () => {
    it("creates a note with plain_text", () => {
      const note = createNoteBlock("This is a note");
      expect(note).toEqual({
        tag: "note",
        elements: [{ tag: "plain_text", content: "This is a note" }],
      });
    });
  });

  describe("buildCard", () => {
    it("assembles header and elements into a full card", () => {
      const header = createCardHeader("Card Title");
      const elements = [
        createMarkdownBlock("Some content"),
        createDividerBlock(),
      ];
      const card = buildCard(header, elements);
      expect(card).toEqual({
        config: { wide_screen_mode: true },
        header,
        elements,
      });
    });

    it("includes optional config", () => {
      const header = createCardHeader("Title");
      const elements: FeishuCardElement[] = [];
      const card = buildCard(header, elements, { wide_screen_mode: false });
      expect(card).toEqual({
        config: { wide_screen_mode: false },
        header,
        elements,
      });
    });
  });
});

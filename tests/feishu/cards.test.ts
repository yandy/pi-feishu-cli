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
import {
  buildStopCard,
  buildStopCardDone,
} from "../../src/feishu/cards/stop.js";

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
    expect(markdownBlocks.some((b: any) => b.content.includes("TestBot"))).toBe(
      true,
    );
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
    const currentIdx = markdowns.findIndex((d: any) =>
      d.content?.includes("📌 **当前"),
    );
    expect(currentIdx).not.toBe(-1);
    const modelLine = markdowns[currentIdx];
    const attrsLine = markdowns[currentIdx + 1];
    expect(modelLine.content).toContain("GPT-4");
    expect(modelLine.content).toContain("test");
    expect(attrsLine.content).toContain("high");
    expect(attrsLine.content).toContain("📝");
    expect(attrsLine.content).toContain("🖼️");
    expect(attrsLine.content).toContain("128K");
  });

  function extractButtons(card: any): any[] {
    const elements = (card as any).body?.elements ?? [];
    const direct = elements.filter((e: any) => e.tag === "button");
    const fromColumns = elements
      .filter((e: any) => e.tag === "column_set")
      .flatMap((e: any) => e.columns ?? [])
      .flatMap((col: any) => col.elements ?? [])
      .filter((e: any) => e.tag === "button");
    return [...direct, ...fromColumns];
  }

  it("action buttons use short thinking labels", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const buttons = extractButtons(card);
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

  it("current model has ✓ marker in markdown, other models have [选取]", async () => {
    const currentProvider = mockSession.model.provider;
    const currentId = mockSession.model.id;
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: [
        {
          provider: currentProvider,
          id: currentId,
          name: "M1",
          input: ["text"] as ("text" | "image")[],
          contextWindow: 1000,
        },
        {
          provider: "other",
          id: "m2",
          name: "M2",
          input: ["text"] as ("text" | "image")[],
          contextWindow: 1000,
        },
      ],
    });
    const markdowns = ((card as any).body?.elements ?? []).filter(
      (e: any) => e.tag === "markdown",
    );
    const currentLine = markdowns.find((d: any) =>
      d.content?.includes("✓ 当前"),
    );
    expect(currentLine).toBeDefined();
    const buttons = extractButtons(card);
    const selectButtons = buttons.filter((b: any) => b.text.content === "选取");
    expect(selectButtons.length).toBe(1);
  });

  it("thinking level buttons carry current model in callback", async () => {
    const card = await buildModelsCard({
      session: mockSession as any,
      availableModels: mockModels,
    });
    const buttons = extractButtons(card);
    const levelLabels = ["off", "min", "low", "med", "high", "xhigh"];
    const levelButtons = buttons.filter((b: any) =>
      levelLabels.includes(b.text?.content),
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

import {
  buildDialogCard,
  buildDialogResultCard,
} from "../../src/feishu/cards/dialog.js";

describe("dialog card", () => {
  describe("buildDialogCard", () => {
    it("returns card with title-derived header (no truncation when short)", () => {
      const { card, headerTitle, headerTemplate } = buildDialogCard(
        "确认删除",
        ["是", "否"],
        "dialog-1",
      );
      expect(headerTitle).toBe("确认删除");
      expect(headerTemplate).toBe("red");
      expect((card as any).header.title.content).toBe("确认删除");
      expect((card as any).header.template).toBe("red");
    });

    it("truncates long title for header (max 20 chars)", () => {
      const { headerTitle } = buildDialogCard("A".repeat(30), ["选项"], "d-1");
      expect(headerTitle.length).toBeLessThanOrEqual(20);
    });

    it("strips newlines from header title", () => {
      const { headerTitle } = buildDialogCard("标题\n\n描述", ["是"], "d-2");
      expect(headerTitle).not.toContain("\n");
      expect(headerTitle).toBe("标题描述");
    });

    it("includes one button per option with callback value", () => {
      const { card } = buildDialogCard("选择", ["A", "B", "C"], "d-3");
      const buttons = ((card as any).body.elements as any[]).filter(
        (e: any) => e.tag === "button",
      );
      expect(buttons).toHaveLength(3);
      expect(buttons[1].behaviors[0].value).toMatchObject({
        cmd: "feishu_dialog",
        dialog_id: "d-3",
        dialog_choice: "B",
      });
    });

    it("places title markdown and divider before buttons", () => {
      const { card } = buildDialogCard("标题", ["是"], "d-4");
      const els = (card as any).body.elements;
      expect(els[0].tag).toBe("markdown");
      expect(els[1].tag).toBe("hr");
      expect(els[2].tag).toBe("button");
    });

    it("includes schema 2.0 and update_multi config", () => {
      const { card } = buildDialogCard("标题", ["是"], "d-5");
      expect(card.schema).toBe("2.0");
      expect((card as any).config).toMatchObject({
        update_multi: true,
        width_mode: "fill",
      });
    });
  });

  describe("buildDialogResultCard", () => {
    it("builds card showing selected choice with original header", () => {
      const card = buildDialogResultCard("确认删除", "red", "是");
      expect((card as any).header.title.content).toBe("确认删除");
      expect((card as any).header.template).toBe("red");
      const els = (card as any).body.elements;
      expect(els).toHaveLength(1);
      expect(els[0].tag).toBe("markdown");
      expect(els[0].content).toBe("已选择: **是**");
    });

    it("result card has schema 2.0", () => {
      const card = buildDialogResultCard("标题", "red", "选项A");
      expect(card.schema).toBe("2.0");
    });
  });
});

describe("stop card", () => {
  it("buildStopCard returns card with stop button", () => {
    const card = buildStopCard();
    expect(card).toHaveProperty("schema", "2.0");
    expect(card.config).toEqual({ update_multi: true });
    const body = (card as any).body;
    expect(body.elements).toHaveLength(2);
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "🤖 AI 正在生成中...",
    });
    expect(body.elements[1].tag).toBe("action");
    expect(body.elements[1].actions[0].tag).toBe("button");
    expect(body.elements[1].actions[0].type).toBe("danger");
    expect(body.elements[1].actions[0].behaviors[0].value).toEqual({
      cmd: "stop",
    });
  });

  it("buildStopCardDone returns done card with status text", () => {
    const card = buildStopCardDone("生成完成");
    expect(card.schema).toBe("2.0");
    expect(card.config).toEqual({ update_multi: true });
    const body = (card as any).body;
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "✅ 生成完成",
    });
  });

  it("buildStopCardDone shows stopped symbol for 已中断", () => {
    const card = buildStopCardDone("已中断");
    const body = (card as any).body;
    expect(body.elements[0]).toEqual({
      tag: "markdown",
      content: "🛑 已中断",
    });
  });

  it("buildStopCardDone defaults to checkmark for unknown status", () => {
    const card = buildStopCardDone("未知状态");
    const body = (card as any).body;
    expect(body.elements[0].content).toBe("✅ 未知状态");
  });
});

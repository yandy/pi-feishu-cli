import { describe, it, expect } from "vitest";
import {
  buildSessionListCard,
  buildModelSelectCard,
} from "../src/cards.js";
import type { SessionInfo } from "../src/types.js";

describe("buildSessionListCard", () => {
  const sessions: SessionInfo[] = [
    { id: "abc", name: "修 bug", createdAt: 1700000000 },
    { id: "def", name: "新功能", createdAt: 1700000100 },
  ];

  it("builds card with session entries", () => {
    const card = buildSessionListCard("oc_chat1", sessions, "abc");
    const json = JSON.parse(card);
    expect(json.card.header).toBeDefined();
    expect(json.card.elements).toBeDefined();
    expect(JSON.stringify(json).length).toBeGreaterThan(100);
  });

  it("shows empty state when no sessions", () => {
    const card = buildSessionListCard("oc_chat1", [], null);
    const json = JSON.parse(card);
    expect(JSON.stringify(json)).toContain("暂无会话");
  });

  it("marks active session", () => {
    const card = buildSessionListCard("oc_chat1", sessions, "def");
    const json = JSON.parse(card);
    const str = JSON.stringify(json);
    expect(str).toContain("def");
  });
});

describe("buildModelSelectCard", () => {
  it("builds card with model options", () => {
    const models = [
      { id: "claude-sonnet", name: "Claude Sonnet" },
      { id: "gpt-4o", name: "GPT-4o" },
    ];
    const card = buildModelSelectCard("oc_chat1", models, "claude-sonnet");
    const json = JSON.parse(card);
    expect(json.card.header).toBeDefined();
    expect(JSON.stringify(json)).toContain("Claude Sonnet");
    expect(JSON.stringify(json)).toContain("GPT-4o");
  });
});

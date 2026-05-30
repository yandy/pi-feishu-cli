import { describe, it, expect } from "vitest";
import {
  buildSessionListText,
  buildModelListText,
} from "../src/im/cards.js";
import type { SessionInfo } from "../src/im/types.js";

describe("buildSessionListText", () => {
  const sessions: SessionInfo[] = [
    { id: "abc", name: "修 bug", createdAt: 1700000000 },
    { id: "def", name: "新功能", createdAt: 1700000100 },
  ];

  it("builds text with session entries", () => {
    const text = buildSessionListText(sessions, "abc");
    expect(text).toContain("修 bug");
    expect(text).toContain("新功能");
    expect(text).toContain("abc");
    expect(text).toContain("def");
  });

  it("shows empty state when no sessions", () => {
    const text = buildSessionListText([], null);
    expect(text).toContain("暂无会话");
  });

  it("marks active session with ▶", () => {
    const text = buildSessionListText(sessions, "abc");
    expect(text).toContain("▶ **修 bug**");
    expect(text).toContain("  新功能");
  });

  it("includes usage instructions", () => {
    const text = buildSessionListText(sessions, null);
    expect(text).toContain("/new");
    expect(text).toContain("/switch");
    expect(text).toContain("/rm");
  });
});

describe("buildModelListText", () => {
  const models = [
    { id: "claude-sonnet", name: "Claude Sonnet" },
    { id: "gpt-4o", name: "GPT-4o" },
  ];

  it("builds text with model options", () => {
    const text = buildModelListText(models, "claude-sonnet");
    expect(text).toContain("Claude Sonnet");
    expect(text).toContain("GPT-4o");
  });

  it("marks current model with ▶", () => {
    const text = buildModelListText(models, "claude-sonnet");
    expect(text).toContain("▶ `claude-sonnet`");
    expect(text).not.toContain("▶ `gpt-4o`");
  });

  it("includes usage instructions", () => {
    const text = buildModelListText(models, "claude-sonnet");
    expect(text).toContain("/model");
  });
});

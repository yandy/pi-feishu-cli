import { describe, expect, it } from "vitest";
import { buildInitialMessage } from "../src/index.js";

function makePiArgs(overrides: Partial<{ messages: string[] }> = {}) {
  return {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
    ...overrides,
  } as Parameters<typeof buildInitialMessage>[0]["parsed"];
}

describe("buildInitialMessage", () => {
  it("returns the first message and shifts it out", () => {
    const parsed = makePiArgs({ messages: ["hello world"] });
    const result = buildInitialMessage({ parsed });
    expect(result).toBe("hello world");
    expect(parsed.messages).toEqual([]);
  });

  it("returns undefined when messages are empty", () => {
    const parsed = makePiArgs({ messages: [] });
    const result = buildInitialMessage({ parsed });
    expect(result).toBeUndefined();
  });

  it("only returns the first message, leaving rest for initialMessages", () => {
    const parsed = makePiArgs({
      messages: ["first task", "second task", "third task"],
    });
    const result = buildInitialMessage({ parsed });
    expect(result).toBe("first task");
    expect(parsed.messages).toEqual(["second task", "third task"]);
  });
});

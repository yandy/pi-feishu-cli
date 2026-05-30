import { describe, it, expect } from "vitest";
import {
  renderText,
  renderCodeBlock,
  splitLongMessage,
  MESSAGE_MAX_LENGTH,
} from "../src/im/renderer.js";

describe("renderText", () => {
  it("returns plain text unchanged", () => {
    const result = renderText("hello world");
    expect(result).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("splits on large text", () => {
    const long = "x".repeat(MESSAGE_MAX_LENGTH + 100);
    const result = renderText(long);
    expect(result.length).toBe(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("text");
  });

  it("handles empty text", () => {
    const result = renderText("");
    expect(result).toEqual([{ type: "text", text: "" }]);
  });
});

describe("renderCodeBlock", () => {
  it("wraps code in code block markers", () => {
    const result = renderCodeBlock("console.log(1)", "javascript");
    expect(result).toEqual([
      {
        type: "text",
        text: "```javascript\nconsole.log(1)\n```",
      },
    ]);
  });

  it("uses no language when lang not provided", () => {
    const result = renderCodeBlock("print(1)");
    expect(result).toEqual([
      {
        type: "text",
        text: "```\nprint(1)\n```",
      },
    ]);
  });
});

describe("splitLongMessage", () => {
  it("does not split short message", () => {
    const result = splitLongMessage("short text");
    expect(result).toEqual(["short text"]);
  });

  it("splits long message at newlines", () => {
    const part1 = "a".repeat(Math.floor(MESSAGE_MAX_LENGTH * 0.6));
    const part2 = "b".repeat(Math.floor(MESSAGE_MAX_LENGTH * 0.6));
    const text = part1 + "\n" + part2;
    const result = splitLongMessage(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const combined = result.join("");
    expect(combined).toBe(text);
  });

  it("splits uniformly when no newlines", () => {
    const long = "x".repeat(MESSAGE_MAX_LENGTH + 500);
    const result = splitLongMessage(long);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const combined = result.join("");
    expect(combined).toBe(long);
  });
});

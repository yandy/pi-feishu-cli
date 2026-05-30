import { describe, it, expect } from "vitest";
import { parseBotCommand } from "../../extensions/bot-commands/router.js";

describe("parseBotCommand", () => {
  it("returns help for /help", () => {
    expect(parseBotCommand("/help")).toBe("help");
  });

  it("returns sessions for /sessions", () => {
    expect(parseBotCommand("/sessions")).toBe("sessions");
  });

  it("returns model for /model", () => {
    expect(parseBotCommand("/model")).toBe("model");
  });

  it("returns null for non-command text", () => {
    expect(parseBotCommand("hello world")).toBeNull();
  });

  it("returns null for unknown commands", () => {
    expect(parseBotCommand("/unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseBotCommand("")).toBeNull();
  });

  it("returns null for text with leading space", () => {
    expect(parseBotCommand(" /help")).toBeNull();
  });

  it("returns null for bare /", () => {
    expect(parseBotCommand("/")).toBeNull();
  });

  it("ignores extra args after command", () => {
    expect(parseBotCommand("/sessions extra")).toBe("sessions");
    expect(parseBotCommand("/model claude-3")).toBe("model");
  });
});

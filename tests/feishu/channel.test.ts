import { describe, it, expect } from "vitest";
import { LOG_LEVEL_MAP, LoggerLevel } from "../../src/feishu/channel.js";

describe("log level mapping", () => {
  it("maps valid level names to LoggerLevel values", () => {
    expect(LOG_LEVEL_MAP.fatal).toBe(LoggerLevel.fatal);
    expect(LOG_LEVEL_MAP.error).toBe(LoggerLevel.error);
    expect(LOG_LEVEL_MAP.warn).toBe(LoggerLevel.warn);
    expect(LOG_LEVEL_MAP.info).toBe(LoggerLevel.info);
    expect(LOG_LEVEL_MAP.debug).toBe(LoggerLevel.debug);
    expect(LOG_LEVEL_MAP.trace).toBe(LoggerLevel.trace);
  });

  it("defaults to warn when level is not provided", () => {
    const loggerLevel = LOG_LEVEL_MAP[""] ?? LoggerLevel.warn;
    expect(loggerLevel).toBe(LoggerLevel.warn);
  });

  it("defaults to warn for unknown level strings", () => {
    const loggerLevel = LOG_LEVEL_MAP["invalid"] ?? LoggerLevel.warn;
    expect(loggerLevel).toBe(LoggerLevel.warn);
  });
});

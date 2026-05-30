import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_FILE } from "../../src/im/paths.js";

describe("logger", () => {
  afterEach(() => {
    try { unlinkSync(LOG_FILE); } catch {}
  });

  it("appends message to log file with ISO timestamp", async () => {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const { log } = await import("../../src/im/logger.js");

    log("test message");

    expect(existsSync(LOG_FILE)).toBe(true);
    const content = readFileSync(LOG_FILE, "utf-8");
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain("test message");
  });

  it("appends multiple messages", async () => {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const { log } = await import("../../src/im/logger.js");

    log("msg1");
    log("msg2");

    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some(l => l.includes("msg1"))).toBe(true);
    expect(lines.some(l => l.includes("msg2"))).toBe(true);
  });
});

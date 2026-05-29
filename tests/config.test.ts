import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  const tmpDir = join(tmpdir(), "pi-feishu-cli-test-config");
  const configPath = join(tmpDir, "config.json");

  beforeEach(() => {
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe(DEFAULT_CONFIG.strategy);
    expect(config.pollInterval).toBe(DEFAULT_CONFIG.pollInterval);
    expect(config.model).toBeUndefined();
    expect(config.autoStart).toBe(DEFAULT_CONFIG.autoStart);
  });

  it("loads and merges partial config", () => {
    writeFileSync(configPath, JSON.stringify({ strategy: "open", pollInterval: 10 }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("open");
    expect(config.pollInterval).toBe(10);
  });

  it("loads full config", () => {
    writeFileSync(configPath, JSON.stringify({
      strategy: "mention",
      model: "anthropic/claude-sonnet",
      pollInterval: 3,
      autoStart: true,
    }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("mention");
    expect(config.model).toBe("anthropic/claude-sonnet");
    expect(config.pollInterval).toBe(3);
    expect(config.autoStart).toBe(true);
  });

  it("ignores extra unknown fields", () => {
    writeFileSync(configPath, JSON.stringify({
      strategy: "open",
      pollInterval: 5,
      unknownField: "should be ignored",
    }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("open");
    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });
});

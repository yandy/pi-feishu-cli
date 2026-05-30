import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveModel, DEFAULT_CONFIG } from "../src/im/config.js";

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
    expect(config.model).toBeUndefined();
    expect(config.botName).toBeUndefined();
  });

  it("loads and merges partial config", () => {
    writeFileSync(configPath, JSON.stringify({ strategy: "open" }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("open");
    expect(config.model).toBeUndefined();
    expect(config.botName).toBeUndefined();
  });

  it("loads full config with botName", () => {
    writeFileSync(configPath, JSON.stringify({
      strategy: "mention",
      model: "anthropic/claude-sonnet",
      botName: "MyBot",
    }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("mention");
    expect(config.model).toBe("anthropic/claude-sonnet");
    expect(config.botName).toBe("MyBot");
  });

  it("ignores extra unknown fields", () => {
    writeFileSync(configPath, JSON.stringify({
      strategy: "open",
      unknownField: "should be ignored",
    }));
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("open");
    expect((config as unknown as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("saveModel persists model ID to config", () => {
    saveModel("anthropic/claude-opus-4-5", tmpDir);
    const config = loadConfig(tmpDir);
    expect(config.model).toBe("anthropic/claude-opus-4-5");
  });

  it("saveModel does not overwrite existing strategy", () => {
    writeFileSync(configPath, JSON.stringify({ strategy: "open" }));
    saveModel("anthropic/claude-sonnet-4-20250514", tmpDir);
    const config = loadConfig(tmpDir);
    expect(config.strategy).toBe("open");
    expect(config.model).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("uses configDir to determine config file path", () => {
    const otherDir = join(tmpdir(), "pi-feishu-cli-test-config-other");
    const otherConfigPath = join(otherDir, "config.json");
    if (!existsSync(otherDir)) mkdirSync(otherDir, { recursive: true });
    try {
      writeFileSync(otherConfigPath, JSON.stringify({ strategy: "open" }));
      const config = loadConfig(otherDir);
      expect(config.strategy).toBe("open");
    } finally {
      try { unlinkSync(otherConfigPath); } catch {}
      try { rmdirSync(otherDir); } catch {}
    }
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadConfig } from "../src/config.js";

const tmpDir = join(process.cwd(), "tests", "__tmp_config__");

function cleanup() {
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

afterEach(cleanup);

describe("loadConfig", () => {
  it("returns config from env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";
    try {
      const cfg = loadConfig({});
      expect(cfg.appId).toBe("env-id");
      expect(cfg.appSecret).toBe("env-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });

  it("CLI args override env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    process.env.FEISHU_APP_ID = "env-id";
    try {
      const cfg = loadConfig({ appId: "cli-id", appSecret: "cli-secret" });
      expect(cfg.appId).toBe("cli-id");
      expect(cfg.appSecret).toBe("cli-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
    }
  });

  it("config file overrides env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    process.env.FEISHU_APP_ID = "env-id";
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, "feishu.json"),
        JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
      );
      const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
      expect(cfg.appId).toBe("file-id");
      expect(cfg.appSecret).toBe("file-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      cleanup();
    }
  });

  it("CLI args override config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "feishu.json"),
      JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
    );
    const cfg = loadConfig({
      appId: "cli-id",
      appSecret: "cli-secret",
      config: join(tmpDir, "feishu.json"),
    });
    expect(cfg.appId).toBe("cli-id");
    expect(cfg.appSecret).toBe("cli-secret");
    cleanup();
  });

  it("throws when no credentials found", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    try {
      expect(() => loadConfig({})).toThrow("Feishu credentials not configured");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });
});

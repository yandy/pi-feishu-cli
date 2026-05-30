import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAuth, saveAuth } from "../../src/auth/index.js";
import { FEISHU_IM_DIR } from "../../src/config.js";

const TEST_DIR = join(FEISHU_IM_DIR, "_test_auth");
const TEST_AUTH_FILE = join(TEST_DIR, "auth.json");

describe("auth", () => {
  beforeEach(() => {
    try { rmSync(TEST_DIR, { recursive: true }); } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true }); } catch {}
  });

  it("loadAuth returns null when file does not exist", () => {
    const result = loadAuth(TEST_DIR);
    expect(result).toBeNull();
  });

  it("saveAuth creates auth.json with credentials", () => {
    saveAuth(TEST_DIR, "my-app-id", "my-secret");
    expect(existsSync(TEST_AUTH_FILE)).toBe(true);

    const content = JSON.parse(readFileSync(TEST_AUTH_FILE, "utf-8"));
    expect(content.appId).toBe("my-app-id");
    expect(content.appSecret).toBe("my-secret");
  });

  it("loadAuth returns credentials after saveAuth", () => {
    saveAuth(TEST_DIR, "app123", "sec456");
    const result = loadAuth(TEST_DIR);
    expect(result).toEqual({ appId: "app123", appSecret: "sec456" });
  });

  it("loadAuth returns null for invalid JSON", () => {
    writeFileSync(TEST_AUTH_FILE, "not json", "utf-8");
    const result = loadAuth(TEST_DIR);
    expect(result).toBeNull();
  });
});

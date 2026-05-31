import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadAuth, saveAuth } from "../../src/auth/index.js";
import { AUTH_FILE } from "../../src/config.js";

describe("auth", () => {
  const TEST_DIR = dirname(AUTH_FILE);

  beforeEach(() => {
    try { rmSync(AUTH_FILE); } catch {}
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(AUTH_FILE); } catch {}
  });

  it("loadAuth returns null when file does not exist", () => {
    try { rmSync(AUTH_FILE); } catch {}
    const result = loadAuth(TEST_DIR);
    expect(result).toBeNull();
  });

  it("saveAuth creates auth.json with credentials", () => {
    saveAuth(TEST_DIR, "my-app-id", "my-secret");
    expect(existsSync(AUTH_FILE)).toBe(true);

    const content = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    expect(content.appId).toBe("my-app-id");
    expect(content.appSecret).toBe("my-secret");
  });

  it("loadAuth returns credentials after saveAuth", () => {
    saveAuth(TEST_DIR, "app123", "sec456");
    const result = loadAuth(TEST_DIR);
    expect(result).toEqual({ appId: "app123", appSecret: "sec456" });
  });

  it("loadAuth returns null for invalid JSON", () => {
    writeFileSync(AUTH_FILE, "not json", "utf-8");
    const result = loadAuth(TEST_DIR);
    expect(result).toBeNull();
  });
});

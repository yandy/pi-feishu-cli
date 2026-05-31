import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAuth, saveAuth } from "../../src/auth/index.js";

const TEST_DIR = "/tmp/test-pi-feishu-auth";
const TEST_AUTH_FILE = join(TEST_DIR, "auth.json");

vi.mock("../../src/config.js", () => ({
  AUTH_FILE: "/tmp/test-pi-feishu-auth/auth.json",
  FEISHU_IM_DIR: "/tmp/test-pi-feishu-auth",
  SOCKET_PATH: "/tmp/test-pi-feishu-auth.sock",
  PID_FILE: "/tmp/test-pi-feishu-auth/daemon.pid",
  REGISTRY_FILE: "/tmp/test-pi-feishu-auth/registry.json",
  DAEMON_LOG: "/tmp/test-pi-feishu-auth/daemon.log",
}));

describe("auth", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
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

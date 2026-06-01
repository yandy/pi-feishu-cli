import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  FEISHU_IM_DIR,
  PID_FILE,
  AUTH_FILE,
  DAEMON_LOG,
  SOCKET_PATH,
} from "../src/config.js";

describe("config", () => {
  const baseDir = join(homedir(), ".pi", "agent", "feishu-im");

  it("FEISHU_IM_DIR points to ~/.pi/agent/feishu-im", () => {
    expect(FEISHU_IM_DIR).toBe(baseDir);
  });

  it("PID_FILE points to daemon.pid in feishu-im dir", () => {
    expect(PID_FILE).toBe(join(baseDir, "daemon.pid"));
  });

  it("AUTH_FILE points to auth.json in feishu-im dir", () => {
    expect(AUTH_FILE).toBe(join(baseDir, "auth.json"));
  });

  it("DAEMON_LOG points to daemon.log in feishu-im dir", () => {
    expect(DAEMON_LOG).toBe(join(baseDir, "daemon.log"));
  });

  it("SOCKET_PATH is in /tmp", () => {
    expect(SOCKET_PATH).toBe("/tmp/pi-feishu-im.sock");
  });
});

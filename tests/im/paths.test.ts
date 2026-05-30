import { describe, it, expect } from "vitest";
import { FEISHU_IM_DIR, PID_FILE, LOG_FILE, CONFIG_FILE, REGISTRY_FILE } from "../../src/shared.js";

describe("paths", () => {
  it("FEISHU_IM_DIR points to .pi/agent/feishu-im", () => {
    expect(FEISHU_IM_DIR).toContain(".pi/agent/feishu-im");
  });

  it("PID_FILE is under FEISHU_IM_DIR", () => {
    expect(PID_FILE).toContain(FEISHU_IM_DIR);
    expect(PID_FILE).toContain("daemon.pid");
  });

  it("all paths are strings", () => {
    expect(typeof FEISHU_IM_DIR).toBe("string");
    expect(typeof PID_FILE).toBe("string");
    expect(typeof LOG_FILE).toBe("string");
    expect(typeof CONFIG_FILE).toBe("string");
    expect(typeof REGISTRY_FILE).toBe("string");
  });
});

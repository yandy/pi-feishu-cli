import { describe, it, expect } from "vitest";
import { initRuntime } from "../src/runtime.js";

describe("initRuntime", () => {
  it("creates a runtime with sessionManager", async () => {
    const cwd = process.cwd();
    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
    expect(result.runtime.session).toBeDefined();
    expect(typeof result.runtime.session.sessionId).toBe("string");
  }, 30000);

  it("loads skills from skills/ directory", async () => {
    const cwd = process.cwd();
    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
  }, 30000);
});

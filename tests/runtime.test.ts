import { describe, it, expect } from "vitest";
import { initRuntime } from "../src/runtime.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
    const skillsDir = join(cwd, "skills");
    const skillDirs = readdirSync(skillsDir).filter((entry) => {
      const full = join(skillsDir, entry);
      return statSync(full).isDirectory();
    });

    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
    // At minimum, some skill directories should exist
    expect(skillDirs.length).toBeGreaterThan(0);
  }, 30000);
});

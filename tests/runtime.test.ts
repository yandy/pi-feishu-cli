import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initRuntime } from "../src/runtime.js";

const SKILL_CONTENT = `---
name: test-skill
description: A test skill for testing
---
# Test Skill
`;

describe("initRuntime", () => {
  it("creates a runtime with sessionManager", async () => {
    const cwd = process.cwd();
    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
    expect(result.runtime.session).toBeDefined();
    expect(typeof result.runtime.session.sessionId).toBe("string");
  }, 30000);

  it("skips loading bundled skills when noBundleFeishuSkills is true", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, SKILL_CONTENT);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        packageRoot: tmpDir,
        noBundleFeishuSkills: true,
      });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const skillNames = loaded.skills.map((s) => s.name);
      expect(skillNames).not.toContain("test-skill");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);

  it("loads bundled skills when noBundleFeishuSkills is false", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, SKILL_CONTENT);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        packageRoot: tmpDir,
        noBundleFeishuSkills: false,
      });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const skillNames = loaded.skills.map((s) => s.name);
      expect(skillNames).toContain("test-skill");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);

  it("loads bundled skills from packageRoot, not from cwd", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      // Create mock skills under packageRoot/skills/
      const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, SKILL_CONTENT);

      // Set cwd to the project root (needed for session to work),
      // but packageRoot to tmpDir which has only our mock skill
      const cwd = process.cwd();
      const result = await initRuntime({ cwd, packageRoot: tmpDir });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const names = loaded.skills.map((s) => s.name);
      expect(names).toContain("test-skill");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);
});

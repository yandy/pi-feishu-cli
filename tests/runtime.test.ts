import { describe, it, expect } from "vitest";
import { initRuntime } from "../src/runtime.js";
import { readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("initRuntime", () => {
  it("creates a runtime with sessionManager", async () => {
    const cwd = process.cwd();
    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
    expect(result.runtime.session).toBeDefined();
    expect(typeof result.runtime.session.sessionId).toBe("string");
  }, 30000);

  it("loads skills from skills/ directory relative to cwd", async () => {
    const cwd = process.cwd();
    const skillsDir = join(cwd, "skills");
    const skillDirs = readdirSync(skillsDir).filter((entry) => {
      const full = join(skillsDir, entry);
      return statSync(full).isDirectory();
    });

    const result = await initRuntime({ cwd });
    expect(result.runtime).toBeDefined();
    expect(skillDirs.length).toBeGreaterThan(0);
  }, 30000);

  it("skips loading bundled skills when noBundleFeishuSkills is true", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, "# Test Skill\n");

      const cwd = process.cwd();
      const result = await initRuntime({ cwd, packageRoot: tmpDir, noBundleFeishuSkills: true });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const skillNames = loaded.skills.map(s => s.name);
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
      writeFileSync(skillPath, "# Test Skill\n");

      const cwd = process.cwd();
      const result = await initRuntime({ cwd, packageRoot: tmpDir, noBundleFeishuSkills: false });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const skillNames = loaded.skills.map(s => s.name);
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
      writeFileSync(skillPath, "# Test Skill\n");

      // Set cwd to the project root (needed for session to work),
      // but packageRoot to tmpDir which has only our mock skill
      const cwd = process.cwd();
      const result = await initRuntime({ cwd, packageRoot: tmpDir });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const skillNames = loaded.skills.map(s => s.name);
      expect(skillNames).toContain("test-skill");
      // Should NOT contain skills from the real project's skills/ dir
      expect(skillNames).not.toContain("lark-im");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);
});

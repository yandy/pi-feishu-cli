import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Args } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { initRuntime } from "../src/runtime.js";

const WEATHER_EXT_TS = `\
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function weatherReportExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "weather_report",
    label: "Weather Report",
    description: "Report the weather for a city",
    parameters: Type.Object({ city: Type.String() }),
    async execute() {
      return { content: [{ type: "text", text: "sunny" }], details: {} };
    },
  });
}
`;

function makePiArgs(overrides: Partial<Args> = {}): Args {
  return {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
    ...overrides,
  };
}

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

  it("loads skills from piArgs.skills (--skill)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      // Create mock skill in tmpDir
      const skillPath = join(tmpDir, "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, SKILL_CONTENT);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        piArgs: makePiArgs({ skills: [tmpDir] }),
      });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const names = loaded.skills.map((s) => s.name);
      expect(names).toContain("test-skill");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);

  it("enables grep, find, ls tools by default", async () => {
    const cwd = process.cwd();
    const result = await initRuntime({ cwd });
    const activeTools = result.runtime.session.getActiveToolNames();
    expect(activeTools).toContain("grep");
    expect(activeTools).toContain("find");
    expect(activeTools).toContain("ls");
  }, 30000);

  it("respects piArgs.noSkills to disable skill loading", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    try {
      const skillPath = join(tmpDir, "skills", "test-skill", "SKILL.md");
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, SKILL_CONTENT);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        packageRoot: tmpDir,
        piArgs: {
          messages: [],
          fileArgs: [],
          unknownFlags: new Map(),
          diagnostics: [],
          noSkills: true,
        },
      });

      const loaded = result.runtime.services.resourceLoader.getSkills();
      const names = loaded.skills.map((s) => s.name);
      expect(names).not.toContain("test-skill");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30000);

  it("loads tools registered by -e extension (not filtered out)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-ext-"));
    try {
      const extPath = join(tmpDir, "weather-report.ts");
      writeFileSync(extPath, WEATHER_EXT_TS);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        piArgs: makePiArgs({ extensions: [extPath] }),
      });

      const active = result.runtime.session.getActiveToolNames();
      expect(active).toContain("weather_report");
      expect(active).toContain("send_file_to_chat");
      expect(active).toContain("grep");
      expect(active).toContain("find");
      expect(active).toContain("ls");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 60000);

  it("respects explicit piArgs.tools allowlist (filters extension tools)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-ext-"));
    try {
      const extPath = join(tmpDir, "weather-report.ts");
      writeFileSync(extPath, WEATHER_EXT_TS);

      const cwd = process.cwd();
      const result = await initRuntime({
        cwd,
        piArgs: makePiArgs({ extensions: [extPath], tools: ["read", "bash"] }),
      });

      const active = result.runtime.session.getActiveToolNames();
      expect(active).toContain("read");
      expect(active).toContain("bash");
      expect(active).not.toContain("weather_report");
      expect(active).not.toContain("grep");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 60000);
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveCredentials } from "../src/config.js";

const tmpDir = join(process.cwd(), "tests", "__tmp_config__");

function cleanup() {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {}
}

afterEach(cleanup);

describe("loadConfig", () => {
  it("returns config from env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";
    try {
      const cfg = loadConfig({ config: join(tmpDir, ".nonexistent.json") });
      expect(cfg.appId).toBe("env-id");
      expect(cfg.appSecret).toBe("env-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });

  it("config file overrides env vars", () => {
    const prevId = process.env.FEISHU_APP_ID;
    process.env.FEISHU_APP_ID = "env-id";
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, "feishu.json"),
        JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
      );
      const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
      expect(cfg.appId).toBe("file-id");
      expect(cfg.appSecret).toBe("file-secret");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      cleanup();
    }
  });

  it("CLI args override config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "feishu.json"),
      JSON.stringify({ appId: "file-id", appSecret: "file-secret" }),
    );
    const cfg = loadConfig({
      appId: "cli-id",
      appSecret: "cli-secret",
      config: join(tmpDir, "feishu.json"),
    });
    expect(cfg.appId).toBe("cli-id");
    expect(cfg.appSecret).toBe("cli-secret");
    cleanup();
  });

  it("reads botName from FEISHU_BOT_NAME env var", () => {
    const prev = process.env.FEISHU_BOT_NAME;
    process.env.FEISHU_BOT_NAME = "My Bot";
    try {
      const cfg = loadConfig({ appId: "x", appSecret: "x" });
      expect(cfg.botName).toBe("My Bot");
    } finally {
      process.env.FEISHU_BOT_NAME = prev;
    }
  });

  it("reads botName from config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "feishu.json"),
      JSON.stringify({
        appId: "file-id",
        appSecret: "file-secret",
        botName: "File Bot",
      }),
    );
    try {
      const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
      expect(cfg.botName).toBe("File Bot");
    } finally {
      cleanup();
    }
  });

  it("reads noBundleFeishuSkills from FEISHU_NO_BUNDLE_SKILLS env var", () => {
    const prev = process.env.FEISHU_NO_BUNDLE_SKILLS;
    process.env.FEISHU_NO_BUNDLE_SKILLS = "true";
    try {
      const cfg = loadConfig({ appId: "x", appSecret: "x" });
      expect(cfg.noBundleFeishuSkills).toBe(true);
    } finally {
      process.env.FEISHU_NO_BUNDLE_SKILLS = prev;
    }
  });

  it("config file noBundleFeishuSkills overrides env var", () => {
    const prev = process.env.FEISHU_NO_BUNDLE_SKILLS;
    process.env.FEISHU_NO_BUNDLE_SKILLS = "true";
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, "feishu.json"),
        JSON.stringify({
          appId: "file-id",
          appSecret: "file-secret",
          noBundleFeishuSkills: false,
        }),
      );
      const cfg = loadConfig({ config: join(tmpDir, "feishu.json") });
      expect(cfg.noBundleFeishuSkills).toBe(false);
    } finally {
      process.env.FEISHU_NO_BUNDLE_SKILLS = prev;
      cleanup();
    }
  });

  it("throws when no credentials found", () => {
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    try {
      expect(() =>
        loadConfig({ config: join(tmpDir, ".nonexistent.json") }),
      ).toThrow("Feishu credentials not configured");
    } finally {
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });
});

describe("config merge: global + project", () => {
  const tmpDir = join(process.cwd(), "tests", "__tmp_merge__");

  function cleanup() {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  }

  afterEach(cleanup);

  it("merges global and project configs with project overriding global on same-name fields", () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = globalDir;

    try {
      writeFileSync(
        join(globalDir, "feishu.json"),
        JSON.stringify({ appId: "global-id", appSecret: "global-secret", botName: "GlobalBot" }),
      );
      writeFileSync(
        join(projectDir, ".pi", "feishu.json"),
        JSON.stringify({ botName: "ProjectBot", noBundleFeishuSkills: true }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("global-id");
      expect(cfg.appSecret).toBe("global-secret");
      expect(cfg.botName).toBe("ProjectBot");
      expect(cfg.noBundleFeishuSkills).toBe(true);
    } finally {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    }
  });

  it("uses only global config when project config does not exist", () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = globalDir;

    try {
      writeFileSync(
        join(globalDir, "feishu.json"),
        JSON.stringify({ appId: "global-id", appSecret: "global-secret", botName: "GlobalBot" }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("global-id");
      expect(cfg.appSecret).toBe("global-secret");
      expect(cfg.botName).toBe("GlobalBot");
    } finally {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    }
  });

  it("uses only project config when global config does not exist", () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = globalDir;

    try {
      writeFileSync(
        join(projectDir, ".pi", "feishu.json"),
        JSON.stringify({ appId: "project-id", appSecret: "project-secret", botName: "ProjectBot" }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("project-id");
      expect(cfg.appSecret).toBe("project-secret");
      expect(cfg.botName).toBe("ProjectBot");
    } finally {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    }
  });

  it("falls back to env vars when neither config file exists", () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = globalDir;
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";

    try {
      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("env-id");
      expect(cfg.appSecret).toBe("env-secret");
    } finally {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
    }
  });

  it("explicit config option bypasses dual-file merge and loads only that file", () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const prevBotName = process.env.FEISHU_BOT_NAME;
    const globalDir = join(tmpDir, "global");
    const explicitDir = join(tmpDir, "explicit");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    mkdirSync(explicitDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = globalDir;
    delete process.env.FEISHU_BOT_NAME;

    try {
      writeFileSync(
        join(globalDir, "feishu.json"),
        JSON.stringify({ appId: "global-id", appSecret: "global-secret", botName: "GlobalBot" }),
      );
      writeFileSync(
        join(projectDir, ".pi", "feishu.json"),
        JSON.stringify({ appId: "project-id", appSecret: "project-secret" }),
      );
      writeFileSync(
        join(explicitDir, "explicit.json"),
        JSON.stringify({ appId: "explicit-id", appSecret: "explicit-secret" }),
      );

      const cfg = loadConfig({
        cwd: projectDir,
        config: join(explicitDir, "explicit.json"),
      });

      // Should only load explicit config, not merged from global + project
      expect(cfg.appId).toBe("explicit-id");
      expect(cfg.appSecret).toBe("explicit-secret");
      expect(cfg.botName).toBeUndefined();
    } finally {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      process.env.FEISHU_BOT_NAME = prevBotName;
    }
  });
});

describe("saveCredentials", () => {
  it("writes appId and appSecret to JSON file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    const configPath = join(tmpDir, "feishu.json");
    try {
      saveCredentials(configPath, {
        appId: "test-id",
        appSecret: "test-secret",
      });
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.appId).toBe("test-id");
      expect(parsed.appSecret).toBe("test-secret");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates parent directory if it doesn't exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    const nestedPath = join(tmpDir, "a", "b", "feishu.json");
    try {
      saveCredentials(nestedPath, { appId: "id", appSecret: "secret" });
      expect(existsSync(nestedPath)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

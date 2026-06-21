import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CONFIG_DIR_NAME, getAgentDir as piGetAgentDir } from "@earendil-works/pi-coding-agent";
import type { FeishuConfig } from "./types.js";

function getAgentDir(): string {
  if (process.env.PI_AGENT_DIR) return process.env.PI_AGENT_DIR;
  return piGetAgentDir();
}

export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  noBundleFeishuSkills?: boolean;
}

function findConfigFile(cwd: string): string | null {
  const paths = [
    join(cwd, CONFIG_DIR_NAME, "feishu.json"),
    join(getAgentDir(), "feishu.json"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadPartialFileConfig(path: string): Partial<FeishuConfig> | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    const result: Partial<FeishuConfig> = {};
    if (parsed.appId && typeof parsed.appId === "string")
      result.appId = parsed.appId;
    if (parsed.appSecret && typeof parsed.appSecret === "string")
      result.appSecret = parsed.appSecret;
    if (parsed.botName && typeof parsed.botName === "string")
      result.botName = parsed.botName;
    if (parsed.noBundleFeishuSkills !== undefined)
      result.noBundleFeishuSkills = parsed.noBundleFeishuSkills;
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function loadFileConfigs(cwd: string): {
  project: Partial<FeishuConfig> | null;
  global: Partial<FeishuConfig> | null;
} {
  const projectPath = join(cwd, CONFIG_DIR_NAME, "feishu.json");
  const globalPath = join(getAgentDir(), "feishu.json");

  return {
    project: existsSync(projectPath) ? loadPartialFileConfig(projectPath) : null,
    global: existsSync(globalPath) ? loadPartialFileConfig(globalPath) : null,
  };
}

function loadFileConfig(path: string): FeishuConfig | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed.appId &&
      typeof parsed.appId === "string" &&
      parsed.appSecret &&
      typeof parsed.appSecret === "string"
    ) {
      return {
        appId: parsed.appId,
        appSecret: parsed.appSecret,
        ...(parsed.botName ? { botName: parsed.botName } : {}),
        ...(parsed.noBundleFeishuSkills !== undefined
          ? { noBundleFeishuSkills: parsed.noBundleFeishuSkills }
          : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadConfig(options: ConfigOptions = {}): FeishuConfig {
  const envConfig: Partial<FeishuConfig> = {};
  if (process.env.FEISHU_APP_ID) envConfig.appId = process.env.FEISHU_APP_ID;
  if (process.env.FEISHU_APP_SECRET)
    envConfig.appSecret = process.env.FEISHU_APP_SECRET;
  if (process.env.FEISHU_BOT_NAME)
    envConfig.botName = process.env.FEISHU_BOT_NAME;

  let fileConfig: Partial<FeishuConfig> | null = null;
  const configPath = options.config;

  if (configPath) {
    // Explicit config path: single-file mode (backward compatible)
    fileConfig = loadFileConfig(configPath);
  } else {
    // Dual-file merge: global + project with project overriding
    const { project, global } = loadFileConfigs(options.cwd ?? process.cwd());
    if (project || global) {
      fileConfig = { ...global, ...project };
    }
  }

  const cliConfig: Partial<FeishuConfig> = {};
  if (options.appId) cliConfig.appId = options.appId;
  if (options.appSecret) cliConfig.appSecret = options.appSecret;

  const appId = cliConfig.appId ?? fileConfig?.appId ?? envConfig.appId;
  const appSecret =
    cliConfig.appSecret ?? fileConfig?.appSecret ?? envConfig.appSecret;

  if (!appId || !appSecret) {
    throw new Error(
      "Feishu credentials not configured. Set FEISHU_APP_ID/FEISHU_APP_SECRET env vars, " +
        "create .pi/feishu.json or ~/.pi/agent/feishu.json, or pass --app-id/--app-secret CLI args.",
    );
  }

  const cliNoBundle = options.noBundleFeishuSkills;
  const envNoBundle =
    process.env.FEISHU_NO_BUNDLE_SKILLS === "1" ||
    process.env.FEISHU_NO_BUNDLE_SKILLS === "true";
  const fileNoBundle = fileConfig?.noBundleFeishuSkills;

  return {
    appId,
    appSecret,
    botName: fileConfig?.botName ?? envConfig.botName,
    noBundleFeishuSkills: cliNoBundle ?? fileNoBundle ?? envNoBundle,
  };
}

export function saveCredentials(path: string, config: FeishuConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

const DEFAULT_SAVE_PATH = join(getAgentDir(), "feishu.json");

async function readNonEmpty(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(question)).trim();
      if (answer.length > 0) return answer;
      console.error("输入不能为空，请重新输入。");
    }
  } finally {
    rl.close();
  }
}

export async function promptAndSaveCredentials(
  savePath?: string,
): Promise<FeishuConfig> {
  const appId = await readNonEmpty("Feishu App ID: ");
  const appSecret = await readNonEmpty("Feishu App Secret: ");

  const config: FeishuConfig = { appId, appSecret };
  const path = savePath ?? DEFAULT_SAVE_PATH;
  saveCredentials(path, config);
  console.error(`Credentials saved to ${path}`);

  return config;
}

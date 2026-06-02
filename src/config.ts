import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import type { FeishuConfig } from "./types.js";

export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
  noBundleFeishuSkills?: boolean;
}

function findConfigFile(cwd: string): string | null {
  const paths = [
    join(cwd, ".pi", "feishu.json"),
    join(homedir(), ".pi", "agent", "feishu.json"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadFileConfig(path: string): FeishuConfig | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.appId && typeof parsed.appId === "string" && parsed.appSecret && typeof parsed.appSecret === "string") {
      return {
        appId: parsed.appId,
        appSecret: parsed.appSecret,
        ...(parsed.botName ? { botName: parsed.botName } : {}),
        ...(parsed.noBundleFeishuSkills !== undefined ? { noBundleFeishuSkills: parsed.noBundleFeishuSkills } : {}),
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
  if (process.env.FEISHU_APP_SECRET) envConfig.appSecret = process.env.FEISHU_APP_SECRET;
  if (process.env.FEISHU_BOT_NAME) envConfig.botName = process.env.FEISHU_BOT_NAME;

  let fileConfig: FeishuConfig | null = null;
  const configPath = options.config ?? findConfigFile(options.cwd ?? process.cwd());
  if (configPath) {
    fileConfig = loadFileConfig(configPath);
  }

  const cliConfig: Partial<FeishuConfig> = {};
  if (options.appId) cliConfig.appId = options.appId;
  if (options.appSecret) cliConfig.appSecret = options.appSecret;

  const appId = cliConfig.appId ?? fileConfig?.appId ?? envConfig.appId;
  const appSecret = cliConfig.appSecret ?? fileConfig?.appSecret ?? envConfig.appSecret;

  if (!appId || !appSecret) {
    throw new Error(
      "Feishu credentials not configured. Set FEISHU_APP_ID/FEISHU_APP_SECRET env vars, " +
      "create .pi/feishu.json or ~/.pi/agent/feishu.json, or pass --app-id/--app-secret CLI args.",
    );
  }

  const cliNoBundle = options.noBundleFeishuSkills;
  const envNoBundle = process.env.FEISHU_NO_BUNDLE_SKILLS === "1" || process.env.FEISHU_NO_BUNDLE_SKILLS === "true";
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

const DEFAULT_SAVE_PATH = join(homedir(), ".pi", "agent", "feishu.json");

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

export async function promptAndSaveCredentials(savePath?: string): Promise<FeishuConfig> {
  const appId = await readNonEmpty("Feishu App ID: ");
  const appSecret = await readNonEmpty("Feishu App Secret: ");

  const config: FeishuConfig = { appId, appSecret };
  const path = savePath ?? DEFAULT_SAVE_PATH;
  saveCredentials(path, config);
  console.error(`Credentials saved to ${path}`);

  return config;
}

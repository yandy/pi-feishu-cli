import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FeishuConfig } from "./types.js";

export interface ConfigOptions {
  appId?: string;
  appSecret?: string;
  config?: string;
  cwd?: string;
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
      return { appId: parsed.appId, appSecret: parsed.appSecret };
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
      "create ~/.pi/agent/feishu.json, or pass --app-id/--app-secret CLI args.",
    );
  }

  return { appId, appSecret };
}

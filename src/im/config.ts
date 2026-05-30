import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FeishuImConfig } from "./types.js";

const CONFIG_FILE = "config.json";

export const DEFAULT_CONFIG: FeishuImConfig = {
  strategy: "mention",
};

function getConfigPath(configDir: string): string {
  return join(configDir, CONFIG_FILE);
}

export function loadConfig(configDir: string = join(process.env.HOME || "~", ".pi", "agent", "feishu-im")): FeishuImConfig {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = getConfigPath(configDir);

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      strategy: raw.strategy ?? DEFAULT_CONFIG.strategy,
      model: raw.model,
      botName: raw.botName,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveModel(
  modelId: string,
  configDir: string = join(process.env.HOME || "~", ".pi", "agent", "feishu-im"),
): void {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const configPath = getConfigPath(configDir);
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
  }
  config.model = modelId;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

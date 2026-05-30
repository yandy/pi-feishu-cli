import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FeishuImConfig } from "./types.js";

const CONFIG_FILE = "config.json";

export const DEFAULT_CONFIG: FeishuImConfig = {
  strategy: "mention",
};

export function loadConfig(configDir: string = join(process.env.HOME || "~", ".pi", "agent", "feishu-im")): FeishuImConfig {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = join(configDir, CONFIG_FILE);

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

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FeishuImConfig } from "./types.js";

export const DEFAULT_CONFIG: Required<Omit<FeishuImConfig, "model">> = {
  strategy: "mention",
  pollInterval: 5,
  autoStart: false,
};

export function loadConfig(configDir: string): FeishuImConfig {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = join(configDir, "config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      strategy: raw.strategy ?? DEFAULT_CONFIG.strategy,
      model: raw.model,
      pollInterval: raw.pollInterval ?? DEFAULT_CONFIG.pollInterval,
      autoStart: raw.autoStart ?? DEFAULT_CONFIG.autoStart,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

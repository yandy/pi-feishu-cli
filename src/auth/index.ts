import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface AuthCredentials {
  appId: string;
  appSecret: string;
}

export function loadAuth(dir: string): AuthCredentials | null {
  const filePath = join(dir, "auth.json");
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.appId === "string" && typeof parsed.appSecret === "string") {
      return { appId: parsed.appId, appSecret: parsed.appSecret };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAuth(dir: string, appId: string, appSecret: string): void {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "auth.json");
  writeFileSync(filePath, JSON.stringify({ appId, appSecret }, null, 2), "utf-8");
}

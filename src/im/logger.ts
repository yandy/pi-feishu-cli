import { appendFileSync } from "node:fs";
import { LOG_FILE } from "../shared.js";

export function log(msg: string): void {
  const ts = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  } catch {
    // diagnostic logging failures are silently ignored
  }
}

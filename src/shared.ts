import { join } from "node:path";
import { homedir } from "node:os";

export const FEISHU_IM_DIR = join(homedir(), ".pi", "agent", "feishu-im");
export const PID_FILE = join(FEISHU_IM_DIR, "daemon.pid");
export const LOG_FILE = join(FEISHU_IM_DIR, "daemon.log");
export const CONFIG_FILE = join(FEISHU_IM_DIR, "config.json");
export const REGISTRY_FILE = join(FEISHU_IM_DIR, "registry.json");

import { homedir } from "node:os";
import { join } from "node:path";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");

export const FEISHU_IM_DIR = join(PI_AGENT_DIR, "feishu-im");
export const PID_FILE = join(FEISHU_IM_DIR, "daemon.pid");
export const AUTH_FILE = join(FEISHU_IM_DIR, "auth.json");
export const DAEMON_LOG = join(FEISHU_IM_DIR, "daemon.log");
export const SOCKET_PATH = "/tmp/pi-feishu-im.sock";

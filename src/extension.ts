import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PID_FILE } from "./im/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isRunning(): boolean {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function getPid(): number | null {
  try {
    return parseInt(readFileSync(PID_FILE, "utf-8").trim());
  } catch {
    return null;
  }
}

async function handleStart(ctx: { ui: { notify: (message: string, type?: "info" | "error" | "warning") => void } }): Promise<void> {
  if (isRunning()) {
    ctx.ui.notify(`飞书 IM 守护进程已在运行 (PID: ${getPid()})`, "info");
    return;
  }

  try {
    execSync("which lark-cli", { stdio: "ignore" });
  } catch {
    ctx.ui.notify("lark-cli 未安装。请运行: npm i -g lark-cli", "error");
    return;
  }

  try {
    execSync("lark-cli config show", { stdio: "pipe", timeout: 5000 });
  } catch {
    ctx.ui.notify("lark-cli 未配置。请运行: lark-cli config init", "error");
    return;
  }

  const daemonPath = join(__dirname, "im", "daemon.ts");

  const child = spawn("node", ["--import", "jiti/register", daemonPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PI_FEISHU_IM: "1" },
  });

  child.unref();

  await new Promise((r) => setTimeout(r, 2000));

  if (isRunning()) {
    ctx.ui.notify(`飞书 IM 守护进程已启动 (PID: ${getPid()})`, "info");
  } else {
    ctx.ui.notify("飞书 IM 守护进程启动失败，请检查日志", "error");
  }
}

function handleStop(ctx: { ui: { notify: (message: string, type?: "info" | "error" | "warning") => void } }): void {
  const pid = getPid();
  if (!pid || !isRunning()) {
    ctx.ui.notify("飞书 IM 守护进程未在运行", "info");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(PID_FILE); } catch {}
    ctx.ui.notify("飞书 IM 守护进程已停止", "info");
  } catch {
    ctx.ui.notify("停止守护进程失败", "error");
  }
}

function handleStatus(ctx: { ui: { notify: (message: string, type?: "info" | "error" | "warning") => void } }): void {
  if (isRunning()) {
    ctx.ui.notify(`飞书 IM 守护进程运行中 (PID: ${getPid()})`, "info");
  } else {
    ctx.ui.notify("飞书 IM 守护进程未在运行", "info");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("feishu-im", {
    description: "管理飞书 IM 守护进程 (start|stop|status|restart)",
    handler: async (args, ctx) => {
      const sub = args?.trim() || "start";

      switch (sub) {
        case "start":
          await handleStart(ctx);
          break;
        case "stop":
          handleStop(ctx);
          break;
        case "status":
          handleStatus(ctx);
          break;
        case "restart":
          handleStop(ctx);
          await new Promise((r) => setTimeout(r, 1000));
          await handleStart(ctx);
          break;
        default:
          ctx.ui.notify("用法: /feishu-im [start|stop|status|restart]", "error");
      }
    },
  });
}

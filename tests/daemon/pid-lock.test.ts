import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEISHU_IM_DIR, PID_FILE, SOCKET_PATH } from "../../src/config.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(moduleDir, "../..");

const daemonPath = join(packageDir, "src", "daemon", "index.ts");

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("daemon PID lock", () => {
  beforeAll(() => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    // Clean up from any stale test runs
    try { rmSync(PID_FILE, { force: true }); } catch {}
    try { rmSync(SOCKET_PATH, { force: true }); } catch {}
  });

  afterEach(() => {
    try { rmSync(PID_FILE, { force: true }); } catch {}
    try { rmSync(SOCKET_PATH, { force: true }); } catch {}
  });

  it("exits with code 0 when PID file exists and process is alive", async () => {
    const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
    const child1 = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !existsSync(PID_FILE)) {
      await delay(100);
    }
    expect(existsSync(PID_FILE)).toBe(true);

    const child2 = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 10000);
      child2.on("close", (code) => { clearTimeout(t); resolve(code); });
    });

    // If child2 didn't exit (old daemon may have died), terminate both
    if (exitCode === null) {
      await terminate(child2);
      await terminate(child1);
      throw new Error("child2 did not exit within 10s — child1 may have crashed");
    }

    expect(exitCode).toBe(0);
    await terminate(child1);
  }, 20000);

  it("cleans up stale PID and starts when old process is dead", async () => {
    mkdirSync(FEISHU_IM_DIR, { recursive: true });
    writeFileSync(PID_FILE, "99999", "utf-8");

    const { VITEST: _vitest, ...childEnv } = process.env as Record<string, string | undefined>;
    const child = spawn("node", ["--import", "jiti/register", daemonPath], {
      cwd: packageDir,
      env: { ...childEnv, DAEMON_START_TIME: String(Date.now()) },
      stdio: "pipe",
    });

    const deadline = Date.now() + 5000;
    let started = false;
    while (Date.now() < deadline) {
      try {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (pid !== 99999) { started = true; break; }
      } catch {}
      await delay(100);
    }
    expect(started).toBe(true);

    await terminate(child);
  }, 15000);
});

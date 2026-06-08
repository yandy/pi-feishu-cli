import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionManager } from "../src/index.js";

describe("createSessionManager", () => {
  let tmpCwd: string;

  afterEach(() => {
    if (tmpCwd) {
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  function setupCwd(): string {
    tmpCwd = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    return tmpCwd;
  }

  it("returns SessionManager.create when parsed is undefined", () => {
    const cwd = setupCwd();
    const sm = createSessionManager(undefined, cwd);
    expect(sm).toBeDefined();
    expect(sm.getCwd()).toBe(cwd);
  });

  it("returns SessionManager.create when no session flags present", () => {
    const cwd = setupCwd();
    const sm = createSessionManager(
      {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
        model: "sonnet",
      },
      cwd,
    );
    expect(sm).toBeDefined();
  });

  it("returns SessionManager.continueRecent when --continue is set", () => {
    const cwd = setupCwd();
    const sm = createSessionManager(
      {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
        continue: true,
      },
      cwd,
    );
    expect(sm).toBeDefined();
    expect(sm.isPersisted()).toBe(true);
  });

  it("returns SessionManager.inMemory when --no-session is set", () => {
    const cwd = setupCwd();
    const sm = createSessionManager(
      {
        messages: [],
        fileArgs: [],
        unknownFlags: new Map(),
        diagnostics: [],
        noSession: true,
      },
      cwd,
    );
    expect(sm).toBeDefined();
    expect(sm.getSessionFile()).toBeUndefined();
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    kill: vi.fn(),
  })),
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => {
  let pidFileContent = "";
  return {
    readFileSync: vi.fn(() => pidFileContent),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => false),
  };
});

vi.mock("../src/im/paths.js", () => ({
  PID_FILE: "/tmp/test-daemon.pid",
}));

describe("extension module", () => {
  it("exports default function that registers command", async () => {
    const ext = await import("../src/extension.js");
    expect(typeof ext.default).toBe("function");
  });

  it("registers /feishu-im command (no flag registration)", async () => {
    const ext = await import("../src/extension.js");
    const mockPi = {
      registerCommand: vi.fn(),
      registerFlag: vi.fn(),
    };

    ext.default(mockPi as any);

    expect(mockPi.registerCommand).toHaveBeenCalledWith("feishu-im", expect.any(Object));
    expect(mockPi.registerFlag).not.toHaveBeenCalled();
  });

  it("commands return proper responses", async () => {
    const ext = await import("../src/extension.js");
    const mockPi = {
      registerCommand: vi.fn(),
      registerFlag: vi.fn(),
    };

    ext.default(mockPi as any);

    const cmdHandler = mockPi.registerCommand.mock.calls[0][1].handler;
    const mockCtx = { ui: { notify: vi.fn() } };

    await cmdHandler("status", mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(
      "飞书 IM 守护进程未在运行",
      "info"
    );
  });
});

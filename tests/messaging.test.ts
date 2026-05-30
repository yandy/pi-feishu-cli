import { describe, it, expect, vi, afterEach } from "vitest";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result?: { stdout: string; stderr: string }) => void;
    mockExecFile(...args);
    if (typeof cb === "function") {
      return { on: vi.fn() };
    }
    return {};
  },
}));

vi.mock("node:util", () => ({
  promisify: () => {
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        const callback = (err: Error | null, result?: { stdout: string; stderr: string }) => {
          if (err) reject(err);
          else resolve(result);
        };
        mockExecFile(...args, callback);
      });
    };
  },
}));

describe("larkCliAvailable", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("returns true when lark-cli responds", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "lark-cli help", stderr: "" });
    });
    const { larkCliAvailable } = await import("../src/im/messaging.js");
    const result = await larkCliAvailable();
    expect(result).toBe(true);
  });

  it("returns false when lark-cli fails", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error("command not found"));
    });
    const { larkCliAvailable } = await import("../src/im/messaging.js");
    const result = await larkCliAvailable();
    expect(result).toBe(false);
  });
});

describe("larkCliConfigured", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("returns true when appId and appSecret are set", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: JSON.stringify({ appId: "cli_a1", appSecret: "secret" }), stderr: "" });
    });
    const { larkCliConfigured } = await import("../src/im/messaging.js");
    const result = await larkCliConfigured();
    expect(result).toBe(true);
  });

  it("returns false when config is empty", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: JSON.stringify({}), stderr: "" });
    });
    const { larkCliConfigured } = await import("../src/im/messaging.js");
    const result = await larkCliConfigured();
    expect(result).toBe(false);
  });
});

describe("sendMessage", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("sends text message", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "{}", stderr: "" });
    });
    const { sendMessage } = await import("../src/im/messaging.js");
    const result = await sendMessage("hello", "oc_test");
    expect(result).toBe(true);
  });

  it("sends markdown message", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "{}", stderr: "" });
    });
    const { sendMessage } = await import("../src/im/messaging.js");
    const result = await sendMessage("**bold**", "oc_test", "markdown");
    expect(result).toBe(true);
  });

  it("sends interactive card", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "{}", stderr: "" });
    });
    const { sendMessage } = await import("../src/im/messaging.js");
    const result = await sendMessage('{"config":{"wide_screen_mode":true}}', "oc_test", "interactive");
    expect(result).toBe(true);
  });

  it("returns false on execFile error", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error("timeout"));
    });
    const { sendMessage } = await import("../src/im/messaging.js");
    const result = await sendMessage("hello", "oc_test");
    expect(result).toBe(false);
  });
});

describe("setTypingStatus", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("adds Typing reaction when typing=true", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: JSON.stringify({ data: { reaction_id: "rid_1" } }), stderr: "" });
    });
    const { setTypingStatus } = await import("../src/im/messaging.js");
    const result = await setTypingStatus("om_123", true);
    expect(result).toBe(true);
  });

  it("removes Typing reaction when typing=false", async () => {
    mockExecFile
      .mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: JSON.stringify({
          data: { items: [{ reaction_type: { emoji_type: "Typing" }, reaction_id: "rid_1" }] },
        }), stderr: "" });
      })
      .mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: "{}", stderr: "" });
      });
    const { setTypingStatus } = await import("../src/im/messaging.js");
    const result = await setTypingStatus("om_123", false);
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    mockExecFile.mockImplementationOnce((_cmd: string, _args: unknown, _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error("no permission"));
    });
    const { setTypingStatus } = await import("../src/im/messaging.js");
    const result = await setTypingStatus("om_123", true);
    expect(result).toBe(false);
  });
});

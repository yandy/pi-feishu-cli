import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli.js";

describe("parseArgs", () => {
  it("parses feishu args and leaves remaining for pi", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node",
      "pi-feishu",
      "--app-id", "my-app",
      "--app-secret", "my-secret",
      "--model", "claude-sonnet",
      "--thinking", "high",
      "do something",
    ]);

    expect(cliArgs.appId).toBe("my-app");
    expect(cliArgs.appSecret).toBe("my-secret");
    expect(remainingArgs).toEqual([
      "node",
      "pi-feishu",
      "--model", "claude-sonnet",
      "--thinking", "high",
      "do something",
    ]);
  });

  it("passes through all args when no feishu args present", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node",
      "pi-feishu",
      "--model", "claude-sonnet",
    ]);

    expect(cliArgs.appId).toBeUndefined();
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--model", "claude-sonnet"]);
  });

  it("handles --no-bundle-feishu-skills flag", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node", "pi-feishu",
      "--no-bundle-feishu-skills",
      "--model", "sonnet",
    ]);

    expect(cliArgs.noBundleFeishuSkills).toBe(true);
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--model", "sonnet"]);
  });

  it("handles --bot-name value", () => {
    const { cliArgs, remainingArgs } = parseArgs([
      "node", "pi-feishu",
      "--bot-name", "MyBot",
      "--continue",
    ]);

    expect(cliArgs.botName).toBe("MyBot");
    expect(remainingArgs).toEqual(["node", "pi-feishu", "--continue"]);
  });
});

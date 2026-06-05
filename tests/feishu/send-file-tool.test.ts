import { describe, expect, it } from "vitest";
import { initRuntime } from "../../src/runtime.js";

describe("send_file_to_chat tool registration", () => {
  it("initRuntime registers send_file_to_chat tool via extension", async () => {
    const { runtime } = await initRuntime({ cwd: process.cwd() });

    const extResult = runtime.services.resourceLoader.getExtensions();
    const allTools = extResult.extensions.flatMap((ext: any) =>
      ext.tools instanceof Map ? [...ext.tools.keys()] : [],
    );
    expect(allTools).toContain("send_file_to_chat");
  }, 30000);
});

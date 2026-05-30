import { describe, it, expect } from "vitest";

describe("daemon exports", () => {
  it("daemon module can be imported", async () => {
    const mod = await import("../src/im/daemon.js");
    expect(typeof mod).toBe("object");
  });
});

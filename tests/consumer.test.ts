import { describe, it, expect, vi, afterEach } from "vitest";
import type { FeishuEvent } from "../src/im/types.js";

let mockChild: Record<string, unknown>;
let mockStdout: Record<string, unknown>;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require("node:events").EventEmitter;
    mockChild = new EventEmitter();
    mockStdout = new EventEmitter();
    Object.assign(mockStdout, {
      resume: vi.fn(),
      pause: vi.fn(),
      setEncoding: vi.fn(),
      destroy: vi.fn(),
      readable: true,
    });
    Object.assign(mockChild, {
      stdout: mockStdout,
      kill: vi.fn(),
    });
    return mockChild;
  }),
}));

describe("startEventConsumer", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("parses NDJSON line and calls onEvent", async () => {
    const events: FeishuEvent[] = [];
    const { startEventConsumer } = await import("../src/im/consumer.js");

    const stop = startEventConsumer(
      (event) => events.push(event),
      () => {}
    );

    const rawEvent = {
      type: "im.message.receive_v1",
      chat_id: "oc_test",
      chat_type: "p2p",
      content: "hello",
      message_id: "om_123",
      message_type: "text",
      sender_id: "ou_user",
      create_time: "1700000000",
      event_id: "ev_1",
      timestamp: "1700000001",
    };

    // Simulate stdout data event (readline listens to 'data')
    (mockStdout as unknown as NodeJS.EventEmitter).emit("data", Buffer.from(JSON.stringify(rawEvent) + "\n"));

    expect(events).toHaveLength(1);
    expect(events[0].chat_id).toBe("oc_test");
    expect(events[0].content).toBe("hello");
    expect(events[0].raw).toEqual(rawEvent);

    stop();
  });

  it("skips unparseable lines", async () => {
    const events: FeishuEvent[] = [];
    const { startEventConsumer } = await import("../src/im/consumer.js");

    const stop = startEventConsumer(
      (event) => events.push(event),
      () => {}
    );

    (mockStdout as unknown as NodeJS.EventEmitter).emit("data", Buffer.from("not{}valid}}json\n"));

    expect(events).toHaveLength(0);
    stop();
  });

  it("kills child process on stop", async () => {
    const { startEventConsumer } = await import("../src/im/consumer.js");

    const stop = startEventConsumer(
      () => {},
      () => {}
    );

    stop();

    expect((mockChild as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith("SIGTERM");
  });
});

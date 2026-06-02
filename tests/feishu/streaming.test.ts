import { describe, it, expect, vi } from "vitest";
import { createStreamingHandler } from "../../src/feishu/streaming.js";

function createMockSession(events: any[]) {
  let listener: ((e: any) => void) | null = null;
  return {
    subscribe: (fn: (e: any) => void) => {
      listener = fn;
      return () => { listener = null; };
    },
    emit: (e: any) => { listener?.(e); },
  };
}

function createMockStream() {
  const chunks: string[] = [];
  return {
    chunks,
    append: vi.fn(async (chunk: string) => { chunks.push(chunk); }),
  };
}

describe("createStreamingHandler", () => {
  it("streams text_delta chunks", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello", contentIndex: 0, partial: {} },
    });

    expect(stream.append).toHaveBeenCalledWith("Hello");
    unsub();
  });

  it("streams thinking_delta as blockquote", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm", contentIndex: 0, partial: {} },
    });

    expect(stream.append).toHaveBeenCalledWith("> hmm");
    unsub();
  });

  it("streams tool_execution_start", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "tool_execution_start", toolName: "bash", toolCallId: "1", args: {} });

    expect(stream.append).toHaveBeenCalledWith("🔧 bash");
    unsub();
  });

  it("streams tool_execution_update", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "tool_execution_update", toolName: "bash", toolCallId: "1", args: {}, partialResult: "output" });

    expect(stream.append).toHaveBeenCalledWith("output");
    unsub();
  });

  it("ignores structural events (agent_start, turn_start, message_start)", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "agent_start" });
    session.emit({ type: "turn_start" });
    session.emit({ type: "message_start", message: {} });

    expect(stream.append).not.toHaveBeenCalled();
    unsub();
  });

  it("returns unsubscribe function", () => {
    const session = createMockSession([]);
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

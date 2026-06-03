import { describe, expect, it, vi } from "vitest";
import { createStreamingHandler } from "../../src/feishu/streaming.js";

function createMockSession() {
  let listener: ((e: any) => void) | null = null;
  return {
    subscribe: (fn: (e: any) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    emit: (e: any) => {
      listener?.(e);
    },
  };
}

function createMockStream() {
  const chunks: string[] = [];
  return {
    chunks,
    append: vi.fn(async (chunk: string) => {
      chunks.push(chunk);
    }),
  };
}

describe("createStreamingHandler", () => {
  it("streams text_delta chunks", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.append).toHaveBeenCalledWith("Hello");
    unsub();
  });

  it("streams thinking_delta as blockquote", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "hmm",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.append).toHaveBeenCalledWith("> hmm");
    unsub();
  });

  it("streams multi-line thinking_delta with > on each line", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "line1\nline2\nline3",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> line1\n> line2\n> line3"]);
    unsub();
  });

  it("streams consecutive think chunks without redundant >", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "I think ",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "we should",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> I think ", "we should"]);
    unsub();
  });

  it("streams think chunk starting with newlines", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "\n\nSecond thought.",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> \n> \n> Second thought."]);
    unsub();
  });

  it("closes blockquote when text follows think without trailing newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "answer",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> think", "\nanswer"]);
    unsub();
  });

  it("does not add extra newline when think ends with newline before text", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think\n",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "answer\n",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> think\n", "answer\n"]);
    unsub();
  });

  it("adds newline before new think block when text does not end with newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "some text",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "rethink",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["some text", "\n> rethink"]);
    unsub();
  });

  it("does not add extra newline before new think when text ends with newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "some text\n",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "rethink",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["some text\n", "> rethink"]);
    unsub();
  });

  it("closes think block when tool fires while think ends without newline", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "1",
      args: {},
    });

    expect(stream.chunks).toEqual(["> think", "\n🔧 bash"]);
    unsub();
  });

  it("starts new think block after tool execution", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "think\n",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "1",
      args: {},
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "rethink\n",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["> think\n", "🔧 bash", "\n> rethink\n"]);
    unsub();
  });

  it("streams consecutive text_delta without adding newlines", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello",
        contentIndex: 0,
        partial: {},
      },
    });

    session.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: " World",
        contentIndex: 0,
        partial: {},
      },
    });

    expect(stream.chunks).toEqual(["Hello", " World"]);
    unsub();
  });

  it("streams tool_execution_start", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "1",
      args: {},
    });

    expect(stream.append).toHaveBeenCalledWith("🔧 bash");
    unsub();
  });

  it("streams tool_execution_update", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({
      type: "tool_execution_update",
      toolName: "bash",
      toolCallId: "1",
      args: {},
      partialResult: "output",
    });

    expect(stream.append).toHaveBeenCalledWith("output");
    unsub();
  });

  it("ignores structural events (agent_start, turn_start, message_start)", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);

    session.emit({ type: "agent_start" });
    session.emit({ type: "turn_start" });
    session.emit({ type: "message_start", message: {} });

    expect(stream.append).not.toHaveBeenCalled();
    unsub();
  });

  it("returns unsubscribe function", () => {
    const session = createMockSession();
    const stream = createMockStream();
    const unsub = createStreamingHandler(session as any, stream as any);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

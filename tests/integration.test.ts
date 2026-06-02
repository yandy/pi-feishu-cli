import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { initRuntime } from "../src/runtime.js";
import { createChannel } from "../src/feishu/channel.js";
import { buildSessionsCard } from "../src/feishu/cards/sessions.js";
import { buildModelsCard } from "../src/feishu/cards/models.js";
import { createStreamingHandler } from "../src/feishu/streaming.js";
import { createMessageHandler } from "../src/feishu/handler.js";
import {
  createCardHeader,
  createMarkdownBlock,
  createActionButton,
  createDividerBlock,
  createNoteBlock,
  buildCard,
} from "../src/feishu/cards/helpers.js";

describe("integration smoke", () => {
  it("all modules import without error", () => {
    expect(typeof loadConfig).toBe("function");
    expect(typeof initRuntime).toBe("function");
    expect(typeof createChannel).toBe("function");
    expect(typeof buildSessionsCard).toBe("function");
    expect(typeof buildModelsCard).toBe("function");
    expect(typeof createStreamingHandler).toBe("function");
    expect(typeof createMessageHandler).toBe("function");
    expect(typeof createCardHeader).toBe("function");
    expect(typeof createMarkdownBlock).toBe("function");
    expect(typeof createActionButton).toBe("function");
    expect(typeof createDividerBlock).toBe("function");
    expect(typeof createNoteBlock).toBe("function");
    expect(typeof buildCard).toBe("function");
  });
});

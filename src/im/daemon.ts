#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Bot } from "./bot.js";
import { startEventConsumer } from "./consumer.js";
import { larkCliAvailable, larkCliConfigured } from "./messaging.js";
import { log } from "./logger.js";
import { PID_FILE } from "./paths.js";
import { processItem } from "./processor.js";
import type { QueuedItem } from "./processor.js";

async function runDaemon() {
  if (!(await larkCliAvailable())) {
    log("lark-cli not available, exiting");
    console.error("lark-cli 未安装。运行: npm i -g lark-cli");
    process.exit(1);
  }
  if (!(await larkCliConfigured())) {
    log("lark-cli not configured, exiting");
    console.error("lark-cli 未配置。运行: lark-cli config init");
    process.exit(1);
  }

  const config = loadConfig();
  const registry = new SessionRegistry(join(homedir(), ".pi", "agent", "feishu-im"));
  const bot = new Bot(registry, config.strategy, config.botName);

  writeFileSync(PID_FILE, String(process.pid));

  const cwd = process.cwd();
  const agentDir = getAgentDir();

  const runtime = await createAgentSessionRuntime(
    async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(cwd),
    }
  );

  console.log("[feishu-im] Daemon started, PID:", process.pid);
  console.log("[feishu-im] Strategy:", config.strategy);
  log("Daemon started, pid=" + process.pid + " strategy=" + config.strategy);

  const eventQueue: QueuedItem[] = [];
  let processing = false;

  function processNext(): void {
    if (processing) return;
    if (eventQueue.length === 0) return;

    processing = true;
    const item = eventQueue.shift()!;

    processItem(
      item,
      runtime,
      registry,
      agentDir,
      config.model ?? "anthropic/claude-sonnet-4-20250514"
    ).finally(() => {
      processing = false;
      processNext();
    });
  }

  const stopConsumer = startEventConsumer(
    (event) => {
      log("Event: sender=" + event.sender_id + " type=" + event.message_type);
      const route = bot.route(event);
      log("Route: " + route.type);

      if (route.type !== "skip") {
        eventQueue.push({ event, route });
        log("Queued, queue size=" + eventQueue.length);
        processNext();
      }
    },
    (err) => {
      log("Consumer error: " + err.message);
    }
  );

  log("Event consumer started");

  process.on("SIGTERM", () => {
    log("Received SIGTERM, shutting down");
    stopConsumer();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    log("Received SIGINT, shutting down");
    stopConsumer();
    process.exit(0);
  });
}

runDaemon().catch((err) => {
  console.error("[feishu-im] Fatal error:", err);
  process.exit(1);
});

#!/usr/bin/env node

// Keep as raw Node.js JS for the bin entry point
// This file is compiled by tsc to dist/cli.js
// import.meta is available because the package is "type": "module"

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { main } from "./src/index.js";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(__filename), "..");

interface CliArgs {
  appId?: string;
  appSecret?: string;
  config?: string;
  logLevel?: string;
  botName?: string;
  noBundleFeishuSkills?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--app-id":
        if (i + 1 < argv.length) result.appId = argv[++i];
        break;
      case "--app-secret":
        if (i + 1 < argv.length) result.appSecret = argv[++i];
        break;
      case "--config":
        if (i + 1 < argv.length) result.config = argv[++i];
        break;
      case "--log-level":
        if (i + 1 < argv.length) result.logLevel = argv[++i];
        break;
      case "--bot-name":
        if (i + 1 < argv.length) result.botName = argv[++i];
        break;
      case "--no-bundle-feishu-skills":
        result.noBundleFeishuSkills = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`Usage: pi-feishu [options]

Options:
  --app-id <id>       Feishu app ID
  --app-secret <key>  Feishu app secret
  --config <path>     Path to config JSON file
  --log-level <level> Log level (fatal|error|warn|info|debug|trace, default: warn)
  --bot-name <name>   Bot display name (default: PI Agent)
  --no-bundle-feishu-skills  Skip loading project skills/ directory
  --help, -h          Show this help

Configuration priority: CLI args > config file > environment variables

Environment variables:
  FEISHU_APP_ID       Feishu app ID
  FEISHU_APP_SECRET   Feishu app secret

Config file location:
  Searched in order: .pi/feishu.json → ~/.pi/agent/feishu.json
`);
}

const cliArgs = parseArgs(process.argv);

main({
  appId: cliArgs.appId,
  appSecret: cliArgs.appSecret,
  config: cliArgs.config,
  logLevel: cliArgs.logLevel,
  botName: cliArgs.botName,
  noBundleFeishuSkills: cliArgs.noBundleFeishuSkills,
  packageRoot,
}).catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

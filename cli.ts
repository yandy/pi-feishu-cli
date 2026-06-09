#!/usr/bin/env node

// Keep as raw Node.js JS for the bin entry point
// This file is compiled by tsc to dist/cli.js
// import.meta is available because the package is "type": "module"

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parsePiArgs } from "@earendil-works/pi-coding-agent";
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

export function parseArgs(argv: string[]): {
  cliArgs: CliArgs;
  remainingArgs: string[];
} {
  const consumed = new Set<number>();
  const result: CliArgs = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--app-id":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.appId = argv[++i];
        }
        break;
      case "--app-secret":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.appSecret = argv[++i];
        }
        break;
      case "--config":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.config = argv[++i];
        }
        break;
      case "--log-level":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.logLevel = argv[++i];
        }
        break;
      case "--bot-name":
        if (i + 1 < argv.length) {
          consumed.add(i);
          consumed.add(i + 1);
          result.botName = argv[++i];
        }
        break;
      case "--no-bundle-feishu-skills":
        consumed.add(i);
        result.noBundleFeishuSkills = true;
        break;
      // --help/-h is passed through to PI args parser for combined help
    }
  }

  const remainingArgs = argv.filter((_, i) => !consumed.has(i) && i >= 2);
  return { cliArgs: result, remainingArgs };
}

function printHelp(): void {
  console.log(`Usage: pi-feishu [options] [@files...] [messages...]

Feishu Options:
  --app-id <id>       Feishu app ID
  --app-secret <key>  Feishu app secret
  --config <path>     Path to config JSON file
  --log-level <level> Log level (fatal|error|warn|info|debug|trace, default: warn)
  --bot-name <name>   Bot display name (default: PI Agent)
  --no-bundle-feishu-skills  Skip loading project skills/ directory
  --help, -h          Show this help

Configuration priority: CLI args > config file > environment variables

Feishu Environment Variables:
  FEISHU_APP_ID       Feishu app ID
  FEISHU_APP_SECRET   Feishu app secret

Config file location:
  Searched in order: .pi/feishu.json → ~/.pi/agent/feishu.json

PI Agent Options:
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt (can be used multiple times)
  --continue, -c                 Continue previous session
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --no-session                   Don't save session (ephemeral)
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --verbose                      Force verbose startup

PI Agent Environment Variables:
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY,
  GROQ_API_KEY, XAI_API_KEY, FIREWORKS_API_KEY, TOGETHER_API_KEY,
  OPENROUTER_API_KEY, MISTRAL_API_KEY, MINIMAX_API_KEY, MOONSHOT_API_KEY,
  KIMI_API_KEY, CLOUDFLARE_API_KEY, and more.

Examples:
  pi-feishu
  pi-feishu "List all .ts files in src/"
  pi-feishu @prompt.md "What does this file do?"
  pi-feishu --continue "What did we discuss?"
  pi-feishu --model openai/gpt-4o "Help me refactor"
  pi-feishu --thinking high "Solve this complex problem"
  pi-feishu --fork <session-id>
`);
}
const { cliArgs, remainingArgs } = parseArgs(process.argv);
const piArgs = parsePiArgs(remainingArgs);

if (piArgs.help) {
  printHelp();
  process.exit(0);
}

main({
  appId: cliArgs.appId,
  appSecret: cliArgs.appSecret,
  config: cliArgs.config,
  logLevel: cliArgs.logLevel,
  botName: cliArgs.botName,
  noBundleFeishuSkills: cliArgs.noBundleFeishuSkills,
  piArgs,
  packageRoot,
}).catch((err) => {
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});

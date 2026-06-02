# pi-feishu

A CLI tool that runs [Pi](https://pi.ai) as a terminal TUI and connects it to a Feishu (Lark) bot for remote interaction. The TUI and the Feishu bot share the same AgentSessionRuntime session — interact from either interface interchangeably.

## Prerequisites

- Node.js >= 22
- Pi API keys configured (`~/.pi/agent/auth.json`)
- Feishu app with bot capabilities enabled (permissions: `im:message`, `im:message.group_msg`, `card.action.trigger`)

## Installation

```bash
npm install -g pi-feishu-cli
```

Or run directly without installing:

```bash
npx pi-feishu
```

## Quick Start

```bash
pi-feishu --app-id cli_xxx --app-secret xxx
```

If credentials are missing, the CLI prompts you to enter them interactively and saves them to `~/.pi/agent/feishu.json`.

## CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--app-id <id>` | — | Feishu app ID |
| `--app-secret <key>` | — | Feishu app secret |
| `--config <path>` | — | Path to JSON config file |
| `--log-level <level>` | `warn` | One of: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `--bot-name <name>` | `PI Agent` | Bot display name in help card |
| `--no-bundle-feishu-skills` | — | Skip loading project `skills/` directory |
| `--help`, `-h` | — | Show help and exit |

## Configuration

Feishu credentials are resolved with the following priority (higher overrides lower):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | CLI args | `pi-feishu --app-id xxx --app-secret xxx` |
| 2 | Config file | `.pi/feishu.json` or `~/.pi/agent/feishu.json` (searched in order) |
| 3 (lowest) | Env vars | `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BOT_NAME`, `FEISHU_NO_BUNDLE_SKILLS` |

Config file format:

```json
{ "appId": "cli_xxx", "appSecret": "xxx", "botName": "My Bot", "noBundleFeishuSkills": true }
```

Override config file path with `--config`:

```bash
pi-feishu --config /path/to/config.json
```

## Feishu Bot Commands

| Command | Action |
|---------|--------|
| `/sessions` | Show session management card — list, switch, delete, and create sessions |
| `/models` | Show model and thinking level selection card |
| `/help` | Show usage instructions |
| *any other message* | Chat with Pi — streaming response via Feishu cards (typewriter effect) |

### Card Interactions

Clickable buttons on cards support the following actions:

- **Session management:** new, switch, delete
- **Model management:** select provider/model/thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`)
- **Help card navigation:** jump to sessions or models card

## Architecture

```
cli.ts                     CLI entry — parse args, load config, call main()
  └─ src/config.ts         Credential resolution CLI > config file > env vars
  └─ src/runtime.ts        AgentSessionRuntime initialization + skill loading
  └─ src/feishu/
       ├─ channel.ts       LarkChannel wrapper — WebSocket, send, stream, cards
       ├─ handler.ts       Message routing — commands vs conversation
       ├─ streaming.ts     Session events → Feishu card streaming (typewriter)
       └─ cards/
            ├─ sessions.ts Session management card
            ├─ models.ts   Model selection card
            ├─ help.ts     Help card
            └─ helpers.ts  Shared card building utilities
  └─ InteractiveMode       TUI (from @earendil-works/pi-coding-agent)
```

### Channel API

`createChannel(opts)` wraps `@larksuiteoapi/node-sdk`'s `LarkChannel` and returns a `Channel` interface.

**Events:**

| Event | Handler | Description |
|-------|---------|-------------|
| `message` | `(msg: NormalizedMessage) => void` | Incoming Feishu message |
| `cardAction` | `(evt: any) => void` | Card button click |
| `error` | `(err: Error) => void` | Channel-level error |
| `reconnecting` | `() => void` | SDK reconnecting |
| `reconnected` | `() => void` | SDK reconnected |
| `botAdded` | `() => void` | Bot added to a chat |
| `onRawEvent(type, handler)` | — | Register a handler for a raw SDK event type on the underlying dispatcher |

**Methods:** `connect`, `disconnect`, `send`, `stream`, `updateCard`, `onRawEvent`

### Data Flow

```
Feishu user → WebSocket → channel.on("message")
  ├── /sessions  → build card → channel.send(card)
  ├── /models    → build card → channel.send(card)
  ├── /help      → build card → channel.send(card)
  └── text       → session.prompt(text) → events → channel.stream().append()

Card click → channel.on("cardAction")
  ├── session: new/switch/delete → runtime.* → updateCard()
  └── model: select → session.setModel() + setThinkingLevel() → updateCard()
```

## Skills

The `skills/` directory contains 26 Lark API skills that provide Pi with knowledge of Feishu's ecosystem: documents, calendar, mail, spreadsheets, wiki, approval, attendance, task, minutes, whiteboard, and more. These are automatically loaded at startup via `loadSkillsFromDir()`.

## Development

```bash
npm install
npm run build     # tsc compile to dist/
npm run check     # tsc --noEmit type check
npm run dev       # tsc --watch
npm test          # vitest run
npm run test:watch # vitest
```

### Test Structure

Tests mirror `src/` under `tests/` using Vitest:

```bash
npx vitest run tests/feishu/channel.test.ts
```

## Publishing

Published to npm on GitHub Release (CI workflow in `.github/workflows/publish.yml`).

```bash
npm version patch
git push --tags
# Create GitHub Release → auto-publishes with --provenance
```

## License

MIT

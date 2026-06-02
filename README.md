# pi-feishu

A CLI tool that embeds Pi's AI coding agent in a terminal TUI and connects to a Feishu (Lark) bot for remote interaction.

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

## Usage

Start the CLI with Feishu bot credentials:

```bash
pi-feishu --app-id <feishu-app-id> --app-secret <feishu-app-secret>
```

Both the TUI and the Feishu bot share the same Pi session — you can interact from either interface interchangeably.

## Configuration

Feishu credentials are resolved with the following priority (higher overrides lower):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | CLI args | `pi-feishu --app-id xxx --app-secret xxx` |
| 2 | Config file | `.pi/feishu.json` or `~/.pi/agent/feishu.json` |
| 3 (lowest) | Env vars | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` |

Config file format:

```json
{ "appId": "cli_xxx", "appSecret": "xxx" }
```

Override config file path with `--config`:

```bash
pi-feishu --config /path/to/config.json
```

## Feishu Bot Commands

- `/sessions` — Show session management card (list sessions, switch, delete, create new)
- `/models` — Show model and thinking level management card
- Any other message — Chat with Pi (streaming response with typewriter effect via Feishu cards)

## Skills

The `skills/` directory contains Lark API skills that provide Pi with knowledge of Feishu's ecosystem (documents, calendar, mail, spreadsheets, and more). These are automatically loaded at startup.

## Development

```bash
npm install
npm run build    # tsc compile to dist/
npm run check    # tsc --noEmit type check
npm test         # vitest
```

## License

MIT

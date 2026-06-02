# pi-feishu-cli v1 Design

## Overview

A standalone CLI tool `pi-feishu` that embeds Pi's AI coding agent capabilities into a terminal TUI and connects to a Feishu (Lark) bot for remote interaction. Both TUI and Feishu share the same `AgentSessionRuntime`, allowing session and model management from either interface.

## Architecture

Single-process Node.js application. `InteractiveMode` (from Pi SDK) provides the TUI. The Feishu Channel (WebSocket) runs on the same event loop, calling into the shared runtime directly.

```
pi-feishu (single process)
│
├── CLI entry (cli.ts)
│   └── Parse args, load config, call main()
│
├── Runtime layer (src/runtime.ts)
│   └── createAgentSessionRuntime() with skills/, tools, auth
│
├── Feishu layer (src/feishu/)
│   ├── channel.ts        — createLarkChannel() wrapper
│   ├── handler.ts        — message routing (/sessions, /models, chat)
│   ├── streaming.ts      — session events → channel.stream().append()
│   └── cards/
│       ├── sessions.ts   — session management card
│       ├── models.ts     — model management card
│       └── helpers.ts    — shared card builders
│
└── TUI layer
    └── InteractiveMode.run() — auto TUI (no custom UI code)
```

## Project Structure

```
pi-feishu-cli/
├── cli.ts                    # CLI entry (shebang), args parsing
├── src/
│   ├── index.ts              # main(): orchestrate init flow
│   ├── config.ts             # Config loading (CLI > file > env)
│   ├── runtime.ts            # AgentSessionRuntime init
│   ├── feishu/
│   │   ├── channel.ts        # createLarkChannel() wrapper
│   │   ├── handler.ts        # Message routing
│   │   ├── streaming.ts      # Session events → Feishu streaming
│   │   └── cards/
│   │       ├── sessions.ts   # Session card builder
│   │       ├── models.ts     # Model card builder
│   │       └── helpers.ts    # Shared card utilities
│   └── types.ts              # Shared types
├── skills/                   # 26 existing Lark API skills (unchanged)
├── package.json              # type: module, bin: {"pi-feishu": "./dist/cli.js"}
├── tsconfig.json
└── tests/
```

Old files to remove: `extensions/`, `src/daemon/`, `src/ipc/`, `src/auth/`, `src/channel/`.

## Configuration

Feishu credentials are resolved with the following priority (later overrides earlier):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | CLI args | `pi-feishu --app-id xxx --app-secret xxx` |
| 2 | Config file | `~/.pi/agent/feishu.json` or `.pi/feishu.json` |
| 3 (lowest) | Env vars | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` |

Config file path can be overridden with `--config`. Default search: `.pi/feishu.json` → `~/.pi/agent/feishu.json`.

Pi credentials (API keys) continue using `~/.pi/agent/auth.json` managed by `AuthStorage`.

## Runtime

Uses `createAgentSessionRuntime()` from `@earendil-works/pi-coding-agent`:

- **SessionManager**: `SessionManager.create(cwd)` for persistence
- **Tools**: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`
- **Skills**: Loaded from `skills/` directory via `DefaultResourceLoader` with `skillsOverride`
- **Model**: From `modelRegistry.getAvailable()`, default fallback

## Data Flow

### TUI Input (handled entirely by InteractiveMode)

- Enter key → `session.prompt(text, {streamingBehavior: "steer"})`
- Alt+Enter → followUp queuing
- Ctrl+P → model switching panel
- Slash commands handled by InteractiveMode built-ins

### Feishu Input

```
Feishu user → WebSocket → channel.on('message', msg)
  ├── msg.content starts "/sessions" → build & send session card
  ├── msg.content starts "/models"   → build & send model card
  └── otherwise                      → session.prompt(msg.content, {streamingBehavior: "steer"})
```

### Session Events → Feishu Streaming

Only events visible in TUI's chat stream are streamed to Feishu. Status bar, footer, and internal events are excluded to match the TUI experience.

```
session.subscribe(event)

  // Message streaming (visible in chat):
  message_update.text_delta         → s.append(delta)
  message_update.thinking_delta     → s.append("> " + delta)
  message_update.error              → s.append("— 模型返回错误 —")

  // Tool execution (visible in chat):
  tool_execution_start      → s.append("🔧 {toolName}")
  tool_execution_update     → s.append(delta)        // tool live output (e.g. bash stdout)
  tool_execution_end        → s.append("{✅/❌}")

  // Queue / status events (visible in chat-adjacent areas in TUI):
  queue_update              → s.append("— 消息已排队 —")

  // Compaction (visible via status bar loader in TUI, inline in Feishu):
  compaction_start          → s.append("— 压缩中... —")
  compaction_end            → s.append("— 压缩完成 —")

  // Auto retry (visible via status bar loader in TUI, inline in Feishu):
  auto_retry_start          → s.append("— 自动重试 ({attempt}/{maxAttempts})... —")
  auto_retry_end            → s.append("{success: '✅' : '❌'} 重试结果")

  // NOT streamed (status bar / footer / internal only):
  //   agent_start, agent_end, turn_start, turn_end,
  //   message_start, message_end,
  //   message_update.{start, text_start, text_end, thinking_start, thinking_end,
  //     toolcall_start, toolcall_delta, toolcall_end, done},
  //   session_info_changed, thinking_level_changed
```

Channel SDK's `stream()` handles throttling and "typewriter" rendering. First `append()` auto-sends a "Thinking..." placeholder card.

### Feishu Card Actions

```
channel.on('cardAction', event)
  ├── cmd: "session", action: "switch" → runtime.switchSession(id), refresh card
  ├── cmd: "session", action: "delete" → delete session, refresh card
  ├── cmd: "session", action: "new"    → runtime.newSession(), refresh card
  └── cmd: "model", action: "select"   → session.setModel() + setThinkingLevel(), refresh card
```

## Feishu Cards

### /sessions Card

```
┌─────────────────────────────────────┐
│ Session Management                   │
├─────────────────────────────────────┤
│ Current Session                      │
│ 2025-06-02_project-refactor.jsonl    │
├─────────────────────────────────────┤
│ Other Sessions                       │
│ session-a.jsonl  [Switch] [Delete]  │
│ session-b.jsonl  [Switch] [Delete]  │
├─────────────────────────────────────┤
│ [New Session]                        │
└─────────────────────────────────────┘
```

- Lists current session, other sessions (from `SessionManager.list(cwd)` and `SessionManager.listAll(cwd)`), and a "New Session" button
- Each session row has Switch and Delete action buttons
- Card refreshes in-place via `channel.updateCard()` after each action

### /models Card

```
┌─────────────────────────────────────┐
│ Model Management                     │
├─────────────────────────────────────┤
│ Current                              │
│ Claude Opus 4.5 · Thinking: high    │
├─────────────────────────────────────┤
│ Available Models                     │
│ Claude Opus 4.5    │ ThinkLevel │ [Switch] │
│ GPT-5              │ ThinkLevel │ [Switch] │
│ ...                                  │
└─────────────────────────────────────┘
```

- Shows current model + thinking level
- Lists all available models with thinking level selector and Switch button
- Switching calls both `setModel()` and `setThinkingLevel()`

## Skills

All 26 existing Lark API skills in `skills/` are preserved and loaded via `DefaultResourceLoader.skillsOverride()`. These provide Pi with knowledge of Lark APIs for document, calendar, mail, etc. operations.

## Dependencies

- `@earendil-works/pi-coding-agent` — Pi SDK (runtime + InteractiveMode)
- `@larksuiteoapi/node-sdk` — Feishu Channel SDK (WebSocket + streaming)
- `typebox` — Schema validation (pi peer dependency)

Dev dependencies:
- `typescript` — Compile TS to JS
- `@types/node` — Node.js type definitions
- `vitest` — Test runner

## Error Handling

- Feishu connection failure: log error, continue TUI-only mode
- Session prompt failure: report error to Feishu via `channel.send()` or card update
- Card action failure: update card with error message
- Channel disconnect: auto-reconnect handled by SDK

## Startup Flow

1. Parse CLI args, load config (CLI > file > env)
2. Initialize `AgentSessionRuntime` with skills, tools, auth
3. Connect Feishu Channel (if credentials available)
4. Subscribe to session events for Feishu streaming
5. Start `InteractiveMode.run()` (blocking, takes over terminal)

## Build & Distribution

No bundler. TypeScript is compiled to JavaScript via `tsc`, output to `dist/`. `package.json` `bin` points to `dist/cli.js`. Users install via `npm i -g pi-feishu-cli` or run directly with `npx pi-feishu`.

- Build: `tsc` (compile TS → JS to `dist/`)
- `prepublishOnly`: runs `tsc` before npm publish
- `bin` field: `"./dist/cli.js"`
- Skills (`skills/`) are loaded at runtime from disk, not bundled
- Dev iteration: use `tsc --watch` or direct `tsx cli.ts` for quick testing

## README

Write a `README.md` covering:
- What `pi-feishu` is (CLI tool embedding Pi AI agent with Feishu bot)
- Installation (`npm i -g pi-feishu-cli`)
- Prerequisites (Node.js >= 22, Feishu app credentials, Pi API keys)
- Usage: `pi-feishu --app-id xxx --app-secret xxx`
- Configuration (CLI args, config file, env vars with priority)
- Feishu bot commands (`/sessions`, `/models`, regular chat)
- Skills directory reference

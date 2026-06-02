# Remove Session Robot Commands & Simplify Architecture

> **Date:** 2026-06-01
> **Status:** Approved

## Goal

Remove the `/sessions` robot command and all associated session-management complexity (registry, session tracking, switch/new code paths), while keeping `/model` and `/help`. Use `ExtensionContext` instead of `ExtensionCommandContext` for message handling since no session-mutation APIs are needed.

---

## Architecture

### What stays

| Component | Rationale |
|-----------|-----------|
| `ipcClient` at module scope | Survives `export default(pi)` re-execution; independent of sessions |
| `attachHandler(client, pi, extCtx)` as standalone function | Called from both `start` and `session_start` |
| `session_start` event handler | **Lifecycle hook**, not session management. Rebinds handler with fresh `pi` + `ExtensionContext` when user does TUI new session |
| `/model` and `/help` bot commands | Not session-related |
| `activeChatId` / `forwardingCount` | Message forwarding to Feishu, unrelated |
| `message_update`/`message_end`/`agent_end` forwarding | Core functionality |

### What goes

| Component | Location | Lines |
|-----------|----------|-------|
| `sessions.ts` (entire file) | `extensions/bot-commands/` | 158 |
| `sessions.test.ts` (entire file) | `tests/bot-commands/` | 217 |
| `Registry` interface + `loadRegistry`/`saveRegistry` | `extensions/index.ts` | ~20 |
| `REGISTRY_FILE` config | `src/config.ts` | 1 |
| `/sessions` in `BOT_COMMANDS` | `extensions/bot-commands/router.ts` | 1 |
| `/sessions` line in help card | `extensions/bot-commands/help.ts` | 1 |
| `/sessions` bot command handler | `extensions/index.ts` | ~14 |
| Session tracking in `/model` handler | `extensions/index.ts` | ~6 |
| Session tracking in normal message handler | `extensions/index.ts` | ~7 |
| Sessions `cardAction` handling | `extensions/index.ts` | ~17 |
| `saveRegistry()` in model cardAction | `extensions/index.ts` | 1 |
| Error message `/feishu-im restart` → `/feishu-im start` | `extensions/index.ts` | 1 |
| Session-related tests | `tests/extensions/index.test.ts` | ~290 |
| Session tests in router.test.ts | `tests/bot-commands/` | 2 cases |
| Session assertion in help.test.ts | `tests/bot-commands/` | 1 case |
| REGISTRY_FILE test in config.test.ts | `tests/config.test.ts` | 1 case |

### Simplified message handling flow

```
Feishu message → Daemon → IPC → attachHandler:
  /help        → buildHelpCard() → send card
  /model       → buildModelCard(models, currentModel) → send card
  other /cmd   → buildHelpCard() → send card
  normal msg   → pi.sendUserMessage(prompt) → stream back to Feishu

cardAction:
  model select → handleModelAction() → updateCard

Removed paths:
  /sessions    → [removed]
  sessions switch/new/delete cardAction → [removed]
  session file tracking in /model and normal msg → [removed]
```

### ExtensionContext usage in attachHandler

The handler is called from two paths, both providing correct types:

1. `/feishu-im start` command handler: `ctx` is `ExtensionCommandContext` (extends `ExtensionContext`)
2. `session_start` event: `sessionCtx` is `ExtensionContext`

`attachHandler` only consumes `ExtensionContext` capabilities: `ui.notify`, `ui.input`, `modelRegistry`, `model`.

---

## Files Changed

### Delete

- `extensions/bot-commands/sessions.ts`
- `tests/bot-commands/sessions.test.ts`

### Modify

| File | Changes |
|------|---------|
| `src/config.ts` | Remove `REGISTRY_FILE` export |
| `extensions/bot-commands/router.ts` | Remove `sessions` from `BOT_COMMANDS`; `BotCommand` → `"help" \| "model"` |
| `extensions/bot-commands/help.ts` | Remove `/sessions` line from help card markdown |
| `extensions/index.ts` | Remove Registry/session tracking/sessions handler/sessions cardAction/restart message; fix restart→start |
| `tests/extensions/index.test.ts` | Remove stale ctx describe block, `createStaleAwareCtx`, `createFreshSessionCtx`, `before_agent_start`/`session_shutdown` negative tests; fix restart→start |
| `tests/bot-commands/router.test.ts` | Remove sessions test cases |
| `tests/bot-commands/help.test.ts` | Remove `/sessions` assertion |
| `tests/config.test.ts` | Remove `REGISTRY_FILE` test |

---

## Non-changes

- `extensions/bot-commands/model.ts` — independent of sessions
- `tests/bot-commands/model.test.ts` — independent of sessions
- `src/daemon/`, `src/ipc/`, `src/channel/`, `src/auth/` — no changes
- `skills/` — no changes
- `extensions/feishu-card.ts` — no changes
- `tests/feishu-card.test.ts` — no changes
- `tests/auth/index.test.ts` — no changes (REGISTRY_FILE appears only in mock)

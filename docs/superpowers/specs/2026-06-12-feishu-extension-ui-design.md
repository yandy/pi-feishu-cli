# Feishu ExtensionUIContext Bridge Design

## Problem

Pi's extension system provides `ctx.ui.confirm()`, `ctx.ui.select()`, and `ctx.ui.notify()` for extensions to interact with users. In TUI mode, `InteractiveMode` binds a terminal-based `ExtensionUIContext`. Pi-feishu never binds one, so `runner.hasUI()` returns `false`.

When `pi-permission-system` is installed and a tool call matches an `ask` rule:

```
canConfirm = hasUI || isSubagent || yoloMode
           = false   || false      || false
           → block with "confirmation_unavailable"
```

All `ask`-rule tool calls are silently blocked instead of prompting the user.

## Root Cause

1. Pi-feishu never calls `runtime.session.bindExtensions({ uiContext })` or `runner.setUIContext()`
2. If it did, the Feishu Lark SDK's `ChatPipeline` serializes all events (messages + card actions) by `chatId`. The message handler blocks on `session.prompt()`, which blocks on `ctx.ui.confirm()`. The card action event is queued behind the message handler on the same pipeline → **deadlock**.

## Solution

1. **Disable ChatPipeline** (`safety: { chatQueue: { enabled: false } }`) to free card actions from message serialization
2. **Manual message lock** (Promise-chain) to prevent concurrent `session.prompt()` calls
3. **Bridge `ExtensionUIContext`** to Feishu interactive cards with callback buttons

### Architecture

```
                    ┌─────────────────────────┐
                    │     src/index.ts         │
                    │  (feishu handler)        │
                    │                          │
                    │  promptLock (manual)     │
                    │  setUIContext(permission)│
                    │  cardAction → permission │
                    └───┬──────────┬───────────┘
                        │          │
              ┌─────────▼──┐  ┌───▼──────────────┐
              │ handler.ts │  │ permission-ui.ts  │
              │ (no change)│  │ (new file)        │
              └────────────┘  │                    │
                              │  createFeishuUIContext()
                              │  pendingDialogs Map  │
                              │  resolveCardAction() │
                              └────────────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  channel.ts        │
                              │  +chatQueue:false  │
                              └────────────────────┘
```

### Data Flow

```
Feishu message "git push -f"
  │
  ├─ promptLock (wait previous, then acquire)
  ├─ setFeishuContext({ chatId, channel })
  ├─ runner.setUIContext(feishuUIContext, "feishu")
  └─ channel.stream()
      └─ session.prompt()
          └─ pi-permission-system: tool_call "bash"
              └─ ctx.ui.select("权限确认", ["是", "是，允许...", ...])
                  ├─ channel.send(permissionCard)   ← independent message
                  ├─ pendingDialogs.set(cardId, {resolve})
                  └─ await Promise ──→ [prompt blocked]
                                        │
                        User clicks [是] ──┘
                          └─ cardAction handler
                              └─ resolvePermissionCardAction()
                                  └─ resolve("是")
                                      │
                              select() returns "是" ←┘
                          └─ agent continues
              └─ streaming continues → card finalized
  └─ unlock → next message can enter
```

## Files Changed

### `src/feishu/permission-ui.ts` (new, ~120 lines)

Exports:
- `createFeishuUIContext(): ExtensionUIContext` — full interface with `select`/`confirm`/`input`/`notify` bridged to Feishu cards, TUI methods stubbed
- `resolvePermissionCardAction(value)` — resolves pending dialog by `perm_dialog_id`

Internal:
- `pendingDialogs: Map<string, { resolve, timer }>` — module-level shared state, keyed by `cardId`
- `select()` sends an interactive card with one button per option, callback value carries `{ cmd: "permission", perm_dialog_id, perm_choice }`
- `confirm()` delegates to `select(["是", "否"])`
- Default timeout: 60s, configurable via `opts.timeout`

Card format uses existing helpers: `createCardHeader` (red), `createActionButton`, `createMarkdownBlock`, `buildCard`.

### `src/index.ts` (3 changes)

1. **Manual message lock** — Promise-chain around the message handler body to prevent concurrent `session.prompt()`

2. **Set UI context** — `runtime.session.extensionRunner.setUIContext(feishuUIContext, "feishu")` after `setFeishuContext()`

3. **Permission card action** — add `cmd === "permission"` branch in `handleCardAction()`, calling `resolvePermissionCardAction(value)`

### `src/feishu/channel.ts` (1 change)

Add `safety: { chatQueue: { enabled: false } }` to `createLarkChannel` options, freeing card actions from ChatPipeline serialization.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No Feishu context (initialMessage) | `confirm()` returns `true`, `select()` returns first option |
| Timeout (default 60s) | Clear `timer`, delete `pendingDialogs` entry, resolve with `undefined`/`false` |
| AbortSignal | `opts.signal?.addEventListener("abort")` → resolve `undefined` |
| Concurrent dialogs | Different `cardId` keys in `pendingDialogs` |
| Concurrent messages | Manual `promptLock` ensures serial `session.prompt()` |
| Card ignored by user | Timeout resolves automatically, no Promise leak |
| Streaming card + permission card | Independent `im.v1.message` calls, different `card_id`s |

## Non-Goals

- TUI-specific methods (`setFooter`, `setWidget`, `setTitle`, `custom`, `editor` etc.) are stubbed
- Not adding CLI flags to toggle this behavior (always on for Feishu context)

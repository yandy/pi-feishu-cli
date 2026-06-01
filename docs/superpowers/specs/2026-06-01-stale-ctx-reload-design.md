# Fix Stale pi/ctx After Session Operations

## Problem

`ctx.switchSession()` and `ctx.newSession()` permanently invalidate the captured `pi` (ExtensionAPI) and `ctx` (ExtensionCommandContext). Subsequent calls to `pi.sendUserMessage()` throw `"This extension ctx is stale after session replacement or reload"`, breaking all normal message forwarding in Feishu.

The same stale-ctx error prevents a second cardAction from working (first one succeeds, subsequent ones fail because `ctx` is already stale).

## Solution

Use `ctx.reload()` — which re-executes `export default function(pi)`, providing a fresh `pi` and fresh `ExtensionCommandContext` — after every session-replacing operation. Combined with `session_start` event re-binding, this allows unlimited session switches.

## Architecture

```
                        reload()
cardAction ──→ switchSession/newSession ──→ default(pi) re-executes
  (cmd ctx)     (pi stale)                   ↓
                                          fresh pi/ctx
                                              ↓
                                        session_start fires
                                              ↓
                                     attachHandler(fresh pi, fresh ctx)
                                              ↓
                                     all IPC messages work again
```

## Key Changes

### 1. `ipcClient` lifted to module scope

```
module scope:
  let ipcClient: IPCClient | null = null
```

After `reload()`, `ipcClient` survives. No disconnect/reconnect needed — only `removeAllListeners("message")` + new `on("message", ...)` to replace the stale handler closure.

### 2. `attachHandler(client, pi, ctx)` extracted

A standalone function that clears old IPC message listeners and binds a new one using the current `pi`/`ctx` from its parameters (not from a stale closure):

```typescript
function attachHandler(client: IPCClient, pi: ExtensionAPI, ctx: any): void {
    client.removeAllListeners("message");
    client.on("message", async (msg) => {
        // All message handling (ready, needAuth, message, cardAction, etc.)
        // pi and ctx are the function parameters — always fresh
    });
}
```

### 3. `session_start` re-binding

```typescript
pi.on("session_start", (_event, sessionCtx) => {
    if (ipcClient?.connected) {
        attachHandler(ipcClient, pi, sessionCtx);
    }
});
```

After `reload()`, `session_start` fires with a fresh `pi`. The handler re-attaches the IPC message listener with the fresh references.

### 4. `reload()` in `handleSessionsAction`

Only for operations that call Pi session APIs:

| Action | Pi API | Needs reload? |
|--------|--------|--------------|
| switch | `ctx.switchSession` | ✓ |
| new    | `ctx.newSession`    | ✓ |
| delete | pure local `rmSync` | ✗ |

In `withSession` callbacks:

```typescript
case "switch": {
    if (action.sessionPath === registry.current) return;
    await ctx.switchSession(action.sessionPath, { withSession: async (newCtx: any) => {
        registry.current = action.sessionPath;
        onUpdate(registry);
        await newCtx.reload();
    }});
    break;
}
```

### 5. `handleModelAction` simplified

`pi.setModel()` does NOT make `pi`/`ctx` stale. `handleModelAction` does not need `switchSession`/`newSession`/`withSession`/`reload`/`registry`/`onUpdate` at all:

```typescript
export async function handleModelAction(
  action: ModelAction,
  modelRegistry: { find: (provider: string, id: string) => unknown },
  setModel: (model: unknown) => Promise<boolean>,
): Promise<boolean> {
  const model = modelRegistry.find(action.modelProvider, action.modelId);
  if (!model) return false;
  return await setModel(model);
}
```

Caller (index.ts cardAction):
```typescript
const ok = await handleModelAction(modelAction, ctx.modelRegistry, (m) => pi.setModel(m as any));
saveRegistry(registry);
const models = ctx.modelRegistry.getAvailable() as ModelInfo[];
const cm = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
const card = buildModelCard(models, cm);
sendToDaemon({ type: "updateCard", messageId: msg.messageId, card });
```

If model not found (`!ok`), send an empty model card. No `onUpdate` callback, no double try-catch, no stale ctx.

### 6. `handleSessionsAction` keeps `onUpdate`

Switch/new modify registry inside `withSession` (where outer `ctx` is stale). `onUpdate` is needed to pass the updated registry back to the caller for `saveRegistry` + card rebuild. Delete modifies registry directly (no `withSession`), but still uses `onUpdate` for consistency.

## Operation Summary

| Operation | Pi API | pi stale? | Needs reload? | Needs onUpdate? |
|-----------|--------|-----------|--------------|----------------|
| cardAction switch | `ctx.switchSession` | ✓ | ✓ (inside withSession) | ✓ |
| cardAction new    | `ctx.newSession`    | ✓ | ✓ (inside withSession) | ✓ |
| cardAction delete | —                   | ✗ | ✗ | ✓ |
| modelAction select| `pi.setModel`       | ✗ | ✗ | ✗ |
| /sessions message | —                   | ✗ | ✗ | — |
| /model message    | —                   | ✗ | ✗ | — |
| normal message    | `pi.sendUserMessage`| ✗ | ✗ | — |

## Lifecycle

```
1. cold start:     default(pi) → registerCommand → user types /feishu-im start
                   → ipcClient = createIPCClient() → ipcClient.connect()
                   → attachHandler(ipcClient, pi, cmdCtx)

2. cardAction "switch":
                   cmdCtx.switchSession(path, { withSession: async (newCtx) => {
                       registry.current = path
                       onUpdate(registry)
                       await newCtx.reload()
                   }})

3. reload fires:   default(pi) re-executes → pi_v2 fresh
                   ipcClient still connected (module scope)

4. session_start:  attachHandler(ipcClient, pi_v2, sessionCtx)

5. normal message: pi_v2.sendUserMessage(prompt) → works

6. repeat 2-5 for unlimited session switches
```

## State Persistence Across reload

| State | Strategy |
|-------|----------|
| `ipcClient` | Module scope — survives reload |
| `registry` | `loadRegistry()` reads from disk each time |
| `activeChatId` | Reset to `null` on reload (in-flight messages during reload window are acceptable losses) |
| `forwardingCount` | Reset to `0` |

## Files Changed

| File | Change |
|------|--------|
| `extensions/index.ts` | Lift ipcClient, extract attachHandler, session_start re-binding, modelAction simplified |
| `extensions/bot-commands/sessions.ts` | reload() in switch/new withSession callbacks |
| `extensions/bot-commands/model.ts` | Remove switchSession/newSession/reload/onUpdate, simplify to pi.setModel |
| `tests/bot-commands/model.test.ts` | Update for simplified signature |
| `tests/bot-commands/sessions.test.ts` | Update for reload() behavior |
| `tests/extensions/index.test.ts` | Update for session_start + attachHandler pattern |

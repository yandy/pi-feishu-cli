# Stale ctx reload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Use `ctx.reload()` + `session_start` re-binding to give the extension a fresh `pi`/`ctx` after every session-switching cardAction.

**Architecture:** Lift `ipcClient` to module scope. Extract `attachHandler(client, pi, ctx)` to rebind IPC listeners. `session_start` re-binds handler. `newCtx.reload()` in session-switching `withSession` callbacks. Simplify `handleModelAction` since `pi.setModel` doesn't need session replacement.

---

### Task 1: Simplify `handleModelAction`

**Files:** `tests/bot-commands/model.test.ts`, `extensions/bot-commands/model.ts`

- [ ] **RED:** Replace handleModelAction tests with simplified 3-arg signature `(action, modelRegistry, setModel)`. 2 tests: found (calls setModel, returns true) / not found (doesn't call setModel, returns false).

```typescript
describe("handleModelAction", () => {
  it("calls setModel and returns true when model found", async () => {
    const modelRegistry = { find: vi.fn().mockReturnValue({ name: "GPT-4" }) };
    const setModel = vi.fn().mockResolvedValue(true);
    const action: ModelAction = { cmd: "model", action: "select", modelProvider: "openai", modelId: "gpt-4" };
    const result = await handleModelAction(action, modelRegistry, setModel);
    expect(modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4");
    expect(setModel).toHaveBeenCalledWith({ name: "GPT-4" });
    expect(result).toBe(true);
  });

  it("returns false and does not call setModel when model not found", async () => {
    const modelRegistry = { find: vi.fn().mockReturnValue(undefined) };
    const setModel = vi.fn();
    const action: ModelAction = { cmd: "model", action: "select", modelProvider: "unknown", modelId: "nonexistent" };
    const result = await handleModelAction(action, modelRegistry, setModel);
    expect(setModel).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});
```

Run: `npx vitest run tests/bot-commands/model.test.ts -t "handleModelAction"` → FAIL (6 args vs 3)

- [ ] **GREEN:** Rewrite `handleModelAction` in model.ts:

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

Remove unused imports: `createNoteBlock`, `type FeishuSelectOption`, `buildCard`, `FeishuCardElement` — check if used by `buildModelCard`. Keep all used ones.

Run: `npx vitest run tests/bot-commands/model.test.ts` → 5 PASS

- [ ] **Commit:** `git add -A && git commit -m "refactor: simplify handleModelAction"`

---

### Task 2: Add `reload()` to handleSessionsAction switch + new

**Files:** `tests/bot-commands/sessions.test.ts`, `extensions/bot-commands/sessions.ts`

- [ ] **RED:** Update tests to verify `newCtx.reload()` is called in both switch and new.

Update switch test to provide `{ reload: vi.fn() }` to withSession mock, assert `reload` called.
Update new test similarly, assert `reload` called.

Run: `npx vitest run tests/bot-commands/sessions.test.ts -t "handleSessionsAction"` → FAIL (reload not called)

- [ ] **GREEN:** In sessions.ts `handleSessionsAction`, add `await newCtx.reload()` at end of both switch and new `withSession` callbacks:

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
    case "new": {
      await ctx.newSession({ withSession: async (newCtx: any) => {
        const sf = newCtx.sessionManager.getSessionFile();
        if (sf) { registry.current = sf; registry.sessions = [...new Set([...registry.sessions, sf])]; }
        onUpdate(registry);
        await newCtx.reload();
      }});
      break;
    }
```

Run: `npx vitest run tests/bot-commands/sessions.test.ts` → 10 PASS

- [ ] **Commit:** `git add -A && git commit -m "feat: add reload() to handleSessionsAction switch and new"`

---

### Task 3: index.ts restructuring — ipcClient lift, attachHandler, session_start, model cardAction

**Files:** `tests/extensions/index.test.ts`, `extensions/index.ts`

- [ ] **RED:** Add test for session_start rebinding.

Update `createMockAPI()` to return `handlers` Map (if not already). Add test verifying session_start handler exists and re-attaches IPC listener.

Run: `npx vitest run tests/extensions/index.test.ts -t "re-binds"` → FAIL (no session_start re-bind)

- [ ] **GREEN:** Restructure index.ts:

(a) Lift `ipcClient` to module scope (outside `default(pi)`)
(b) Extract `attachHandler(client, piExtension, ctxExtension)` — the entire message handling switch
(c) `getClient()` — remove `onMessage` param (no longer binds message listener)
(d) Command handler "start": `attachHandler(client, pi, ctx)` after connect
(e) Replace debug `session_start` handler with re-binding:
```typescript
pi.on("session_start", (_event: any, sessionCtx: any) => {
    if (ipcClient?.connected) attachHandler(ipcClient, pi, sessionCtx);
});
```
(f) Simplify model cardAction handler to use new `handleModelAction` directly
(g) Clean up the debug `console.error` in pi.sendUserMessage catch block

Run: `npx vitest run tests/extensions/index.test.ts -t "re-binds"` → PASS

- [ ] **Commit:** `git add -A && git commit -m "feat: ipcClient lift, attachHandler, session_start rebind"`

---

### Task 4: Full verification

- [ ] Run all tests: `npx vitest run`
- [ ] Typecheck: `npx tsc --noEmit`
- [ ] Commit cleanup if needed

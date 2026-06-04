# Models Card UI 优化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/models` card layout with provider grouping, model info display (input modality, context window), and shared thinking level at the bottom.

**Architecture:** Single-file change to `src/feishu/cards/models.ts` — group available models by `provider`, show `name`/`input`/`contextWindow` per model, move 6 thinking level buttons to bottom as shared controls. No server-side logic changes needed (callback shape stays `action:"select"`).

**Tech Stack:** TypeScript, Feishu interactive card v2.0

---

### TDD Phase 1 — RED

### Task 1: Write failing tests for new layout

**Files:**
- Modify: `tests/feishu/cards.test.ts` (models card section, lines 90-157)
- Modify: `tests/feishu/builders.test.ts` (mock model data, lines 37-38, 47-48)

**Changes:**

1. **Update mock model data** in both test files to include `name`, `input`, `contextWindow`:
   ```typescript
   { provider: "openai", id: "gpt-4", name: "GPT-4", input: ["text", "image"] as ("text" | "image")[], contextWindow: 128000 }
   ```

2. **Rewrite `cards.test.ts` models card section** with these tests:

| Test | What it checks |
|------|---------------|
| `current model line shows name, provider, level, input, context` | The `**当前**` markdown contains all 5 fields |
| `action buttons use short thinking labels` | Button texts don't contain "Think:" prefix, use short labels |
| `divides sections with hr elements` | At least 2 `hr` elements (between status/models, and models/level) |
| `model names are bolded in markdown` | Markdown content has `**GPT-4**`, `**Claude 3**` |
| `current model has no [选取] button, other models do` | Only non-current models get [选取] buttons |
| `thinking level buttons carry current model in callback` | Level button callbacks contain current model's provider/modelId |
| `groups models by provider` | Provider section headers appear as `**── provider ──**` |

3. Run tests to verify they FAIL (RED).

- [ ] **Step 1: Update mock data in cards.test.ts**

```typescript
// Replace existing mockSession and mockModels with full model data
const mockSession = {
  model: {
    provider: "test",
    id: "gpt-4",
    name: "GPT-4",
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 128000,
  },
  thinkingLevel: "high" as const,
};
const mockModels = [
  {
    provider: "openai",
    id: "gpt-4",
    name: "GPT-4",
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 128000,
  },
  {
    provider: "anthropic",
    id: "claude-3",
    name: "Claude 3",
    input: ["text", "image"] as ("text" | "image")[],
    contextWindow: 200000,
  },
];
```

- [ ] **Step 2: Rewrite all 7 tests in cards.test.ts models card section**

- [ ] **Step 3: Update mock data in builders.test.ts**

```typescript
// builders.test.ts lines 37-38 and 47-48
availableModels: [{
  provider: "test",
  id: "test-model",
  name: "Test Model",
  input: ["text"] as ("text" | "image")[],
  contextWindow: 1000,
}],
```

- [ ] **Step 4: Run tests and verify RED**

Run: `npx vitest run tests/feishu/cards.test.ts tests/feishu/builders.test.ts --reporter verbose`

Expected: Tests in "models card" section FAIL because old code doesn't produce new layout.

---

### TDD Phase 2 — GREEN

### Task 2: Rewrite `buildModelsCard` to pass tests

**Files:**
- Modify: `src/feishu/cards/models.ts`

**Changes:**

Replace the entire `buildModelsCard` function. New design:

```
┌─ Model 管理 ─────────────────────────────────────┐
│  当前                                              │
│  GPT-4 (test) · high · text+image · 128K           │
│  ─────────────────────────────────────────         │
│  ── openai ──                                      │
│  **GPT-4** · text+image · 128K         [选取]      │
│  ── anthropic ──                                   │
│  **Claude 3** · text+image · 200K                  │
│  ─────────────────────────────────────────         │
│  思考级别                                           │
│  [off] [min] [low] [med] [high] [xhigh]            │
└────────────────────────────────────────────────────┘
```

Key implementation details:

1. **`ModelCardOptions.availableModels`** — the new `Model` interface requires `name`, `input`, `contextWindow`.
2. **Group by provider** — use a simple `groupBy` helper (Map-based).
3. **Current model** — show in status section; in model list, append ` — 当前` to markdown, no button.
4. **Thinking level buttons** — at bottom, all carry `{ cmd:"model", action:"select", provider:currentProvider, modelId:currentModelId, thinkingLevel:level }`.
5. **Model [选取] buttons** — carry `{ cmd:"model", action:"select", provider, modelId, thinkingLevel: session.thinkingLevel }`.

Helper functions:
- `inputLabel(input)`: `["text", "image"]` → `"text+image"`, `["text"]` → `"text"`
- `fmtContext(n)`: `200000` → `"200K"`, `128000` → `"128K"`
- `groupBy(items, keyFn)`: generic Map-based group

- [ ] **Step 1: Rewrite `buildModelsCard` with new layout**

Update `src/feishu/cards/models.ts`:

```typescript
export interface Model {
  provider: string;
  id: string;
  name: string;
  input: ("text" | "image")[];
  contextWindow: number;
}
```

Implement `inputLabel`, `fmtContext`, `groupBy` helpers.

Implement `buildModelsCard` with the new layout.

- [ ] **Step 2: Run tests and verify GREEN**

Run: `npx vitest run tests/feishu/cards.test.ts tests/feishu/builders.test.ts --reporter verbose`

Expected: All tests pass.

---

### TDD Phase 3 — REFACTOR

### Task 3: Typecheck, lint, and final verification

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --reporter verbose`
Expected: 86+ tests pass.

- [ ] **Step 3: Run lint**

Run: `npx biome check --write src/feishu/cards/models.ts tests/feishu/cards.test.ts tests/feishu/builders.test.ts`
Expected: No errors (format fixes applied).

- [ ] **Step 4: Commit**

```bash
git add src/feishu/cards/models.ts tests/feishu/cards.test.ts tests/feishu/builders.test.ts docs/superpowers/specs/2026-06-04-models-card-ui-optimization.md docs/superpowers/plans/2026-06-04-models-card-ui-optimization.md
git commit -m "feat: redesign /models card layout with provider grouping and model info"
```

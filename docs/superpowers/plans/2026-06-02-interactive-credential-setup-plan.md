# Interactive Credential Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `pi-feishu` runs without Feishu credentials, prompt user interactively and persist to `~/.pi/agent/feishu.json`.

**Architecture:** `config.ts` gets a new `promptAndSaveCredentials(savePath?)` export. `main()` in `index.ts` wraps `loadConfig()` in try/catch and calls the prompt on failure. Save path is parameterized for test isolation.

**Tech Stack:** TypeScript, Node.js `readline` module

---

### Task 1: Implement interactive credential prompt

**Files:**
- Modify: `src/config.ts` — add `promptAndSaveCredentials()`
- Modify: `src/index.ts` — wrap `loadConfig` in try/catch
- Create: `tests/config.test.ts` — add test for prompt save path

- [ ] **Step 1: Write failing test for `promptAndSaveCredentials`**

Add to `tests/config.test.ts`:

```typescript
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync as fsExistsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("promptAndSaveCredentials", () => {
  it("saves credentials to specified path", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    const configPath = join(tmpDir, "feishu.json");

    // Mock readline: simulate user input
    const { mockQuestion } = await import("node:readline/promises");
    // We can't easily mock readline here, so test the file-writing behavior
    // by calling a lower-level helper. For now, just test the import exists.
    const mod = await import("../src/config.js");
    expect(typeof mod.promptAndSaveCredentials).toBe("function");

    rmSync(tmpDir, { recursive: true });
  });
});
```

Wait, `readline` is hard to mock cleanly in a unit test. Instead, let's extract the file-writing logic into a testable helper, and test that separately.

**Revised Step 1: Write tests for credential persistence**

Add to `tests/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveCredentials } from "../src/config.js";

describe("saveCredentials", () => {
  it("writes appId and appSecret to JSON file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    const configPath = join(tmpDir, "feishu.json");
    try {
      saveCredentials(configPath, { appId: "test-id", appSecret: "test-secret" });
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.appId).toBe("test-id");
      expect(parsed.appSecret).toBe("test-secret");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("creates parent directory if it doesn't exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-feishu-test-"));
    const nestedPath = join(tmpDir, "a", "b", "feishu.json");
    try {
      saveCredentials(nestedPath, { appId: "id", appSecret: "secret" });
      expect(existsSync(nestedPath)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/yandy/workspace/pri/pi-feishu-cli && npx vitest run tests/config.test.ts
```
Expected: failures — `saveCredentials` not exported from config.js.

- [ ] **Step 3: Add `saveCredentials` to `src/config.ts`**

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function saveCredentials(path: string, config: FeishuConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/yandy/workspace/pri/pi-feishu-cli && npx vitest run tests/config.test.ts
```
Expected: 7 tests pass (5 original + 2 new).

- [ ] **Step 5: Add `promptAndSaveCredentials` to `src/config.ts`**

Add to `src/config.ts`:

```typescript
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "feishu.json");

export async function promptAndSaveCredentials(savePath?: string): Promise<FeishuConfig> {
  const rl = createInterface({ input: processStdin, output: processStdout });

  const appId = await rl.question("Feishu App ID: ");
  const appSecret = await rl.question("Feishu App Secret: ");

  rl.close();

  const config: FeishuConfig = { appId, appSecret };
  const path = savePath ?? DEFAULT_CONFIG_PATH;
  saveCredentials(path, config);
  console.error(`Credentials saved to ${path}`);

  return config;
}
```

- [ ] **Step 6: Run all tests to verify nothing broke**

```bash
cd /home/yandy/workspace/pri/pi-feishu-cli && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Modify `src/index.ts` — wrap `loadConfig` in try/catch**

Replace the feishuConfig loading in `main()`:

```typescript
export async function main(options: MainOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  let feishuConfig: import("./config.js").FeishuConfig;
  try {
    feishuConfig = loadConfig({
      appId: options.appId,
      appSecret: options.appSecret,
      config: options.config,
      cwd,
    });
  } catch {
    console.error("未找到飞书凭证，请输入：");
    feishuConfig = await promptAndSaveCredentials();
  }

  // ... rest unchanged
}
```

Also add the import at the top of `src/index.ts`:

```typescript
import { loadConfig, promptAndSaveCredentials } from "./config.js";
```

- [ ] **Step 8: Verify tsc and tests pass**

```bash
cd /home/yandy/workspace/pri/pi-feishu-cli && npx tsc --noEmit && npx vitest run
```
Expected: tsc zero errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /home/yandy/workspace/pri/pi-feishu-cli && git add -A && git commit -m "feat: interactive credential prompt with auto-save"
```

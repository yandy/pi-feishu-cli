# Fix pi Extension Config: Global + Project Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `.pi`/`~/.pi/agent` paths with `CONFIG_DIR_NAME`/`getAgentDir()`, and merge both global and project configs with project fields overriding global.

**Architecture:** `src/config.ts` loads both `${getAgentDir()}/feishu.json` (global) and `${cwd}/${CONFIG_DIR_NAME}/feishu.json` (project), shallow-merges with project priority. Priority chain unchanged: CLI args > project config > global config > env vars.

**Tech Stack:** TypeScript, Node.js, Vitest, `@earendil-works/pi-coding-agent@^0.79.9`

## Global Constraints

- `CONFIG_DIR_NAME` imported from `@earendil-works/pi-coding-agent` (≥0.79.9) — defaults to `.pi`
- `getAgentDir()` imported from `@earendil-works/pi-coding-agent` — respects `PI_AGENT_DIR` env var, defaults to `${homedir()}/${CONFIG_DIR_NAME}/agent`
- `DEFAULT_SAVE_PATH` must use `getAgentDir()` instead of hardcoded `~/.pi/agent`
- Backward compatibility: explicit `config` option still bypasses dual-file merge
- All existing tests must pass after changes
- TDD: every test written and verified failing before implementation code is written

---

### Task 1: Dependency upgrade and verify CONFIG_DIR_NAME

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent@0.79.1` (current)
- Produces: `@earendil-works/pi-coding-agent@^0.79.9`

- [ ] **Step 1: Upgrade dependency**

```bash
npm install @earendil-works/pi-coding-agent@^0.79.9
```

- [ ] **Step 2: Verify CONFIG_DIR_NAME and getAgentDir are importable**

Create a quick one-liner test file or use `grep` on `node_modules/@earendil-works/pi-coding-agent/dist/config.d.ts`:
```
Expected: export declare const CONFIG_DIR_NAME: string;
Expected: export declare function getAgentDir(): string;
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade @earendil-works/pi-coding-agent to ^0.79.9"
```

---

### Task 2: Write failing tests for dual-file merge behavior

**Files:**
- Modify: `tests/config.test.ts`

**Interfaces:**
- Consumes: `loadConfig` from `../src/config.js`
- Produces: New test cases verifying merge behavior

- [ ] **Step 1: Add import for getAgentDir mock setup**

Since tests need to control both global and project config paths without hardcoding `.pi`, set `PI_AGENT_DIR` env var to a temp directory for global config.

In `tests/config.test.ts`, add these test cases after existing `describe("loadConfig", ...)` tests:

```typescript
describe("config merge: global + project", () => {
  const tmpDir = join(process.cwd(), "tests", "__tmp_merge__");

  function cleanup() {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  }

  afterEach(cleanup);

  it("merges global and project configs with project overriding global on same-name fields", () => {
    const prevAgentDir = process.env.PI_AGENT_DIR;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true }); // CONFIG_DIR_NAME = ".pi"
    process.env.PI_AGENT_DIR = globalDir;

    try {
      // Global config has appId and botName
      writeFileSync(
        join(globalDir, "feishu.json"),
        JSON.stringify({ appId: "global-id", appSecret: "global-secret", botName: "GlobalBot" }),
      );
      // Project config overrides botName, adds noBundleFeishuSkills
      writeFileSync(
        join(projectDir, ".pi", "feishu.json"),
        JSON.stringify({ botName: "ProjectBot", noBundleFeishuSkills: true }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      // appId/appSecret from global (project doesn't have them)
      expect(cfg.appId).toBe("global-id");
      expect(cfg.appSecret).toBe("global-secret");
      // botName overridden by project
      expect(cfg.botName).toBe("ProjectBot");
      // noBundleFeishuSkills from project
      expect(cfg.noBundleFeishuSkills).toBe(true);
    } finally {
      process.env.PI_AGENT_DIR = prevAgentDir;
      cleanup();
    }
  });

  it("uses only global config when project config does not exist", () => {
    const prevAgentDir = process.env.PI_AGENT_DIR;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project"); // no .pi/feishu.json here
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.PI_AGENT_DIR = globalDir;

    try {
      writeFileSync(
        join(globalDir, "feishu.json"),
        JSON.stringify({ appId: "global-id", appSecret: "global-secret", botName: "GlobalBot" }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("global-id");
      expect(cfg.appSecret).toBe("global-secret");
      expect(cfg.botName).toBe("GlobalBot");
    } finally {
      process.env.PI_AGENT_DIR = prevAgentDir;
      cleanup();
    }
  });

  it("uses only project config when global config does not exist", () => {
    const prevAgentDir = process.env.PI_AGENT_DIR;
    const globalDir = join(tmpDir, "global"); // no feishu.json here
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    process.env.PI_AGENT_DIR = globalDir;

    try {
      writeFileSync(
        join(projectDir, ".pi", "feishu.json"),
        JSON.stringify({ appId: "project-id", appSecret: "project-secret", botName: "ProjectBot" }),
      );

      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("project-id");
      expect(cfg.appSecret).toBe("project-secret");
      expect(cfg.botName).toBe("ProjectBot");
    } finally {
      process.env.PI_AGENT_DIR = prevAgentDir;
      cleanup();
    }
  });

  it("falls back to env vars when neither config file exists", () => {
    const prevAgentDir = process.env.PI_AGENT_DIR;
    const prevId = process.env.FEISHU_APP_ID;
    const prevSecret = process.env.FEISHU_APP_SECRET;
    const globalDir = join(tmpDir, "global");
    const projectDir = join(tmpDir, "project");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.PI_AGENT_DIR = globalDir;
    process.env.FEISHU_APP_ID = "env-id";
    process.env.FEISHU_APP_SECRET = "env-secret";

    try {
      const cfg = loadConfig({ cwd: projectDir });

      expect(cfg.appId).toBe("env-id");
      expect(cfg.appSecret).toBe("env-secret");
    } finally {
      process.env.PI_AGENT_DIR = prevAgentDir;
      process.env.FEISHU_APP_ID = prevId;
      process.env.FEISHU_APP_SECRET = prevSecret;
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```
Expected: New tests FAIL because `loadConfig` still uses old `findConfigFile` that only loads one file (the first found).

- [ ] **Step 3: Commit**

```bash
git add tests/config.test.ts
git commit -m "test: add failing tests for global + project config merge"
```

---

### Task 3: Implement dual-file merge in src/config.ts

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: `CONFIG_DIR_NAME`, `getAgentDir` from `@earendil-works/pi-coding-agent`
- Consumes: `FeishuConfig` from `./types.js`
- Produces: Updated `loadConfig` with merge logic

- [ ] **Step 1: Add import for CONFIG_DIR_NAME and getAgentDir**

In `src/config.ts`, update the imports. Currently there are no pi imports. Add:

```typescript
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
```

Add this near the top, after the existing `node:*` imports.

- [ ] **Step 2: Replace `findConfigFile` with `loadFileConfigs`**

Remove the existing `findConfigFile` function (lines that search two hardcoded paths) and replace with:

```typescript
function findConfigFile(cwd: string): string | null {
  const projectPath = join(cwd, CONFIG_DIR_NAME, "feishu.json");
  const globalPath = join(getAgentDir(), "feishu.json");

  if (existsSync(projectPath)) return projectPath;
  if (existsSync(globalPath)) return globalPath;
  return null;
}

function loadFileConfigs(cwd: string): {
  project: FeishuConfig | null;
  global: FeishuConfig | null;
} {
  const projectPath = join(cwd, CONFIG_DIR_NAME, "feishu.json");
  const globalPath = join(getAgentDir(), "feishu.json");

  return {
    project: (existsSync(projectPath) ? loadFileConfig(projectPath) : null),
    global: (existsSync(globalPath) ? loadFileConfig(globalPath) : null),
  };
}
```

Note: Keep `findConfigFile` for backward compatibility when `options.config` is explicitly provided — it returns the first matching path (unchanged behavior for explicit config).

- [ ] **Step 3: Update `loadConfig` to merge both configs**

In `loadConfig`, replace the file config loading section. Current code:

```typescript
let fileConfig: FeishuConfig | null = null;
const configPath =
  options.config ?? findConfigFile(options.cwd ?? process.cwd());
if (configPath) {
  fileConfig = loadFileConfig(configPath);
}
```

Replace with:

```typescript
let fileConfig: FeishuConfig | null = null;
const configPath = options.config;

if (configPath) {
  // Explicit config path: single-file mode (backward compatible)
  fileConfig = loadFileConfig(configPath);
} else {
  // Dual-file merge: global + project with project overriding
  const { project, global } = loadFileConfigs(options.cwd ?? process.cwd());
  if (project || global) {
    fileConfig = { ...global, ...project };
  }
}
```

- [ ] **Step 4: Update `DEFAULT_SAVE_PATH`**

Replace:

```typescript
const DEFAULT_SAVE_PATH = join(homedir(), ".pi", "agent", "feishu.json");
```

With:

```typescript
const DEFAULT_SAVE_PATH = join(getAgentDir(), "feishu.json");
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```
Expected: All tests PASS — both existing and new merge tests.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```
Expected: All tests PASS across the project.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts
git commit -m "feat: merge global + project configs using CONFIG_DIR_NAME and getAgentDir"
```
